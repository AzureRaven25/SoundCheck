/** Internet Archive (Creative Commons / public-domain audio): pure helpers, unit-tested. */

export interface IaFile { name: string; format?: string; length?: string; title?: string; track?: string; creator?: string }
export interface OpenTrack { file: string; title: string; trackNo: number | null; durationMs: number | null; streamUrl: string }

const AUDIO_PREFERENCE = ['VBR MP3', 'MP3', '128Kbps MP3', '64Kbps MP3', 'Ogg Vorbis'];

/** IA lengths are seconds ("509.22") or "m:ss" / "h:mm:ss". */
export function parseLength(v: string | undefined): number | null {
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000) || null;
  const parts = v.split(':').map(Number);
  if (parts.some((n) => !isFinite(n))) return null;
  return Math.round(parts.reduce((s, n) => s * 60 + n, 0) * 1000) || null;
}

/** "01 Riding Alone For Thousands Of Miles - lullaby" → "Lullaby" (drop leading number and artist prefix). */
export function cleanTitle(raw: string, creator: string): string {
  let t = raw.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/^\s*\d{1,3}[\s.\-_)]+/, '').trim();
  const prefix = `${creator} - `;
  if (creator && t.toLowerCase().startsWith(prefix.toLowerCase())) t = t.slice(prefix.length);
  t = t.replace(/_/g, ' ').trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : raw;
}

/** One playable file per song: the best audio format for each base name, in track order. */
export function pickTracks(identifier: string, files: IaFile[], creator: string): OpenTrack[] {
  const byBase = new Map<string, IaFile>();
  for (const f of files) {
    const rank = AUDIO_PREFERENCE.indexOf(f.format ?? '');
    if (rank < 0) continue;
    const base = f.name.replace(/\.[^.]+$/, '').replace(/_vbr$|_64kb$|_128kb$/, '');
    const cur = byBase.get(base);
    if (!cur || AUDIO_PREFERENCE.indexOf(cur.format ?? '') > rank) byBase.set(base, f);
  }
  const out = [...byBase.values()].map((f) => {
    const tn = Number.parseInt((f.track ?? '').split('/')[0] ?? '', 10);
    return {
      file: f.name,
      title: cleanTitle(f.title ?? f.name, creator),
      trackNo: Number.isFinite(tn) ? tn : null,
      durationMs: parseLength(f.length),
      streamUrl: `https://archive.org/download/${encodeURIComponent(identifier)}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
    };
  });
  return out.sort((a, b) => (a.trackNo ?? 1e9) - (b.trackNo ?? 1e9) || a.file.localeCompare(b.file));
}

/** Deterministic UUID (v5-style, SHA-1) so re-importing an album never duplicates catalog rows. */
export async function stableUuid(name: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`soundcheck:open:${name}`))).slice(0, 16);
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export function licenseAllowsKaraoke(licenseUrl: string | null | undefined): boolean {
  if (!licenseUrl) return false;
  const u = licenseUrl.toLowerCase();
  if (u.includes('publicdomain') || u.includes('/zero/')) return true;
  return u.includes('creativecommons.org/licenses/') && !u.includes('-nd');
}

/** Album art: a file named like a cover beats the archive's default item image (often a scan or a tracklist). */
export function pickCover(identifier: string, files: IaFile[]): string {
  const images = files.filter((f) => /^(JPEG|PNG|JPEG Thumb)$/.test(f.format ?? '') && !/thumb|back|tracklist|_itemimage/i.test(f.name) && f.format !== 'JPEG Thumb');
  const pick = images.find((f) => /front|cover|folder|artwork/i.test(f.name)) ?? images[0];
  return pick ? `https://archive.org/download/${encodeURIComponent(identifier)}/${pick.name.split('/').map(encodeURIComponent).join('/')}`
              : `https://archive.org/services/img/${encodeURIComponent(identifier)}`;
}
