'use client';
/**
 * Automatic sync of a karaoke video to the original recording (which the lyrics follow).
 *
 * YouTube's players can't be read from the page, so this listens the way a person would: through the microphone.
 * It plays a few seconds of the original, then the same stretch of the karaoke version (with a few seconds of
 * slack on either side), and finds the time shift where the two sound most alike. "Alike" is measured on chroma
 * (which notes are sounding: the chords, shared by a full mix and its instrumental) plus onset strength (the
 * beat). Nothing is recorded or uploaded: only the resulting offset is kept, and shared so the next singer of
 * that video starts in sync without listening again.
 */
import type { YTPlayer } from '@/player/youtube';

/** One analysis frame: video time (seconds) and features (12 chroma + onset strength + loudness). */
export interface Frame { t: number; v: Float32Array }

const DIMS = 14;
const FLUX_WEIGHT = 1;
/** Loudness tells silence (a title card, the moment before a song starts) from music. */
const LOUD_WEIGHT = 1;

/** Chroma + spectral flux of one spectrum (dB per bin, as AnalyserNode.getFloatFrequencyData gives). */
export function features(db: Float32Array, sampleRate: number, fftSize: number, prev: Float32Array | null): { v: Float32Array; mag: Float32Array } {
  const v = new Float32Array(DIMS);
  const mag = new Float32Array(db.length);
  const hz = sampleRate / fftSize;
  let flux = 0, energy = 0;
  for (let k = 1; k < db.length; k++) {
    const f = k * hz;
    if (f > 4000) break;
    const m = Number.isFinite(db[k]!) ? 10 ** (db[k]! / 20) : 0;
    mag[k] = m;
    if (prev) flux += Math.max(0, m - prev[k]!);
    if (f >= 55) energy += m * m;
    if (f < 55 || f > 2000) continue;
    const pc = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12) % 12;
    v[pc]! += m * m;
  }
  let total = 0;
  for (let i = 0; i < 12; i++) total += v[i]!;
  let norm = 0;
  for (let i = 0; i < 12; i++) { v[i] = Math.log1p((100 * v[i]!) / (total || 1)); norm += v[i]! * v[i]!; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < 12; i++) v[i]! /= norm;
  v[12] = Math.log1p(flux);
  v[13] = Math.max(-120, 10 * Math.log10(energy + 1e-12));
  return { v, mag };
}

/** Frames resampled onto a regular grid (nearest frame), each feature z-scored over the stretch. */
function grid(frames: Frame[], step: number): { t0: number; rows: Float32Array[] } | null {
  if (frames.length < 10) return null;
  const sorted = [...frames].sort((a, b) => a.t - b.t);
  const t0 = sorted[0]!.t;
  const n = Math.floor((sorted[sorted.length - 1]!.t - t0) / step) + 1;
  const rows: Float32Array[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * step;
    while (j + 1 < sorted.length && Math.abs(sorted[j + 1]!.t - t) <= Math.abs(sorted[j]!.t - t)) j++;
    rows.push(Float32Array.from(sorted[j]!.v));
  }
  for (let d = 0; d < DIMS; d++) {
    let mean = 0;
    for (const r of rows) mean += r[d]!;
    mean /= rows.length;
    let sd = 0;
    for (const r of rows) sd += (r[d]! - mean) ** 2;
    sd = Math.sqrt(sd / rows.length) || 1;
    const w = d === 12 ? FLUX_WEIGHT : d === 13 ? LOUD_WEIGHT : 1;
    for (const r of rows) r[d] = ((r[d]! - mean) / sd) * w;
  }
  return { t0, rows };
}

export interface Match { shift: number; score: number; margin: number }

/**
 * The shift s (cand time = ref time + s) in [lo, hi] where `cand` best matches `ref`. `score` is a correlation
 * (about 0 for unrelated sound, 1 for identical); `margin` is how far it beats the next-best peak.
 */
export function bestShift(ref: Frame[], cand: Frame[], lo: number, hi: number, step = 0.05): Match | null {
  const r = grid(ref, step), c = grid(cand, step);
  if (!r || !c) return null;
  const scale = 12 + FLUX_WEIGHT * FLUX_WEIGHT + LOUD_WEIGHT * LOUD_WEIGHT;
  const scores: { s: number; score: number }[] = [];
  for (let s = lo; s <= hi + 1e-9; s += step) {
    let sum = 0, n = 0;
    for (let i = 0; i < r.rows.length; i++) {
      const j = Math.round((r.t0 + i * step + s - c.t0) / step);
      if (j < 0 || j >= c.rows.length) continue;
      const a = r.rows[i]!, b = c.rows[j]!;
      let dot = 0;
      for (let d = 0; d < DIMS; d++) dot += a[d]! * b[d]!;
      sum += dot; n++;
    }
    if (n >= r.rows.length * 0.8) scores.push({ s, score: sum / n / scale });
  }
  if (!scores.length) return null;
  const best = scores.reduce((a, b) => (b.score > a.score ? b : a));
  // the runner-up is the best *other peak*: shifts next to the best one sit on its slope (a chord lasts a while)
  const peaks = scores.filter((x, i) => x.score >= (scores[i - 1]?.score ?? -Infinity) && x.score >= (scores[i + 1]?.score ?? -Infinity));
  const rival = peaks.filter((x) => Math.abs(x.s - best.s) >= 0.25).reduce((m, x) => Math.max(m, x.score), -1);
  return { shift: Math.round(best.s * 100) / 100, score: best.score, margin: best.score - rival };
}

