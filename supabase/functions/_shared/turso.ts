/**
 * Turso long-tail tier: FTS5 search over songs beyond the Supabase subset (see services/catalog
 * turso_export.py for the schema). Hits are converted to catalog rows and promoted into Supabase.
 */
import type { CatalogRows } from './musicbrainz.ts';

export interface TursoSong {
  rank: number; id: string; title: string; artist_credit: string;
  album_id: string | null; album_title: string | null; album_type: string | null;
  release_year: number | null; duration_ms: number | null; popularity: number;
  credits: { position: number; artist_id: string; name: string; sort_name: string | null; join_phrase: string }[];
  isrcs: string[]; recordings: string[];
}

/** Same rules as turso_export.match_query: quoted words (no FTS syntax injection), last word as prefix. */
export function matchQuery(q: string): string {
  // apostrophes removed (the index strips them too) so "dont" / "don't" / "don’t" all match
  const words = q.toLowerCase().replace(/['‘’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(Boolean).slice(0, 8);
  if (!words.length) return '';
  const parts = words.map((w) => `"${w}"`);
  if (words[words.length - 1]!.length >= 2) parts[parts.length - 1] += '*';
  return parts.join(' ');
}

const SEARCH_SQL =
  'select s.rank, s.id, s.title, s.artist_credit, s.album_id, s.album_title, s.album_type, s.release_year, s.duration_ms, ' +
  's.popularity, s.credits, s.isrcs, s.recordings from songs_fts f join songs s on s.rank = f.rowid ' +
  'where songs_fts match ? order by s.rank limit ?';

type HranaValue = { type: string; value?: string | number };

export function tursoConfigured(): boolean {
  return !!(Deno.env.get('TURSO_DATABASE_URL') && Deno.env.get('TURSO_AUTH_TOKEN'));
}

export async function searchTurso(q: string, limit = 10, fetchImpl: typeof fetch = fetch): Promise<TursoSong[]> {
  const mq = matchQuery(q);
  if (!mq || !tursoConfigured()) return [];
  const base = Deno.env.get('TURSO_DATABASE_URL')!.replace('libsql://', 'https://').replace(/\/$/, '');
  const res = await fetchImpl(`${base}/v2/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('TURSO_AUTH_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        { type: 'execute', stmt: { sql: SEARCH_SQL, args: [{ type: 'text', value: mq }, { type: 'integer', value: String(limit) }] } },
        { type: 'close' },
      ],
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`turso ${res.status}`);
  const body = await res.json();
  const result = body.results?.[0];
  if (result?.type !== 'ok') throw new Error(`turso: ${JSON.stringify(result?.error ?? result)}`);
  const v = (c: HranaValue) => (c.type === 'null' ? null : c.value);
  return (result.response.result.rows as HranaValue[][]).map((row) => {
    const [rank, id, title, artist, albumId, albumTitle, albumType, year, duration, popularity, credits, isrcs, recordings] = row.map(v);
    return {
      rank: Number(rank), id: String(id), title: String(title), artist_credit: String(artist),
      album_id: albumId == null ? null : String(albumId), album_title: albumTitle == null ? null : String(albumTitle),
      album_type: albumType == null ? null : String(albumType),
      release_year: year == null ? null : Number(year), duration_ms: duration == null ? null : Number(duration),
      popularity: Number(popularity), credits: JSON.parse(String(credits ?? '[]')),
      isrcs: JSON.parse(String(isrcs ?? '[]')), recordings: JSON.parse(String(recordings ?? '[]')),
    };
  });
}

const ALBUM_TYPES = new Set(['album', 'single', 'ep']);

/** Convert Turso hits into Supabase catalog rows (same id scheme as the bulk sync). */
export function songsToRows(songs: TursoSong[], maxRecordings = 5): CatalogRows {
  const out: CatalogRows = { artists: [], albums: [], tracks: [], track_artists: [], track_recordings: [] };
  const artists = new Set<string>();
  const albums = new Set<string>();
  for (const s of songs) {
    for (const c of s.credits) {
      if (!artists.has(c.artist_id)) {
        artists.add(c.artist_id);
        out.artists.push({ id: c.artist_id, mbid: c.artist_id, name: c.name, sort_name: c.sort_name, disambiguation: null });
      }
      out.track_artists.push({ track_id: s.id, position: c.position, artist_id: c.artist_id, join_phrase: c.join_phrase ?? '' });
    }
    if (s.album_id && !albums.has(s.album_id)) {
      albums.add(s.album_id);
      out.albums.push({
        id: s.album_id, mbid: s.album_id, title: s.album_title ?? s.title, artist_credit: s.artist_credit,
        primary_type: ALBUM_TYPES.has(s.album_type ?? '') ? s.album_type! : 'other', release_year: s.release_year,
      });
    }
    out.tracks.push({
      id: s.id, mbid: s.id, title: s.title, artist_credit: s.artist_credit, album_id: s.album_id,
      duration_ms: s.duration_ms, release_year: s.release_year, isrcs: s.isrcs.slice(0, 20), popularity: s.popularity,
    });
    const recs = [s.id, ...s.recordings.filter((r) => r !== s.id)].slice(0, maxRecordings);
    for (const r of recs) out.track_recordings.push({ recording_mbid: r, track_id: s.id });
  }
  return out;
}
