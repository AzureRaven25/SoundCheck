import 'server-only';
import { supabaseServer } from './supabase/server';
import type { TrackItem } from './types';
import { TRACK_SELECT, toTrackItem, type Row } from './track-mapping';

/** Primary album artwork for a set of albums, in one query. */
export async function albumArtwork(albumIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(albumIds.filter((x): x is string => !!x))];
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const sb = await supabaseServer();
  const { data } = await sb.from('artwork').select('entity_id, source_url, storage_path')
    .eq('entity_type', 'album').eq('is_primary', true).in('entity_id', ids);
  for (const a of data ?? []) map.set(a.entity_id, a.storage_path ?? a.source_url);
  return map;
}

export async function withArtwork(rows: Row[]): Promise<TrackItem[]> {
  const art = await albumArtwork(rows.map((r) => r.album_id));
  return rows.map((r) => toTrackItem(r, art));
}

export async function getPopularTracks(limit = 24, offset = 0): Promise<TrackItem[]> {
  const sb = await supabaseServer();
  const { data } = await sb.from('tracks').select(TRACK_SELECT).order('popularity', { ascending: false }).range(offset, offset + limit - 1);
  return withArtwork((data ?? []) as unknown as Row[]);
}

export async function getTrack(id: string) {
  const sb = await supabaseServer();
  const { data } = await sb.from('tracks').select(`${TRACK_SELECT}, isrcs, popularity`).eq('id', id).maybeSingle();
  if (!data) return null;
  const [track] = await withArtwork([data as unknown as Row]);
  return track!;
}

export async function getAlbum(id: string) {
  const sb = await supabaseServer();
  const [{ data: album }, { data: tracks }] = await Promise.all([
    sb.from('albums').select('id, title, artist_credit, primary_type, release_year, album_artists(position, join_phrase, artists(id, name))').eq('id', id).maybeSingle(),
    sb.from('tracks').select(TRACK_SELECT).eq('album_id', id).order('popularity', { ascending: false }).limit(100),
  ]);
  if (!album) return null;
  const art = await albumArtwork([id]);
  return {
    album: {
      ...album,
      artwork_url: art.get(id) ?? null,
      artists: [...album.album_artists].sort((a, b) => a.position - b.position).filter((a) => a.artists)
        .map((a) => ({ id: a.artists!.id, name: a.artists!.name, join_phrase: a.join_phrase })),
    },
    tracks: ((tracks ?? []) as unknown as Row[]).map((r) => toTrackItem(r, art)),
  };
}

export async function getArtist(id: string) {
  const sb = await supabaseServer();
  const [{ data: artist }, { data: top }, { data: albums }, { data: photo }] = await Promise.all([
    sb.from('artists').select('id, name, disambiguation, country').eq('id', id).maybeSingle(),
    sb.from('tracks').select(`${TRACK_SELECT}, credit:track_artists!inner(artist_id)`).eq('credit.artist_id', id)
      .order('popularity', { ascending: false }).limit(20),
    sb.from('albums').select('id, title, release_year, primary_type, credit:album_artists!inner(artist_id)').eq('credit.artist_id', id)
      .order('release_year', { ascending: false, nullsFirst: false }).limit(48),
    sb.from('artwork').select('source_url').eq('entity_type', 'artist').eq('entity_id', id).eq('is_primary', true).maybeSingle(),
  ]);
  if (!artist) return null;
  const art = await albumArtwork([...(top ?? []).map((t) => t.album_id), ...(albums ?? []).map((a) => a.id)]);
  return {
    artist,
    photo: photo?.source_url ?? null,
    topTracks: ((top ?? []) as unknown as Row[]).map((r) => toTrackItem(r, art)),
    albums: (albums ?? []).map((a) => ({ id: a.id, title: a.title, release_year: a.release_year, primary_type: a.primary_type, artwork_url: art.get(a.id) ?? null })),
  };
}
