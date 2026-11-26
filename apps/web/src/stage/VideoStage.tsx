'use client';
/**
 * SoundCheck Stage for any song with a YouTube video: synced lyrics over YouTube's own players. Backing is a
 * karaoke version (no lead vocal) when one exists, with the original playing alongside at whatever volume the
 * singer wants as a guide vocal; or the original alone. Singing is scored against the lyrics (no melody needed).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import clsx from 'clsx';
import { AlertTriangle, ArrowLeft, Hand, ListMusic, Mic, MicOff, Pause, Play, RotateCcw, SkipForward, Smartphone, Square, Users } from 'lucide-react';
import { PROTOCOL_VERSION } from '@soundcheck/contracts';
import { Artwork } from '@/components/ui/Artwork';
import { supabaseBrowser } from '@/lib/supabase/client';
import { recordGuestTake, type GuestScore } from './guestScore';
import { PartyPanel } from './PartyPanel';
import { SingRecorder, voicedSeconds } from './singHistory';
import { loadYouTubeApi, videoIdFrom, type YTPlayer } from '@/player/youtube';
import { useHostSession } from '@/session/useHostSession';
import { queueChanged, useSessionQueue } from '@/session/queue';
import { VoiceReceiver } from '@/session/voice';
import { startMic, type MicHandle } from './mic';
import type { SingerTrail } from './PitchHud';
import { VoiceVisualizer, type SingerLevel } from './VoiceVisualizer';
import { Results, type ScoreView } from './Results';
import { LineCheers, rateLine } from './Cheers';
import { LyricsSyncer } from './LyricsSyncer';
import { lineAt, StageLyrics } from './StageLyrics';
import { saveVideoOffset, type StageVideo, type VideoStageData } from './useVideoStageData';
import { VideoClock } from './videoClock';
import { localOffset, measureKaraokeOffset, micMaybeAllowed, rememberOffset } from './autoSync';

type Phase = 'intro' | 'singing' | 'scoring' | 'results';
type Mode = 'solo' | 'party';
type Backing = 'karaoke' | 'original';
const SOLO_COLOR = '#ffc94d';
const midiOf = (f0: number) => 69 + 12 * Math.log2(f0 / 440);
const fmtOffset = (s: number) => `${s >= 0 ? '+' : '−'}${Math.abs(s).toFixed(1)} s`;

function pasted(id: string, kind: StageVideo['kind']): StageVideo {
  return { id, title: 'Your link', channel: 'YouTube', durationS: null, kind, offset: 0, offsetSource: 'guess', votes: 0, measured: 0 };
}

/** A YouTube player in a div (YouTube's own visible player, never hidden or covered). */
function usePlayer(videoId: string | null, onReady: (p: YTPlayer | null) => void) {
  const el = useRef<HTMLDivElement | null>(null);
  const cb = useRef(onReady);
  useEffect(() => { cb.current = onReady; });
  useEffect(() => {
    if (!videoId || !el.current) { cb.current(null); return; }
    let p: YTPlayer | null = null;
    let dead = false;
    const host = document.createElement('div');
    el.current.replaceChildren(host);
    void loadYouTubeApi().then(() => {
      if (dead || !window.YT) return;
      p = new window.YT.Player(host, {
        videoId, width: '100%', height: '100%',
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, fs: 0 },
        events: { onReady: () => { if (!dead) cb.current(p); } },
      });
    });
    return () => { dead = true; cb.current(null); try { p?.destroy(); } catch { /* gone */ } };
  }, [videoId]);
  return el;
}

