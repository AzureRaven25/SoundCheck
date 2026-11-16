/**
 * catalog-search: search the SoundCheck catalog in tiers and grow it on demand.
 *   1. Supabase (active catalog: top-ranked songs + everything users have touched)
 *   2. Turso long-tail index (ranks beyond the Supabase subset), with hits promoted into Supabase
 *   3. MusicBrainz live lookup (anything newer or rarer), with eligible songs added
 *
 * POST { q: string, limit?: number }
 *   →  { results: SearchRow[], source: 'catalog' | 'catalog+extended' | 'catalog+musicbrainz' }
 */
import { MB_BASE, mapRecordingSearch, recordingQuery, type CatalogRows, type MbRecording } from '../_shared/musicbrainz.ts';
import { norm } from '../_shared/norm.ts';
import { searchTurso, songsToRows, tursoConfigured } from '../_shared/turso.ts';
import { adminClient, cacheGet, cachePut, DAY, handle, json, providerFetch } from '../_shared/runtime.ts';

const LIVE_LOOKUP_BELOW = 5;

async function searchCatalog(q: string, limit: number) {
  const { data, error } = await adminClient().rpc('search_tracks', { q, lim: limit, off: 0 });
  if (error) throw error;
  return data ?? [];
}

/** Drop candidates that already exist under another recording id (same artist + title). */
async function withoutExisting(rows: CatalogRows): Promise<CatalogRows> {
  const db = adminClient();
  const keep = new Set<string>();
  for (const t of rows.tracks) {
    const { data } = await db.from('tracks').select('id').eq('norm_title', norm(t.title)).eq('norm_artist', norm(t.artist_credit)).limit(1);
    if (!data?.length) keep.add(t.id);
  }
  return {
    ...rows,
    tracks: rows.tracks.filter((t) => keep.has(t.id)),
    track_artists: rows.track_artists.filter((a) => keep.has(a.track_id)),
    track_recordings: rows.track_recordings.filter((r) => keep.has(r.track_id)),
  };
}

async function upsertRows(rows: CatalogRows) {
  if (!rows.tracks.length) return 0;
  const db = adminClient();
  const steps: [string, unknown[], string][] = [
    ['artists', rows.artists, 'id'],
    ['albums', rows.albums.filter((a) => rows.tracks.some((t) => t.album_id === a.id)), 'id'],
    ['tracks', rows.tracks, 'id'],
    ['track_artists', rows.track_artists, 'track_id,position'],
    ['track_recordings', rows.track_recordings, 'recording_mbid'],
  ];
  for (const [table, data, onConflict] of steps) {
    if (!data.length) continue;
    const { error } = await db.from(table).upsert(data, { onConflict, ignoreDuplicates: table !== 'tracks' });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  return rows.tracks.length;
}

Deno.serve((req) =>
  handle(req, async (body) => {
    const q = String(body.q ?? '').trim().slice(0, 200);
    const limit = Math.min(Math.max(Number(body.limit ?? 30) || 30, 1), 100);
    if (!q) return json({ results: [], source: 'catalog' });

    let results = await searchCatalog(q, limit);
    if (results.length >= LIVE_LOOKUP_BELOW || q.length < 3) return json({ results, source: 'catalog' });

    if (tursoConfigured()) {
      try {
        const hits = await searchTurso(q, 10);
        const added = await upsertRows(await withoutExisting(songsToRows(hits)));
        if (added) results = await searchCatalog(q, limit);
        if (results.length) return json({ results, source: 'catalog+extended', added });
      } catch (e) {
        console.warn('turso tier unavailable', e); // fall through to MusicBrainz
      }
    }

    const key = norm(q);
    if (await cacheGet('musicbrainz', key)) return json({ results, source: 'catalog' });

    const query = recordingQuery(q);
    if (!query) return json({ results, source: 'catalog' });
    const url = `${MB_BASE}/recording?fmt=json&limit=25&query=${encodeURIComponent(query)}`;
    let res = await providerFetch('musicbrainz', url);
    if (res.status === 503) res = await providerFetch('musicbrainz', url); // MusicBrainz signals throttling with 503
    if (!res.ok) {
      await cachePut('musicbrainz', key, 'error', { status: res.status }, 60);
      return json({ results, source: 'catalog', warning: `musicbrainz ${res.status}` });
    }
    const payload = (await res.json()) as { recordings?: MbRecording[] };
    const rows = await withoutExisting(mapRecordingSearch(payload.recordings ?? []));
    const added = await upsertRows(rows);
    await cachePut('musicbrainz', key, added ? 'hit' : 'miss', { added }, 7 * DAY);
    if (added) results = await searchCatalog(q, limit);
    return json({ results, source: 'catalog+musicbrainz', added });
  })
);
