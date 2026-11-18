import 'server-only';
import { supabasePublic } from './supabase/public';
import type { TrackItem } from './types';
import { TRACK_SELECT, toTrackItem, type Row } from './track-mapping';

/** Primary album artwork for a set of albums, in one query. */
export async function albumArtwork(albumIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(albumIds.filter((x): x is string => !!x))];
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const sb = supabasePublic();
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
  const sb = supabasePublic();
  const { data } = await sb.from('tracks').select(TRACK_SELECT).order('popularity', { ascending: false }).range(offset, offset + limit - 1);
  return withArtwork((data ?? []) as unknown as Row[]);
}

export async function getTrack(id: string) {
  const sb = supabasePublic();
  const { data } = await sb.from('tracks').select(`${TRACK_SELECT}, isrcs, popularity`).eq('id', id).maybeSingle();
  if (!data) return null;
  const [track] = await withArtwork([data as unknown as Row]);
  return track!;
}

export async function getAlbum(id: string) {
  const sb = supabasePublic();
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
  const sb = supabasePublic();
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

async function tracksByIds(ids: string[]): Promise<TrackItem[]> {
  if (!ids.length) return [];
  const sb = supabasePublic();
  const { data } = await sb.from('tracks').select(TRACK_SELECT).in('id', ids);
  const byId = new Map(((data ?? []) as unknown as Row[]).map((r) => [r.id, r]));
  return withArtwork(ids.map((i) => byId.get(i)).filter((r): r is Row => !!r));
}

/**
 * Songs that play in full for everyone (open sources), newest additions first, mixed across providers so one
 * source doesn't fill the shelf.
 */
export async function getFullLengthTracks(providers: string[], limit = 12): Promise<TrackItem[]> {
  const sb = supabasePublic();
  const per = Math.ceil(limit / providers.length) + 2;
  const lists = await Promise.all(providers.map(async (p) => {
    const { data } = await sb.from('track_sources').select('track_id').eq('provider', p).not('stream_url', 'is', null)
      .order('created_at', { ascending: false }).limit(per * 3);
    // spread picks across the most recent batch for variety
    const ids = [...new Set((data ?? []).map((r) => r.track_id as string))];
    return ids.filter((_, i) => i % 3 === 0).slice(0, per);
  }));
  const mixed: string[] = [];
  for (let i = 0; mixed.length < limit && lists.some((l) => l[i]); i++) for (const l of lists) if (l[i] && mixed.length < limit) mixed.push(l[i]!);
  return tracksByIds(mixed);
}

/** Songs with a shared karaoke version (processed from an open-licensed recording): sing right now. */
export async function getReadyToSing(limit = 12): Promise<TrackItem[]> {
  const sb = supabasePublic();
  const { data } = await sb.rpc('ready_to_sing', { p_limit: limit });
  return tracksByIds((data ?? []).map((r: { track_id: string }) => r.track_id));
}

/** Other songs credited to the same artist, most popular first. */
export async function getMoreByArtist(artistCredit: string, excludeId: string, limit = 12): Promise<TrackItem[]> {
  const sb = supabasePublic();
  const { data } = await sb.from('tracks').select(TRACK_SELECT).eq('artist_credit', artistCredit).neq('id', excludeId)
    .order('popularity', { ascending: false }).limit(limit);
  return withArtwork((data ?? []) as unknown as Row[]);
}