export function VideoStage({ data, resume }: { data: VideoStageData; resume: string | null }) {
  const router = useRouter();
  const clock = useRef(new VideoClock());
  const [karaokeList, setKaraokeList] = useState(data.karaoke);
  const [originalList, setOriginalList] = useState(data.originals);
  const [karaokeIdx, setKaraokeIdx] = useState(0);
  const [originalIdx, setOriginalIdx] = useState(0);
  const karaokeVid = karaokeList[karaokeIdx] ?? null;
  const originalVid = originalList[originalIdx] ?? null;
  const [backing, setBacking] = useState<Backing>(data.karaoke.length ? 'karaoke' : 'original');
  const mainVid = backing === 'karaoke' ? karaokeVid ?? originalVid : originalVid ?? karaokeVid;
  const guideVid = backing === 'karaoke' && karaokeVid && originalVid ? originalVid : null;
  const [guide, setGuide] = useState(0.25);
  const [music, setMusic] = useState(1);
  const [mode, setMode] = useState<Mode>(resume ? 'party' : 'solo');
  const [phase, setPhase] = useState<Phase>('intro');
  const [playing, setPlaying] = useState(false);
  const [useMic, setUseMic] = useState(true);
  const [micError, setMicError] = useState<string | null>(null);
  const [scores, setScores] = useState<ScoreView[] | null>(null);
  const [group, setGroup] = useState<{ score: number; grade: 'S' | 'A' | 'B' | 'C' | 'D'; singers: number } | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);
  // offsets: other singers' shared ones, else one this browser measured, else the guess from the video's length
  const [offsets, setOffsets] = useState<Record<string, number>>(() => Object.fromEntries([...data.karaoke, ...data.originals].map((v) =>
    [v.id, v.measured ? v.offset : localOffset(v.id) ?? v.offset])));
  const [paste, setPaste] = useState('');
  const [pasteKind, setPasteKind] = useState<StageVideo['kind']>('karaoke');
  const [lines, setLines] = useState(data.lyricsGranularity === 'plain' ? [] : data.lines);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  useEffect(() => { syncingRef.current = syncing; }, [syncing]);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [ready, setReady] = useState({ main: false, guide: false });
  const mic = useRef<MicHandle | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const frames = useRef<number[]>([]);
  const trail = useRef<[number, number | null][]>([]);
  const noiseFloor = useRef<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const { open: openParty, session: partySession } = host;
  useEffect(() => { if (resume && !partySession) void openParty(); }, [resume, partySession, openParty]);
  const singerIds = () => hostRef.current.singers().filter((s) => s.mic === 'ready' || s.mic === 'live').map((s) => s.memberId);

  const getTime = useCallback(() => clock.current.lyricTime(), []);
  const { setPositionSource } = host;
  useEffect(() => { setPositionSource(getTime); }, [setPositionSource, getTime]);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    (window as unknown as { __soundcheckStage?: unknown }).__soundcheckStage = { position: getTime, playing: () => clock.current.isPlaying(), clock: clock.current };
  }, [getTime]);

  const publish = useCallback((state: 'playing' | 'paused' | 'ended') => {
    if (mode === 'party') hostRef.current.publishTransport(state, clock.current.lyricTime(), 0, singerIds());
  }, [mode]);

  // players
  const mainPlayer = useRef<YTPlayer | null>(null);
  const guidePlayer = useRef<YTPlayer | null>(null);
  const mainEl = usePlayer(mainVid?.id ?? null, (p) => { mainPlayer.current = p; clock.current.main = p; setReady((r) => ({ ...r, main: !!p })); });
  const guideEl = usePlayer(guideVid?.id ?? null, (p) => { guidePlayer.current = p; clock.current.guide = p; setReady((r) => ({ ...r, guide: !!p })); });
  /** Back to the chosen backing + guide (after the original took over at the end of the last take). */
  const resetPlayers = () => {
    const c = clock.current;
    c.main = mainPlayer.current;
    c.guide = guidePlayer.current;
    c.mainOffset = mainVid ? offsets[mainVid.id] ?? 0 : 0;
    c.guideOffset = guideVid ? offsets[guideVid.id] ?? 0 : 0;
    try { mainPlayer.current?.setVolume(Math.round(music * 100)); } catch { /* not ready */ }
    c.setGuideVolume(guide);
    setHandedOff(false);
  };
  useEffect(() => {
    const c = clock.current;
    c.start();
    return () => c.stop();
  }, []);
  // offsets and volumes follow the chosen videos and sliders
  useEffect(() => { clock.current.mainOffset = mainVid ? offsets[mainVid.id] ?? 0 : 0; }, [mainVid, offsets]);
  useEffect(() => { clock.current.guideOffset = guideVid ? offsets[guideVid.id] ?? 0 : 0; }, [guideVid, offsets]);
  useEffect(() => { try { clock.current.main?.setVolume(Math.round(music * 100)); } catch { /* not ready */ } }, [music, ready.main]);
  useEffect(() => { clock.current.setGuideVolume(guide); }, [guide, ready.guide]);
  // the karaoke video ended before the song did: the original plays on at the music volume
  const [handedOff, setHandedOff] = useState(false);
  const musicRef = useRef(music);
  useEffect(() => { musicRef.current = music; }, [music]);
  useEffect(() => {
    clock.current.onHandoff = (p) => {
      try { p.unMute(); p.setVolume(Math.round(Math.max(0.6, musicRef.current) * 100)); } catch { /* not ready */ }
      setHandedOff(true);
    };
  }, []);
  // a karaoke track re-recorded at a slightly different tempo keeps drifting from the original: say so
  const [driftWarn, setDriftWarn] = useState(false);
  useEffect(() => {
    if (phase !== 'singing' || !guideVid) return;
    const iv = setInterval(() => setDriftWarn(guide > 0 && clock.current.driftCorrections() >= 3), 2000);
    return () => clearInterval(iv);
  }, [phase, guideVid, guide]);
  // the solo mic, for the visualiser's waveform and spectrum, and everyone's levels for the meters
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const lastDb = useRef(-90);

  // the video's own controls can start or pause the song too
  useEffect(() => {
    clock.current.onState = (s) => {
      setPlaying(s === 'playing');
      publish(s);
      if (s === 'playing' && !syncingRef.current) setPhase((p) => (p === 'intro' ? 'singing' : p));
    };
  }, [publish]);
  // keep phones' clocks honest (YouTube can buffer)
  useEffect(() => {
    if (!playing || mode !== 'party') return;
    const iv = setInterval(() => publish('playing'), 5000);
    return () => clearInterval(iv);
  }, [playing, mode, publish]);

  const nudge = (delta: number, which: 'main' | 'guide' = 'main') => {
    const v = which === 'main' ? mainVid : guideVid;
    if (!v) return;
    setOffsets((o) => {
      const next = Math.round(((o[v.id] ?? 0) + delta) * 100) / 100;
      if (data.signedIn) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => void saveVideoOffset(data.track.id, v.id, next), 1500);
      }
      return { ...o, [v.id]: next };
    });
    if (which === 'main' && clock.current.isPlaying()) setTimeout(() => publish('playing'), 50);
    clock.current.resetDrift();
  };
  /** "Tap on the first word": the nearest line (within 6 s) starts right now. */
  const tapSync = () => {
    if (!mainVid) return;
    const sung = lines.filter((l) => l.start != null && l.text.trim());
    const t = clock.current.lyricTime();
    const i = lineAt(sung, t);
    const cands = [sung[i], sung[i + 1]].filter(Boolean) as { start?: number }[];
    const best = cands.sort((a, b) => Math.abs(a.start! - t) - Math.abs(b.start! - t))[0];
    if (!best || Math.abs(best.start! - t) > 6) return;
    nudge(t - best.start!);   // lyrics clock was at t when the line actually began: move offset by the difference
  };

  // sing history: every solo take is recorded (signed in), scored or not
  const singRec = useRef<SingRecorder | null>(null);
  useEffect(() => {
    if (phase !== 'singing') return;
    const iv = setInterval(() => void singRec.current?.report(voicedSeconds(frames.current, noiseFloor.current)), 5_000);
    return () => clearInterval(iv);
  }, [phase]);
  useEffect(() => () => { void singRec.current?.report(voicedSeconds(frames.current, noiseFloor.current), true); }, []);

  // auto sync: the first time a karaoke version is sung, line it up with the original by ear (see autoSync.ts)
  const [aligning, setAligning] = useState<'original' | 'karaoke' | null>(null);
  const [autoNote, setAutoNote] = useState<string | null>(null);
  const alignAbort = useRef<AbortController | null>(null);
  const tried = useRef(new Set<string>());
  useEffect(() => () => alignAbort.current?.abort(), []);
  /** `again`: the singer asked to line it up again, even though it was measured before. */
  const needsAutoSync = (again = false) => !!(mode === 'solo' && useMic && backing === 'karaoke' && karaokeVid && guideVid && mainVid === karaokeVid
    && ready.guide && guidePlayer.current && mainPlayer.current
    && (again || (!karaokeVid.measured && localOffset(karaokeVid.id) == null && !tried.current.has(karaokeVid.id))));

  /** Lyrics time to compare at: somewhere with the full band (about 40% in, after the first line). */
  function compareAt(): number {
    const first = lines.find((l) => l.start != null && l.text.trim())?.start ?? 10;
    let dur = 0;
    try { dur = (guidePlayer.current?.getDuration() ?? 0) - (offsets[guideVid!.id] ?? 0); } catch { /* not ready */ }
    if (!(dur > 40)) return first + 8;
    return Math.min(Math.max(first + 4, dur * 0.4), dur - 20);
  }

  async function autoSync(ac: AudioContext): Promise<number | null> {
    const k = karaokeVid!, kp = mainPlayer.current!, gp = guidePlayer.current!;
    const guess = offsets[k.id] ?? 0;
    tried.current.add(k.id);
    const ctl = new AbortController();
    alignAbort.current = ctl;
    clock.current.hold = true;
    setAligning('original');
    try {
      const r = await measureKaraokeOffset({ ctx: ac, karaoke: kp, original: gp, originalOffset: offsets[guideVid!.id] ?? 0, guess,
        at: compareAt(), signal: ctl.signal, onStep: setAligning });
      void supabaseBrowser().rpc('log_video_sync_attempt', {
        p_track_id: data.track.id, p_video_id: k.id, p_outcome: r.outcome, p_guess_ms: Math.round(guess * 1000),
        p_offset_ms: r.match ? Math.round(((offsets[guideVid!.id] ?? 0) + r.match.shift) * 1000) : null,
        p_score: r.match?.score ?? null, p_margin: r.match?.margin ?? null, p_ref_frames: r.refFrames, p_cand_frames: r.candFrames, p_level_db: r.levelDb,
      }).then(() => {});
      if (r.outcome === 'skipped') return null;
      if (!r.ok) {
        setAutoNote(r.outcome === 'low-confidence' && r.levelDb != null && r.levelDb > -50
          ? 'Heard the music but couldn’t find a sure match, so the timing wasn’t changed. If the original sounds ahead of the karaoke, press Later.'
          : r.outcome.endsWith('did-not-play') ? 'A video didn’t start in time (an ad, or slow loading), so the timing wasn’t checked. Try “Line up again”.'
          : 'Couldn’t hear the music through the mic (headphones, or the volume is low), so the timing wasn’t checked.');
        return null;
      }
      rememberOffset(k.id, r.offset);
      setOffsets((o) => ({ ...o, [k.id]: r.offset }));
      if (data.signedIn) void saveVideoOffset(data.track.id, k.id, r.offset, true);
      const moved = r.offset - guess;
      setAutoNote(Math.abs(moved) < 0.15 ? 'Checked: the karaoke version is in sync with the song.' : `Karaoke version lined up with the song automatically (moved ${fmtOffset(moved)}).`);
      return r.offset;
    } catch {
      return null;   // no mic, or it was blocked: begin() reports that
    } finally {
      clock.current.hold = false;
      alignAbort.current = null;
      setAligning(null);
    }
  }

  async function start(again = false) {
    const ac = ctx.current ?? new AudioContext({ latencyHint: 'interactive' });
    ctx.current = ac;
    void ac.resume();
    const synced = needsAutoSync(again) && (await micMaybeAllowed()) ? await autoSync(ac) : null;
    await begin(ac, synced);
  }

  async function begin(ac: AudioContext, offsetOverride: number | null) {
    frames.current = [];
    trail.current = [];
    host.resetTake();
    setScores(null); setScoreError(null);
    void singRec.current?.report(voicedSeconds(frames.current, noiseFloor.current), true);
    singRec.current = mode === 'solo' && data.signedIn ? new SingRecorder(data.track.id, 'lyrics', false) : null;
    // start the video inside the click, before any await (unless auto sync ran first: the page has been clicked)
    resetPlayers();
    if (offsetOverride != null) clock.current.mainOffset = offsetOverride;
    clock.current.seekLyric(-clock.current.mainOffset);   // from the top of the video
    clock.current.resetDrift();
    clock.current.play();
    setPhase('singing');
    if (mode === 'solo' && useMic && !mic.current) {
      try {
        mic.current = await startMic((f) => {
          const c = clock.current;
          if (!c.isPlaying()) return;
          lastDb.current = f.rmsDb;
          const t = c.lyricTime() - (mic.current?.inputLatencyMs ?? 0) / 1000;
          frames.current.push(+t.toFixed(3), f.f0, +f.conf.toFixed(3), +f.rmsDb.toFixed(1));
          // the trail is lenient (a quiet mic still draws): a clear pitch a little above the room. Scoring has its own gate.
          const voiced = f.f0 > 0 && f.conf >= 0.65 && (noiseFloor.current == null || f.rmsDb >= noiseFloor.current + 4);
          trail.current.push([t, voiced ? midiOf(f.f0) : null]);
          if (trail.current.length > 400) trail.current.splice(0, trail.current.length - 400);
        }, ac);
        const an = ac.createAnalyser();
        an.fftSize = 2048;
        an.smoothingTimeConstant = 0.78;
        ac.createMediaStreamSource(mic.current.stream).connect(an);
        setAnalyser(an);
        // most videos open with an instrumental lead-in: measure the room's level during its first second
        noiseFloor.current = await mic.current.calibrate(1000);
      } catch (err) {
        setMicError(err instanceof Error && err.name === 'NotAllowedError' ? 'Microphone access was blocked, so singing won’t be scored.' : 'No microphone available, so singing won’t be scored.');
        setUseMic(false);
      }
    }
  }
  useEffect(() => () => { mic.current?.stop(); void ctx.current?.close(); }, []);

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

  // the song ends with the video
  const finishRef = useRef<() => void>(() => {});
  useEffect(() => {
    const c = clock.current;
    const prev = c.onState;
    c.onState = (s) => { prev?.(s); if (s === 'ended') finishRef.current(); };
    return () => { c.onState = prev; };
  });

  async function finish() {
    clock.current.pause();
    setPlaying(false);
    publish('ended');
    void singRec.current?.report(voicedSeconds(frames.current, noiseFloor.current), true);
    const sb = supabaseBrowser();
    const scorable = lines.filter((l) => l.start != null).length >= 3;
    if (!scorable) { setScoreError('This song has no synced lyrics, so it can’t be scored yet.'); setPhase('results'); return; }
    if (!data.signedIn) { setScoreError('Log in to get scored and appear on the leaderboard.'); setPhase('results'); return; }
    if (mode === 'party') {
      const singers = hostRef.current.singers().filter((s) => hostRef.current.framesOf(s.memberId).length >= 400);
      if (!singers.length) { setScoreError('We didn’t hear any phones. Check that each singer turned their mic on.'); setPhase('results'); return; }
      setPhase('scoring');
      const { data: res, error } = await sb.functions.invoke<{ results: (Omit<ScoreView, 'name' | 'color'> & { member_id: string; performance_id: string })[]; group: typeof group; guests?: GuestScore | null }>('score-performance', {
        body: { track_id: data.track.id, session_id: hostRef.current.session!.id, mode: 'lyrics',
                party_mode: partyMode.mode, singers: singers.map((s) => ({ member_id: s.memberId, frames: hostRef.current.framesOf(s.memberId), latency_ms: null, noise_floor_db: s.noiseFloorDb, part: partyMode.mode === 'duet' ? partyMode.parts[s.memberId] : undefined })) },
      });
      if (error || !res) setScoreError('Scoring failed. Please try again.');
      else {
        const byId = new Map(singers.map((s) => [s.memberId, s]));
        setScores(res.results.map((r) => ({ ...r, name: byId.get(r.member_id)?.name ?? 'Singer', color: byId.get(r.member_id)?.color ?? '#fff' })));
        setGroup(res.group ?? null);
        setGuests(res.guests ?? null);
        void recordGuestTake(data.track.id, 'lyrics', res.guests, (id) => hostRef.current.framesOf(id),
          (id) => hostRef.current.singers().find((x) => x.memberId === id)?.noiseFloorDb ?? null);
        hostRef.current.sendResults({
          type: 'results', v: PROTOCOL_VERSION, trackId: data.track.id,
          performances: res.results.map((r) => ({ memberId: r.member_id, performanceId: r.performance_id, score: r.score, grade: r.grade,
            pitch: r.pitch, timing: r.timing, rhythm: r.rhythm, stability: r.stability, duration: r.duration ?? 0, transitions: r.transitions ?? 0, feedback: r.feedback })),
          group: res.group ?? null,
        });
      }
      setPhase('results');
      return;
    }
    if (!useMic || frames.current.length < 100) {
      setScoreError(useMic ? 'We didn’t capture enough singing to score.' : null);
      setPhase('results');
      return;
    }
    setPhase('scoring');
    const { data: res, error } = await sb.functions.invoke<{ results: Omit<ScoreView, 'name' | 'color'>[] }>('score-performance', {
      body: { track_id: data.track.id, mode: 'lyrics', singers: [{ frames: frames.current, latency_ms: 0, noise_floor_db: noiseFloor.current }] },
    });
    if (error || !res) setScoreError('Scoring failed. Please try again.');
    else { setScores(res.results.map((r) => ({ ...r, name: 'You', color: SOLO_COLOR }))); void singRec.current?.link(res.results[0]?.performance_id); }
    setPhase('results');
  }
  useEffect(() => { finishRef.current = () => { if (phase === 'singing') void finish(); }; });

  async function singNext() {
    const sid = host.session?.id;
    if (!sid) return;
    const { data: rows } = await supabaseBrowser().rpc('advance_queue', { p_session_id: sid });
    host.send(queueChanged);
    const next = (rows as { track_id: string }[] | null)?.[0];
    if (next) router.push(`/stage/${next.track_id}?party=${sid}`);
  }

  // voice monitoring (phones' mics through these speakers), as on the melody Stage
  const voice = useRef<VoiceReceiver | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceVol, setVoiceVol] = useState(0.8);
  const [echo, setEcho] = useState(0.35);
  useEffect(() => { voice.current?.setVolume(voiceVol); }, [voiceVol]);
  useEffect(() => { voice.current?.setEcho(echo); }, [echo]);
  function toggleVoice(on: boolean) {
    const ac = ctx.current ?? new AudioContext({ latencyHint: 'interactive' });
    ctx.current = ac;
    void ac.resume();
    if (on) {
      voice.current ??= new VoiceReceiver(ac, (ev) => hostRef.current.send(ev));
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
  useEffect(() => () => voice.current?.close(), []);

  function addPasted() {
    const id = videoIdFrom(paste);
    if (!id) return;
    if (pasteKind === 'karaoke') { setKaraokeList((l) => [pasted(id, 'karaoke'), ...l.filter((v) => v.id !== id)]); setKaraokeIdx(0); setBacking('karaoke'); }
    else { setOriginalList((l) => [pasted(id, 'original'), ...l.filter((v) => v.id !== id)]); setOriginalIdx(0); }
    setOffsets((o) => ({ ...o, [id]: o[id] ?? 0 }));
    setPaste('');
    // share it so the next singer of this song gets it without a YouTube search
    if (data.signedIn) void supabaseBrowser().rpc('share_song_video', { p_track_id: data.track.id, p_video_id: id, p_kind: pasteKind }).then(() => {});
  }

  const joinUrl = host.session ? `${typeof window !== 'undefined' ? window.location.origin : ''}/join/${host.session.code}` : '';
  const partySingers = host.singers();
  const mainOffset = mainVid ? offsets[mainVid.id] ?? 0 : 0;
  const hasLyrics = lines.some((l) => l.start != null);

  const showStage = phase !== 'results' && phase !== 'scoring';
  // YouTube asks for embedded players of at least 200×200 px
  const tile = 'h-[200px] w-full min-w-[200px] overflow-hidden rounded-xl bg-black ring-1 ring-ink-700/80 min-[900px]:h-[clamp(200px,calc((100vh-30rem)/2),300px)]';
  return (
    <div className="relative h-full overflow-hidden">
      {data.track.artworkUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.track.artworkUrl} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-20 blur-3xl" />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink-950/50 via-ink-950/80 to-ink-950" aria-hidden />
      <div className={clsx('absolute inset-0 flex flex-col overflow-y-auto [&>*]:shrink-0', showStage && 'min-[900px]:overflow-hidden')}>

      <header className="relative flex items-center gap-3 px-4 py-3 md:px-6">
        <Link href={`/track/${data.track.id}`} aria-label="Leave Stage" className="rounded-full bg-ink-900/70 p-2 hover:bg-ink-800"><ArrowLeft size={20} /></Link>
        <div className="w-11 shrink-0"><Artwork src={data.track.artworkUrl} title={data.track.title} resolve={false} sizes="44px" /></div>
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-bold leading-tight">{data.track.title}</p>
          <p className="truncate text-sm text-ink-300">{data.track.artist}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2 text-[11px] font-bold uppercase tracking-widest">
          <span className="stage-gradient rounded-md px-3 py-1.5 text-white">{mode === 'party' ? 'SoundCheck Party' : 'SoundCheck Stage'}</span>
          {host.session && <span className="rounded-md bg-ink-800 px-3 py-1.5">Code {host.session.code}</span>}
        </div>
      </header>

      {!showStage && (
        <div className="relative flex flex-1 flex-col py-6">
          <div className="my-auto w-full">
            <Results battle={mode === 'party' && partyMode.mode === 'battle'} scores={scores} group={mode === 'party' ? group : null} guests={mode === 'party' ? guests : null} trackId={data.track.id} error={scoreError}
              onAgain={() => { setScores(null); setGroup(null); setGuests(null); setScoreError(null); setPhase('intro'); }} />
            {mode === 'party' && nextUp && phase === 'results' && (
              <div className="mx-auto mt-6 flex max-w-md items-center gap-3 rounded-2xl bg-ink-850/90 p-4">
                <ListMusic className="text-pink-400" />
                <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-widest text-ink-300">Up next</p><p className="truncate font-bold">{nextUp.title} <span className="font-normal text-ink-300">· {nextUp.artist_credit}</span></p></div>
                <button type="button" onClick={() => void singNext()} className="flex items-center gap-2 rounded-full bg-ink-50 px-4 py-2 text-sm font-bold text-ink-950"><SkipForward size={16} /> Sing next</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stage: lyrics and the visualiser are the show; YouTube's players sit in a side rail as compact tiles (they must
          stay visible while playing, so they're kept mounted and are only hidden on the results screen, paused). */}
      <div className={clsx('relative flex-1 gap-4 px-4 pb-3 md:px-6', showStage ? 'flex flex-col min-[900px]:grid min-[900px]:min-h-0 min-[900px]:grid-cols-[minmax(0,1fr)_26rem] min-[900px]:grid-rows-[auto_minmax(0,1fr)]' : 'hidden')}>
        <aside className="order-1 -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 min-[900px]:col-start-2 min-[900px]:row-start-1 min-[900px]:mx-0 min-[900px]:flex min-[900px]:flex-col min-[900px]:gap-2 min-[900px]:overflow-visible min-[900px]:px-0 min-[900px]:pb-0" aria-label="Videos">
          <div className="w-[260px] shrink-0 min-[900px]:w-full">
            <p className="mb-1 truncate text-[10px] font-bold uppercase tracking-widest text-ink-300">
              Backing · {mainVid?.kind === 'karaoke' ? (mainVid.title.match(/instrumental/i) && !mainVid.title.match(/karaoke/i) ? 'instrumental' : 'karaoke version') : 'original'}
            </p>
            {mainVid ? <div className={tile} ref={mainEl} data-testid="main-video" /> : (
              <div className={clsx(tile, 'flex items-center justify-center p-3 text-center text-xs text-ink-300')}>
                {data.quotaExhausted ? 'Today’s YouTube search limit is used up. Paste a link below (it’s saved for everyone).'
                  : data.configured ? 'No video found. Paste a YouTube link below.' : 'Paste a YouTube link below to sing along.'}
              </div>
            )}
          </div>
          {guideVid && (
            <div className="w-[260px] shrink-0 min-[900px]:w-full">
              <p className="mb-1 truncate text-[10px] font-bold uppercase tracking-widest text-ink-300">Guide vocal · original</p>
              <div className={tile} ref={guideEl} data-testid="guide-video" />
            </div>
          )}
        </aside>
          {showStage && (
            <div className="order-3 space-y-2 self-start rounded-xl bg-ink-900/70 p-3 ring-1 ring-ink-800 min-[900px]:col-start-2 min-[900px]:row-start-2 min-[900px]:max-h-full min-[900px]:w-full min-[900px]:overflow-y-auto" role="group" aria-label="Mix">
              {autoNote && phase === 'singing' && <p role="status" className="rounded-lg bg-ink-850 p-2 text-xs text-ink-300">{autoNote}</p>}
              {handedOff && phase === 'singing' && (
                <p role="status" className="rounded-lg bg-cyan-400/10 p-2 text-xs text-cyan-400">The karaoke version ended early, so the original is finishing the song.</p>
              )}
              {karaokeVid && originalVid && (
                <div role="radiogroup" aria-label="Backing track" className="grid grid-cols-2 rounded-full bg-ink-850 p-1 text-xs font-bold">
                  {(['karaoke', 'original'] as const).map((b) => (
                    <button key={b} type="button" role="radio" aria-checked={backing === b} onClick={() => setBacking(b)} disabled={phase === 'singing'}
                      className={clsx('rounded-full px-3 py-1.5', backing === b ? 'bg-ink-50 text-ink-950' : 'text-ink-300')}>
                      {b === 'karaoke' ? 'Karaoke version' : 'Original song'}
                    </button>
                  ))}
                </div>
              )}
              <label className="flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-widest text-ink-300">
                Music
                <input type="range" min={0} max={1} step={0.05} value={music} onChange={(e) => setMusic(Number(e.target.value))} className="w-36" />
              </label>
              {guideVid && (
                <>
                  <label className="flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-widest text-ink-300">
                    Guide vocal
                    <input type="range" min={0} max={1} step={0.05} value={guide} onChange={(e) => setGuide(Number(e.target.value))} className="w-36" aria-label="Guide vocal volume" />
                  </label>
                  <div className="flex items-center justify-between gap-2 text-xs" role="group" aria-label="Guide timing">
                    <span className="font-bold uppercase tracking-widest text-ink-300">Guide timing</span>
                    <span className="flex gap-1">
                      <button type="button" onClick={() => nudge(-0.1, 'guide')} className="rounded-full bg-ink-800 px-2.5 py-1 font-bold" aria-label="Guide earlier">Earlier</button>
                      <button type="button" onClick={() => nudge(0.1, 'guide')} className="rounded-full bg-ink-800 px-2.5 py-1 font-bold" aria-label="Guide later">Later</button>
                    </span>
                  </div>
                  {driftWarn && phase === 'singing' && (
                    <p role="status" className="flex gap-2 rounded-lg bg-gold-400/10 p-2 text-xs text-gold-400">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                      This karaoke version is a re-recording with slightly different timing, so the guide keeps slipping. Try another karaoke version, or lower the guide.
                    </p>
                  )}
                </>
              )}
              <div className="flex items-center justify-between gap-1.5 text-xs" role="group" aria-label="Lyrics timing"
                title={guideVid ? 'Moves the lyrics and the original together, against the karaoke backing' : 'Moves the lyrics against the video'}>
                <span className="font-bold uppercase tracking-widest text-ink-300">{guideVid ? 'Lyrics + original' : 'Lyrics'}</span>
                <span className="flex items-center gap-1">
                  <button type="button" onClick={() => nudge(-0.25)} className="rounded-full bg-ink-800 px-2.5 py-1 font-bold" aria-label="Lyrics earlier">Earlier</button>
                  <span className="w-14 text-center font-bold tabular-nums" aria-live="polite" title="Video time minus lyrics time">{fmtOffset(mainOffset)}</span>
                  <button type="button" onClick={() => nudge(0.25)} className="rounded-full bg-ink-800 px-2.5 py-1 font-bold" aria-label="Lyrics later">Later</button>
                </span>
                <button type="button" onClick={tapSync} disabled={phase !== 'singing' || !hasLyrics}
                  className="flex items-center gap-1 rounded-full bg-ink-800 px-2.5 py-1 font-bold disabled:opacity-30" title="Tap the moment a line starts being sung" aria-label="Tap when a line starts">
                  <Hand size={13} /> Tap
                </button>
              </div>
              {mode === 'party' && voiceOn && <VoiceKnobs vol={voiceVol} setVol={setVoiceVol} echo={echo} setEcho={setEcho} />}
            </div>
          )}

        <section className="order-2 flex min-w-0 flex-col gap-3 min-[900px]:col-start-1 min-[900px]:row-span-2 min-[900px]:row-start-1 min-[900px]:min-h-0" aria-label="Lyrics">
          <div className="relative h-40 shrink-0 overflow-hidden rounded-2xl bg-ink-900/70 ring-1 ring-ink-800 min-[900px]:h-[clamp(120px,30vh,320px)]">
            <VoiceVisualizer getTime={getTime} getTrails={getTrails} analyser={mode === 'solo' ? analyser : null} getLevels={getLevels} />
          </div>
          <div className="relative flex min-h-[16rem] flex-auto items-center justify-center min-[900px]:min-h-0 min-[900px]:overflow-y-auto">
            {phase === 'intro' && syncing ? (
              <LyricsSyncer trackId={data.track.id} videoId={mainVid?.id ?? null} signedIn={data.signedIn}
                initial={data.lyricsGranularity === 'plain' ? data.lines.map((l) => l.text).filter((t) => t.trim()) : []}
                getTime={getTime} playFromTop={() => { clock.current.seekLyric(-mainOffset); clock.current.play(); }} pause={() => clock.current.pause()}
                onCancel={() => setSyncing(false)}
                onDone={(synced, applied) => {
                  setLines(synced);
                  setSyncing(false);
                  setSyncNote(applied ? 'Thanks! These lyrics are now synced for everyone.' : 'Lyrics timed for this session.');
                }} />
            ) : phase === 'intro' && aligning ? (
              <div className="w-full max-w-xl py-4 text-center" role="status" aria-live="polite">
                <h1 className="font-display text-3xl font-extrabold tracking-tight">Lining up the karaoke version</h1>
                <p className="mt-3 text-lg font-bold text-pink-400">{aligning === 'original' ? 'Listening to the original song…' : 'Listening to the karaoke version…'}</p>
                <p className="mt-3 text-sm text-ink-300">
                  Keep your speakers up and stay quiet for about 20 seconds. This happens once per video: everyone who sings it after you starts in sync.
                </p>
                <button type="button" onClick={() => alignAbort.current?.abort()} className="mt-5 rounded-full bg-ink-800 px-5 py-2 text-sm font-bold hover:bg-ink-700">Skip</button>
              </div>
            ) : phase === 'intro' ? (
              <div className="w-full max-w-2xl py-4 text-center">
                <h1 className="font-display text-4xl font-extrabold tracking-tight">Ready to sing?</h1>
                <div role="radiogroup" aria-label="Microphones" className="mx-auto mt-5 inline-flex rounded-full bg-ink-850 p-1">
                  {(['solo', 'party'] as const).map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                      className={clsx('flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold', mode === m ? 'bg-ink-50 text-ink-950' : 'text-ink-300')}>
                      {m === 'solo' ? <><Mic size={16} /> This device’s mic</> : <><Smartphone size={16} /> Phones as mics</>}
                    </button>
                  ))}
                </div>
                {mode === 'solo' ? (
                  <label className="mt-4 flex items-center justify-center gap-3 text-sm">
                    <input type="checkbox" checked={useMic} onChange={(e) => setUseMic(e.target.checked)} />
                    Score me with this device’s microphone {hasLyrics ? '' : '(needs synced lyrics)'}
                  </label>
                ) : !host.session ? (
                  <button type="button" onClick={() => void host.open()} className="mx-auto mt-4 flex items-center gap-2 rounded-full bg-ink-50 px-6 py-3 font-bold text-ink-950">
                    <Users size={18} /> Open the party
                  </button>
                ) : (
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-6 text-left">
                    <div className="rounded-2xl bg-white p-3"><QRCodeSVG value={joinUrl} size={132} aria-label={`QR code to join ${host.session.code}`} /></div>
                    <div>
                      <p className="text-sm text-ink-300">Scan, or open <b className="text-ink-50">{joinUrl.replace(/^https?:\/\//, '').replace(/\/join\/.*/, '/join')}</b> and enter</p>
                      <p className="font-display text-5xl font-black tracking-[0.25em]" data-testid="pairing-code">{host.session.code}</p>
                      <ul className="mt-2 space-y-1" aria-label="Singers">
                        {partySingers.length === 0 && <li className="text-sm text-ink-500">Waiting for singers…</li>}
                        {partySingers.map((s) => (
                          <li key={s.memberId} className="flex items-center gap-2 text-sm">
                            <span className="h-3 w-3 rounded-full" style={{ background: s.color }} /><b>{s.name}</b>
                            <span className={clsx('text-xs', s.mic === 'ready' ? 'text-success-400' : 'text-ink-500')}>{s.mic === 'ready' ? 'mic ready' : 'mic off'}</span>
                          </li>
                        ))}
                      </ul>
                      <label className="mt-2 flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={voiceOn} onChange={(e) => toggleVoice(e.target.checked)} /> Hear singers through the speakers
                      </label>
                    </div>
                  </div>
                )}
                {!data.signedIn && (
                  <p className="mt-3 text-sm text-ink-300">
                    Sing along without an account, or <Link href={`/login?next=${encodeURIComponent(`/stage/${data.track.id}`)}`} className="font-bold text-ink-50 underline">log in</Link> to get scored and keep your history.
                  </p>
                )}
                {host.error && <p role="alert" className="mt-3 text-sm text-danger-400">{host.error}</p>}
                {micError && <p className="mt-3 text-sm text-gold-400">{micError}</p>}
                {syncNote && <p role="status" className="mt-3 text-sm text-success-400">{syncNote}</p>}
                {!hasLyrics && (
                  <div className="mt-4 rounded-xl bg-ink-850/80 p-3 text-sm text-ink-300">
                    {data.lyricsGranularity === 'plain' ? 'This song’s lyrics aren’t timed yet.' : 'No lyrics found for this song yet.'} Without timed lyrics you can sing along, but it won’t be scored.
                    <button type="button" disabled={!originalVid && !mainVid}
                      onClick={() => { if (originalVid) setBacking('original'); setSyncing(true); }}
                      className="ml-2 rounded-full bg-ink-50 px-3 py-1 text-xs font-bold text-ink-950 disabled:opacity-40">
                      {data.lyricsGranularity === 'plain' ? 'Time them yourself' : 'Add and time them'}
                    </button>
                  </div>
                )}
                <button type="button" onClick={() => void start()} disabled={!mainVid || !ready.main || (mode === 'party' && !partySingers.some((s) => s.mic === 'ready'))}
                  className="stage-gradient mt-6 rounded-full px-10 py-4 font-display text-xl font-bold shadow-lift hover:scale-105 disabled:opacity-40 disabled:hover:scale-100">
                  Start singing
                </button>
                {mode === 'solo' && useMic && backing === 'karaoke' && karaokeVid && guideVid && (
                  <button type="button" onClick={() => void start(true)} disabled={!ready.main || !ready.guide}
                    className="mx-auto mt-3 block text-xs font-bold text-ink-300 underline hover:text-ink-50 disabled:opacity-40">
                    Karaoke out of step? Line it up again, then sing
                  </button>
                )}
                <details className="mx-auto mt-6 max-w-2xl text-left text-sm">
                  <summary className="cursor-pointer text-center text-xs font-bold uppercase tracking-widest text-ink-300 hover:text-ink-50">Choose videos</summary>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <VideoPicker label="Karaoke versions" list={karaokeList} idx={karaokeIdx} onPick={setKaraokeIdx} offsets={offsets} />
                    <VideoPicker label="Original recordings" list={originalList} idx={originalIdx} onPick={setOriginalIdx} offsets={offsets} />
                  </div>
                </details>
                <form className="mx-auto mt-3 flex max-w-2xl gap-2" onSubmit={(e) => { e.preventDefault(); addPasted(); }}>
                  <select value={pasteKind} onChange={(e) => setPasteKind(e.target.value as StageVideo['kind'])} aria-label="Kind of video"
                    className="rounded-full bg-ink-850 px-3 py-2 text-sm">
                    <option value="karaoke">Karaoke version</option>
                    <option value="original">Original song</option>
                  </select>
                  <input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste a YouTube link"
                    className="min-w-0 flex-1 rounded-full bg-ink-850 px-4 py-2 text-sm placeholder:text-ink-500" aria-label="YouTube link" />
                  <button type="submit" disabled={!videoIdFrom(paste)} className="rounded-full bg-ink-50 px-4 py-2 text-sm font-bold text-ink-950 disabled:opacity-40">Use video</button>
                </form>
              </div>
            ) : (
              <div className="relative w-full">
                <LineCheers lines={lines} getTime={getTime} rate={(a, b) => {
                  if (mode === 'solo') return useMic ? rateLine(frames.current, a, b, noiseFloor.current) : null;
                  const rs = hostRef.current.singers().map((sg) => rateLine(hostRef.current.framesOf(sg.memberId), a, b, sg.noiseFloorDb ?? null)).filter((r): r is number => r != null);
                  return rs.length ? Math.max(...rs) : null;
                }} />
                <StageLyrics lines={lines} notes={[]} getTime={getTime} decorate={mode === 'party' && partyMode.mode === 'duet' ? duetLabel : undefined} />
              </div>
            )}
          </div>
          {phase !== 'intro' && (
          <div className="flex shrink-0 items-center justify-center gap-3" role="group" aria-label="Song controls">
          <button type="button" aria-label={playing ? 'Pause' : 'Play'} disabled={phase !== 'singing'}
            onClick={() => (clock.current.isPlaying() ? clock.current.pause() : clock.current.play())}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-50 text-ink-950 disabled:opacity-30">
            {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="translate-x-0.5" />}
          </button>
          <button type="button" aria-label="Restart" disabled={phase !== 'singing'}
            onClick={() => { frames.current = []; trail.current = []; host.resetTake(); resetPlayers(); clock.current.seekLyric(-mainOffset); clock.current.resetDrift(); clock.current.play(); }}
            className="rounded-full bg-ink-800 p-3 disabled:opacity-30"><RotateCcw size={18} /></button>
          <button type="button" aria-label="Finish and score" disabled={phase !== 'singing'} onClick={() => void finish()}
            className="flex items-center gap-2 rounded-full bg-ink-800 px-4 py-3 text-sm font-bold disabled:opacity-30"><Square size={14} fill="currentColor" /> Finish</button>
          {phase === 'singing' && mode === 'solo' && (useMic ? <Mic size={18} className="text-success-400" aria-label="Microphone on" /> : <MicOff size={18} className="text-ink-500" aria-label="Microphone off" />)}
        </div>
          )}
        </section>
      </div>

      {mode === 'party' && host.session && (
        <div className={clsx('relative px-4 pb-6 md:px-6', phase !== 'intro' && 'hidden')}>
          <PartyPanel host={host} items={queue.items} reload={queue.reload} currentTrackId={data.track.id} phase={phase} onMode={onPartyMode} />
        </div>
      )}
      </div>
    </div>
  );
}

function VoiceKnobs({ vol, setVol, echo, setEcho }: { vol: number; setVol: (v: number) => void; echo: number; setEcho: (v: number) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs font-bold uppercase tracking-widest text-ink-300">
      <label className="flex items-center gap-2">Voices
        <input type="range" min={0} max={1.5} step={0.05} value={vol} onChange={(e) => setVol(Number(e.target.value))} className="w-20" aria-label="Voice volume" />
      </label>
      <label className="flex items-center gap-2">Echo
        <input type="range" min={0} max={1} step={0.05} value={echo} onChange={(e) => setEcho(Number(e.target.value))} className="w-20" aria-label="Echo" />
      </label>
    </div>
  );
}

function VideoPicker({ label, list, idx, onPick, offsets }: { label: string; list: StageVideo[]; idx: number; onPick: (i: number) => void; offsets: Record<string, number> }) {
  if (!list.length) return <div className="rounded-xl bg-ink-850/80 p-3"><p className="text-xs font-bold uppercase tracking-widest text-ink-300">{label}</p><p className="mt-1 text-ink-500">None found.</p></div>;
  return (
    <fieldset className="rounded-xl bg-ink-850/80 p-3">
      <legend className="sr-only">{label}</legend>
      <p className="text-xs font-bold uppercase tracking-widest text-ink-300">{label}</p>
      <ul className="mt-1 space-y-1">
        {list.map((v, i) => (
          <li key={v.id}>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg p-1 hover:bg-ink-800">
              <input type="radio" name={label} checked={i === idx} onChange={() => onPick(i)} className="mt-1" />
              <span className="min-w-0">
                <span className="block truncate font-bold">{v.title}</span>
                <span className="block truncate text-xs text-ink-300">
                  {v.channel}{v.durationS ? ` · ${Math.floor(v.durationS / 60)}:${String(Math.round(v.durationS % 60)).padStart(2, '0')}` : ''}
                  {v.offsetSource === 'shared' ? ` · lyrics synced by ${v.votes} singer${v.votes === 1 ? '' : 's'}` : (offsets[v.id] ?? 0) ? ` · lyrics start ≈ ${fmtOffset(offsets[v.id]!)}` : ''}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
