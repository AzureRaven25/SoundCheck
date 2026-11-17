import type { TrackItem } from './types';

/** PostgREST embed used everywhere a track list is rendered. */
export const TRACK_SELECT =
  'id, title, artist_credit, album_id, duration_ms, release_year, popularity, albums(title), track_artists(position, join_phrase, artists(id, name))';

export type Row = {
  id: string; title: string; artist_credit: string; album_id: string | null; duration_ms: number | null;
  release_year: number | null; albums: { title: string } | null;
  track_artists: { position: number; join_phrase: string; artists: { id: string; name: string } | null }[];
};

export function toTrackItem(r: Row, artwork?: Map<string, string>): TrackItem {
  return {
    id: r.id, title: r.title, artist_credit: r.artist_credit, album_id: r.album_id, album_title: r.albums?.title ?? null,
    duration_ms: r.duration_ms, release_year: r.release_year,
    artwork_url: r.album_id ? artwork?.get(r.album_id) ?? null : null,
    artists: [...(r.track_artists ?? [])]
      .sort((a, b) => a.position - b.position)
      .filter((a) => a.artists)
      .map((a) => ({ id: a.artists!.id, name: a.artists!.name, join_phrase: a.join_phrase })),
  };
}

/** Client-side equivalent of catalog.withArtwork (browser Supabase client). */
export async function withArtworkClient(
  sb: { from: (t: 'artwork') => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  rows: Row[],
): Promise<TrackItem[]> {
  const ids = [...new Set(rows.map((r) => r.album_id).filter((x): x is string => !!x))];
  const art = new Map<string, string>();
  if (ids.length) {
    const { data } = await sb.from('artwork').select('entity_id, source_url, storage_path')
      .eq('entity_type', 'album').eq('is_primary', true).in('entity_id', ids);
    for (const a of (data ?? []) as { entity_id: string; source_url: string; storage_path: string | null }[]) {
      art.set(a.entity_id, a.storage_path ?? a.source_url);
    }
  }
  return rows.map((r) => toTrackItem(r, art));
}
