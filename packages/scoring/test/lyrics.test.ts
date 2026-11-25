import { describe, expect, it } from 'vitest';
import { detectVibrato, lineWindows, scoreLyrics, scorePerformance, type LyricLine } from '../src';

const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 12 lines, 4 s apart, each sung for ~2.6 s as 4 notes from C major; 2 s instrumental gaps between verses
const MELODY = [[60, 62, 64, 67], [67, 65, 64, 62], [64, 65, 67, 72], [72, 71, 69, 67]];
const lines: LyricLine[] = Array.from({ length: 12 }, (_, i) => ({ start: 2 + i * 4 + (i >= 6 ? 4 : 0), text: 'la la la la la' }));

interface Opts { late?: number; skip?: (i: number) => boolean; detune?: (i: number, j: number) => number; vibrato?: number; mono?: boolean; loudness?: (i: number) => number; offKey?: boolean; seed?: number; inGaps?: boolean }
function sing(o: Opts = {}): number[] {
  const r = rng(o.seed ?? 1);
  const f: number[] = [];
  const end = (lines[lines.length - 1]!.start ?? 0) + 5;
  for (let t = 0; t < end; t += 0.01) {
    const st = t - (o.late ?? 0);
    const i = lines.findIndex((l) => l.start! <= st && st < l.start! + 2.6);
    if (i < 0 || o.skip?.(i)) {
      if (o.inGaps && i < 0) f.push(+t.toFixed(3), midiToHz(60 + Math.floor(r() * 12)), 0.9, -20);
      else f.push(+t.toFixed(3), 0, 0.1, -60);
      continue;
    }
    const j = Math.min(3, Math.floor((st - lines[i]!.start!) / 0.65));
    let midi = o.mono ? 64 : MELODY[i % 4]![j]!;
    if (o.offKey && j % 2) midi += 1;
    midi += (o.detune?.(i, j) ?? 0) / 100;
    if (o.vibrato && st - lines[i]!.start! - j * 0.65 > 0.15) midi += (o.vibrato / 100) * Math.sin(2 * Math.PI * 6 * st);
    f.push(+t.toFixed(3), midiToHz(midi), 0.95, (o.loudness?.(i) ?? -20) + (r() - 0.5));
  }
  return f;
}

