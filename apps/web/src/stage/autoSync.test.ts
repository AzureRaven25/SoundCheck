import { describe, expect, it } from 'vitest';
import { agree, bestShift, confident, features, type Frame } from './autoSync';

const SR = 22050;
const FFT = 4096;

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
      const wr = Math.cos(a * k), wi = Math.sin(a * k);
      const xr = re[i + k + len / 2]! * wr - im[i + k + len / 2]! * wi, xi = re[i + k + len / 2]! * wi + im[i + k + len / 2]! * wr;
      re[i + k + len / 2] = re[i + k]! - xr; im[i + k + len / 2] = im[i + k]! - xi;
      re[i + k] = re[i + k]! + xr; im[i + k] = im[i + k]! + xi;
    }
  }
}

/** Deterministic pseudo-random numbers. */
function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

const CHORDS = [[60, 64, 67], [57, 60, 64], [65, 69, 72], [67, 71, 74], [62, 65, 69], [64, 67, 71]];
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/**
 * A song: a chord every beat-pair from a fixed random progression, with drum-like clicks on each beat.
 * `vocal` adds a melody (the original has one, karaoke doesn't); `timbre` changes harmonics (a re-recording).
 */
function song(seconds: number, { vocal, timbre, noise, loop = 0 }: { vocal: boolean; timbre: number; noise: number; loop?: number }) {
  const r = rng(7), n = rng(99 + timbre);
  const beat = 0.5;
  let prog = Array.from({ length: Math.ceil(seconds / (2 * beat)) + 1 }, () => CHORDS[Math.floor(r() * CHORDS.length)]!);
  let mel = Array.from({ length: Math.ceil(seconds / beat) + 1 }, () => 72 + Math.floor(r() * 8));
  // `loop`: the same `loop` chords over and over (a song whose bars all sound alike)
  if (loop) { prog = prog.map((_, i) => prog[i % loop]!); mel = mel.map((_, i) => mel[i % (2 * loop)]!); }
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const chord = prog[Math.floor(t / (2 * beat))]!;
    let s = 0;
    for (const m of chord) for (let h = 1; h <= 1 + timbre; h++) s += Math.sin(2 * Math.PI * hz(m) * h * t) / h;
    const bt = t % beat;
    s += bt < 0.03 ? (n() * 2 - 1) * 3 * (1 - bt / 0.03) : 0;
    if (vocal) s += 0.7 * Math.sin(2 * Math.PI * hz(mel[Math.floor(t / beat)]!) * t);
    out[i] = s * 0.1 + (n() * 2 - 1) * noise;
  }
  return out;
}

/** Frames of `audio` heard from `from` to `to` seconds, stamped with `stamp(t)` (its video time). */
function hear(audio: Float32Array, from: number, to: number, stamp: (t: number) => number): Frame[] {
  const frames: Frame[] = [];
  const room = rng(5);
  let prev: Float32Array | null = null;
  for (let t = from; t < to; t += 0.04) {
    const start = Math.round(t * SR) - FFT;
    const re = new Float64Array(FFT), im = new Float64Array(FFT);
    for (let i = 0; i < FFT; i++) re[i] = ((audio[start + i] ?? 0) + (room() * 2 - 1) * 0.003) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT));
    fft(re, im);
    const db = new Float32Array(FFT / 2);
    for (let k = 0; k < FFT / 2; k++) db[k] = 20 * Math.log10(Math.hypot(re[k]!, im[k]!) / FFT + 1e-9);
    const f = features(db, SR, FFT, prev);
    prev = f.mag;
    frames.push({ t: stamp(t), v: f.v });
  }
  return frames;
}

