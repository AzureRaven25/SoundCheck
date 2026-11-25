import { describe, expect, it } from 'vitest';
import { grade, liveHit, scorePerformance, type RefNote, type ScoreInput } from '../src';

/** Deterministic PRNG (mulberry32) so fixtures never change between runs. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 4 phrases: 5 short notes + 1 sustained note each, 1 s rests between phrases. */
function melody(): RefNote[] {
  const r = rng(7);
  const scale = [60, 62, 64, 65, 67, 69, 71, 72];
  const notes: RefNote[] = [];
  let t = 1;
  for (let p = 0; p < 4; p++) {
    let prev = -1;
    for (let k = 0; k < 6; k++) {
      let pitch = scale[Math.floor(r() * scale.length)]!;
      if (pitch === prev) pitch = scale[(scale.indexOf(pitch) + 1) % scale.length]!;
      prev = pitch;
      const dur = k === 5 ? 1.2 : 0.45;
      notes.push({ start: +t.toFixed(3), end: +(t + dur).toFixed(3), pitch });
      t += dur + 0.02;
    }
    t += 1;
  }
  return notes;
}

interface Sing {
  cents?: number; octave?: number; lateMs?: number; wobble?: number; vibrato?: number;
  skipPhrases?: number[]; keyShift?: number; seed?: number;
}
const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** Simulated singer: follows the melody with controlled flaws; 10 ms frames over the whole song. */
function sing(notes: RefNote[], s: Sing = {}): number[] {
  const r = rng(s.seed ?? 1);
  const frames: number[] = [];
  const end = notes[notes.length - 1]!.end + 1;
  const phraseOf = (k: number) => Math.floor(k / 6);
  for (let t = 0; t < end; t += 0.01) {
    const st = t - (s.lateMs ?? 0) / 1000;          // what the singer is singing at time t
    const k = notes.findIndex((n) => n.start <= st && st < n.end);
    if (k < 0 || s.skipPhrases?.includes(phraseOf(k))) {
      frames.push(+t.toFixed(3), 0, 0.1, -60);
      continue;
    }
    const n = notes[k]!;
    let midi = n.pitch + (s.keyShift ?? 0) + (s.octave ?? 0) + (s.cents ?? 0) / 100;
    if (s.wobble) midi += ((r() * 2 - 1) * s.wobble) / 100;
    if (s.vibrato) midi += (s.vibrato / 100) * Math.sin(2 * Math.PI * 6 * (st - n.start));
    frames.push(+t.toFixed(3), midiToHz(midi), 0.95, -18);
  }
  return frames;
}

const notes = melody();
const run = (s: Sing, extra: Partial<ScoreInput> = {}) =>
  scorePerformance({ notes, frames: sing(notes, s), keyShift: s.keyShift ?? 0, ...extra });

describe('SoundCheck Score golden fixtures', () => {
  const perfect = run({});

  it('perfect performance scores S', () => {
    expect(perfect.score).toBeGreaterThanOrEqual(95);
    expect(perfect.grade).toBe('S');
    expect(perfect.pitch).toBeGreaterThan(0.98);
    expect(perfect.details.coverage).toBeGreaterThan(0.95);
  });

  it('singing an octave lower costs nothing', () => {
    const r = run({ octave: -12 });
    expect(Math.abs(r.score - perfect.score)).toBeLessThanOrEqual(1);
    expect(r.details.octaveShifts.every((o) => o === -12)).toBe(true);
  });

  it('a transposed song is scored against the transposed melody', () => {
    const r = run({ keyShift: 2 });
    expect(Math.abs(r.score - perfect.score)).toBeLessThanOrEqual(1);
  });

  it('a semitone flat loses ~20% of pitch credit and is called out', () => {
    const r = run({ cents: -100 });
    expect(r.pitch).toBeGreaterThan(0.75);
    expect(r.pitch).toBeLessThan(0.85);
    expect(r.details.meanPitchBiasCents).toBeLessThan(-80);
    expect(r.feedback.join(' ')).toMatch(/flat/);
    expect(r.score).toBeLessThan(perfect.score);
  });

  it('small deviations within 50 cents keep full pitch credit', () => {
    expect(run({ cents: 30 }).pitch).toBeGreaterThan(0.98);
  });

  it('constant device latency is aligned away when latency is unknown', () => {
    const r = run({ lateMs: 200 });
    expect(r.details.latencyOffsetMs).toBe(200);
    expect(r.score).toBeGreaterThanOrEqual(perfect.score - 1);
  });

  it('a genuinely late singer is penalised once latency is calibrated', () => {
    const r = run({ lateMs: 300 }, { latencyMs: 0 });
    expect(r.details.latencyOffsetMs).toBe(80);                 // search limited to ±80 ms
    expect(r.details.meanOnsetMs).toBeGreaterThan(150);
    expect(r.timing).toBeLessThan(perfect.timing - 0.1);
    expect(r.feedback.join(' ')).toMatch(/late/);
  });

  it('skipping half the song halves coverage', () => {
    const r = run({ skipPhrases: [1, 3] });
    expect(r.details.coverage).toBeGreaterThan(0.4);
    expect(r.details.coverage).toBeLessThan(0.6);
    expect(r.score).toBeLessThan(80);
    expect(r.feedback[0]).toMatch(/unsung/);
    expect(r.details.phraseScores[1]).toBe(-1);
  });

  it('erratic pitch hurts stability; steady vibrato does not', () => {
    const wobbly = run({ wobble: 90, seed: 3 });
    const vibrato = run({ vibrato: 40 });
    expect(wobbly.stability).toBeLessThan(0.5);
    expect(vibrato.stability).toBeGreaterThan(0.8);
    expect(vibrato.score).toBeGreaterThan(wobbly.score);
  });

  it('silence scores zero with helpful feedback', () => {
    const r = scorePerformance({ notes, frames: Array.from({ length: 4000 }, (_, i) => (i % 4 === 0 ? i / 400 : i % 4 === 3 ? -70 : 0)) });
    expect(r.score).toBe(0);
    expect(r.feedback[0]).toMatch(/didn’t hear/);
  });

  it('noise floor gate ignores quiet frames', () => {
    const r = scorePerformance({ notes, frames: sing(notes), noiseFloorDb: -5 }); // everything below -5 dB ignored
    expect(r.score).toBe(0);
  });

  it('is deterministic', () => {
    expect(run({ wobble: 40, seed: 9 })).toEqual(run({ wobble: 40, seed: 9 }));
  });
});