/** Accept a match only when it is clearly the music (not a quiet room or headphones) and clearly one place. */
export const confident = (m: Match | null): m is Match => !!m && m.score >= 0.22 && m.margin >= 0.04;
/**
 * Two weaker matches from different parts of the song that land on the same shift are as good as one strong one.
 * Landing within 0.1 s of each other is itself the evidence (two unrelated stretches rarely share a wrong peak), so
 * clearly-music matches that agree that closely count even when each had a close runner-up.
 */
export const agree = (a: Match | null, b: Match | null): boolean => {
  if (!a || !b) return false;
  const d = Math.abs(a.shift - b.shift), lo = Math.min(a.score, b.score);
  return (lo >= 0.15 && Math.min(a.margin, b.margin) >= 0.03 && d <= 0.15) || (lo >= 0.2 && d <= 0.1);
};

// ---- in the browser ----

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A player's time, smoothed between the API's coarse updates (like VideoClock). */
function smoothTime(p: YTPlayer) {
  let anchor = { yt: 0, at: 0, playing: false };
  return () => {
    let yt: number, playing: boolean;
    try { yt = p.getCurrentTime(); playing = p.getPlayerState() === 1; } catch { return null; }
    const predicted = anchor.playing ? anchor.yt + (performance.now() - anchor.at) / 1000 : anchor.yt;
    if (!playing || !anchor.playing || Math.abs(predicted - yt) > 0.12) anchor = { yt, at: performance.now(), playing };
    return playing ? (anchor.playing ? anchor.yt + (performance.now() - anchor.at) / 1000 : yt) : null;
  };
}

/** Seek, play, and wait until it's really playing near `to` (an ad or buffering can delay it). */
async function playFrom(p: YTPlayer, to: number, signal: AbortSignal) {
  p.seekTo(to, true);
  p.playVideo();
  const until = performance.now() + 15_000;
  while (performance.now() < until) {
    if (signal.aborted) return false;
    try { if (p.getPlayerState() === 1 && Math.abs(p.getCurrentTime() - to) < 1.5) { await sleep(350); return true; } } catch { /* not ready */ }
    await sleep(100);
  }
  return false;
}

/** Frames heard while `time` says the video is playing; `level` collects the mic's loudness (dBFS) per frame. */
async function listen(an: AnalyserNode, sampleRate: number, time: () => number | null, ms: number, signal: AbortSignal, level: number[]): Promise<Frame[]> {
  const db = new Float32Array(an.frequencyBinCount);
  const wave = new Float32Array(an.fftSize);
  const out: Frame[] = [];
  let prev: Float32Array | null = null;
  const end = performance.now() + ms;
  while (performance.now() < end && !signal.aborted) {
    const t = time();
    an.getFloatFrequencyData(db);
    const f = features(db, sampleRate, an.fftSize, prev);
    prev = f.mag;
    if (t != null) {
      out.push({ t, v: f.v });
      an.getFloatTimeDomainData(wave);
      let sum = 0;
      for (const x of wave) sum += x * x;
      level.push(10 * Math.log10(sum / wave.length + 1e-12));
    }
    await sleep(40);
  }
  return out;
}

/** The raw mic (echo cancellation would remove exactly the music we need to hear), or null if Skip came first. */
function micUntilAborted(signal: AbortSignal): Promise<MediaStream | null> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return resolve(null);
    const onAbort = () => resolve(null);
    signal.addEventListener('abort', onAbort, { once: true });
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })
      .then((s) => { signal.removeEventListener('abort', onAbort); if (signal.aborted) s.getTracks().forEach((t) => t.stop()); resolve(signal.aborted ? null : s); },
            (e) => { signal.removeEventListener('abort', onAbort); reject(e); });
  });
}

