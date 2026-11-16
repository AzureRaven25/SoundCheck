/** Client for services/api. Set EXPO_PUBLIC_API_URL to your Mac's LAN address when running on a TV. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');

export type Song = {
  id: number;
  title: string;
  artist: string;
  year: number | null;
  length_ms: number | null;
  cover_url: string | null;
  bundle_id: string | null;
};

export type LibraryItem = {
  bundle_id: string;
  song_id: number | null;
  title: string;
  artist: string | null;
  duration_s: number | null;
  has_lyrics: boolean;
  year: number | null;
  cover_url: string | null;
  key: string | null;
  tempo_bpm: number | null;
  vocal_range: { low: number; high: number; min: number; max: number } | null;
};

export type LyricLine = { start: number; end: number; text: string };
export type Lyrics = { source: string; lines: LyricLine[] };
export type Note = { start: number; end: number; pitch: number };
export type Melody = { hop: number; contour: (number | null)[]; notes: Note[] };
export type Stem = 'original' | 'instrumental' | 'vocals';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json() as Promise<T>;
}

export const api = {
  library: () => get<LibraryItem[]>('/api/library'),
  libraryItem: (bundleId: string) => get<LibraryItem>(`/api/library/${encodeURIComponent(bundleId)}`),
  lyrics: (bundleId: string) => get<Lyrics>(`/api/library/${encodeURIComponent(bundleId)}/lyrics`),
  melody: (bundleId: string) => get<Melody>(`/api/library/${encodeURIComponent(bundleId)}/melody`),
  audioUrl: (bundleId: string, stem: Stem) => `${API_URL}/api/library/${encodeURIComponent(bundleId)}/audio/${stem}`,
  search: (q: string, limit = 30) => get<Song[]>(`/api/songs/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  popular: (limit = 30) => get<Song[]>(`/api/songs/popular?limit=${limit}`),
  wishlist: () => get<Song[]>('/api/wishlist'),
  setWishlisted: async (songId: number, on: boolean) => {
    const res = await fetch(`${API_URL}/api/wishlist/${songId}`, { method: on ? 'PUT' : 'DELETE' });
    if (!res.ok) throw new Error(`${res.status} wishlist`);
  },
};

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds)) return '';
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export function midiName(m: number): string {
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

/** Transpose a key name like "Eb major" by n semitones. */
export function transposeKey(key: string | null, n: number): string | null {
  if (!key) return null;
  const [tonic, mode] = key.split(' ');
  const i = NOTE_NAMES.indexOf(tonic);
  if (i < 0) return key;
  return `${NOTE_NAMES[(((i + n) % 12) + 12) % 12]} ${mode ?? ''}`.trim();
}
