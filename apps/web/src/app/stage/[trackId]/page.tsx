'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Mic, MicOff, Minus, Pause, Play, Plus, RotateCcw, Square } from 'lucide-react';
import { liveHit } from '@soundcheck/scoring';
import { Artwork } from '@/components/ui/Artwork';
import { supabaseBrowser } from '@/lib/supabase/client';
import { StageEngine } from '@/stage/engine';
import { startMic, type MicHandle } from '@/stage/mic';
import { PitchHud, type SingerTrail } from '@/stage/PitchHud';
import { Results, type ScoreView } from '@/stage/Results';
import { StageLyrics } from '@/stage/StageLyrics';
import { useStageData, type StageData } from '@/stage/useStageData';

type Phase = 'intro' | 'loading' | 'calibrating' | 'singing' | 'scoring' | 'results';
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const transposeKey = (k: string | null, n: number) => {
  if (!k) return null;
  const [tonic, mode] = k.split(' ');
  const plain = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const i = plain.indexOf(tonic ?? '');
  return i < 0 ? k : `${NOTE_NAMES[(((i + n) % 12) + 12) % 12]} ${mode ?? ''}`;
};

function Stage({ data }: { data: StageData }) {
  const engine = useRef<StageEngine | null>(null);
  const mic = useRef<MicHandle | null>(null);
  const frames = useRef<number[]>([]);
  const trail = useRef<[number, number | null][]>([]);
  const hits = useRef({ hit: 0, total: 0 });
  const [phase, setPhase] = useState<Phase>('intro');
  const [loadPct, setLoadPct] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [keyShift, setKeyShift] = useState(0);
  const [guide, setGuide] = useState(0);
  const [useMic, setUseMic] = useState(true);
  const [micError, setMicError] = useState<string | null>(null);
  const [hitRate, setHitRate] = useState<number | null>(null);
  const [scores, setScores] = useState<ScoreView[] | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const noiseFloor = useRef<number | null>(null);
  const noteAt = useRef<(t: number) => number | null>(() => null);

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
  // Test hook (development builds only): lets E2E tests sync a simulated singer to the song clock.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    (window as unknown as { __soundcheckStage?: unknown }).__soundcheckStage = { position: getTime, playing: () => engine.current?.isPlaying() ?? false };
  }, [getTime]);
  const getTrails = useCallback((): SingerTrail[] => [{ id: 'me', color: '#ffc94d', points: trail.current }], []);

  async function start() {
    // Everything that needs the click's user activation happens synchronously, first: create and
    // resume the one AudioContext shared by playback and the mic.
    const e = engine.current ?? new StageEngine();
    engine.current = e;
    void e.ctx.resume();
    setPhase('loading');
    try {
      frames.current = [];
      trail.current = [];
      hits.current = { hit: 0, total: 0 };
      if (useMic && !mic.current) {
        try {
          mic.current = await startMic((f) => {
            const eng = engine.current;
            if (!eng || !eng.isPlaying()) return;
            // the frame describes audio heard ~input latency ago
            const t = eng.position() - (mic.current?.inputLatencyMs ?? 0) / 1000;
            frames.current.push(+t.toFixed(3), f.f0, +f.conf.toFixed(3), +f.rmsDb.toFixed(1));
            const voiced = f.f0 > 0 && f.conf >= 0.6 && (noiseFloor.current == null || f.rmsDb >= noiseFloor.current + 10);
            const midi = voiced ? 69 + 12 * Math.log2(f.f0 / 440) : null;
            trail.current.push([t, midi]);
            if (trail.current.length > 400) trail.current.splice(0, trail.current.length - 400);
            const ref = noteAt.current(t);
            if (ref != null && voiced) {
              hits.current.total++;
              if (liveHit(f.f0, ref, keyShiftRef.current)) hits.current.hit++;
            }
          }, e.ctx);
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
      if (mic.current) {
        setPhase('calibrating');
        noiseFloor.current = await mic.current.calibrate(1500);
      }
      setPhase('singing');
      await e.play(0);
      setPlaying(true);
    } catch (err) {
      setScoreError(err instanceof Error ? err.message : String(err));
      setPhase('intro');
    }
  }

  const keyShiftRef = useRef(0);
  useEffect(() => { keyShiftRef.current = keyShift; engine.current?.setKey(keyShift); }, [keyShift]);
  useEffect(() => { engine.current?.setGuide(guide); }, [guide]);

  useEffect(() => {
    if (phase !== 'singing') return;
    const iv = setInterval(() => {
      const { hit, total } = hits.current;
      setHitRate(total > 20 ? hit / total : null);
    }, 500);
    return () => clearInterval(iv);
  }, [phase]);

  async function finish() {
    engine.current?.pause();
    setPlaying(false);
    if (!useMic || frames.current.length < 100) {
      setScores(null);
      setScoreError(useMic ? 'We didn’t capture enough singing to score.' : null);
      setPhase('results');
      return;
    }
    setPhase('scoring');
    const { data: res, error } = await supabaseBrowser().functions.invoke<{ results: (Omit<ScoreView, 'name' | 'color'>)[] }>('score-performance', {
      body: { track_id: data.track.id, key_shift: keyShift, singers: [{ frames: frames.current, latency_ms: 0, noise_floor_db: noiseFloor.current }] },
    });
    if (error || !res) setScoreError('Scoring failed. Please try again.');
    else setScores(res.results.map((r) => ({ ...r, name: 'You', color: '#ffc94d' })));
    setPhase('results');
  }

  const toggle = async () => {
    const e = engine.current;
    if (!e) return;
    if (e.isPlaying()) { e.pause(); setPlaying(false); } else { await e.play(); setPlaying(true); }
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {data.track.artworkUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.track.artworkUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-125 object-cover opacity-25 blur-3xl" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-ink-950/40 via-ink-950/70 to-ink-950" aria-hidden />

      <header className="relative flex items-center gap-4 px-6 pt-5">
        <Link href={`/track/${data.track.id}`} aria-label="Leave Stage" className="rounded-full bg-ink-900/70 p-2 hover:bg-ink-800"><ArrowLeft size={20} /></Link>
        <div className="w-12"><Artwork src={data.track.artworkUrl} title={data.track.title} resolve={false} sizes="48px" /></div>
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-bold">{data.track.title}</p>
          <p className="truncate text-sm text-ink-300">{data.track.artist}</p>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
          <span className="stage-gradient rounded-md px-3 py-1.5 text-white">SoundCheck Stage</span>
          {data.musicalKey && <span className="rounded-md bg-ink-800 px-3 py-1.5">Key {transposeKey(data.musicalKey, keyShift)}</span>}
          {hitRate != null && <span className="rounded-md bg-ink-800 px-3 py-1.5 text-gold-400">On pitch {Math.round(hitRate * 100)}%</span>}
        </div>
      </header>

      {phase === 'results' || phase === 'scoring' ? (
        <div className="relative flex flex-1 items-center overflow-y-auto py-8">
          <Results scores={scores} trackId={data.track.id} error={scoreError} onAgain={() => { setScores(null); setScoreError(null); setPhase('intro'); }} />
        </div>
      ) : (
        <>
          <div className="relative mx-6 mt-6 h-40 overflow-hidden rounded-2xl bg-ink-900/60 ring-1 ring-ink-800">
            <PitchHud notes={data.notes} keyShift={keyShift} getTime={getTime} getTrails={getTrails} range={data.vocalRange} />
          </div>
          <div className="relative flex flex-1 items-center justify-center px-8">
            {phase === 'intro' ? (
              <div className="max-w-xl text-center">
                <h1 className="font-display text-5xl font-extrabold tracking-tight">Ready to sing?</h1>
                <p className="mt-4 text-ink-300">
                  {data.lyricsGranularity === 'word' ? 'Word-by-word lyrics' : data.lines.length ? 'Synced lyrics' : 'Melody guide'}, vocals removed,
                  and a live pitch guide. Your score appears at the end.
                </p>
                <label className="mt-6 flex items-center justify-center gap-3 text-sm">
                  <input type="checkbox" checked={useMic} onChange={(e) => setUseMic(e.target.checked)} />
                  Score me with this device’s microphone
                </label>
                {micError && <p className="mt-3 text-sm text-gold-400">{micError}</p>}
                {scoreError && <p role="alert" className="mt-3 text-sm text-danger-400">{scoreError}</p>}
                <button type="button" onClick={() => void start()} className="stage-gradient mt-8 rounded-full px-10 py-4 font-display text-xl font-bold shadow-lift hover:scale-105">
                  Start singing
                </button>
              </div>
            ) : phase === 'loading' ? (
              <p className="flex items-center gap-3 text-xl text-ink-300"><Loader2 className="animate-spin" /> Warming up the band… {Math.round(loadPct * 100)}%</p>
            ) : phase === 'calibrating' ? (
              <p className="text-xl text-ink-300" role="status">Stay quiet for a moment while we listen to the room…</p>
            ) : (
              <StageLyrics lines={data.lines} notes={data.notes} getTime={getTime} />
            )}
          </div>
          <footer className="relative flex flex-wrap items-center justify-center gap-3 px-6 pb-6">
            <button type="button" aria-label={playing ? 'Pause' : 'Play'} disabled={phase !== 'singing'} onClick={() => void toggle()}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-50 text-ink-950 disabled:opacity-30">
              {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="translate-x-0.5" />}
            </button>
            <button type="button" aria-label="Restart" disabled={phase !== 'singing'} onClick={() => { frames.current = []; trail.current = []; hits.current = { hit: 0, total: 0 }; void engine.current?.play(0); setPlaying(true); }}
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
            {phase === 'singing' && (useMic ? <Mic size={18} className="text-success-400" aria-label="Microphone on" /> : <MicOff size={18} className="text-ink-500" aria-label="Microphone off" />)}
          </footer>
        </>
      )}
    </div>
  );
}

export default function StagePage() {
  const { trackId } = useParams<{ trackId: string }>();
  const state = useStageData(trackId);
  if (state.kind === 'ready') return <Stage data={state.data} />;
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      {state.kind === 'loading' && <p className="flex items-center gap-3 text-ink-300"><Loader2 className="animate-spin" /> Setting the stage…</p>}
      {state.kind === 'signed-out' && <p>Please <Link className="underline" href={`/login?next=/stage/${trackId}`}>log in</Link> to sing.</p>}
      {state.kind === 'not-ready' && (
        <div>
          <p className="font-display text-3xl font-bold">“{state.title}” isn’t karaoke-ready yet</p>
          <p className="mt-2 text-ink-300">Upload your copy on the song page and we’ll build the karaoke tracks in a minute or two.</p>
          <Link href={`/track/${trackId}`} className="mt-6 inline-block rounded-full bg-ink-50 px-6 py-3 font-bold text-ink-950">Go to the song</Link>
        </div>
      )}
      {state.kind === 'error' && <p role="alert" className="text-danger-400">Couldn’t open Stage: {state.message}</p>}
    </div>
  );
}
