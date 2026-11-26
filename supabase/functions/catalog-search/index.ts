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
import { adminClient, cacheGet, cachePut, DAY, handle, json, providerFetch, sleep } from '../_shared/runtime.ts';
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

/** Add Apple catalog songs we don't have yet (linked to existing artists by name). Returns how many were added. */
async function importItunes(songs: ItunesSong[], popularity?: (rank: number) => number): Promise<number> {
  const rows = await itunesToRows(songs);
  if (popularity) rows.tracks.forEach((t, i) => { t.popularity = popularity(i); });
  const db = adminClient();
  const fresh: typeof rows.tracks = [];
  for (const t of rows.tracks) {
    const { data } = await db.from('tracks').select('id').eq('norm_title', norm(t.title)).eq('norm_artist', norm(t.artist_credit)).limit(1);
    if (!data?.length) fresh.push(t);
    else if (popularity) await db.from('tracks').update({ popularity: t.popularity }).eq('id', data[0]!.id).lt('popularity', t.popularity);   // a chart hit we already have: rank it up
  }
  if (!fresh.length) return 0;
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
    // and the album, so it appears in the artist's discography
    if (t.album_id) await db.from('album_artists').upsert({ album_id: t.album_id, position: 0, artist_id: artistId, join_phrase: '' }, { onConflict: 'album_id,position', ignoreDuplicates: true });
  }
  return fresh.length;
}

async function itunesSearch(params: Record<string, string>): Promise<ItunesSong[]> {
  const res = await providerFetch('itunes', `https://itunes.apple.com/search?${new URLSearchParams({ media: 'music', entity: 'song', country: 'US', ...params })}`);
  if (!res.ok) throw new Error(`itunes ${res.status}`);
  return ((await res.json()).results ?? []) as ItunesSong[];
}

/** Search tier: Apple's catalog for this query (cached a week per query). */
async function growFromItunes(q: string, key: string): Promise<number> {
  const ck = `search:${key}`;
  if (await cacheGet('itunes', ck)) return 0;
  const added = await importItunes(await itunesSearch({ term: q, limit: '25' }));
  await cachePut('itunes', ck, added ? 'hit' : 'miss', { added }, 7 * DAY);
  return added;
}

/** Words of a string for matching: lower case, accents and punctuation gone ("Choosin’ Texas" → choosin, texas). */
const words = (s: string) => norm(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1);
/** Does any result contain every word of the query (in its title + artist)? Otherwise look further afield. */
function strongMatch(q: string, results: { title?: string; artist_credit?: string }[]): boolean {
  const qw = words(q);
  if (!qw.length) return true;
  return results.slice(0, 10).some((r) => {
    const have = words(`${r.title ?? ''} ${r.artist_credit ?? ''}`);
    return qw.every((w) => have.some((h) => h === w || h.startsWith(w)));
  });
}

/**
 * Artist pages: fill in an artist's songs from Apple's catalog when we only have a few (once a week per artist).
 * POST { action: 'artist', artist_id } → { added }
 */
async function fillArtist(artistId: string): Promise<number> {
  const db = adminClient();
  const { data: a } = await db.from('artists').select('id, name').eq('id', artistId).maybeSingle();
  if (!a) return 0;
  const { count } = await db.from('track_artists').select('track_id', { count: 'exact', head: true }).eq('artist_id', artistId);
  if ((count ?? 0) >= 40) return 0;
  const ck = `artist:${artistId}`;
  if (await cacheGet('itunes', ck)) return 0;
  const target = norm(a.name);
  const songs = (await itunesSearch({ term: a.name, attribute: 'artistTerm', limit: '100' }))
    .filter((x) => norm(x.artistName ?? '') === target || norm(x.artistName ?? '').startsWith(`${target} `) || norm(x.artistName ?? '').startsWith(`${target},`));
  const added = await importItunes(songs);
  await cachePut('itunes', ck, added ? 'hit' : 'miss', { added }, 7 * DAY);
  return added;
}

/**
 * New releases: Apple Music's 100 most-played songs in the US this week, added (or ranked up) so what people
 * are listening to is always in the catalog. Weekly via pg_cron. POST { action: 'charts' } → { added }
 */
