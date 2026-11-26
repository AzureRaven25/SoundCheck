import { describe, expect, it } from 'vitest';
import { subtract, vocalShare } from './separate';
import { fromInt16, toInt16 } from './store';

describe('karaoke made on this device', () => {
  it('backing = original − vocal, sample for sample (so it keeps the recording’s quality)', () => {
    const n = 1000;
    const band = Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin(i / 7));
    const voice = Float32Array.from({ length: n }, (_, i) => 0.2 * Math.sin(i / 3));
    const mix = { left: band.map((x, i) => x + voice[i]!), right: band.map((x, i) => x + voice[i]!) };
    const back = subtract(mix, { left: voice, right: voice });
    for (let i = 0; i < n; i += 97) expect(back.left[i]).toBeCloseTo(band[i]!, 6);
  });

  it('stores audio as 16-bit and reads it back within one step, clipping at full scale', () => {
    const x = Float32Array.from([0, 0.5, -0.5, 1, -1, 1.7, -3, 0.123456]);
    const y = fromInt16(toInt16(x));
    const expected = [0, 0.5, -0.5, 1, -1, 1, -1, 0.123456];
    expected.forEach((v, i) => expect(Math.abs(y[i]! - v)).toBeLessThan(1 / 32767 + 1e-9));
  });

  it('measures how much of a recording is the singer (an instrumental is close to none)', () => {
    const band = Float32Array.from({ length: 4000 }, (_, i) => 0.3 * Math.sin(i / 7));
    const quiet = Float32Array.from({ length: 4000 }, (_, i) => 0.001 * Math.sin(i / 3));
    const loud = Float32Array.from({ length: 4000 }, (_, i) => 0.2 * Math.sin(i / 3));
    expect(vocalShare({ left: band, right: band }, { left: quiet, right: quiet })).toBeLessThan(0.01);
    expect(vocalShare({ left: band, right: band }, { left: loud, right: loud })).toBeGreaterThan(0.1);
  });
});
