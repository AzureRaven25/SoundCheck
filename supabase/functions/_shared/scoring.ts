// GENERATED from packages/scoring/src/index.ts by `npm run sync:scoring`. Do not edit.
/**
 * SoundCheck Score v1: implementation of docs/SCORING.md.
 *
 * Pure TypeScript, no dependencies: runs in the website (practice mode, previews) and in the
 * `score-performance` Edge Function (the official score that gets stored). Deterministic: the same
 * inputs always produce the same score.
 */

export const SCORING_VERSION = '1.2.0';

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
  /** steadiness of your timing from note to note (a consistent small lag is fine) */
  rhythm: number;
  /** holding notes for their full length */
  duration: number;
  /** moving from one note to the next at the right moment */
  transitions: number;
  stability: number;
  /**
   * Expression (v1.2): volume dynamics across phrases plus vibrato on long notes, the way karaoke-box scoring
   * (DAM, JOYSOUND) rewards a performance that isn't flat and mechanical. It adds up to BONUS_MAX bonus points on
   * top of the weighted categories; it never takes points away.
   */
  expression: number;
  bonus: number;
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
    vibratoNotes?: number;         // long notes sung with a real vibrato
    dynamicsDb?: number;           // spread of loudness between phrases (dB)
    mode?: 'melody' | 'lyrics';
  };
}

export const BONUS_MAX = 5;
const WEIGHTS = { pitch: 0.35, timing: 0.2, rhythm: 0.1, duration: 0.1, transitions: 0.1, stability: 0.15 };
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

interface Frames { t: Float64Array; c: Float64Array; db: Float64Array; voiced: Uint8Array; n: number }

function parseFrames(flat: number[], floorDb: number | null | undefined): Frames {
  const n = Math.floor(flat.length / 4);
  // Frames arrive in network order; everything below scans in song time, so sort first (stable).
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => flat[a * 4]! - flat[b * 4]! || a - b);
  const t = new Float64Array(n), c = new Float64Array(n), db = new Float64Array(n), voiced = new Uint8Array(n);
  const gate = floorDb == null ? -Infinity : floorDb + 10;
  for (let k = 0; k < n; k++) {
    const i = order[k]!;
    const f0 = flat[i * 4 + 1]!, conf = flat[i * 4 + 2]!, rms = flat[i * 4 + 3]!;
    t[k] = flat[i * 4]!;
    db[k] = rms;
    if (f0 > 0 && conf >= 0.6 && rms >= gate) {
      voiced[k] = 1;
      c[k] = hzToCents(f0);
    }
  }
  return { t, c, db, voiced, n };
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

/**
 * Vibrato on a sustained note: a regular 4.5–7.5 Hz pitch oscillation, 15–150 cents deep, that explains most of the
 * note's pitch movement once the slow drift is removed. Returns the depth (cents, peak) or null.
 */
export function detectVibrato(cents: number[], hop = 0.01): number | null {
  if (cents.length < 40) return null;
  const w = 12;
  const ma = cents.map((_, i) => mean(cents.slice(Math.max(0, i - w), i + w + 1)));
  const res = cents.map((c, i) => c - ma[i]!);
  const total = mean(res.map((r) => r * r));
  if (!(total > 0)) return null;
  let best = 0, bestAmp = 0;
  for (let hz = 4.5; hz <= 7.5001; hz += 0.25) {
    let ss = 0, cc = 0, sc = 0, sn = 0, cs = 0;
    for (let i = 0; i < res.length; i++) {
      const a = 2 * Math.PI * hz * i * hop, si = Math.sin(a), co = Math.cos(a);
      ss += si * si; cc += co * co; sc += si * co; sn += res[i]! * si; cs += res[i]! * co;
    }
    const det = ss * cc - sc * sc;
    if (Math.abs(det) < 1e-9) continue;
    const a = (sn * cc - cs * sc) / det, b = (cs * ss - sn * sc) / det;
    const amp = Math.hypot(a, b);
    const explained = (amp * amp) / 2 / total;
    if (explained > best) { best = explained; bestAmp = amp; }
  }
  return best >= 0.5 && bestAmp >= 15 && bestAmp <= 150 ? Math.round(bestAmp) : null;
}

