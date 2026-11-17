'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import {
  clockOffset, FRAMES_PER_MESSAGE, FRAME_STRIDE, PROTOCOL_VERSION, songPositionAt,
  type ClockPongEvent, type LiveScoreEvent, type ResultsEvent, type SessionEvent, type TransportEvent,
} from '@soundcheck/contracts';
import { supabaseBrowser } from '@/lib/supabase/client';
import { openSessionChannel, type SessionChannel } from '@/session/channel';
import { startMic, type MicHandle } from '@/stage/mic';
import { lineAt } from '@/stage/StageLyrics';
import { RequestSong } from '@/session/RequestSong';
import { VoiceSender } from '@/session/voice';
import type { StageLine } from '@/stage/useStageData';

type Step = 'name' | 'joining' | 'joined' | 'calibrating' | 'live' | 'error';

/**
 * SoundCheck Mobile (browser): a phone becomes a wireless mic for the TV session. Computes pitch
 * locally and streams 10-frame batches over the session's Realtime channel (docs/ARCHITECTURE.md).
 */
export default function JoinSessionPage() {
  const { code } = useParams<{ code: string }>();
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [member, setMember] = useState<{ id: string; color: string } | null>(null);
  const [transportState, setTransportState] = useState<TransportEvent['state']>('idle');
  const [level, setLevel] = useState(0);
  const [live, setLive] = useState<{ hitRate: number } | null>(null);
  const [result, setResult] = useState<ResultsEvent['performances'][number] | null>(null);
  const [line, setLine] = useState<string>('');
  const [muted, setMuted] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [queueVersion, setQueueVersion] = useState(0);
  const [voiceLive, setVoiceLive] = useState(false);
  const voiceWanted = useRef(false);
  const sender = useRef<VoiceSender | null>(null);
  /** Start or stop sending this phone's voice to the TV, following the host's switch. */
  const syncVoice = useCallback(() => {
    const me = memberRef.current;
    if (voiceWanted.current && mic.current && me && ch.current) {
      if (!sender.current) {
        sender.current = new VoiceSender(me, (ev) => void ch.current?.send(ev));
        void sender.current.start(mic.current.stream).then(() => setVoiceLive(true)).catch(() => setVoiceLive(false));
      }
    } else if (sender.current) {
      sender.current.stop(); sender.current = null; setVoiceLive(false);
    }
  }, []);

  const ch = useRef<SessionChannel | null>(null);
  const mic = useRef<MicHandle | null>(null);
  const transport = useRef<TransportEvent | null>(null);
  const offset = useRef(0);
  const pongs = useRef<{ offsetMs: number; rttMs: number }[]>([]);
  const batch = useRef<number[]>([]);
  const seq = useRef(0);
  const memberRef = useRef<string | null>(null);
  const mutedRef = useRef(false);
  const lines = useRef<StageLine[]>([]);
  const lyricsFor = useRef<string | null>(null);

  const songTime = useCallback(() => (transport.current ? songPositionAt(transport.current, Date.now(), offset.current) : 0), []);

  // dev-only hook so E2E tests can sync a simulated singer to the song clock
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    (window as unknown as { __soundcheckJoin?: unknown }).__soundcheckJoin = { position: songTime, playing: () => transport.current?.state === 'playing' };
  }, [songTime]);

  const onEvent = useCallback((e: SessionEvent) => {
    const me = memberRef.current;
    if (e.type === 'transport') {
      // a new song (or the same song again) starting: the previous score card goes away
      if (e.state === 'playing' && transport.current?.state !== 'playing') setResult(null);
      // frames still waiting in a partial batch belong to the previous take (or song): never send them late
      if (e.state !== 'playing' || transport.current?.state !== 'playing') batch.current = [];
      transport.current = e;
      setTransportState(e.state);
      if (e.trackId && lyricsFor.current !== e.trackId) {
        lyricsFor.current = e.trackId;
        void supabaseBrowser().functions.invoke<{ lines: StageLine[] }>('fetch-lyrics', { body: { track_id: e.trackId } })
          .then(({ data }) => { lines.current = (data?.lines ?? []).filter((l) => l.text?.trim() && l.start != null); });
      }
    } else if (e.type === 'clock_pong' && e.memberId === me) {
      pongs.current.push(clockOffset(e as ClockPongEvent, Date.now()));
      // the lowest-RTT exchanges give the most accurate offset
      const best = [...pongs.current].sort((a, b) => a.rttMs - b.rttMs).slice(0, 3);
      offset.current = best.reduce((s, p) => s + p.offsetMs, 0) / best.length;
    } else if (e.type === 'live_score') {
      const mine = (e as LiveScoreEvent).scores.find((s) => s.memberId === me);
      if (mine) setLive({ hitRate: mine.hitRate });
    } else if (e.type === 'results') {
      const mine = e.performances.find((p) => p.memberId === me);
      if (mine) setResult(mine);
    } else if (e.type === 'voice') {
      voiceWanted.current = e.enabled;
      syncVoice();
    } else if (e.type === 'rtc' && e.from === 'host' && e.memberId === me) {
      void sender.current?.handle(e);
    } else if (e.type === 'queue_changed') {
      setQueueVersion((v) => v + 1);
    } else if (e.type === 'host_command' && e.memberId === me) {
      if (e.command === 'mute') { mutedRef.current = true; setMuted(true); }
      if (e.command === 'unmute') { mutedRef.current = false; setMuted(false); }
    }
  }, [syncVoice]);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setStep('joining');
    try {
      const sb = supabaseBrowser();
      let { data: { user } } = await sb.auth.getUser();
      if (!user) {
        const { data, error: err } = await sb.auth.signInAnonymously({ options: { data: { display_name: name.trim() || 'Singer' } } });
        if (err) throw err;
        user = data.user;
      }
      const { data, error: err } = await sb.rpc('join_session', { p_code: code, p_display_name: name.trim() || 'Singer', p_platform: 'web' });
      if (err || !data?.[0]) throw new Error(err?.message.includes('invalid') ? 'That code isn’t active. Check the TV.' : err?.message ?? 'Could not join');
      const m = { id: data[0].member_id, color: data[0].color };
      memberRef.current = m.id;
      ch.current = await openSessionChannel(data[0].session_id, m.id, onEvent);
      await ch.current.track({ memberId: m.id, displayName: name.trim() || 'Singer', role: 'singer', platform: 'web', color: m.color, mic: 'off' });
      // clock sync: a few pings; pongs refine the offset
      for (let i = 0; i < 6; i++) {
        setTimeout(() => void ch.current?.send({ type: 'clock_ping', v: PROTOCOL_VERSION, memberId: m.id, id: i, t0: Date.now() }), i * 250);
      }
      setSessionId(data[0].session_id);
      setMember(m);
      setStep('joined');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('error');
    }
  }

  async function micOn() {
    if (!member) return;
    const ctx = new AudioContext({ latencyHint: 'interactive' }); // created inside the tap (user activation)
    void ctx.resume();
    setStep('calibrating');
    try {
      mic.current = await startMic((f) => {
        setLevel(Math.max(0, Math.min(1, (f.rmsDb + 60) / 50)));
        const t = transport.current;
        if (!t || t.state !== 'playing' || mutedRef.current) return;
        // song time the singer is hearing now, minus this phone's capture latency
        const st = songPositionAt(t, Date.now() - (mic.current?.inputLatencyMs ?? 0), offset.current);
        batch.current.push(+st.toFixed(3), +f.f0.toFixed(2), +f.conf.toFixed(3), +f.rmsDb.toFixed(1));
        if (batch.current.length >= FRAMES_PER_MESSAGE * FRAME_STRIDE) {
          const frames = batch.current;
          batch.current = [];
          void ch.current?.send({ type: 'pitch', v: PROTOCOL_VERSION, memberId: member.id, seq: seq.current++, frames });
        }
      }, ctx);
      const floor = await mic.current.calibrate(1500);
      await ch.current?.send({ type: 'mic_status', v: PROTOCOL_VERSION, memberId: member.id, state: 'ready', noiseFloorDb: floor, latencyMs: mic.current.inputLatencyMs });
      await ch.current?.track({ memberId: member.id, displayName: name.trim() || 'Singer', role: 'singer', platform: 'web', color: member.color, mic: 'ready' });
      try { await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<unknown> } }).wakeLock?.request('screen'); } catch { /* optional */ }
      setStep('live');
      syncVoice();   // the host may already have voices on
    } catch (err) {
      setError(err instanceof Error && err.name === 'NotAllowedError' ? 'Allow microphone access to sing.' : 'Microphone unavailable.');
      setStep('error');
    }
  }

  // current lyric line on the phone (follows the shared song clock)
  useEffect(() => {
    if (step !== 'live') return;
    const iv = setInterval(() => {
      const t = songTime();
      const i = lineAt(lines.current, t);
      setLine(i >= 0 ? lines.current[i]!.text : '');
    }, 200);
    return () => clearInterval(iv);
  }, [step, songTime]);

  useEffect(() => () => { sender.current?.stop(); mic.current?.stop(); void ch.current?.close(); }, []);

  const shell = 'flex h-full flex-col items-center justify-center gap-6 p-6 text-center';
  if (step === 'name' || step === 'joining') {
    return (
      <main className={shell}>
        <p className="font-display text-sm font-bold uppercase tracking-[0.3em] text-pink-400">SoundCheck Party · {code}</p>
        <h1 className="font-display text-4xl font-extrabold tracking-tight">What’s your stage name?</h1>
        <form onSubmit={join} className="w-full max-w-xs">
          <label htmlFor="nm" className="sr-only">Stage name</label>
          <input id="nm" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus placeholder="e.g. Sam"
            className="w-full rounded-2xl border-2 border-ink-700 bg-ink-850 px-4 py-4 text-center text-2xl font-bold focus:border-pink-500 focus:outline-none" />
          <button type="submit" disabled={step === 'joining'} className="stage-gradient mt-6 w-full rounded-full py-4 text-lg font-bold disabled:opacity-60">
            {step === 'joining' ? 'Joining…' : 'Join'}
          </button>
        </form>
      </main>
    );
  }
  if (step === 'error') {
    return <main className={shell}><p role="alert" className="text-xl text-danger-400">{error}</p><Link className="underline" href="/join">Try another code</Link></main>;
  }
  if (step === 'joined' || step === 'calibrating') {
    return (
      <main className={shell}>
        <div className="h-4 w-4 rounded-full" style={{ background: member?.color }} />
        <h1 className="font-display text-3xl font-extrabold">You’re in, {name || 'Singer'}!</h1>
        <p className="text-ink-300">Hold your phone like a microphone, about a hand’s width from your mouth.</p>
        <button type="button" onClick={() => void micOn()} disabled={step === 'calibrating'}
          className="flex h-40 w-40 items-center justify-center rounded-full shadow-lift disabled:opacity-60" style={{ background: member?.color }} aria-label="Turn on my microphone">
          <Mic size={64} className="text-ink-950" />
        </button>
        <p className="text-sm text-ink-500" role="status">{step === 'calibrating' ? 'Stay quiet for a second…' : 'Tap to turn on your mic'}</p>
        {sessionId && <RequestSong sessionId={sessionId} version={queueVersion} notify={(ev) => void ch.current?.send(ev)} />}
      </main>
    );
  }
  return (
    <main className={shell}>
      {result ? (
        <div role="dialog" aria-label="Your score">
          <p className="text-sm font-bold uppercase tracking-widest text-ink-300">SoundCheck Score</p>
          <p className="font-display text-8xl font-black tabular-nums">{result.score}</p>
          <p className="font-display text-3xl font-black" style={{ color: member?.color }}>{result.grade}</p>
          <ul className="mt-4 space-y-1 text-sm text-ink-300">{result.feedback.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      ) : (
        <>
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-ink-500">
            {transportState === 'playing' ? 'Live' : transportState === 'paused' ? 'Paused' : 'Waiting for the song'}
          </p>
          <p className="min-h-[5rem] font-display text-3xl font-bold leading-tight" aria-live="polite">{line}</p>
          <div className="relative flex h-44 w-44 items-center justify-center rounded-full" style={{ background: `${member?.color}22` }}>
            <div className="absolute inset-0 rounded-full transition-transform" style={{ background: member?.color, opacity: 0.35, transform: `scale(${0.6 + level * 0.4})` }} />
            {muted ? <MicOff size={56} /> : <Mic size={56} />}
          </div>
          {live && <p className="font-display text-2xl font-bold" role="status">On pitch {Math.round(live.hitRate * 100)}%</p>}
          {muted && <p className="text-gold-400">The host muted your mic</p>}
          {voiceLive && <p className="text-sm text-ink-300" role="status">🔊 Your voice is on the TV</p>}
        </>
      )}
      {sessionId && <RequestSong sessionId={sessionId} version={queueVersion} notify={(ev) => void ch.current?.send(ev)} />}
    </main>
  );
}
