/** iTunes song search → 30 s preview matching (pure, unit-tested). */
import { similarity, stripEditionNoise } from './norm.ts';

export interface ItunesSong {
  trackName: string;
  artistName: string;
  previewUrl?: string;
  trackViewUrl?: string;
  trackTimeMillis?: number;
  kind?: string;
}

/**
 * Best preview for a song: title and artist must match closely, and when both durations are known
 * they must be within 15 s (so a 2-minute radio edit or a 9-minute live take isn't chosen).
 */
export function pickPreview(results: ItunesSong[], title: string, artist: string, durationMs: number | null): ItunesSong | null {
  let best: { r: ItunesSong; score: number } | null = null;
  const want = stripEditionNoise(title);
  for (const r of results) {
    if (!r.previewUrl || !r.trackViewUrl || (r.kind && r.kind !== 'song')) continue;
    const t = similarity(stripEditionNoise(r.trackName), want);
    const a = similarity(r.artistName, artist);
    if (t < 0.8 || a < 0.6) continue;
    let score = t * 0.6 + a * 0.4;
    if (durationMs && r.trackTimeMillis) {
      const diff = Math.abs(r.trackTimeMillis - durationMs) / 1000;
      if (diff > 15) continue;
      score += 0.1 * (1 - diff / 15);
    }
    if (!best || score > best.score) best = { r, score };
  }
  return best?.r ?? null;
}
