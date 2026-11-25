'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Volume2 } from 'lucide-react';
import {
  clockOffset, FRAMES_PER_MESSAGE, FRAME_STRIDE, PROTOCOL_VERSION, songPositionAt,
  type ClockPongEvent, type LiveScoreEvent, type ResultsEvent, type SessionEvent, type TransportEvent,
} from '@soundcheck/contracts';
import { supabaseBrowser } from '@/lib/supabase/client';
import { openSessionChannel, type SessionChannel } from '@/session/channel';
import { startMic, type MicHandle } from '@/stage/mic';
import { StageLyrics } from '@/stage/StageLyrics';
import { PitchHud } from '@/stage/PitchHud';
import { RequestSong } from '@/session/RequestSong';
import { VoiceSender } from '@/session/voice';
import type { StageLine, StageNote } from '@/stage/useStageData';

const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
/** "A4 +12¢" for a frequency. */
function noteName(f0: number): { name: string; cents: number } {
  const midi = 69 + 12 * Math.log2(f0 / 440);
  const n = Math.round(midi);
  return { name: `${NOTE[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`, cents: Math.round((midi - n) * 100) };
}

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
  const [lyrics, setLyrics] = useState<StageLine[]>([]);
  const [notes, setNotes] = useState<StageNote[]>([]);
  const [tuner, setTuner] = useState<{ name: string; cents: number } | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const [myGain, setMyGain] = useState(1);
  const trail = useRef<[number, number | null][]>([]);
  const quietSince = useRef<number | null>(null);
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
  const floorRef = useRef<number | null>(null);
  const lastPitch = useRef(0);
  const lastDb = useRef(-90);
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
        trail.current = [];
        const sb = supabaseBrowser();
        void sb.functions.invoke<{ lines: StageLine[] }>('fetch-lyrics', { body: { track_id: e.trackId } })
          .then(({ data }) => { lines.current = (data?.lines ?? []).filter((l) => l.text?.trim() && l.start != null); setLyrics(lines.current); });
        // the melody (when this song has a karaoke version) for the phone's own pitch guide
        void sb.from('karaoke_analysis').select('notes').eq('track_id', e.trackId).order('created_at', { ascending: false }).limit(1)
          .then(({ data }) => setNotes(((data?.[0]?.notes ?? []) as unknown as StageNote[])));
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
        const voiced = f.f0 > 0 && f.conf >= 0.6 && (floorRef.current == null || f.rmsDb >= floorRef.current + 10);
        trail.current.push([st, voiced ? 69 + 12 * Math.log2(f.f0 / 440) : null]);
        if (trail.current.length > 400) trail.current.splice(0, trail.current.length - 400);
        lastPitch.current = voiced ? f.f0 : lastPitch.current;
        lastDb.current = f.rmsDb;
        batch.current.push(+st.toFixed(3), +f.f0.toFixed(2), +f.conf.toFixed(3), +f.rmsDb.toFixed(1));
        if (batch.current.length >= FRAMES_PER_MESSAGE * FRAME_STRIDE) {
          const frames = batch.current;
          batch.current = [];
          void ch.current?.send({ type: 'pitch', v: PROTOCOL_VERSION, memberId: member.id, seq: seq.current++, frames });
        }
      }, ctx);
      const floor = await mic.current.calibrate(1500);
      floorRef.current = floor;
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

  // tuner and mic tips (5 Hz): what note you're on, and whether the phone is too far or too close
  useEffect(() => {
    if (step !== 'live') return;
    const iv = setInterval(() => {
      const f0 = lastPitch.current;
      setTuner(f0 > 0 ? noteName(f0) : null);
      lastPitch.current = 0;
      const playing = transport.current?.state === 'playing';
      const t = songTime();
      const inLine = lines.current.some((l, i) => l.start! <= t && t < (lines.current[i + 1]?.start ?? l.start! + 6) && t < l.start! + 6);
      const db = lastDb.current;
      if (playing && db > -4) setTip('Too loud: hold the phone a little further away');
      else if (playing && inLine && floorRef.current != null && db < floorRef.current + 8) {
        quietSince.current ??= Date.now();
        setTip(Date.now() - quietSince.current > 2500 ? 'Can’t hear you: bring the phone closer to your mouth' : null);
      } else { quietSince.current = null; setTip(null); }
    }, 200);
    return () => clearInterval(iv);
  }, [step, songTime]);

  // phones lock and suspend audio: keep the screen on, and pick the mic back up when the page returns
  useEffect(() => {
    if (step !== 'live') return;
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      void mic.current?.context.resume();
      try { void (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<unknown> } }).wakeLock?.request('screen'); } catch { /* optional */ }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [step]);

  const sendGain = (g: number) => {
    setMyGain(g);
    if (memberRef.current) void ch.current?.send({ type: 'voice_gain', v: PROTOCOL_VERSION, memberId: memberRef.current, gain: g });
  };
  const toggleSelfMute = () => { mutedRef.current = !mutedRef.current; setMuted(mutedRef.current); };
  const myColor = member?.color ?? '#ffc94d';
  const myTrails = useCallback(() => [{ id: 'me', color: myColor, points: trail.current }], [myColor]);

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
    <main className="flex h-full flex-col items-center gap-4 overflow-y-auto p-4 text-center">
      {result ? (
        <div role="dialog" aria-label="Your score" className="my-auto w-full max-w-sm">
          <p className="text-sm font-bold uppercase tracking-widest text-ink-300">SoundCheck Score</p>
          <p className="font-display text-8xl font-black tabular-nums">{result.score}</p>
          <p className="font-display text-3xl font-black" style={{ color: member?.color }}>{result.grade}</p>
          <div className="mt-4 space-y-2 text-left">
            {([['Pitch', result.pitch], ['Timing', result.timing], ['Rhythm', result.rhythm], ['Steadiness', result.stability]] as const).map(([k, v]) => (
              <div key={k}>
                <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-ink-300"><span>{k}</span><span>{Math.round(v * 100)}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-ink-700"><div className="h-full rounded-full" style={{ width: `${v * 100}%`, background: member?.color }} /></div>
              </div>
            ))}
          </div>
          <ul className="mt-4 space-y-1 text-sm text-ink-300">{result.feedback.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      ) : (
        <>
          <div className="flex w-full items-center justify-between text-xs font-bold uppercase tracking-[0.2em]">
            <span className={transportState === 'playing' ? 'text-success-400' : 'text-ink-500'}>
              {transportState === 'playing' ? '● Live' : transportState === 'paused' ? 'Paused' : 'Waiting for the song'}
            </span>
            {live && <span role="status" style={{ color: member?.color }}>On pitch {Math.round(live.hitRate * 100)}%</span>}
          </div>
          <div className="w-full">
            {lyrics.length ? <StageLyrics lines={lyrics} notes={notes} getTime={songTime} /> : <p className="py-10 text-ink-500">Lyrics will show here when the song starts.</p>}
          </div>
          <div className="h-24 w-full overflow-hidden rounded-xl bg-ink-900/70 ring-1 ring-ink-800">
            <PitchHud notes={notes} keyShift={transport.current?.keyShift ?? 0} getTime={songTime}
              getTrails={myTrails} range={null} />
          </div>
          <div className="flex w-full items-center justify-center gap-5">
            <button type="button" onClick={toggleSelfMute} aria-pressed={muted} aria-label={muted ? 'Unmute my mic' : 'Mute my mic'}
              className="relative flex h-28 w-28 shrink-0 items-center justify-center rounded-full" style={{ background: `${member?.color}22` }}>
              <span className="absolute inset-0 rounded-full transition-transform" style={{ background: member?.color, opacity: muted ? 0.1 : 0.35, transform: `scale(${0.6 + (muted ? 0 : level) * 0.4})` }} />
              {muted ? <MicOff size={44} /> : <Mic size={44} />}
            </button>
            <div className="min-w-[7rem] text-left" aria-live="off">
              <p className="text-xs font-bold uppercase tracking-widest text-ink-500">You’re singing</p>
              <p className="font-display text-4xl font-black tabular-nums">{tuner ? tuner.name : '–'}</p>
              {tuner && (
                <div className="relative mt-1 h-2 w-28 rounded-full bg-ink-700" aria-label={`${tuner.cents > 0 ? '+' : ''}${tuner.cents} cents`}>
                  <span className="absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded bg-ink-300" style={{ left: '50%' }} />
                  <span className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${50 + tuner.cents}%`, background: Math.abs(tuner.cents) <= 15 ? '#3ddc97' : '#ffc94d' }} />
                </div>
              )}
            </div>
          </div>
          {tip && <p role="status" className="rounded-full bg-gold-400/15 px-4 py-2 text-sm font-bold text-gold-400">{tip}</p>}
          {muted && <p className="text-gold-400">Your mic is muted</p>}
          {voiceLive && <p className="text-sm text-ink-300" role="status">🔊 Your voice is on the TV</p>}
          {voiceLive && (
            <label className="flex w-full max-w-xs items-center gap-3 text-sm text-ink-300">
              <Volume2 size={18} aria-hidden /> Me on the TV
              <input type="range" min={0} max={2} step={0.1} value={myGain} onChange={(e) => sendGain(Number(e.target.value))} className="flex-1" aria-label="My voice volume on the TV" />
            </label>
          )}
        </>
      )}
      {sessionId && <RequestSong sessionId={sessionId} version={queueVersion} notify={(ev) => void ch.current?.send(ev)} />}
    </main>
  );
}
