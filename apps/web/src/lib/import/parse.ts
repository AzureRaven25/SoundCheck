/**
 * Pure helpers for importing a music collection (no browser APIs; unit-tested in parse.test.ts):
 * file classification, filename fallbacks, playlists (M3U/M3U8/PLS) and CD-rip logs (Exact Audio Copy, whipper).
 */

export const AUDIO_EXT: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', mp4: 'audio/mp4', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg',
  opus: 'audio/ogg', wav: 'audio/wav', aif: 'audio/aiff', aiff: 'audio/aiff', alac: 'audio/mp4',
};
/** formats the audio bucket accepts and browsers can play (WMA isn't either) */
export type FileKind = 'audio' | 'zip' | 'playlist' | 'riplog' | 'cue' | 'other';

export function extOf(name: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name);
  return m ? m[1]!.toLowerCase() : '';
}

export function classify(name: string): FileKind {
  const base = name.split('/').pop() ?? name;
  if (base.startsWith('._') || base === '.DS_Store') return 'other'; // macOS resource forks inside zips
  const e = extOf(base);
  if (e in AUDIO_EXT) return 'audio';
  if (e === 'zip') return 'zip';
  if (e === 'm3u' || e === 'm3u8' || e === 'pls') return 'playlist';
  if (e === 'log') return 'riplog';
  if (e === 'cue') return 'cue';
  return 'other';
}

export function mimeFor(name: string, given?: string): string {
  if (given && given.startsWith('audio/')) return given;
  return AUDIO_EXT[extOf(name)] ?? 'application/octet-stream';
}

export interface GuessedTags { title: string; artist: string | null; album: string | null; trackNo: number | null }

/**
 * Tags from a path when the file has none: ".../Artist/Album/03 - Title.mp3", "03. Artist - Title.flac",
 * "Artist - Title.mp3" (Bandcamp zips use "Artist - Album - 03 Title.flac").
 */
export function guessFromPath(path: string): GuessedTags {
  const parts = path.split('/').filter(Boolean);
  const file = (parts.pop() ?? path).replace(/\.[a-z0-9]{1,5}$/i, '').replace(/_/g, ' ').trim();
  const album = parts.length >= 1 ? parts[parts.length - 1]! : null;
  const dirArtist = parts.length >= 2 ? parts[parts.length - 2]! : null;
  // Bandcamp: "Artist - Album - 03 Title"
  const bc = /^(.+?) - (.+?) - (\d{1,3})\s+(.+)$/.exec(file);
  if (bc) return { artist: bc[1]!.trim(), album: bc[2]!.trim(), trackNo: Number(bc[3]), title: bc[4]!.trim() };
  let rest = file;
  let trackNo: number | null = null;
  const num = /^(\d{1,3})(?:[\s.\-_)]+)(.+)$/.exec(rest);
  if (num) { trackNo = Number(num[1]); rest = num[2]!.trim(); }
  const dash = /^(.+?)\s+[-–]\s+(.+)$/.exec(rest);
  if (dash) return { artist: dash[1]!.trim(), title: dash[2]!.trim(), album, trackNo };
  return { title: rest || file, artist: dirArtist, album, trackNo };
}

export interface PlaylistFile { name: string; entries: { path: string; title: string | null }[] }