describe('auto sync', () => {
  const original = song(40, { vocal: true, timbre: 2, noise: 0.01 });
  const karaoke = song(40, { vocal: false, timbre: 0, noise: 0.02 });

  /** What the Stage does: 6 s of the original at lyrics time `at`, then 14 s of karaoke around the guess. */
  function measure(kOff: number, gOff: number, at: number, guess: number) {
    const ref = hear(original, at, at + 6, (u) => u + gOff);              // song time u -> original video time
    const kFrom = at + guess - 4;                                          // karaoke video time
    const cand = hear(karaoke, kFrom - kOff, kFrom - kOff + 14, (u) => u + kOff);
    const center = guess - gOff;
    const m = bestShift(ref, cand, center - 4, center + 4);
    return { m, offset: m ? gOff + m.shift : null };
  }

  it('finds how far a re-recorded karaoke track (no vocal, different sound) is shifted from the original', () => {
    const { m, offset } = measure(2.3, 0.8, 15, 0.5);   // karaoke has a 2.3 s title card; our guess said 0.5
    expect(confident(m)).toBe(true);
    expect(offset).toBeCloseTo(2.3, 1);
  });

  it('works when the karaoke video runs ahead of the original', () => {
    const { m, offset } = measure(-1.7, 1.0, 12, 0);

    expect(confident(m)).toBe(true);
    expect(offset).toBeCloseTo(-1.7, 1);
  });

  it('copes with a noisy room and a re-recording that is 1% slower', () => {
    const slow = song(42, { vocal: false, timbre: 1, noise: 0.08 });
    const kOff = 3.1, gOff = 0, at = 18, guess = 1.0;
    const ref = hear(original, at, at + 6, (u) => u + gOff);
    const kFrom = at + guess - 4;
    // the slow version's song time u plays at video time u * 1.01 + kOff
    const cand = hear(slow, (kFrom - kOff) / 1.01, (kFrom - kOff + 14) / 1.01, (u) => u * 1.01 + kOff);
    const m = bestShift(ref, cand, guess - gOff - 4, guess - gOff + 4);
    expect(confident(m)).toBe(true);
    expect(gOff + m!.shift).toBeGreaterThan(kOff + at * 0.01 - 0.25);   // the drift up to here is part of the answer
    expect(gOff + m!.shift).toBeLessThan(kOff + (at + 6) * 0.01 + 0.25);
  });

  it('the song’s opening pins down a song whose bars all sound alike (where the middle can be a bar off)', () => {
    const orig = song(30, { vocal: true, timbre: 2, noise: 0.01, loop: 2 });   // repeats every 2 s
    const kar = song(30, { vocal: false, timbre: 0, noise: 0.02, loop: 2 });
    const kOff = 3.0, guess = 5.0;   // a 3 s title card; the guess is one loop off
    const silence = new Float32Array(SR * 12);
    // as the Stage does at the opening: 1.5 s of the quiet room, then 8 s of the original from its start
    const ref = [...hear(silence, 1, 2.5, (u) => u - 2.5), ...hear(orig, 0, 8, (u) => u)];
    const kFrom = guess - 1.5 - 4;   // -0.5: half a second of room before the karaoke video starts
    const cand = [...hear(silence, 1, 1.5, (u) => u - 1.5), ...hear(kar, -kOff, 17 - kOff, (u) => u + kOff)];
    expect(kFrom).toBeLessThan(0);
    const m = bestShift(ref, cand, guess - 4, guess + 4);
    expect(confident(m)).toBe(true);
    expect(m!.shift).toBeCloseTo(kOff, 1);
  });

  it('refuses to guess when it only hears a quiet room (headphones)', () => {
    const room = new Float32Array(40 * SR).map(() => (Math.random() * 2 - 1) * 0.001);
    const ref = hear(original, 10, 16, (t) => t);
    const cand = hear(room, 6, 20, (t) => t);
    expect(confident(bestShift(ref, cand, -4, 4))).toBe(false);
  });

  it('accepts two near misses only when they agree on the shift', () => {
    const m = (shift: number, score = 0.2, margin = 0.05) => ({ shift, score, margin });
    expect(confident(m(2.5))).toBe(false);
    expect(agree(m(2.5), m(2.45))).toBe(true);
    expect(agree(m(2.5), m(1.9))).toBe(false);
    expect(agree(m(2.5), m(2.5, 0.1))).toBe(false);
  });
});