describe('helpers', () => {
  it('grades', () => {
    expect([96, 85, 70, 55, 54].map(grade)).toEqual(['S', 'A', 'B', 'C', 'D']);
  });
  it('liveHit folds octaves and respects key shift', () => {
    expect(liveHit(midiToHz(48), 60)).toBe(true);
    expect(liveHit(midiToHz(62), 60, 2)).toBe(true);
    expect(liveHit(midiToHz(62), 60)).toBe(false);
    expect(liveHit(0, 60)).toBeNull();
  });
});

describe('server copy', () => {
  it('the Edge Function copy matches this package (run npm run sync:scoring)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const copy = readFileSync(new URL('../../../supabase/functions/_shared/scoring.ts', import.meta.url), 'utf8');
    expect(copy.split('\n').slice(1).join('\n')).toBe(src);
  });
});

describe('frame order', () => {
  it('scores the same whether frames arrive in time order or not', () => {
    const notes = [{ start: 1, end: 2, pitch: 69 }, { start: 2.2, end: 3.2, pitch: 71 }];
    const flat: number[] = [];
    for (let t = 0.9; t < 3.3; t += 0.01) {
      const ref = t < 2.1 ? 69 : 71;
      flat.push(+t.toFixed(3), 440 * 2 ** ((ref - 69) / 12), 0.95, -20);
    }
    const sorted = scorePerformance({ notes, frames: flat, keyShift: 0 });
    // a stale batch from the end of an earlier song arriving first must not wreck the take
    const shuffled = [...flat.slice(-40), ...flat.slice(0, -40)];
    const out = scorePerformance({ notes, frames: shuffled, keyShift: 0 });
    expect(out.score).toBe(sorted.score);
    expect(out.score).toBeGreaterThan(70);
  });
});

describe('duration and rhythm categories (v1.1)', () => {
  const notes = [0, 1, 2, 3, 4, 5].map((i) => ({ start: 1 + i * 1.2, end: 2 + i * 1.2, pitch: [60, 64, 67][i % 3]! }));
  const sing = (opts: { lag?: number; hold?: number; jitter?: (i: number) => number }) => {
    const flat: number[] = [];
    notes.forEach((n, i) => {
      const lag = (opts.lag ?? 0) + (opts.jitter?.(i) ?? 0);
      const end = n.start + (n.end - n.start) * (opts.hold ?? 1);
      for (let t = n.start; t < end; t += 0.01) flat.push(+(t + lag).toFixed(3), 440 * 2 ** ((n.pitch - 69) / 12), 0.95, -20);
    });
    return scorePerformance({ notes, frames: flat, keyShift: 0, latencyMs: 0 });
  };
  it('rewards holding notes for their length', () => {
    const full = sing({}), half = sing({ hold: 0.4 });
    expect(full.duration).toBeGreaterThan(0.9);
    expect(half.duration).toBeLessThan(0.6);
    expect(half.feedback.join(' ')).toMatch(/Hold your notes/);
  });
  it('rhythm rewards a steady feel even when slightly late; timing still notices the lag', () => {
    const steady = sing({ lag: 0.15 }), erratic = sing({ jitter: (i) => (i % 2 ? 0.18 : -0.12) });
    expect(steady.rhythm).toBeGreaterThan(erratic.rhythm);
    expect(steady.rhythm).toBeGreaterThan(0.8);
    expect(steady.timing).toBeLessThan(sing({}).timing);
  });
  it('reports every category in 0–1 and the overall out of 100', () => {
    const r = sing({});
    for (const k of ['pitch', 'timing', 'rhythm', 'duration', 'transitions', 'stability'] as const) expect(r[k]).toBeGreaterThanOrEqual(0), expect(r[k]).toBeLessThanOrEqual(1);
    expect(r.score).toBeGreaterThan(80);
    expect(r.details.scoringVersion).toBe('1.2.0');
  });
});