describe('lyrics score (no reference melody)', () => {
  const good = scoreLyrics({ lines, frames: sing() });

  it('a clean, in-key, on-time performance scores well', () => {
    expect(good.score).toBeGreaterThanOrEqual(85);
    expect(good.pitch).toBeGreaterThan(0.9);
    expect(good.timing).toBeGreaterThan(0.85);
    expect(good.details.mode).toBe('lyrics');
    expect(good.feedback.at(-1)).toMatch(/lyrics/);
  });

  it('a singer whose whole voice sits 30 cents off concert pitch is not penalised (own tuning)', () => {
    const r = scoreLyrics({ lines, frames: sing({ detune: () => 30 }) });
    expect(r.pitch).toBeGreaterThan(good.pitch - 0.03);
  });

  it('notes between the semitones cost intonation', () => {
    const r = scoreLyrics({ lines, frames: sing({ detune: (i, j) => (j % 2 ? 45 : 0) }) });
    expect(r.pitch).toBeLessThan(good.pitch - 0.15);
  });

  it('out-of-key notes cost pitch', () => {
    const r = scoreLyrics({ lines, frames: sing({ offKey: true }) });
    expect(r.pitch).toBeLessThan(good.pitch - 0.1);
  });

  it('droning one note is not singing the song', () => {
    const r = scoreLyrics({ lines, frames: sing({ mono: true }) });
    expect(r.pitch).toBeLessThan(0.5);
  });

  it('skipping half the lines halves coverage and calls it out', () => {
    const r = scoreLyrics({ lines, frames: sing({ skip: (i) => i % 2 === 1 }) });
    expect(r.details.coverage).toBeLessThan(0.6);
    expect(r.score).toBeLessThan(good.score - 15);
    expect(r.feedback[0]).toMatch(/unsung/);
  });

  it('a small lyrics-timing error (0.4 s) is aligned away', () => {
    const r = scoreLyrics({ lines, frames: sing({ late: 0.4 }) });
    expect(r.details.latencyOffsetMs).toBe(400);
    expect(r.score).toBeGreaterThanOrEqual(good.score - 2);
  });

  it('singing through the instrumental breaks costs timing', () => {
    const r = scoreLyrics({ lines, frames: sing({ inGaps: true }) });
    expect(r.timing).toBeLessThan(good.timing - 0.05);
  });

  it('vibrato and dynamics earn bonus points', () => {
    const r = scoreLyrics({ lines, frames: sing({ vibrato: 40, loudness: (i) => (i % 4 === 3 ? -12 : -24) }) });
    expect(r.expression).toBeGreaterThan(0.6);
    expect(r.bonus).toBeGreaterThan(2);
    expect(r.bonus).toBeGreaterThan(good.bonus + 2);
    expect(r.score).toBeGreaterThanOrEqual(good.score);
  });

  it('silence scores zero', () => {
    const r = scoreLyrics({ lines, frames: sing({ skip: () => true }) });
    expect(r.score).toBe(0);
  });

  it('line windows end at the words, the next line, or a per-word estimate', () => {
    const w = lineWindows([{ start: 1, text: 'a b' }, { start: 10, text: 'c', words: [{ start: 10, end: 10.6, text: 'c' }] }, { start: 11, text: 'd' }]);
    expect(w[0]).toEqual({ start: 1, end: 3, words: 2 });
    expect(w[1]!.end).toBeCloseTo(10.6);
    expect(w[2]!.end).toBeCloseTo(12.5);
  });
});

describe('vibrato detection and the expression bonus (v1.2)', () => {
  const cents = (depth: number, hz: number, n = 120, noise = 0, seed = 2) => {
    const r = rng(seed);
    return Array.from({ length: n }, (_, i) => 6400 + depth * Math.sin(2 * Math.PI * hz * i * 0.01) + (r() - 0.5) * noise);
  };
  it('finds a real vibrato and rejects wobble or a straight tone', () => {
    expect(detectVibrato(cents(50, 6))).toBeGreaterThan(40);
    expect(detectVibrato(cents(0, 6))).toBeNull();
    expect(detectVibrato(cents(0, 6, 120, 120, 5))).toBeNull();
    expect(detectVibrato(cents(50, 2))).toBeNull();        // slow drift isn't vibrato
  });
  it('melody score: vibrato on long notes adds bonus points, never more than 5', () => {
    const notes = [0, 1, 2, 3, 4, 5].map((i) => ({ start: 1 + i * 1.5, end: 2.2 + i * 1.5, pitch: [60, 64, 67][i % 3]! }));
    const run = (vib: number, loud: (i: number) => number) => {
      const flat: number[] = [];
      notes.forEach((n, i) => { for (let t = n.start; t < n.end; t += 0.01) flat.push(+t.toFixed(3), midiToHz(n.pitch + (vib / 100) * Math.sin(2 * Math.PI * 6 * t)), 0.95, loud(i)); });
      return scorePerformance({ notes, frames: flat, latencyMs: 0, phrases: notes.map((n, k) => ({ start: n.start, end: n.end, noteIdx: [k] })) });
    };
    const plain = run(0, () => -20), expressive = run(40, (i) => (i % 2 ? -12 : -24));
    expect(plain.bonus).toBeLessThan(0.5);
    expect(expressive.bonus).toBeGreaterThan(3);
    expect(expressive.bonus).toBeLessThanOrEqual(5);
    expect(expressive.details.vibratoNotes).toBeGreaterThanOrEqual(4);
    expect(expressive.score).toBeGreaterThanOrEqual(plain.score);
  });
});
