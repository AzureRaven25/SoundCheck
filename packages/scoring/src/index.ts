/**
 * SoundCheck Score v1: implementation of docs/SCORING.md.
 *
 * Pure TypeScript, no dependencies: runs in the website (practice mode, previews) and in the
 * `score-performance` Edge Function (the official score that gets stored). Deterministic: the same
 * inputs always produce the same score.
 */

export const SCORING_VERSION = '1.0.0';

export interface RefNote { start: number; end: number; pitch: number; conf?: number }
export interface Phrase { start: number; end: number; noteIdx: number[] }

export interface ScoreInput {
  notes: RefNote[];
  phrases?: Phrase[];
  /** Flat frames, 4 numbers each: [t (song seconds), f0 Hz (0 = unvoiced), confidence 0–1, rms dBFS]. */
  frames: number[];
  keyShift?: number;
  /** From mic calibration (dBFS). Frames must be 10 dB above it to count as singing. */
  noiseFloorDb?: number | null;
  /**
   * Measured phone→host latency (ms) from calibration. When known, the alignment search is limited
   * to ±80 ms around it, so a singer who is consistently late is still penalised. Unknown: ±400 ms.
   */
  latencyMs?: number | null;
  hop?: number;
}

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

export interface ScoreResult {
  score: number;
  grade: Grade;
  pitch: number;
  timing: number;
  rhythm: number;
  stability: number;
  feedback: string[];
  details: {
    scoringVersion: string;
    latencyOffsetMs: number;
    octaveShifts: number[];        // per phrase, semitones
    meanOnsetMs: number | null;    // + = late
    meanPitchBiasCents: number | null; // + = sharp
    coverage: number;
    completion: number;
    attemptedNotes: number;
    totalNotes: number;
    phraseScores: number[];        // pitch score per phrase (0–1, NaN-free; -1 = not attempted)
  };
}

const WEIGHTS = { pitch: 0.4, timing: 0.25, rhythm: 0.2, stability: 0.15 };
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const std = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h]! : (s[h - 1]! + s[h]!) / 2;
};
export const hzToCents = (hz: number) => 1200 * Math.log2(hz / 440) + 6900; // MIDI × 100

/** Linear credit: 1 up to `full`, 0 from `zero` on. */
const ramp = (x: number, full: number, zero: number) => (x <= full ? 1 : x >= zero ? 0 : 1 - (x - full) / (zero - full));

export function grade(score: number): Grade {
  return score >= 95 ? 'S' : score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';
}

export function phrasesFromGaps(notes: RefNote[], gap = 0.3): Phrase[] {
  const out: Phrase[] = [];
  let cur: number[] = [];
  notes.forEach((n, i) => {
    if (cur.length && n.start - notes[cur[cur.length - 1]!]!.end >= gap) {
      out.push({ start: notes[cur[0]!]!.start, end: notes[cur[cur.length - 1]!]!.end, noteIdx: cur });
      cur = [];
    }
    cur.push(i);
  });
  if (cur.length) out.push({ start: notes[cur[0]!]!.start, end: notes[cur[cur.length - 1]!]!.end, noteIdx: cur });
  return out;
}

interface Frames { t: Float64Array; c: Float64Array; voiced: Uint8Array; n: number }

function parseFrames(flat: number[], floorDb: number | null | undefined): Frames {
  const n = Math.floor(flat.length / 4);
  const t = new Float64Array(n), c = new Float64Array(n), voiced = new Uint8Array(n);
  const gate = floorDb == null ? -Infinity : floorDb + 10;
  for (let i = 0; i < n; i++) {
    const f0 = flat[i * 4 + 1]!, conf = flat[i * 4 + 2]!, rms = flat[i * 4 + 3]!;
    t[i] = flat[i * 4]!;
    if (f0 > 0 && conf >= 0.6 && rms >= gate) {
      voiced[i] = 1;
      c[i] = hzToCents(f0);
    }
  }
  return { t, c, voiced, n };
}

/** For each frame, the index of the reference note sounding at time (t - delta), or -1. Frames sorted by t. */
function activeNotes(fr: Frames, notes: RefNote[], delta: number): Int32Array {
  const out = new Int32Array(fr.n).fill(-1);
  let k = 0;
  for (let i = 0; i < fr.n; i++) {
    const t = fr.t[i]! - delta;
    while (k < notes.length && notes[k]!.end <= t) k++;
    if (k < notes.length && notes[k]!.start <= t) out[i] = k;
  }
  return out;
}