/** Expression: loudness contrast between sung phrases (karaoke boxes call it dynamics) and vibrato on long notes. */
function expressionOf(fr: Frames, groups: number[][], longNotes: number[][], hop: number) {
  const levels = groups.map((fs) => fs.filter((i) => fr.voiced[i]).map((i) => fr.db[i]!)).filter((xs) => xs.length >= 20).map((xs) => median(xs));
  const dynamicsDb = levels.length >= 3 ? std(levels) : 0;
  const dyn = clamp01((dynamicsDb - 1) / 3);           // 1 dB spread: flat; 4 dB+: expressive
  let vib = 0;
  for (const fs of longNotes) if (detectVibrato(fs.map((i) => fr.c[i]!), hop) != null) vib++;
  const vibShare = longNotes.length ? vib / longNotes.length : 0;
  const vibScore = clamp01(vibShare / 0.3);            // vibrato on ~a third of the long notes is plenty
  return { expression: 0.5 * dyn + 0.5 * vibScore, dynamicsDb: Math.round(dynamicsDb * 10) / 10, vibratoNotes: vib };
}

export function scorePerformance(input: ScoreInput): ScoreResult {
  const hop = input.hop ?? 0.01;
  const keyShift = input.keyShift ?? 0;
  const notes = [...input.notes].sort((a, b) => a.start - b.start);
  const phrases = input.phrases?.length ? input.phrases : phrasesFromGaps(notes);
  const ref = notes.map((n) => (n.pitch + keyShift) * 100);
  const fr = parseFrames(input.frames, input.noiseFloorDb);

  const empty: ScoreResult = {
    score: 0, grade: 'D', pitch: 0, timing: 0, rhythm: 0, duration: 0, transitions: 0, stability: 0, expression: 0, bonus: 0,
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
      // the onset is the first frame actually on *this* note (within 50 cents, any octave): the tail of the
      // previous note must not count as arriving early
      if (fr.voiced[i] && folded(fr.c[i]!, target(k)) <= 50) {
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
  const onsetMean = onsetScores.length ? mean(onsetScores) : 0;
  const transitions = transScores.length ? mean(transScores) : onsetMean;
  // rhythm: how steady the singer's timing is across onsets and transitions (std of their offsets)
  const rhythm = deltas.length >= 3 ? 1 - Math.min(1, std(deltas) / 0.2) : onsetMean;

  // 3b. duration: of the notes you sang, did you hold them for their length? (≥ 75% held = full credit)
  let dNum = 0, dDen = 0;
  notes.forEach((n, k) => {
    const len = n.end - n.start;
    if (len < 0.25 || !attempted[k]) return;
    const held = framesOf[k]!.filter((i) => fr.voiced[i]).length * hop / len;
    dNum += ramp(1 - held, 0.25, 0.8) * len;
    dDen += len;
  });
  const duration = dDen ? dNum / dDen : 0;

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
  const base = 100 * completion * (WEIGHTS.pitch * pitch + WEIGHTS.timing * timing + WEIGHTS.rhythm * rhythm
    + WEIGHTS.duration * duration + WEIGHTS.transitions * transitions + WEIGHTS.stability * stability);
  // expression bonus: only for singing that is also in tune (vibrato around the wrong note earns nothing)
  const expr = expressionOf(fr, phrases.map((p) => p.noteIdx.flatMap((k) => framesOf[k]!)),
    notes.map((n, k) => (n.end - n.start >= 0.6 && attempted[k] && noteScore[k]! >= 0.7 ? framesOf[k]!.filter((i) => fr.voiced[i]) : [])).filter((fs) => fs.length >= 40), hop);
  const bonus = Math.round(BONUS_MAX * expr.expression * pitch * completion * 10) / 10;
  const score = Math.min(100, Math.round(base + bonus));
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
  if (duration < 0.6 && dDen > 0 && fb.length < 3) fb.push('Hold your notes a little longer; several were cut short.');
  if (octaveShifts.some((o) => o !== 0) && fb.length < 3) fb.push('You sang in a different octave on some lines. That’s fully counted.');
  if (expr.vibratoNotes >= 2 && fb.length < 3) fb.push(`Nice vibrato on ${expr.vibratoNotes} long notes: bonus points.`);
  else if (expr.expression < 0.2 && pitch >= 0.8 && fb.length < 3) fb.push('Add some dynamics: soft verses and a bigger chorus earn bonus points.');
  if (!fb.length) fb.push(score >= 90 ? 'Outstanding: pitch, timing and control all on point.' : 'Nice run! Sing it again to beat your score.');

  return {
    score, grade: grade(score), pitch: round3(pitch), timing: round3(timing), rhythm: round3(rhythm),
    duration: round3(duration), transitions: round3(transitions), stability: round3(stability),
    expression: round3(expr.expression), bonus,
    feedback: fb.slice(0, 3),
    details: {
      scoringVersion: SCORING_VERSION, latencyOffsetMs: Math.round(delta * 1000), octaveShifts,
      meanOnsetMs: meanOnset == null ? null : Math.round(meanOnset * 1000),
      meanPitchBiasCents: bias == null ? null : Math.round(bias),
      coverage: round3(coverage), completion: round3(completion), attemptedNotes: attempted.filter(Boolean).length, totalNotes: notes.length, phraseScores,
      vibratoNotes: expr.vibratoNotes, dynamicsDb: expr.dynamicsDb, mode: 'melody',
    },
  };
}
const round3 = (x: number) => Math.round(clamp01(x) * 1000) / 1000;

/** Cheap per-frame check for live HUDs (TV, phone): is this frame on the note sounding now? */
export function liveHit(f0Hz: number, refMidi: number | null, keyShift = 0): boolean | null {
  if (refMidi == null || f0Hz <= 0) return null;
  return folded(hzToCents(f0Hz), (refMidi + keyShift) * 100) <= 100;
}

// ─── Lyrics score: songs with synced lyrics but no reference melody (e.g. sung along to a YouTube video) ───

export const LYRICS_SCORING_VERSION = 'lyrics-1.0.0';

export interface LyricLine { start?: number; end?: number; text: string; words?: { start: number; end: number; text: string }[] }

export interface LyricsScoreInput {
  /** Synced lyric lines in song time (the same clock as the frames). */
  lines: LyricLine[];
  frames: number[];
  noiseFloorDb?: number | null;
  hop?: number;
}

/** Krumhansl–Kessler key profiles (major, minor), C first. */
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const SCALE_MAJOR = [0, 2, 4, 5, 7, 9, 11];
const SCALE_MINOR = [0, 2, 3, 5, 7, 8, 10];   // natural minor; harmonic 7th (11) also accepted below

/** When each line is actually sung: its words' span, else up to the next line (at most ~0.5 s per word + 1 s). */
export function lineWindows(lines: LyricLine[]): { start: number; end: number; words: number }[] {
  const timed = lines.filter((l) => l.start != null && l.text.trim());
  return timed.map((l, i) => {
    const start = l.start!;
    const next = timed[i + 1]?.start ?? start + 8;
    const words = l.words?.length ?? l.text.trim().split(/\s+/).length;
    const wordEnd = l.words?.length ? l.words[l.words.length - 1]!.end : null;
    const end = Math.min(next, wordEnd ?? l.end ?? start + 1 + 0.5 * words, start + 12);
    return { start, end: Math.max(end, start + 0.5), words };
  });
}

/** Pitch segments: runs of voiced frames that stay within ~60 cents of their running median (sung notes). */
function segments(fr: Frames, minLen: number): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  const flush = () => { if (cur.length >= minLen) out.push(cur); cur = []; };
  for (let i = 0; i < fr.n; i++) {
    if (!fr.voiced[i]) { flush(); continue; }
    if (cur.length) {
      const prevT = fr.t[cur[cur.length - 1]!]!;
      const m = median(cur.slice(-8).map((k) => fr.c[k]!));
      if (fr.t[i]! - prevT > 0.05 || Math.abs(fr.c[i]! - m) > 60) flush();
    }
    cur.push(i);
  }
  flush();
  return out;
}

/**
 * Scores singing against synced lyrics when there's no reference melody: whether you sing each line when it comes
 * (and stay quiet in the breaks), intonation (landing on real notes, in one key), steadiness and expression. It
 * can't know the exact melody, so it is a softer judge than the melody score; results say which one was used.
 */
export function scoreLyrics(input: LyricsScoreInput): ScoreResult {
  const hop = input.hop ?? 0.01;
  const win = lineWindows(input.lines);
  const fr = parseFrames(input.frames, input.noiseFloorDb);
  const empty: ScoreResult = {
    score: 0, grade: 'D', pitch: 0, timing: 0, rhythm: 0, duration: 0, transitions: 0, stability: 0, expression: 0, bonus: 0,
    feedback: ['We didn’t hear any singing. Check that your mic is on and close to you.'],
    details: { scoringVersion: LYRICS_SCORING_VERSION, latencyOffsetMs: 0, octaveShifts: [], meanOnsetMs: null, meanPitchBiasCents: null,
               coverage: 0, completion: 0.5, attemptedNotes: 0, totalNotes: win.length, phraseScores: win.map(() => -1), mode: 'lyrics' },
  };
  if (!win.length || !fr.voiced.some((v) => v)) return empty;

  // 0. alignment: lyrics timing for a video can be off by a little; find the shift (±1 s) that puts the most
  //    singing inside lines and the least outside them
  const inLine = (t: number) => { for (const w of win) { if (t < w.start) return false; if (t < w.end) return true; } return false; };
  let delta = 0, bestFit = -Infinity;
  const firstVoicedAfter = (t0: number) => {   // binary search the first frame at/after t0, then the first voiced one
    let lo = 0, hi = fr.n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (fr.t[m]! < t0) lo = m + 1; else hi = m; }
    for (let i = lo; i < fr.n && fr.t[i]! < t0 + 1.5; i++) if (fr.voiced[i]) return fr.t[i]!;
    return null;
  };
  for (let d = -1; d <= 1.0001; d += 0.05) {
    let fit = 0;
    for (let i = 0; i < fr.n; i++) if (fr.voiced[i]) fit += inLine(fr.t[i]! - d) ? 1 : -1;
    // line entries: singing that starts right on each line's time (worth up to 0.5 s of frames per line)
    for (const w of win) {
      const on = firstVoicedAfter(w.start + d - 0.5);
      if (on != null) fit += (0.5 / hop) * (1 - Math.min(1, Math.abs(on - (w.start + d)) / 0.5));
    }
    if (fit > bestFit + 1e-9 || (Math.abs(fit - bestFit) < 1e-9 && Math.abs(d) < Math.abs(delta))) { bestFit = fit; delta = d; }
  }
  delta = Math.round(delta * 1000) / 1000;
  const lineFrames: number[][] = win.map(() => []);
  const outside: number[] = [];
  {
    let k = 0;
    for (let i = 0; i < fr.n; i++) {
      const t = fr.t[i]! - delta;
      while (k < win.length && win[k]!.end <= t) k++;
      if (k < win.length && win[k]!.start <= t) lineFrames[k]!.push(i); else if (fr.voiced[i]) outside.push(i);
    }
  }

  // 1. timing: each line sung (coverage), entries on time (onsets), quiet in the breaks
  const lineCov = win.map((w, k) => {
    const v = lineFrames[k]!.filter((i) => fr.voiced[i]).length * hop;
    return Math.min(1, v / (0.45 * (w.end - w.start)));   // ~half a line's span is voiced when it's really sung
  });
  const totalLen = win.reduce((a, w) => a + (w.end - w.start), 0);
  const coverage = win.reduce((a, w, k) => a + lineCov[k]! * (w.end - w.start), 0) / totalLen;
  const onsetDeltas: number[] = [];
  const onsets = win.map((w) => {
    for (let i = 0; i < fr.n; i++) {
      const t = fr.t[i]! - delta;
      if (t < w.start - 0.5) continue;
      if (t > w.start + 1) break;
      if (fr.voiced[i]) { onsetDeltas.push(t - w.start); return ramp(Math.abs(t - w.start), 0.2, 0.8); }
    }
    return 0;
  });
  const voicedTotal = fr.voiced.reduce((a, v) => a + v, 0);
  const strayShare = voicedTotal ? outside.length / voicedTotal : 0;
  const timing = clamp01(0.55 * coverage + 0.3 * mean(onsets) + 0.15 * (1 - Math.min(1, strayShare / 0.4)));
  const rhythm = onsetDeltas.length >= 3 ? 1 - Math.min(1, std(onsetDeltas) / 0.3) : mean(onsets);

  // 2. intonation: sung notes land on the semitone grid (after the singer's own tuning) and stay in one key
  const segs = segments(fr, 12);
  const segPitch = segs.map((s) => median(s.map((i) => fr.c[i]!)));
  const segLen = segs.map((s) => s.length * hop);
  let pitch = 0, inKey = 0, keyName: string | null = null;
  if (segs.length >= 4) {
    // tuning: circular mean of where notes sit within a semitone
    let sx = 0, sy = 0;
    segPitch.forEach((p, j) => { const a = (2 * Math.PI * (((p % 100) + 100) % 100)) / 100; sx += Math.cos(a) * segLen[j]!; sy += Math.sin(a) * segLen[j]!; });
    const tune = ((Math.atan2(sy, sx) / (2 * Math.PI)) * 100 + 100) % 100;
    const devs = segPitch.map((p) => { const d = (((p - tune) % 100) + 100) % 100; return Math.min(d, 100 - d); });
    const grid = segLen.reduce((a, l, j) => a + l * ramp(devs[j]!, 12, 40), 0) / segLen.reduce((a, l) => a + l, 0);
    // key: best-correlating major/minor profile over the pitch-class histogram
    const hist = new Array(12).fill(0) as number[];
    segPitch.forEach((p, j) => { hist[(((Math.round((p - tune) / 100) % 12) + 12) % 12)]! += segLen[j]!; });
    const sum = hist.reduce((a, b) => a + b, 0);
    let best = -Infinity, bestTonic = 0, bestMinor = false;
    for (let tonic = 0; tonic < 12; tonic++) for (const minor of [false, true]) {
      const prof = minor ? KK_MINOR : KK_MAJOR;
      const corr = hist.reduce((a, h, pc) => a + h * prof[(pc - tonic + 12) % 12]!, 0);
      if (corr > best) { best = corr; bestTonic = tonic; bestMinor = minor; }
    }
    const scale = new Set((bestMinor ? [...SCALE_MINOR, 11] : SCALE_MAJOR).map((x) => (x + bestTonic) % 12));
    inKey = sum ? hist.reduce((a, h, pc) => a + (scale.has(pc) ? h : 0), 0) / sum : 0;
    const keyScore = ramp(1 - inKey, 0.06, 0.4);
    // a melody moves: droning one note is "in tune" but isn't singing the song
    const spread = std(segPitch);
    const movement = clamp01((spread - 80) / 170);
    pitch = clamp01((0.55 * grid + 0.45 * keyScore) * (0.4 + 0.6 * movement));
    keyName = `${['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][bestTonic]} ${bestMinor ? 'minor' : 'major'}`;
  }

  // 3. steadiness on held notes (vibrato fitted out), and how fully lines are held
  let sNum = 0, sDen = 0;
  const longs: number[][] = [];
  segs.forEach((sg) => {
    if (sg.length < 35) return;
    const cs = sg.map((i) => fr.c[i]!);
    const w = 12;
    const ma = cs.map((_, i) => mean(cs.slice(Math.max(0, i - w), i + w + 1)));
    const jitter = std(removeVibrato(cs.map((c, i) => c - ma[i]!), hop));
    sNum += ramp(jitter, 15, 80) * sg.length;
    sDen += sg.length;
    if (sg.length >= 60) longs.push(sg);
  });
  const stability = sDen ? sNum / sDen : pitch;
  const duration = clamp01(coverage);

  const completion = 0.5 + 0.5 * Math.min(1, coverage / 0.85);
  const base = 100 * completion * (0.35 * pitch + 0.3 * timing + 0.1 * rhythm + 0.25 * stability);
  const expr = expressionOf(fr, lineFrames, longs, hop);
  const bonus = Math.round(BONUS_MAX * expr.expression * pitch * completion * 10) / 10;
  const score = Math.min(100, Math.round(base + bonus));

  const fb: string[] = [];
  if (coverage < 0.6) fb.push('Some lines went unsung. Keep going through the quieter parts too.');
  const meanOnset = onsetDeltas.length ? mean(onsetDeltas) : null;
  if (meanOnset != null && Math.abs(meanOnset) >= 0.25) fb.push(`You tended to come in ${Math.round(Math.abs(meanOnset) * 1000)} ms ${meanOnset > 0 ? 'late' : 'early'}.`);
  if (strayShare > 0.25 && fb.length < 3) fb.push('Save your voice for the lines: there was singing in the instrumental breaks.');
  if (segs.length >= 4 && inKey < 0.75 && fb.length < 3) fb.push(`Some notes drifted out of the key${keyName ? ` (${keyName})` : ''}. Listen to the backing track and match it.`);
  if (expr.vibratoNotes >= 2 && fb.length < 3) fb.push(`Nice vibrato on ${expr.vibratoNotes} long notes: bonus points.`);
  if (!fb.length) fb.push(score >= 90 ? 'Outstanding: on time, in tune and full of feeling.' : 'Nice run! Sing it again to beat your score.');

  const phraseScores = win.map((_, k) => (lineFrames[k]!.some((i) => fr.voiced[i]) ? Math.round(lineCov[k]! * 1000) / 1000 : -1));
  return {
    score, grade: grade(score), pitch: round3(pitch), timing: round3(timing), rhythm: round3(rhythm),
    duration: round3(duration), transitions: round3(rhythm), stability: round3(stability),
    expression: round3(expr.expression), bonus,
    feedback: [...fb.slice(0, 2), 'Scored against the lyrics and the song’s key; songs with a karaoke version are scored note by note.'],
    details: {
      scoringVersion: LYRICS_SCORING_VERSION, latencyOffsetMs: Math.round(delta * 1000), octaveShifts: [],
      meanOnsetMs: meanOnset == null ? null : Math.round(meanOnset * 1000), meanPitchBiasCents: null,
      coverage: round3(coverage), completion: round3(completion), attemptedNotes: phraseScores.filter((s) => s >= 0).length,
      totalNotes: win.length, phraseScores, vibratoNotes: expr.vibratoNotes, dynamicsDb: expr.dynamicsDb, mode: 'lyrics',
    },
  };
}
