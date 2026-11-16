/** iTunes Search API artwork matching (secondary artwork provider). */
import { similarity, stripEditionNoise } from './norm.ts';

export interface ItunesAlbum {
  collectionName: string;
  artistName: string;
  artworkUrl100?: string;
  trackCount?: number;
  releaseDate?: string;
  collectionId?: number;
}

/** Apple serves larger renditions by rewriting the size segment of the artwork URL. */
export function upscaleArtwork(url: string, size = 1200): string {
  return url.replace(/\/\d+x\d+(bb)?(-\d+)?\.(jpg|png|webp)$/i, `/${size}x${size}bb.jpg`);
}

/** Best matching album (title + artist similarity), or null if nothing is a confident match. */
export function pickAlbum(results: ItunesAlbum[], title: string, artist: string, year?: number | null): ItunesAlbum | null {
  let best: { r: ItunesAlbum; score: number } | null = null;
  const want = stripEditionNoise(title);
  for (const r of results) {
    if (!r.artworkUrl100) continue;
    const t = similarity(stripEditionNoise(r.collectionName), want);
    const a = similarity(r.artistName, artist);
    if (t < 0.75 || a < 0.6) continue;
    let score = t * 0.6 + a * 0.4;
    const ry = r.releaseDate ? Number(r.releaseDate.slice(0, 4)) : null;
    if (year && ry && Math.abs(ry - year) <= 1) score += 0.05;
    if (!best || score > best.score) best = { r, score };
  }
  return best?.r ?? null;
}