const folded = (cents: number, target: number) => {
  const d = (((cents - target) % 1200) + 1200) % 1200;
  return Math.min(d, 1200 - d);
};

/** Latency alignment: the offset that maximises in-tune (octave-folded ±100 c) voiced frames. */
function findOffset(fr: Frames, notes: RefNote[], ref: number[], latencyMs: number | null | undefined): number {
  const center = latencyMs == null ? 0 : latencyMs / 1000;
  const span = latencyMs == null ? 0.4 : 0.08;
  let best = center, bestHits = -1;
  for (let d = center - span; d <= center + span + 1e-9; d += 0.01) {
    const act = activeNotes(fr, notes, d);
    let hits = 0;
    for (let i = 0; i < fr.n; i++) {
      const k = act[i]!;
      if (k >= 0 && fr.voiced[i] && folded(fr.c[i]!, ref[k]!) <= 100) hits++;
    }
    if (hits > bestHits || (hits === bestHits && Math.abs(d - center) < Math.abs(best - center))) {
      bestHits = hits;
      best = d;
    }
  }
  return Math.round(best * 1000) / 1000;
}

/** Remove the best-fitting 4–8 Hz sinusoid (intentional vibrato) from a residual series (10 ms hop). */
function removeVibrato(res: number[], hop: number): number[] {
  if (res.length < 20) return res;
  let best = res, bestVar = std(res);
  for (let hz = 4; hz <= 8.0001; hz += 0.5) {
    let sc = 0, cc = 0, ss = 0, cs = 0, sn = 0;
    for (let i = 0; i < res.length; i++) {
      const w = 2 * Math.PI * hz * i * hop;
      const s = Math.sin(w), c = Math.cos(w);
      sn += res[i]! * s; cs += res[i]! * c; ss += s * s; cc += c * c; sc += s * c;
    }
    const det = ss * cc - sc * sc;
    if (Math.abs(det) < 1e-9) continue;
    const a = (sn * cc - cs * sc) / det, b = (cs * ss - sn * sc) / det;
    const fitted = res.map((r, i) => r - a * Math.sin(2 * Math.PI * hz * i * hop) - b * Math.cos(2 * Math.PI * hz * i * hop));
    const v = std(fitted);
    if (v < bestVar) { bestVar = v; best = fitted; }
  }
  return best;
}