/** False when the browser already says the mic is blocked (then there's nothing to listen with). */
export async function micMaybeAllowed(): Promise<boolean> {
  try { return (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state !== 'denied'; } catch { return true; }
}

/** Long enough to cross a change of section (verse into chorus): a short stretch of a looping groove fits a bar off. */
const REF_S = 16;
const START_REF_S = 8;
const SLACK_S = 6;
/** Seconds of the room's own quiet recorded as "before the video starts" (the song's very start is then unmistakable). */
const PRE_S = 1.5;

export type SyncOutcome = 'ok' | 'low-confidence' | 'no-mic' | 'skipped' | 'original-did-not-play' | 'karaoke-did-not-play' | 'error';
export interface SyncResult {
  offset: number; match: Match | null; ok: boolean; outcome: SyncOutcome;
  refFrames: number; candFrames: number;
  /** median mic level while listening (dBFS): very low means it couldn't hear the speakers */
  levelDb: number | null;
}

/**
 * Measure the karaoke video's offset (video time = lyrics time + offset) against the original, whose offset
 * (`originalOffset`) the lyrics already match. `guess` is the current karaoke offset; the answer is searched
 * within ±4 s of it. `at`: the lyrics time to compare (somewhere with full music). Leaves both players paused.
 */
export async function measureKaraokeOffset(o: {
  ctx: AudioContext; karaoke: YTPlayer; original: YTPlayer; originalOffset: number; guess: number;
  /** lyrics time to compare at; at or before the original's start (-originalOffset), the song's opening is compared */
  at: number;
  signal: AbortSignal; onStep?: (step: 'original' | 'karaoke') => void;
}): Promise<SyncResult> {
  let ref: Frame[] = [], cand: Frame[] = [];
  const level: number[] = [];
  const result = (outcome: SyncOutcome, match: Match | null = null, offset = o.guess): SyncResult => {
    const lv = [...level].sort((a, b) => a - b);
    return { offset, match, ok: outcome === 'ok', outcome, refFrames: ref.length, candFrames: cand.length,
             levelDb: lv.length ? Math.round(lv[Math.floor(lv.length / 2)]! * 10) / 10 : null };
  };
  let stream: MediaStream | null;
  try { stream = await micUntilAborted(o.signal); } catch { return result('no-mic'); }
  if (!stream) return result('skipped');
  const src = o.ctx.createMediaStreamSource(stream);
  const an = o.ctx.createAnalyser();
  an.fftSize = 8192;
  an.smoothingTimeConstant = 0;
  src.connect(an);
  const { karaoke: k, original: g } = o;
  try {
    k.pauseVideo(); k.mute();
    g.pauseVideo();
    g.unMute(); g.setVolume(100);
    o.onStep?.('original');
    // the room while nothing plays, stamped as the moments before video time `from`
    const quiet = async (from: number, seconds: number) => {
      const t0 = performance.now();
      return listen(an, o.ctx.sampleRate, () => from - seconds + (performance.now() - t0) / 1000, seconds * 1000, o.signal, []);
    };
    let gFrom = o.at + o.originalOffset;
    const opening = gFrom <= 0.01;
    const pre = opening ? PRE_S : 0;
    const refS = opening ? START_REF_S : REF_S;
    gFrom = Math.max(0, gFrom);
    if (pre) ref = await quiet(0, pre);
    if (!(await playFrom(g, gFrom, o.signal))) return result(o.signal.aborted ? 'skipped' : 'original-did-not-play');
    ref = [...ref, ...(await listen(an, o.ctx.sampleRate, smoothTime(g), refS * 1000, o.signal, level))];
    g.pauseVideo();
    if (o.signal.aborted) return result('skipped');

    k.unMute(); k.setVolume(100);
    o.onStep?.('karaoke');
    // cover the reference (pre-roll included) shifted anywhere within the slack
    const kFrom = o.at + o.guess - pre - SLACK_S;
    const kPre = Math.min(Math.max(0, -kFrom), pre + 2 * SLACK_S);
    if (kPre > 0) cand = await quiet(0, kPre);
    if (!(await playFrom(k, Math.max(0, kFrom), o.signal))) return result(o.signal.aborted ? 'skipped' : 'karaoke-did-not-play');
    cand = [...cand, ...(await listen(an, o.ctx.sampleRate, smoothTime(k), (refS + pre + 2 * SLACK_S - kPre) * 1000, o.signal, level))];
    k.pauseVideo();
    if (o.signal.aborted) return result('skipped');

    // cand time = ref time + s, so karaoke offset = original offset + s
    const center = o.guess - o.originalOffset;
    const match = bestShift(ref, cand, center - SLACK_S, center + SLACK_S);
    if (!confident(match)) return result('low-confidence', match);
    return result('ok', match, Math.round((o.originalOffset + match.shift) * 100) / 100);
  } catch {
    return result('error');
  } finally {
    try { k.pauseVideo(); g.pauseVideo(); k.unMute(); } catch { /* gone */ }   // the Stage restores volumes
    src.disconnect();
    stream.getTracks().forEach((t) => t.stop());
  }
}

/** Offsets this browser has measured (for visitors who aren't signed in, whose results aren't shared). */
const localKey = (videoId: string) => `soundcheck.autosync.${videoId}`;
export function localOffset(videoId: string): number | null {
  try { const v = localStorage.getItem(localKey(videoId)); return v == null ? null : Number(v); } catch { return null; }
}
export function rememberOffset(videoId: string, offset: number) {
  try { localStorage.setItem(localKey(videoId), String(offset)); } catch { /* storage blocked */ }
}