/** M3U / M3U8 (with #EXTINF titles) and PLS. Paths are normalized to forward slashes, relative to the playlist. */
export function parsePlaylist(name: string, text: string): PlaylistFile {
  const title = (name.split('/').pop() ?? name).replace(/\.(m3u8?|pls)$/i, '');
  const entries: { path: string; title: string | null }[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim());
  if (/\.pls$/i.test(name)) {
    const files = new Map<number, string>(), titles = new Map<number, string>();
    for (const l of lines) {
      const f = /^File(\d+)=(.+)$/i.exec(l); if (f) files.set(Number(f[1]), f[2]!);
      const t = /^Title(\d+)=(.+)$/i.exec(l); if (t) titles.set(Number(t[1]), t[2]!);
    }
    for (const n of [...files.keys()].sort((a, b) => a - b)) entries.push({ path: norm(files.get(n)!), title: titles.get(n) ?? null });
    return { name: title, entries };
  }
  let pendingTitle: string | null = null;
  for (const l of lines) {
    if (!l) continue;
    const inf = /^#EXTINF:[^,]*,(.*)$/i.exec(l);
    if (inf) { pendingTitle = inf[1]!.trim() || null; continue; }
    if (l.startsWith('#')) continue;
    entries.push({ path: norm(l), title: pendingTitle });
    pendingTitle = null;
  }
  return { name: title, entries };
}
function norm(p: string): string {
  return decodeURIComponentSafe(p.replace(/^file:\/\//i, '')).replace(/\\/g, '/');
}
function decodeURIComponentSafe(s: string): string {
  try { return /%[0-9a-f]{2}/i.test(s) ? decodeURIComponent(s) : s; } catch { return s; }
}

/** Match a playlist entry to an imported file: exact relative path, else same file name. */
export function resolveEntry(entryPath: string, playlistDir: string, files: string[]): string | null {
  const joined = (playlistDir ? `${playlistDir}/` : '') + entryPath.replace(/^\.\//, '');
  const exact = files.find((f) => f === joined || f.endsWith(`/${entryPath}`) || f === entryPath);
  if (exact) return exact;
  const base = entryPath.split('/').pop()!.toLowerCase();
  return files.find((f) => f.split('/').pop()!.toLowerCase() === base) ?? null;
}

export interface RipLog { ripper: 'eac' | 'whipper' | 'xld' | 'unknown'; tracks: Map<number, { accurate: boolean; confidence: number | null }> }

/** AccurateRip results per track from an Exact Audio Copy, XLD or whipper log. */
export function parseRipLog(text: string): RipLog | null {
  const ripper = /Exact Audio Copy/i.test(text) ? 'eac' : /whipper|morituri/i.test(text) ? 'whipper' : /X Lossless Decoder/i.test(text) ? 'xld' : 'unknown';
  if (ripper === 'unknown') return null;
  const tracks = new Map<number, { accurate: boolean; confidence: number | null }>();
  if (ripper === 'whipper') {
    // YAML: "  1:\n    ...\n    AccurateRip v2:\n      Result: Found, exact match\n      Remote confidence: 12"
    const re = /^\s{2}(\d{1,3}):\s*$([\s\S]*?)(?=^\s{2}\d{1,3}:\s*$|^\S|(?![\s\S]))/gm;
    for (const m of text.matchAll(re)) {
      const block = m[2]!;
      const ok = /Result:\s*Found, exact match/i.test(block);
      const conf = /Remote confidence:\s*(\d+)/i.exec(block);
      tracks.set(Number(m[1]), { accurate: ok, confidence: conf ? Number(conf[1]) : null });
    }
  } else {
    // EAC: "Track  3 ... Accurately ripped (confidence 5)  [1A2B3C4D]" ; XLD: "Track 03 ... ->Accurately ripped (v2, confidence 12/40)"
    const re = /^Track\s+(\d{1,3})\s*$([\s\S]*?)(?=^Track\s+\d{1,3}\s*$|(?![\s\S]))/gim;
    for (const m of text.matchAll(re)) {
      const block = m[2]!;
      const acc = /Accurately ripped[^\n]*?confidence\s+(\d+)/i.exec(block);
      tracks.set(Number(m[1]), { accurate: !!acc, confidence: acc ? Number(acc[1]) : null });
    }
  }
  return { ripper, tracks };
}

/** "CD rip · AccurateRip verified" style provenance label for a file. */
export function provenanceLabel(base: string, rip: { accurate: boolean; confidence: number | null } | null | undefined): string {
  if (!rip) return base;
  return rip.accurate ? `${base} · AccurateRip verified${rip.confidence ? ` (confidence ${rip.confidence})` : ''}` : `${base} · not AccurateRip verified`;
}
