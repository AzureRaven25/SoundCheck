/**
 * fetch-lyrics: find synced lyrics for a track on LRCLIB and store them in the lyrics contract.
 * Prefers word-level (Enhanced LRC) > line-level > plain. LRCLIB lyrics are community-sourced;
 * see docs/RESEARCH.md §5 for the licensing note (commercial launch needs Musixmatch/LyricFind).
 *
 * POST { track_id: uuid }  →  { granularity, lines } | { lines: [] , granularity: null }
 */
import { parseLrc, plainToContent } from '../_shared/lrc.ts';
import { adminClient, cacheGet, cachePut, DAY, handle, json, providerFetch } from '../_shared/runtime.ts';

interface LrclibRecord { id: number; duration?: number; syncedLyrics?: string | null; plainLyrics?: string | null; instrumental?: boolean }

const LRCLIB = 'https://lrclib.net/api';

function closest(records: LrclibRecord[], seconds: number | null): LrclibRecord | null {
  const synced = records.filter((r) => r.syncedLyrics);
  const pool = synced.length ? synced : records.filter((r) => r.plainLyrics);
  if (!pool.length) return null;
  if (seconds == null) return pool[0]!;
  const best = pool.reduce((a, b) => (Math.abs((a.duration ?? 0) - seconds) <= Math.abs((b.duration ?? 0) - seconds) ? a : b));
  return Math.abs((best.duration ?? 0) - seconds) <= 5 ? best : null;
}

Deno.serve((req) =>
  handle(req, async (body) => {
    const trackId = typeof body.track_id === 'string' ? body.track_id : '';
    if (!trackId) return json({ error: 'track_id required' }, 400);
    const db = adminClient();

    const { data: existing } = await db.from('lyrics').select('granularity, content, provider').eq('track_id', trackId).eq('is_primary', true).maybeSingle();
    if (existing) return json({ granularity: existing.granularity, provider: existing.provider, ...existing.content });

    if ((await cacheGet('lrclib', trackId))?.status === 'miss') return json({ granularity: null, lines: [] });

    const { data: track } = await db.from('tracks').select('id, title, artist_credit, duration_ms, albums(title)').eq('id', trackId).maybeSingle();
    if (!track) return json({ error: 'track not found' }, 404);
    const seconds = track.duration_ms ? Math.round(track.duration_ms / 1000) : null;
    const albumTitle = (track as unknown as { albums: { title: string } | null }).albums?.title;

    const params = new URLSearchParams({ track_name: track.title, artist_name: track.artist_credit });
    if (albumTitle) params.set('album_name', albumTitle);
    if (seconds) params.set('duration', String(seconds));

    let record: LrclibRecord | null = null;
    const exact = await providerFetch('lrclib', `${LRCLIB}/get?${params}`);
    if (exact.ok) record = (await exact.json()) as LrclibRecord;
    if (!record?.syncedLyrics) {
      const search = await providerFetch('lrclib', `${LRCLIB}/search?${new URLSearchParams({ track_name: track.title, artist_name: track.artist_credit })}`);
      if (search.ok) record = closest((await search.json()) as LrclibRecord[], seconds) ?? record;
    }

    if (!record || (!record.syncedLyrics && !record.plainLyrics)) {
      await cachePut('lrclib', trackId, 'miss', null, 7 * DAY);
      return json({ granularity: null, lines: [] });
    }

    const parsed = record.syncedLyrics ? parseLrc(record.syncedLyrics, track.duration_ms ? track.duration_ms / 1000 : null) : null;
    const granularity = parsed ? parsed.granularity : 'plain';
    const content = parsed ? { lines: parsed.lines } : plainToContent(record.plainLyrics!);
    const { error } = await db.from('lyrics').upsert({
      track_id: trackId, provider: 'lrclib', provider_ref: String(record.id), granularity, content, is_primary: true,
    }, { onConflict: 'track_id,provider' });
    if (error) throw error;
    await cachePut('lrclib', trackId, 'hit', { id: record.id }, 30 * DAY);
    return json({ granularity, provider: 'lrclib', ...content });
  })
);
