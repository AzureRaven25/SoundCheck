'use client';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeft, ListMusic, Loader2, SkipForward, Mic, MicOff, Minus, Pause, Play, Plus, RotateCcw, Smartphone, Square, Users } from 'lucide-react';
import clsx from 'clsx';
import { PROTOCOL_VERSION } from '@soundcheck/contracts';
import { liveHit } from '@soundcheck/scoring';
import { Artwork } from '@/components/ui/Artwork';
import { supabaseBrowser } from '@/lib/supabase/client';
import { recordGuestTake, type GuestScore } from '@/stage/guestScore';
import { PartyPanel } from '@/stage/PartyPanel';
import { SingRecorder, voicedSeconds } from '@/stage/singHistory';
import { useHostSession } from '@/session/useHostSession';
import { queueChanged, useSessionQueue, type QueueItem } from '@/session/queue';
import { VoiceReceiver } from '@/session/voice';
import { StageEngine } from '@/stage/engine';
import { startMic, type MicHandle } from '@/stage/mic';
import type { SingerTrail } from '@/stage/PitchHud';
import { VoiceVisualizer, type SingerLevel } from '@/stage/VoiceVisualizer';
import { Results, type ScoreView } from '@/stage/Results';
import { StageLyrics } from '@/stage/StageLyrics';
import { LineCheers, rateLine } from '@/stage/Cheers';
import { useStageData, type StageData } from '@/stage/useStageData';
import { useVideoStageData } from '@/stage/useVideoStageData';
import { VideoStage } from '@/stage/VideoStage';
import { useLocalStage } from '@/stems/useLocalStage';

type Phase = 'intro' | 'loading' | 'calibrating' | 'singing' | 'scoring' | 'results';
type Mode = 'solo' | 'party';
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const transposeKey = (k: string | null, n: number) => {
  if (!k) return null;
  const [tonic, mode] = k.split(' ');
  const plain = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const i = plain.indexOf(tonic ?? '');
  return i < 0 ? k : `${NOTE_NAMES[(((i + n) % 12) + 12) % 12]} ${mode ?? ''}`;
};
const SOLO_COLOR = '#ffc94d';
const midiOf = (f0: number) => 69 + 12 * Math.log2(f0 / 440);

