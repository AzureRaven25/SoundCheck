/**
 * resolve-artwork: find and record primary artwork for an album (or a track's album).
 * Providers in priority order: Cover Art Archive (exact, by release-group MBID) → iTunes Search API
 * (matched by title + artist). Results, including "nothing found", are cached so providers aren't
 * re-queried. Artwork never blocks anything: callers fall back to generated placeholders.
 *
 * POST { album_id?: uuid, track_id?: uuid }  →  { url: string | null, provider: string | null }
 */
import { pickAlbum, upscaleArtwork, type ItunesAlbum } from '../_shared/itunes.ts';
import { adminClient, cacheGet, cachePut, DAY, handle, json, providerFetch } from '../_shared/runtime.ts';

/** A provider answered definitively that it has nothing (vs. a timeout/busy/5xx). */
class NotFound extends Error {}

interface Album { id: string; mbid: string | null; title: string; artist_credit: string; release_year: number | null }

async function fromCoverArtArchive(mbid: string): Promise<string | null> {
  // CAA answers via an archive.org redirect that can be slow: generous timeout.
  const res = await providerFetch('coverartarchive', `https://coverartarchive.org/release-group/${mbid}`, {}, 15000, 4000);
  if (res.status === 404) throw new NotFound();
  if (!res.ok) throw new Error(`coverartarchive ${res.status}`);
  const body = (await res.json()) as { images?: { front?: boolean; image?: string; thumbnails?: Record<string, string> }[] };
  const front = body.images?.find((i) => i.front) ?? body.images?.[0];
  const url = front?.thumbnails?.['1200'] ?? front?.thumbnails?.large ?? front?.image ?? null;
  if (!url) throw new NotFound();
  return url.replace(/^http:/, 'https:');
}

async function fromItunes(album: Album): Promise<string | null> {
  const term = `${album.artist_credit} ${album.title}`.slice(0, 120);
  // Background backfill: don't queue behind user-initiated preview lookups for long.
  const res = await providerFetch('itunes', `https://itunes.apple.com/search?entity=album&limit=15&term=${encodeURIComponent(term)}`, {}, 8000, 2000);
  if (!res.ok) throw new Error(`itunes ${res.status}`);
  const body = (await res.json()) as { results?: ItunesAlbum[] };
  const pick = pickAlbum(body.results ?? [], album.title, album.artist_credit, album.release_year);
  if (!pick?.artworkUrl100) throw new NotFound();
  return upscaleArtwork(pick.artworkUrl100);
}

/** Validate that the URL really serves an image before we store it. */
async function isImage(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return res.ok && (res.headers.get('content-type') ?? '').startsWith('image/');
  } catch {
    return false;
  }
}

Deno.serve((req) =>
  handle(req, async (body) => {
    const db = adminClient();
    let albumId = typeof body.album_id === 'string' ? body.album_id : null;
    if (!albumId && typeof body.track_id === 'string') {
      const { data } = await db.from('tracks').select('album_id').eq('id', body.track_id).maybeSingle();
      albumId = data?.album_id ?? null;
    }
    if (!albumId) return json({ url: null, provider: null, reason: 'no album' });

    const { data: existing } = await db.from('artwork').select('source_url, storage_path, provider')
      .eq('entity_type', 'album').eq('entity_id', albumId).eq('is_primary', true).eq('status', 'ok').maybeSingle();
    if (existing) return json({ url: existing.storage_path ?? existing.source_url, provider: existing.provider });

    const cached = await cacheGet('coverartarchive', `album:${albumId}`);
    if (cached?.status === 'miss') return json({ url: null, provider: null });

    const { data: album } = await db.from('albums').select('id, mbid, title, artist_credit, release_year').eq('id', albumId).maybeSingle<Album>();
    if (!album) return json({ error: 'album not found' }, 404);

    const attempts: [string, () => Promise<string | null>][] = [];
    if (album.mbid) attempts.push(['coverartarchive', () => fromCoverArtArchive(album.mbid!)]);
    attempts.push(['itunes', () => fromItunes(album)]);

    // Only a definitive "nothing" from every provider is cached as a miss. Timeouts, 5xx and
    // "busy" are transient: return retry=true so the client tries again later.
    let transient = false;
    for (const [provider, find] of attempts) {
      let url: string | null = null;
      try {
        url = await find();
      } catch (e) {
        if (!(e instanceof NotFound)) {
          transient = true;
          console.warn(provider, e instanceof Error ? e.message : e);
          if (provider === 'coverartarchive') break; // CAA hiccup: retry later rather than spend iTunes quota
        }
        continue;
      }
      if (url && (await isImage(url))) {
        const { error } = await db.from('artwork').upsert({
          entity_type: 'album', entity_id: album.id, provider, source_url: url, is_primary: true, status: 'ok', checked_at: new Date().toISOString(),
        }, { onConflict: 'entity_type,entity_id,provider,source_url' });
        if (error) throw error;
        return json({ url, provider });
      }
    }
    if (transient) return json({ url: null, provider: null, retry: true });
    await cachePut('coverartarchive', `album:${albumId}`, 'miss', null, 14 * DAY);
    return json({ url: null, provider: null });
  })
);