export function scorePerformance(input: ScoreInput): ScoreResult {
  const hop = input.hop ?? 0.01;
  const keyShift = input.keyShift ?? 0;
  const notes = [...input.notes].sort((a, b) => a.start - b.start);
  const phrases = input.phrases?.length ? input.phrases : phrasesFromGaps(notes);
  const ref = notes.map((n) => (n.pitch + keyShift) * 100);
  const fr = parseFrames(input.frames, input.noiseFloorDb);

  const empty: ScoreResult = {
    score: 0, grade: 'D', pitch: 0, timing: 0, rhythm: 0, stability: 0,
    feedback: ['We didn’t hear any singing. Check that your mic is on and close to you.'],
    details: { scoringVersion: SCORING_VERSION, latencyOffsetMs: 0, octaveShifts: phrases.map(() => 0), meanOnsetMs: null,
               meanPitchBiasCents: null, coverage: 0, completion: 0.5, attemptedNotes: 0, totalNotes: notes.length, phraseScores: phrases.map(() => -1) },
  };
  if (!notes.length || !fr.voiced.some((v) => v)) return empty;

  // 0. latency alignment, then frame → note mapping
  const delta = findOffset(fr, notes, ref, input.latencyMs);
  const act = activeNotes(fr, notes, delta);
  const framesOf: number[][] = notes.map(() => []);
  for (let i = 0; i < fr.n; i++) if (act[i]! >= 0) framesOf[act[i]!]!.push(i);

  // 0b. octave choice per phrase (fair to every vocal range)
  const noteOctave = new Float64Array(notes.length);
  const octaveShifts = phrases.map((p) => {
    let bestO = 0, bestErr = Infinity;
    for (const o of [0, -12, 12, -24, 24]) {
      const errs: number[] = [];
      for (const k of p.noteIdx) for (const i of framesOf[k] ?? []) if (fr.voiced[i]) errs.push(Math.abs(fr.c[i]! - (ref[k]! + o * 100)));
      const m = median(errs);
      if (errs.length && m < bestErr - 1e-9) { bestErr = m; bestO = o; }
    }
    for (const k of p.noteIdx) noteOctave[k] = bestO * 100;
    return bestO;
  });
  const target = (k: number) => ref[k]! + noteOctave[k]!;

  // 1. pitch
  const attempted = notes.map((n, k) => {
    const fs = framesOf[k]!;
    const v = fs.filter((i) => fr.voiced[i]).length;
    return fs.length > 0 && v >= 0.25 * fs.length;
  });
  let pNum = 0, pDen = 0;
  const signed: number[] = [];
  const noteScore = notes.map((n, k) => {
    if (!attempted[k]) return -1;
    const es = framesOf[k]!.filter((i) => fr.voiced[i]).map((i) => fr.c[i]! - target(k));
    es.forEach((e) => signed.push(e));
    const s = mean(es.map((e) => ramp(Math.abs(e), 50, 300)));
    const w = (n.conf ?? 1) < 0.5 ? 0.5 : 1;
    pNum += s * (n.end - n.start) * w;
    pDen += (n.end - n.start) * w;
    return s;
  });
  const pitch = pDen ? pNum / pDen : 0;

  // 2. timing: onsets + coverage
  const onsetIdx = notes.map((n, k) => k).filter((k) => k === 0 || notes[k]!.start - notes[k - 1]!.end >= 0.15
    || phrases.some((p) => p.noteIdx[0] === k));
  const deltas: number[] = [];
  const onsetScores = onsetIdx.map((k) => {
    const s0 = notes[k]!.start;
    for (let i = 0; i < fr.n; i++) {
      const t = fr.t[i]! - delta;
      if (t < s0 - 0.4) continue;
      if (t > s0 + 0.4) break;
      if (fr.voiced[i]) {
        deltas.push(t - s0);
        return ramp(Math.abs(t - s0), 0.1, 0.4);
      }
    }
    return 0;
  });
  let covNum = 0, covDen = 0;
  notes.forEach((n, k) => {
    const dur = n.end - n.start;
    const voicedTime = framesOf[k]!.filter((i) => fr.voiced[i]).length * hop;
    covNum += Math.min(1, voicedTime / dur) * dur;
    covDen += dur;
  });
  const coverage = covDen ? covNum / covDen : 0;
  const timing = 0.5 * (onsetScores.length ? mean(onsetScores) : coverage) + 0.5 * coverage;

  // 3. rhythm: pitch transitions inside phrases
  const transScores: number[] = [];
  for (let k = 0; k + 1 < notes.length; k++) {
    const a = notes[k]!, b = notes[k + 1]!;
    if (a.pitch === b.pitch || b.start - a.end >= 0.15 || !attempted[k] || !attempted[k + 1]) continue;
    const mid = (target(k) + target(k + 1)) / 2;
    const up = target(k + 1) > target(k);
    // The transition happens when the singer, having been on note a, crosses to b's side of the
    // midpoint. Requiring a-side first matters: a late singer may still be on the note *before* a,
    // which can sit on b's side and would otherwise look like an instant (early) transition.
    let found: number | null = null;
    let seenA = false;
    for (let i = 0; i < fr.n; i++) {
      const t = fr.t[i]! - delta;
      if (t < b.start - 0.3) continue;
      if (t > b.start + 0.3) break;
      if (!fr.voiced[i]) continue;
      const onB = up ? fr.c[i]! > mid : fr.c[i]! < mid;
      if (!onB) seenA = true;
      else if (seenA) { found = t; break; }
    }
    if (found == null) { transScores.push(0); continue; }
    deltas.push(found - b.start);
    transScores.push(ramp(Math.abs(found - b.start), 0.08, 0.3));
  }
  const consistency = 1 - Math.min(1, std(deltas) / 0.2);
  const rhythm = transScores.length
    ? 0.7 * mean(transScores) + 0.3 * consistency
    : 0.7 * (onsetScores.length ? mean(onsetScores) : 0) + 0.3 * consistency;

  // 4. stability on sustained notes
  let sNum = 0, sDen = 0;
  notes.forEach((n, k) => {
    const dur = n.end - n.start;
    if (dur < 0.4 || !attempted[k]) return;
    const cs = framesOf[k]!.filter((i) => fr.voiced[i]).map((i) => fr.c[i]! - noteOctave[k]!);
    if (cs.length < 10) return;
    const w = 12; // 250 ms window: longer than any vibrato cycle, so vibrato stays in the residual and is fitted out
    const ma = cs.map((_, i) => mean(cs.slice(Math.max(0, i - w), i + w + 1)));
    const jitter = std(removeVibrato(cs.map((c, i) => c - ma[i]!), hop));
    const slope = Math.abs(ma[ma.length - 1]! - ma[0]!) / Math.max(hop, (cs.length - 1) * hop);
    const s = clamp01(ramp(jitter, 15, 80) - Math.min(0.3, slope / 200));
    sNum += s * dur;
    sDen += dur;
  });
  const stability = sDen ? sNum / sDen : pitch;

  // Completion: pitch/rhythm/stability judge only the notes attempted, so a half-sung song must not
  // score like a full one. Full credit from 90% coverage down; half the song ≈ 0.78×.
  const completion = 0.5 + 0.5 * Math.min(1, coverage / 0.9);
  const score = Math.round(100 * completion * (WEIGHTS.pitch * pitch + WEIGHTS.timing * timing + WEIGHTS.rhythm * rhythm + WEIGHTS.stability * stability));
  const phraseScores = phrases.map((p) => {
    const xs = p.noteIdx.map((k) => noteScore[k]!).filter((s) => s >= 0);
    return xs.length ? Math.round(mean(xs) * 1000) / 1000 : -1;
  });
  const bias = signed.length ? median(signed) : null;
  const meanOnset = deltas.length ? mean(deltas) : null;

  // feedback: most useful first, at most 3
  const fb: string[] = [];
  if (coverage < 0.6) fb.push('Some lines went unsung. Keep going through the quieter parts too.');
  if (bias != null && Math.abs(bias) >= 25) fb.push(`You were about ${Math.round(Math.abs(bias))} cents ${bias < 0 ? 'flat' : 'sharp'} on average. Try ${bias < 0 ? 'lifting' : 'relaxing'} the pitch slightly.`);
  if (meanOnset != null && Math.abs(meanOnset) >= 0.08) fb.push(`You tended to come in ${Math.round(Math.abs(meanOnset) * 1000)} ms ${meanOnset > 0 ? 'late' : 'early'}.`);
  const worst = phraseScores.reduce((w, s, i) => (s >= 0 && (w < 0 || s < phraseScores[w]!) ? i : w), -1);
  if (worst >= 0 && phraseScores[worst]! < 0.6 && fb.length < 3) fb.push(`Line ${worst + 1} was the toughest. Worth another run.`);
  if (stability >= 0.85 && sDen > 0 && fb.length < 3) fb.push('Rock-solid long notes.');
  if (octaveShifts.some((o) => o !== 0) && fb.length < 3) fb.push('You sang in a different octave on some lines. That’s fully counted.');
  if (!fb.length) fb.push(score >= 90 ? 'Outstanding: pitch, timing and control all on point.' : 'Nice run! Sing it again to beat your score.');

  return {
    score, grade: grade(score), pitch: round3(pitch), timing: round3(timing), rhythm: round3(rhythm), stability: round3(stability),
    feedback: fb.slice(0, 3),
    details: {
      scoringVersion: SCORING_VERSION, latencyOffsetMs: Math.round(delta * 1000), octaveShifts,
      meanOnsetMs: meanOnset == null ? null : Math.round(meanOnset * 1000),
      meanPitchBiasCents: bias == null ? null : Math.round(bias),
      coverage: round3(coverage), completion: round3(completion), attemptedNotes: attempted.filter(Boolean).length, totalNotes: notes.length, phraseScores,
    },
  };
}
const round3 = (x: number) => Math.round(clamp01(x) * 1000) / 1000;

/** Cheap per-frame check for live HUDs (TV, phone): is this frame on the note sounding now? */
export function liveHit(f0Hz: number, refMidi: number | null, keyShift = 0): boolean | null {
  if (refMidi == null || f0Hz <= 0) return null;
  return folded(hzToCents(f0Hz), (refMidi + keyShift) * 100) <= 100;
}
