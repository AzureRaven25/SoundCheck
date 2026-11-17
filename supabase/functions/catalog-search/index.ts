/**
 * catalog-search: search the SoundCheck catalog in tiers and grow it on demand.
 *   1. Supabase (active catalog: top-ranked songs + everything users have touched)
 *   2. Turso long-tail index (ranks beyond the Supabase subset), with hits promoted into Supabase
 *   3. MusicBrainz live lookup (anything newer or rarer), with eligible songs added
 *   4. iTunes Search (Apple's catalog, comparable in size to Spotify's) when the tiers above still come up short,
 *      including when MusicBrainz is busy. Metadata + artwork + store link; audio stays preview-only.
 *
 * POST { q: string, limit?: number }
 *   →  { results: SearchRow[], source: 'catalog' | 'catalog+extended' | 'catalog+musicbrainz' }
 */
import { MB_BASE, mapRecordingSearch, recordingQuery, type CatalogRows, type MbRecording } from '../_shared/musicbrainz.ts';
import { norm } from '../_shared/norm.ts';
import { searchTurso, songsToRows, tursoConfigured } from '../_shared/turso.ts';
import { adminClient, cacheGet, cachePut, DAY, handle, json, providerFetch } from '../_shared/runtime.ts';
import { itunesToRows, type ItunesSong } from '../_shared/itunes_catalog.ts';
import { stableUuid } from '../_shared/openmusic.ts';

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

/** Tier 4: add songs from Apple's catalog that we don't have yet (linked to existing artists by name). */
async function growFromItunes(q: string, key: string): Promise<number> {
  const ck = `search:${key}`;
  if (await cacheGet('itunes', ck)) return 0;
  const res = await providerFetch('itunes', `https://itunes.apple.com/search?${new URLSearchParams({ term: q, media: 'music', entity: 'song', limit: '20' })}`);
  if (!res.ok) throw new Error(`itunes ${res.status}`);
  const rows = await itunesToRows(((await res.json()).results ?? []) as ItunesSong[]);
  const db = adminClient();
  const fresh: typeof rows.tracks = [];
  for (const t of rows.tracks) {
    const { data } = await db.from('tracks').select('id').eq('norm_title', norm(t.title)).eq('norm_artist', norm(t.artist_credit)).limit(1);
    if (!data?.length) fresh.push(t);
  }
  if (fresh.length) {
    const keep = new Set(fresh.map((t) => t.id));
    const albums = rows.albums.filter((a) => fresh.some((t) => t.album_id === a.id));
    if (albums.length) { const { error } = await db.from('albums').upsert(albums, { ignoreDuplicates: true }); if (error) throw error; }
    const art = rows.artwork.filter((a) => albums.some((al) => al.id === a.entity_id));
    if (art.length) await db.from('artwork').upsert(art, { onConflict: 'entity_type,entity_id,provider,source_url', ignoreDuplicates: true });
    { const { error } = await db.from('tracks').upsert(fresh, { ignoreDuplicates: true }); if (error) throw error; }
    await db.from('track_sources').upsert(rows.sources.filter((x) => keep.has(x.track_id)), { onConflict: 'provider,external_id', ignoreDuplicates: true });
    // credit each song to its artist (an existing one with the same name, else a new artist row)
    for (const t of fresh) {
      const name = rows.artistNames.get(t.id)!;
      const { data: found } = await db.from('artists').select('id').ilike('name', name.replace(/[%_]/g, '\\$&')).order('popularity', { ascending: false }).limit(1);
      let artistId = found?.[0]?.id as string | undefined;
      if (!artistId) {
        artistId = await stableUuid(`itunes:artist:${norm(name)}`);
        await db.from('artists').upsert({ id: artistId, name: name.slice(0, 500) }, { ignoreDuplicates: true });
      }
      await db.from('track_artists').upsert({ track_id: t.id, position: 0, artist_id: artistId, join_phrase: '' }, { onConflict: 'track_id,position', ignoreDuplicates: true });
    }
  }
  await cachePut('itunes', ck, fresh.length ? 'hit' : 'miss', { added: fresh.length }, 7 * DAY);
  return fresh.length;
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
    let source = 'catalog';
    let added = 0;
    if (!(await cacheGet('musicbrainz', key))) {
      const query = recordingQuery(q);
      if (query) {
        const url = `${MB_BASE}/recording?fmt=json&limit=25&query=${encodeURIComponent(query)}`;
        let res = await providerFetch('musicbrainz', url);
        if (res.status === 503) res = await providerFetch('musicbrainz', url); // MusicBrainz signals throttling with 503
        if (!res.ok) {
          await cachePut('musicbrainz', key, 'error', { status: res.status }, 60);
        } else {
          const payload = (await res.json()) as { recordings?: MbRecording[] };
          added = await upsertRows(await withoutExisting(mapRecordingSearch(payload.recordings ?? [])));
          await cachePut('musicbrainz', key, added ? 'hit' : 'miss', { added }, 7 * DAY);
          if (added) { results = await searchCatalog(q, limit); source = 'catalog+musicbrainz'; }
        }
      }
    }
    if (results.length < LIVE_LOOKUP_BELOW) {
      try {
        const more = await growFromItunes(q, key);
        if (more) { added += more; results = await searchCatalog(q, limit); source = 'catalog+itunes'; }
      } catch (e) {
        console.warn('itunes tier unavailable', e);
      }
    }
    return json({ results, source, added });
  })
);
