/**
 * Song lists from other apps (pure; unit-tested): pasted "Artist - Title" / "Title by Artist" lines, or CSV
 * exports (Exportify, TuneMyMusic, Apple Music exports) with title/artist columns.
 */
export interface WantedSong { title: string; artist: string | null }

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t' || c === ';') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const TITLE_COLS = ['track name', 'title', 'name', 'song', 'track', 'song name'];
const ARTIST_COLS = ['artist name(s)', 'artist name', 'artist', 'artists', 'artist(s)'];

export function parseSongList(text: string): WantedSong[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const ti = header.findIndex((h) => TITLE_COLS.includes(h));
  const ai = header.findIndex((h) => ARTIST_COLS.includes(h));
  if (ti >= 0 && header.length > 1) {
    return lines.slice(1).map(splitCsvLine).map((c) => ({
      title: c[ti] ?? '', artist: ai >= 0 ? (c[ai] ?? '').split(/,|;| & /)[0]!.trim() || null : null,
    })).filter((s) => s.title);
  }
  return lines.map((l) => l.replace(/^\d+[.)]\s+/, '')).map((l) => {
    const by = /^(.+)\s+by\s+(.+)$/i.exec(l); // last " by " (titles like "Stand by Me")
    if (by) return { title: by[1]!.trim(), artist: by[2]!.trim() };
    const dash = /^(.+?)\s+[-–—]\s+(.+)$/.exec(l);
    if (dash) return { artist: dash[1]!.trim(), title: dash[2]!.trim() };
    return { title: l, artist: null };
  }).filter((s) => s.title);
}