function Stage({ data, resume }: { data: StageData; resume: string | null }) {
  const router = useRouter();
  const engine = useRef<StageEngine | null>(null);
  const mic = useRef<MicHandle | null>(null);
  const frames = useRef<number[]>([]);               // solo singer's frames
  const trail = useRef<[number, number | null][]>([]);
  const hits = useRef({ hit: 0, total: 0 });
  const [mode, setMode] = useState<Mode>(resume ? 'party' : 'solo');
  const [phase, setPhase] = useState<Phase>('intro');
  const [loadPct, setLoadPct] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [keyShift, setKeyShift] = useState(0);
  const [guide, setGuide] = useState(0);
  const [useMic, setUseMic] = useState(true);
  const [micError, setMicError] = useState<string | null>(null);
  const [hitRate, setHitRate] = useState<number | null>(null);
  const [partyRates, setPartyRates] = useState<Record<string, number>>({});
  const [scores, setScores] = useState<ScoreView[] | null>(null);
  const [group, setGroup] = useState<{ score: number; grade: 'S' | 'A' | 'B' | 'C' | 'D'; singers: number } | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const noiseFloor = useRef<number | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const lastDb = useRef(-90);
  const noteAt = useRef<(t: number) => number | null>(() => null);
  const keyShiftRef = useRef(0);
  const host = useHostSession(data.track.id, resume);
  // party singing mode from the host's panel: duet parts (who sings which lines) or a head-to-head battle
  const [partyMode, setPartyMode] = useState<{ mode: 'duet' | 'battle' | null; parts: Record<string, 0 | 1> }>({ mode: null, parts: {} });
  const onPartyMode = useCallback((m: 'duet' | 'battle' | null, parts: Record<string, 0 | 1>) => setPartyMode({ mode: m, parts }), []);
  const duetLabel = (i: number) => {
    const who = host.singers().filter((x) => partyMode.parts[x.memberId] === i % 2);
    if (!who.length) return null;
    return <span className="rounded-full px-3 py-1 text-sm font-bold text-ink-950" style={{ background: who[0]!.color }}>{who.map((x) => x.name).join(' & ')}’s line</span>;
  };
  const [guests, setGuests] = useState<GuestScore | null>(null);
  const hostRef = useRef(host);
  useEffect(() => { hostRef.current = host; });
  const queue = useSessionQueue(host.session?.id, host.queueVersion);
  const nextUp = queue.items.find((q) => q.status === 'queued' && q.track_id !== data.track.id) ?? null;
  // continuing a party from the previous song: reopen the same session straight away
  const { open: openParty, session: partySession } = host;
  useEffect(() => { if (resume && !partySession) void openParty(); }, [resume, partySession, openParty]);
  // voice monitoring: phones' mics through these speakers (WebRTC), opt-in because speakers can feed back
  const voice = useRef<VoiceReceiver | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceVol, setVoiceVol] = useState(0.8);
  const [echo, setEcho] = useState(0.35);
  function toggleVoice(on: boolean) {
    const e = engine.current ?? new StageEngine();   // inside the click: the shared AudioContext may start
    engine.current = e;
    void e.ctx.resume();
    if (on) {
      voice.current ??= new VoiceReceiver(e.ctx, (ev) => hostRef.current.send(ev));
      voice.current.setVolume(voiceVol);
      voice.current.setEcho(echo);
      hostRef.current.setRtcHandler((ev) => void voice.current?.handle(ev));
    } else {
      voice.current?.close();
      voice.current = null;
      hostRef.current.setRtcHandler(null);
    }
    setVoiceOn(on);
    hostRef.current.send({ type: 'voice', v: PROTOCOL_VERSION, enabled: on });
  }
  const readyCount = host.singers().filter((s) => s.mic === 'ready' || s.mic === 'live').length;
  useEffect(() => {   // singers who turn their mic on later get the invitation too
    if (voiceOn && readyCount) hostRef.current.send({ type: 'voice', v: PROTOCOL_VERSION, enabled: true });
  }, [voiceOn, readyCount]);
  useEffect(() => { voice.current?.setVolume(voiceVol); }, [voiceVol]);
  useEffect(() => { voice.current?.setEcho(echo); }, [echo]);
  useEffect(() => () => voice.current?.close(), []);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    (window as unknown as { __soundcheckVoice?: unknown }).__soundcheckVoice = () => voice.current?.status() ?? {};
  }, []);

  async function singNext() {
    const sid = host.session?.id;
    if (!sid) return;
    const { data: rows } = await supabaseBrowser().rpc('advance_queue', { p_session_id: sid });
    host.send(queueChanged);
    const next = (rows as { track_id: string }[] | null)?.[0];
    if (next) router.push(`/stage/${next.track_id}?party=${sid}`);
  }
  const singerIds = () => hostRef.current.singers().filter((s) => s.mic === 'ready' || s.mic === 'live').map((s) => s.memberId);

  useEffect(() => {
    const notes = data.notes;
    noteAt.current = (t) => {
      let lo = 0, hi = notes.length - 1;
      while (lo <= hi) {
        const m = (lo + hi) >> 1;
        if (notes[m]!.end <= t) lo = m + 1; else if (notes[m]!.start > t) hi = m - 1; else return notes[m]!.pitch;
      }
      return null;
    };
  }, [data.notes]);

  useEffect(() => () => { engine.current?.dispose(); mic.current?.stop(); }, []);

  const getTime = useCallback(() => engine.current?.position() ?? 0, []);
  const { setPositionSource } = host;
  useEffect(() => { setPositionSource(getTime); }, [setPositionSource, getTime]);
  // Test hook (development builds only): lets E2E tests sync a simulated singer to the song clock.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    (window as unknown as { __soundcheckStage?: unknown }).__soundcheckStage = { position: getTime, playing: () => engine.current?.isPlaying() ?? false };
  }, [getTime]);

  // Live trails: the solo singer, or every phone in the party (last ~3 s of frames each).
  const getTrails = useCallback((): SingerTrail[] => {
    if (mode === 'solo') return [{ id: 'me', color: SOLO_COLOR, points: trail.current }];
    return hostRef.current.singers().map((s) => {
      const f = hostRef.current.framesOf(s.memberId);
      const pts: [number, number | null][] = [];
      for (let i = Math.max(0, f.length - 4 * 300); i < f.length; i += 4) {
        const voiced = f[i + 1]! > 0 && f[i + 2]! >= 0.6 && (s.noiseFloorDb == null || f[i + 3]! >= s.noiseFloorDb + 10);
        pts.push([f[i]!, voiced ? midiOf(f[i + 1]!) : null]);
      }
      return { id: s.memberId, color: s.color, points: pts };
    });
  }, [mode]);

  const getLevels = useCallback((): SingerLevel[] => {
    if (mode === 'solo') return useMic ? [{ color: SOLO_COLOR, db: lastDb.current }] : [];
    return hostRef.current.singers().map((sg) => {
      const f = hostRef.current.framesOf(sg.memberId);
      return { color: sg.color, db: f.length >= 4 ? f[f.length - 1]! : -90 };
    });
  }, [mode, useMic]);

  const publish = useCallback((state: 'playing' | 'paused' | 'ended', pos: number) => {
    if (mode === 'party') hostRef.current.publishTransport(state, pos, keyShiftRef.current, singerIds());
  }, [mode]);

  // sing history: every solo take is recorded, scored or not
  const singRec = useRef<SingRecorder | null>(null);
  useEffect(() => {
    if (phase !== 'singing') return;
    const iv = setInterval(() => void singRec.current?.report(voicedSeconds(frames.current, noiseFloor.current)), 5_000);
    return () => clearInterval(iv);
  }, [phase]);
  useEffect(() => () => { void singRec.current?.report(voicedSeconds(frames.current, noiseFloor.current), true); }, []);

  async function start() {
    // Everything that needs the click's user activation happens synchronously, first: create and
    // resume the one AudioContext shared by playback and the mic.
    const e = engine.current ?? new StageEngine();
    engine.current = e;
    void e.ctx.resume();
    setPhase('loading');
    try {
      void singRec.current?.report(voicedSeconds(frames.current, noiseFloor.current), true);
      singRec.current = mode === 'solo' ? new SingRecorder(data.track.id, 'melody', false) : null;
      frames.current = [];
      trail.current = [];
      hits.current = { hit: 0, total: 0 };
      host.resetTake();
      if (mode === 'solo' && useMic && !mic.current) {
        try {
          mic.current = await startMic((f) => {
            lastDb.current = f.rmsDb;
            const eng = engine.current;
            if (!eng || !eng.isPlaying()) return;
            // the frame describes audio heard ~input latency ago
            const t = eng.position() - (mic.current?.inputLatencyMs ?? 0) / 1000;
            frames.current.push(+t.toFixed(3), f.f0, +f.conf.toFixed(3), +f.rmsDb.toFixed(1));
            const voiced = f.f0 > 0 && f.conf >= 0.6 && (noiseFloor.current == null || f.rmsDb >= noiseFloor.current + 10);
            trail.current.push([t, voiced ? midiOf(f.f0) : null]);
            if (trail.current.length > 400) trail.current.splice(0, trail.current.length - 400);
            const ref = noteAt.current(t);
            if (ref != null && voiced) {
              hits.current.total++;
              if (liveHit(f.f0, ref, keyShiftRef.current)) hits.current.hit++;
            }
          }, e.ctx);
          const an = e.ctx.createAnalyser();
          an.fftSize = 2048;
          an.smoothingTimeConstant = 0.78;
          e.ctx.createMediaStreamSource(mic.current.stream).connect(an);
          setAnalyser(an);
        } catch (err) {
          setMicError(err instanceof Error && err.name === 'NotAllowedError' ? 'Microphone access was blocked, so singing won’t be scored.' : 'No microphone available, so singing won’t be scored.');
          setUseMic(false);
        }
      }
      if (!e.duration) {
        await e.load(data.instrumentalUrl, data.vocalsUrl, setLoadPct);
        e.setOnEnded(() => void finish());
      }
      e.setKey(keyShift);
      e.setGuide(guide);
      if (mode === 'solo' && mic.current) {
        setPhase('calibrating');
        noiseFloor.current = await mic.current.calibrate(1500);
      }
      setPhase('singing');
      await e.play(0);
      publish('playing', 0);
      setPlaying(true);
    } catch (err) {
      setScoreError(err instanceof Error ? err.message : String(err));
      setPhase('intro');
    }
  }

  useEffect(() => {
    keyShiftRef.current = keyShift;
    engine.current?.setKey(keyShift);
    if (engine.current?.isPlaying()) publish('playing', engine.current.position());
  }, [keyShift, publish]);
  useEffect(() => { engine.current?.setGuide(guide); }, [guide]);

  // live accuracy: solo HUD, or per-singer chips + live_score broadcast to the phones (~2 Hz)
  useEffect(() => {
    if (phase !== 'singing') return;
    const iv = setInterval(() => {
      if (mode === 'solo') {
        const { hit, total } = hits.current;
        setHitRate(total > 20 ? hit / total : null);
        return;
      }
      const rates: Record<string, number> = {};
      for (const s of hostRef.current.singers()) {
        const f = hostRef.current.framesOf(s.memberId);
        let hit = 0, total = 0;
        for (let i = 0; i < f.length; i += 4) {
          const voiced = f[i + 1]! > 0 && f[i + 2]! >= 0.6 && (s.noiseFloorDb == null || f[i + 3]! >= s.noiseFloorDb + 10);
          const ref = noteAt.current(f[i]!);
          if (!voiced || ref == null) continue;
          total++;
          if (liveHit(f[i + 1]!, ref, keyShiftRef.current)) hit++;
        }
        if (total > 20) rates[s.memberId] = hit / total;
      }
      setPartyRates(rates);
      hostRef.current.send({ type: 'live_score', v: PROTOCOL_VERSION, scores: Object.entries(rates).map(([memberId, hitRate]) => ({ memberId, hitRate, combo: 0 })) });
    }, 500);
    return () => clearInterval(iv);
  }, [phase, mode]);

  async function finish() {
    const e = engine.current;
    e?.pause();
    setPlaying(false);
    publish('ended', e?.position() ?? 0);
    void singRec.current?.report(voicedSeconds(frames.current, noiseFloor.current), true);
    const sb = supabaseBrowser();
    if (mode === 'party') {
      const singers = hostRef.current.singers().filter((s) => hostRef.current.framesOf(s.memberId).length >= 400);
      if (!singers.length) {
        setScores(null);
        setScoreError('We didn’t hear any phones. Check that each singer turned their mic on.');
        setPhase('results');
        return;
      }
      setPhase('scoring');
      const { data: res, error } = await sb.functions.invoke<{ results: (Omit<ScoreView, 'name' | 'color'> & { member_id: string; performance_id: string })[]; group: { score: number; grade: 'S' | 'A' | 'B' | 'C' | 'D'; singers: number } | null; guests?: GuestScore | null }>('score-performance', {
        body: {
          track_id: data.track.id, session_id: hostRef.current.session!.id, key_shift: keyShift,
          party_mode: partyMode.mode, singers: singers.map((s) => ({ member_id: s.memberId, frames: hostRef.current.framesOf(s.memberId), latency_ms: null, noise_floor_db: s.noiseFloorDb, part: partyMode.mode === 'duet' ? partyMode.parts[s.memberId] : undefined })),
        },
      });
      if (error || !res) {
        setScoreError('Scoring failed. Please try again.');
      } else {
        const byId = new Map(singers.map((s) => [s.memberId, s]));
        setScores(res.results.map((r) => ({ ...r, name: byId.get(r.member_id)?.name ?? 'Singer', color: byId.get(r.member_id)?.color ?? '#fff' })));
        setGroup(res.group ?? null);
        setGuests(res.guests ?? null);
        void recordGuestTake(data.track.id, 'melody', res.guests, (id) => hostRef.current.framesOf(id),
          (id) => hostRef.current.singers().find((x) => x.memberId === id)?.noiseFloorDb ?? null);
        hostRef.current.sendResults({
          type: 'results', v: PROTOCOL_VERSION, trackId: data.track.id,
          performances: res.results.map((r) => ({
            memberId: r.member_id, performanceId: r.performance_id, score: r.score, grade: r.grade,
            pitch: r.pitch, timing: r.timing, rhythm: r.rhythm, stability: r.stability, duration: r.duration, transitions: r.transitions, feedback: r.feedback,
          })),
          group: res.group ?? null,
        });
      }
      setPhase('results');
      return;
    }
    if (!useMic || frames.current.length < 100) {
      setScores(null);
      setScoreError(useMic ? 'We didn’t capture enough singing to score.' : 'You sang without the mic, so this take wasn’t scored.');
      setPhase('results');
      return;
    }
    setPhase('scoring');
    const { data: res, error } = await sb.functions.invoke<{ results: (Omit<ScoreView, 'name' | 'color'>)[] }>('score-performance', {
      body: { track_id: data.track.id, key_shift: keyShift, singers: [{ frames: frames.current, latency_ms: 0, noise_floor_db: noiseFloor.current }] },
    });
    if (error || !res) setScoreError('Scoring failed. Please try again.');
    else { setScores(res.results.map((r) => ({ ...r, name: 'You', color: SOLO_COLOR }))); void singRec.current?.link((res.results[0] as { performance_id?: string } | undefined)?.performance_id); }
    setPhase('results');
  }

  const toggle = async () => {
    const e = engine.current;
    if (!e) return;
    if (e.isPlaying()) { e.pause(); setPlaying(false); publish('paused', e.position()); }
    else { await e.play(); setPlaying(true); publish('playing', e.position()); }
  };

  const joinUrl = host.session ? `${process.env.NEXT_PUBLIC_SITE_URL ?? (typeof window !== 'undefined' ? window.location.origin : '')}/join/${host.session.code}` : '';
  const partySingers = host.singers();

  return (
    <div className="relative h-full overflow-hidden">
      {data.track.artworkUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.track.artworkUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-125 object-cover opacity-25 blur-3xl" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-ink-950/40 via-ink-950/70 to-ink-950" aria-hidden />
      <div className={clsx('absolute inset-0 flex flex-col overflow-y-auto [&>*]:shrink-0', phase !== 'intro' && phase !== 'results' && phase !== 'scoring' && 'min-[900px]:overflow-hidden')}>

      <header className="relative flex items-center gap-4 px-4 py-3 md:px-6">
        <Link href={`/track/${data.track.id}`} aria-label="Leave Stage" className="rounded-full bg-ink-900/70 p-2 hover:bg-ink-800"><ArrowLeft size={20} /></Link>
        <div className="w-12"><Artwork src={data.track.artworkUrl} title={data.track.title} resolve={false} sizes="48px" /></div>
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-bold">{data.track.title}</p>
          <p className="truncate text-sm text-ink-300">{data.track.artist}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2 text-xs font-bold uppercase tracking-widest">
          <span className="stage-gradient rounded-md px-3 py-1.5 text-white">{mode === 'party' ? 'SoundCheck Party' : 'SoundCheck Stage'}</span>
          {host.session && <span className="rounded-md bg-ink-800 px-3 py-1.5">Code {host.session.code}</span>}
          {data.musicalKey && <span className="rounded-md bg-ink-800 px-3 py-1.5">Key {transposeKey(data.musicalKey, keyShift)}</span>}
          {mode === 'solo' && hitRate != null && <span className="rounded-md bg-ink-800 px-3 py-1.5 text-gold-400">On pitch {Math.round(hitRate * 100)}%</span>}
          {mode === 'party' && phase === 'singing' && partySingers.map((s) => (
            <span key={s.memberId} className="rounded-md bg-ink-800 px-3 py-1.5" style={{ color: s.color }}>
              {s.name}{partyRates[s.memberId] != null ? ` ${Math.round(partyRates[s.memberId]! * 100)}%` : ''}
            </span>
          ))}
        </div>
      </header>

      {phase === 'results' || phase === 'scoring' ? (
        <div className="relative flex flex-1 flex-col py-6">
          <div className="my-auto w-full">
            <Results battle={mode === 'party' && partyMode.mode === 'battle'} scores={scores} group={mode === 'party' ? group : null} guests={mode === 'party' ? guests : null} trackId={data.track.id} error={scoreError} onAgain={() => { setScores(null); setGroup(null); setGuests(null); setScoreError(null); setPhase('intro'); }} />
            {mode === 'party' && nextUp && phase === 'results' && (
              <div className="mx-auto mt-6 flex max-w-md items-center gap-3 rounded-2xl bg-ink-850/90 p-4">
                <ListMusic className="text-pink-400" />
                <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-widest text-ink-300">Up next</p><p className="truncate font-bold">{nextUp.title} <span className="font-normal text-ink-300">· {nextUp.artist_credit}</span></p></div>
                <button type="button" onClick={() => void singNext()} className="flex items-center gap-2 rounded-full bg-ink-50 px-4 py-2 text-sm font-bold text-ink-950"><SkipForward size={16} /> Sing next</button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="relative mx-4 mt-1 h-40 overflow-hidden rounded-2xl bg-ink-900/60 ring-1 ring-ink-800 md:mx-6 min-[900px]:h-[clamp(110px,26vh,260px)]">
            <VoiceVisualizer notes={data.notes} keyShift={keyShift} getTime={getTime} getTrails={getTrails} analyser={mode === 'solo' ? analyser : null} getLevels={getLevels} />
          </div>
          <div className={clsx('relative flex min-h-[12rem] items-center justify-center px-6', phase === 'intro' ? 'flex-auto py-4' : 'flex-1 min-[900px]:min-h-0')}>
            {phase === 'intro' ? (
              <div className="w-full max-w-3xl text-center">
                <h1 className="font-display text-5xl font-extrabold tracking-tight [@media(max-height:640px)]:text-3xl">Ready to sing?</h1>
                <div role="radiogroup" aria-label="Microphones" className="mx-auto mt-6 inline-flex rounded-full bg-ink-850 p-1">
                  {(['solo', 'party'] as const).map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                      className={clsx('flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold', mode === m ? 'bg-ink-50 text-ink-950' : 'text-ink-300')}>
                      {m === 'solo' ? <><Mic size={16} /> This device’s mic</> : <><Smartphone size={16} /> Phones as mics</>}
                    </button>
                  ))}
                </div>
                {mode === 'solo' ? (
                  <>
                    <p className="mt-4 text-ink-300">
                      {data.lyricsGranularity === 'word' ? 'Word-by-word lyrics' : data.lines.length ? 'Synced lyrics' : 'Melody guide'}, vocals removed, and a live pitch guide.
                      {data.lyricsTranscribed && ' Lyrics were transcribed automatically from the vocals and may contain mistakes.'}
                    </p>
                    <label className="mt-4 flex items-center justify-center gap-3 text-sm">
                      <input type="checkbox" checked={useMic} onChange={(e) => setUseMic(e.target.checked)} />
                      Score me with this device’s microphone
                    </label>
                  </>
                ) : !host.session ? (
                  <div className="mt-6">
                    <p className="text-ink-300">Everyone scans a code and their phone becomes a wireless mic. No app needed.</p>
                    <button type="button" onClick={() => void host.open()} className="mt-4 flex items-center gap-2 rounded-full bg-ink-50 px-6 py-3 font-bold text-ink-950 mx-auto">
                      <Users size={18} /> Open the party
                    </button>
                    {host.error && <p role="alert" className="mt-3 text-sm text-danger-400">{host.error}</p>}
                  </div>
                ) : (
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-8 text-left">
                    <div className="rounded-2xl bg-white p-3"><QRCodeSVG value={joinUrl} size={168} aria-label={`QR code to join ${host.session.code}`} /></div>
                    <div>
                      <p className="text-sm text-ink-300">Scan, or open <b className="text-ink-50">{joinUrl.replace(/^https?:\/\//, '').replace(/\/join\/.*/, '/join')}</b> and enter</p>
                      <p className="font-display text-6xl font-black tracking-[0.25em]" data-testid="pairing-code">{host.session.code}</p>
                      <ul className="mt-4 space-y-1" aria-label="Singers">
                        {partySingers.length === 0 && <li className="text-sm text-ink-500">Waiting for singers…</li>}
                        {partySingers.map((s) => (
                          <li key={s.memberId} className="flex items-center gap-2 text-sm">
                            <span className="h-3 w-3 rounded-full" style={{ background: s.color }} />
                            <b>{s.name}</b>
                            <span className={clsx('text-xs', s.mic === 'ready' ? 'text-success-400' : 'text-ink-500')}>{s.mic === 'ready' ? 'mic ready' : 'mic off'}</span>
                          </li>
                        ))}
                      </ul>
                      <UpNext items={queue.items} current={data.track.id} />
                    </div>
                  </div>
                )}

                {mode === 'party' && host.session && (
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-sm">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={voiceOn} onChange={(e) => toggleVoice(e.target.checked)} />
                      Hear singers through the speakers
                    </label>
                    {voiceOn && (
                      <label className="flex items-center gap-2 text-ink-300">Voice volume
                        <input type="range" min={0} max={1.5} step={0.05} value={voiceVol} onChange={(e) => setVoiceVol(Number(e.target.value))} className="w-28" />
                      </label>
                    )}
                    {voiceOn && (
                      <label className="flex items-center gap-2 text-ink-300">Echo
                        <input type="range" min={0} max={1} step={0.05} value={echo} onChange={(e) => setEcho(Number(e.target.value))} className="w-24" aria-label="Echo" />
                      </label>
                    )}
                  </div>
                )}
                {micError && <p className="mt-3 text-sm text-gold-400">{micError}</p>}
                {scoreError && <p role="alert" className="mt-3 text-sm text-danger-400">{scoreError}</p>}
                <p className="mt-4 text-xs text-ink-500"><Link href={`/stage/${data.track.id}?video=1`} className="underline hover:text-ink-300">Sing with the YouTube video instead</Link></p>
                <button type="button" onClick={() => void start()} disabled={mode === 'party' && !partySingers.some((s) => s.mic === 'ready')}
                  className="stage-gradient mt-8 rounded-full px-10 py-4 font-display text-xl font-bold shadow-lift hover:scale-105 [@media(max-height:640px)]:mt-4 [@media(max-height:640px)]:py-3 disabled:opacity-40 disabled:hover:scale-100">
                  Start singing
                </button>
              </div>
            ) : phase === 'loading' ? (
              <p className="flex items-center gap-3 text-xl text-ink-300"><Loader2 className="animate-spin" /> Warming up the band… {Math.round(loadPct * 100)}%</p>
            ) : phase === 'calibrating' ? (
              <p className="text-xl text-ink-300" role="status">Stay quiet for a moment while we listen to the room…</p>
            ) : (
              <div className="relative w-full">
                <LineCheers lines={data.lines} getTime={getTime} rate={(a, b) => {
                  const ref = (t: number) => noteAt.current(t);
                  if (mode === 'solo') return useMic ? rateLine(frames.current, a, b, noiseFloor.current, ref, keyShiftRef.current) : null;
                  const rs = hostRef.current.singers().map((sg) => rateLine(hostRef.current.framesOf(sg.memberId), a, b, sg.noiseFloorDb ?? null, ref, keyShiftRef.current)).filter((r): r is number => r != null);
                  return rs.length ? Math.max(...rs) : null;
                }} />
                <StageLyrics lines={data.lines} notes={data.notes} getTime={getTime} decorate={mode === 'party' && partyMode.mode === 'duet' ? duetLabel : undefined} />
              </div>
            )}
          </div>
          <footer className="relative flex flex-wrap items-center justify-center gap-2 px-4 py-3 md:px-6">
            <button type="button" aria-label={playing ? 'Pause' : 'Play'} disabled={phase !== 'singing'} onClick={() => void toggle()}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-50 text-ink-950 disabled:opacity-30">
              {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="translate-x-0.5" />}
            </button>
            <button type="button" aria-label="Restart" disabled={phase !== 'singing'}
              onClick={() => { frames.current = []; trail.current = []; hits.current = { hit: 0, total: 0 }; host.resetTake(); void engine.current?.play(0); setPlaying(true); publish('playing', 0); }}
              className="rounded-full bg-ink-800 p-3 disabled:opacity-30"><RotateCcw size={18} /></button>
            <button type="button" aria-label="Finish and score" disabled={phase !== 'singing'} onClick={() => void finish()}
              className="flex items-center gap-2 rounded-full bg-ink-800 px-4 py-3 text-sm font-bold disabled:opacity-30"><Square size={14} fill="currentColor" /> Finish</button>
            <div className="mx-2 h-8 w-px bg-ink-700" />
            <span className="text-xs font-bold uppercase tracking-widest text-ink-300">Key</span>
            <button type="button" aria-label="Key down" onClick={() => setKeyShift((k) => Math.max(-6, k - 1))} className="rounded-full bg-ink-800 p-2"><Minus size={16} /></button>
            <span className="w-8 text-center font-bold tabular-nums" aria-live="polite">{keyShift > 0 ? `+${keyShift}` : keyShift}</span>
            <button type="button" aria-label="Key up" onClick={() => setKeyShift((k) => Math.min(6, k + 1))} className="rounded-full bg-ink-800 p-2"><Plus size={16} /></button>
            <div className="mx-2 h-8 w-px bg-ink-700" />
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-ink-300">
              Guide vocal
              <input type="range" min={0} max={1} step={0.05} value={guide} onChange={(e) => setGuide(Number(e.target.value))} className="w-28" />
            </label>
            {phase === 'singing' && mode === 'party' && voiceOn && (
              <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-ink-300">
                Voices
                <input type="range" min={0} max={1.5} step={0.05} value={voiceVol} onChange={(e) => setVoiceVol(Number(e.target.value))} className="w-24" aria-label="Voice volume" />
              </label>
            )}
            {phase === 'singing' && mode === 'party' && voiceOn && (
              <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-ink-300">
                Echo
                <input type="range" min={0} max={1} step={0.05} value={echo} onChange={(e) => setEcho(Number(e.target.value))} className="w-20" aria-label="Echo" />
              </label>
            )}
            {phase === 'singing' && mode === 'solo' && (useMic ? <Mic size={18} className="text-success-400" aria-label="Microphone on" /> : <MicOff size={18} className="text-ink-500" aria-label="Microphone off" />)}
          </footer>
        </>
      )}
      {mode === 'party' && host.session && (
        <div className={clsx('relative px-4 pb-6 md:px-6', phase !== 'intro' && 'hidden')}>
          <PartyPanel host={host} items={queue.items} reload={queue.reload} currentTrackId={data.track.id} phase={phase} onMode={onPartyMode} />
        </div>
      )}
      </div>
    </div>
  );
}

/** The party's request queue, shown in the lobby. */
function UpNext({ items, current }: { items: QueueItem[]; current: string }) {
  const upcoming = items.filter((q) => q.status === 'queued' && q.track_id !== current);
  if (!upcoming.length) return <p className="mt-4 text-xs text-ink-500">Singers can request songs from their phones.</p>;
  return (
    <div className="mt-4">
      <p className="text-xs font-bold uppercase tracking-widest text-ink-300">Up next</p>
      <ol className="mt-1 space-y-0.5 text-sm" aria-label="Up next">
        {upcoming.slice(0, 5).map((q, i) => (
          <li key={q.id} className="truncate"><span className="text-ink-500">{i + 1}.</span> <b>{q.title}</b> <span className="text-ink-300">· {q.artist_credit}{q.requester_name ? ` — ${q.requester_name}` : ''}</span></li>
        ))}
      </ol>
    </div>
  );
}

function StageRoute() {
  const { trackId } = useParams<{ trackId: string }>();
  const resume = useSearchParams().get('party');
  const forceVideo = useSearchParams().get('video') === '1';
  const localId = useSearchParams().get('local');
  if (localId) return <LocalStageRoute trackId={trackId} localId={localId} />;
  return <ServerStageRoute trackId={trackId} resume={resume} forceVideo={forceVideo} />;
}

function ServerStageRoute({ trackId, resume, forceVideo }: { trackId: string; resume: string | null; forceVideo: boolean }) {
  const state = useStageData(trackId);
  if (state.kind === 'ready' && !forceVideo) return <Stage data={state.data} resume={resume} />;
  // no karaoke tracks (or asked for the video): sing along to YouTube with synced lyrics
  if (forceVideo || state.kind === 'not-ready' || state.kind === 'signed-out') return <VideoStageRoute trackId={trackId} resume={resume} />;
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      {state.kind === 'loading' && <p className="flex items-center gap-3 text-ink-300"><Loader2 className="animate-spin" /> Setting the stage…</p>}
      {state.kind === 'error' && <p role="alert" className="text-danger-400">Couldn’t open Stage: {state.message}</p>}
    </div>
  );
}

/** Karaoke this device made from the singer's own recording (see /make-karaoke). */
function LocalStageRoute({ trackId, localId }: { trackId: string; localId: string }) {
  const state = useLocalStage(trackId, localId);
  if (state.kind === 'ready') return <VideoStage data={state.data} resume={null} local={{ deck: state.deck, source: state.source }} />;
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      {state.kind === 'loading' && <p className="flex items-center gap-3 text-ink-300"><Loader2 className="animate-spin" /> Loading your karaoke track…</p>}
      {state.kind === 'missing' && <p className="text-ink-300">That karaoke track isn’t on this device (it’s only kept in the browser that made it). <Link href="/make-karaoke" className="font-bold text-ink-50 underline">Make it again</Link></p>}
      {state.kind === 'error' && <p role="alert" className="text-danger-400">Couldn’t open Stage: {state.message}</p>}
    </div>
  );
}

function VideoStageRoute({ trackId, resume }: { trackId: string; resume: string | null }) {
  const state = useVideoStageData(trackId);
  if (state.kind === 'ready') return <VideoStage data={state.data} resume={resume} />;
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      {state.kind === 'loading' && <p className="flex items-center gap-3 text-ink-300"><Loader2 className="animate-spin" /> Finding the karaoke video…</p>}
      {state.kind === 'error' && <p role="alert" className="text-danger-400">Couldn’t open Stage: {state.message}</p>}
    </div>
  );
}

export default function StagePage() {
  return <Suspense><StageRoute /></Suspense>;
}