async function importCharts(): Promise<number> {
  if (await cacheGet('itunes', 'charts:us')) return 0;
  const feed = await providerFetch('itunes', 'https://rss.applemarketingtools.com/api/v2/us/music/most-played/100/songs.json');
  if (!feed.ok) throw new Error(`charts ${feed.status}`);
  const ids = (((await feed.json()).feed?.results ?? []) as { id: string }[]).map((r) => r.id).filter((x) => /^\d+$/.test(x));
  if (!ids.length) return 0;
  const res = await providerFetch('itunes', `https://itunes.apple.com/lookup?${new URLSearchParams({ id: ids.join(','), entity: 'song', country: 'US' })}`);
  if (!res.ok) throw new Error(`itunes lookup ${res.status}`);
  const byId = new Map((((await res.json()).results ?? []) as ItunesSong[]).filter((x) => x.kind === 'song').map((x) => [String(x.trackId), x]));
  const songs = ids.map((i) => byId.get(i)).filter((x): x is ItunesSong => !!x);
  // chart position → popularity in the catalog's range (#1 ≈ the most popular classics)
  const added = await importItunes(songs, (rank) => Math.round(1500 - rank * 10));
  await cachePut('itunes', 'charts:us', 'hit', { added }, 6 * DAY);
  return added;
}

Deno.serve((req) =>
  handle(req, async (body) => {
    // keep-warm ping from pg_cron (every 5 min): no work, just keeps an instance ready so searches skip cold starts
    if (body.warm === true) return json({ warm: true });
    const q = String(body.q ?? '').trim().slice(0, 200);
    const limit = Math.min(Math.max(Number(body.limit ?? 30) || 30, 1), 100);
    if (body.action === 'artist' && typeof body.artist_id === 'string' && /^[0-9a-f-]{36}$/.test(body.artist_id)) {
      return json({ added: await fillArtist(body.artist_id).catch((e) => { console.warn('artist fill', e); return 0; }) });
    }
    if (body.action === 'charts') return json({ added: await importCharts() });
    if (!q) return json({ results: [], source: 'catalog' });

    let results = await searchCatalog(q, limit);
    // look further afield when we have too few results, or none that actually contain what was typed
    // ("choosin texas" used to stop at other songs called Texas)
    if (q.length < 3 || (results.length >= LIVE_LOOKUP_BELOW && strongMatch(q, results))) return json({ results, source: 'catalog' });

    // Apple first: fast, and strongest on new and popular releases
    const key = norm(q);
    let source = 'catalog';
    let added = 0;
    try {
      const more = await growFromItunes(q, key);
      if (more) { added += more; results = await searchCatalog(q, limit); source = 'catalog+itunes'; }
    } catch (e) {
      console.warn('itunes tier unavailable', e);
    }
    if (strongMatch(q, results) && results.length >= LIVE_LOOKUP_BELOW) return json({ results, source, added });

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

    if (!(await cacheGet('musicbrainz', key))) {
      const query = recordingQuery(q);
      if (query) {
        const url = `${MB_BASE}/recording?fmt=json&limit=25&query=${encodeURIComponent(query)}`;
        let res = await providerFetch('musicbrainz', url);
        // MusicBrainz answers 503 when it is overloaded or throttling: wait a moment and try twice more
        for (let i = 0; i < 2 && res.status === 503; i++) { await sleep(1200 * (i + 1)); res = await providerFetch('musicbrainz', url); }
        if (!res.ok) {
          await cachePut('musicbrainz', key, 'error', { status: res.status }, 60);
        } else {
          const payload = (await res.json()) as { recordings?: MbRecording[] };
          const mbAdded = await upsertRows(await withoutExisting(mapRecordingSearch(payload.recordings ?? [])));
          await cachePut('musicbrainz', key, mbAdded ? 'hit' : 'miss', { added: mbAdded }, 7 * DAY);
          if (mbAdded) { added += mbAdded; results = await searchCatalog(q, limit); source = 'catalog+musicbrainz'; }
        }
      }
    }
    return json({ results, source, added });
  })
);
