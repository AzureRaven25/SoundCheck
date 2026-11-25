/**
 * fetch-lyrics: find synced lyrics for a track on LRCLIB and store them in the lyrics contract.
 * Prefers word-level (Enhanced LRC) > line-level > plain. LRCLIB lyrics are community-sourced;
 * see docs/RESEARCH.md §5 for the licensing note (commercial launch needs Musixmatch/LyricFind).
 *
 * POST { track_id: uuid }  →  { granularity, lines } | { lines: [] , granularity: null }
 */
import { cleanTitle, parseLrc, plainToContent, primaryArtist } from '../_shared/lrc.ts';
import { adminClient, cacheGet, cachePut, DAY, handle, json, providerFetch } from '../_shared/runtime.ts';

interface LrclibRecord { id: number; duration?: number; syncedLyrics?: string | null; plainLyrics?: string | null; instrumental?: boolean }

const LRCLIB = 'https://lrclib.net/api';

/**
 * Best record: synced beats plain; then the closest length. Within 5 s it's the same recording; up to 15 s is
 * accepted for synced lyrics (a radio edit or a longer intro), since singers can nudge the timing on Stage.
 */
function closest(records: LrclibRecord[], seconds: number | null): LrclibRecord | null {
  const near = (r: LrclibRecord, tol: number) => seconds == null || r.duration == null || Math.abs(r.duration - seconds) <= tol;
  const byLen = (a: LrclibRecord, b: LrclibRecord) => (seconds == null ? 0 : Math.abs((a.duration ?? 0) - seconds) - Math.abs((b.duration ?? 0) - seconds));
  const synced = records.filter((r) => r.syncedLyrics && !r.instrumental).sort(byLen);
  const plain = records.filter((r) => r.plainLyrics && !r.instrumental).sort(byLen);
  return synced.find((r) => near(r, 5)) ?? synced.find((r) => near(r, 15)) ?? plain.find((r) => near(r, 10)) ?? null;
}

async function lrclibSearch(params: Record<string, string>): Promise<LrclibRecord[]> {
  const r = await providerFetch('lrclib', `${LRCLIB}/search?${new URLSearchParams(params)}`);
  return r.ok ? ((await r.json()) as LrclibRecord[]) : [];
}

Deno.serve((req) =>
  handle(req, async (body) => {
    const trackId = typeof body.track_id === 'string' ? body.track_id : '';
    if (!trackId) return json({ error: 'track_id required' }, 400);
    const db = adminClient();

    const { data: existing } = await db.from('lyrics').select('granularity, content, provider').eq('track_id', trackId).eq('is_primary', true).maybeSingle();
    // synced lyrics are final; plain ones are re-checked weekly in case someone has since synced them on LRCLIB
    if (existing && (existing.granularity !== 'plain' || (await cacheGet('lrclib', `resync:${trackId}`)))) {
      return json({ granularity: existing.granularity, provider: existing.provider, ...existing.content });
    }

    if (!existing && (await cacheGet('lrclib', trackId))?.status === 'miss') return json({ granularity: null, lines: [] });

    const { data: track } = await db.from('tracks').select('id, title, artist_credit, duration_ms, albums(title)').eq('id', trackId).maybeSingle();
    if (!track) return json({ error: 'track not found' }, 404);
    const seconds = track.duration_ms ? Math.round(track.duration_ms / 1000) : null;
    const albumTitle = (track as unknown as { albums: { title: string } | null }).albums?.title;
    const title = cleanTitle(track.title), artist = primaryArtist(track.artist_credit);

    // 1) exact match on the full metadata; 2) searches with the cleaned title and main artist, then free text
    let record: LrclibRecord | null = null;
    const params = new URLSearchParams({ track_name: track.title, artist_name: track.artist_credit });
    if (albumTitle) params.set('album_name', albumTitle);
    if (seconds) params.set('duration', String(seconds));
    const exact = await providerFetch('lrclib', `${LRCLIB}/get?${params}`);
    if (exact.ok) record = (await exact.json()) as LrclibRecord;
    const attempts: Record<string, string>[] = [
      { track_name: title, artist_name: artist },
      { q: `${artist} ${title}` },
    ];
    if (title !== track.title || artist !== track.artist_credit) attempts.unshift({ track_name: track.title, artist_name: track.artist_credit });
    for (const a of attempts) {
      if (record?.syncedLyrics) break;
      record = closest(await lrclibSearch(a), seconds) ?? record;
    }

    if (existing) {
      await cachePut('lrclib', `resync:${trackId}`, 'hit', null, 7 * DAY);
      if (!record?.syncedLyrics) return json({ granularity: existing.granularity, provider: existing.provider, ...existing.content });
    }
    if (!record || (!record.syncedLyrics && !record.plainLyrics)) {
      await cachePut('lrclib', trackId, 'miss', null, 7 * DAY);
      return json({ granularity: null, lines: [] });
    }

    const parsed = record.syncedLyrics ? parseLrc(record.syncedLyrics, track.duration_ms ? track.duration_ms / 1000 : null) : null;
    const granularity = parsed ? parsed.granularity : 'plain';
    const content = parsed ? { lines: parsed.lines } : plainToContent(record.plainLyrics!);
    if (existing && existing.provider !== 'lrclib') await db.from('lyrics').update({ is_primary: false }).eq('track_id', trackId).eq('is_primary', true);
    const { error } = await db.from('lyrics').upsert({
      track_id: trackId, provider: 'lrclib', provider_ref: String(record.id), granularity, content, is_primary: true,
    }, { onConflict: 'track_id,provider' });
    if (error) throw error;
    await cachePut('lrclib', trackId, 'hit', { id: record.id }, 30 * DAY);
    return json({ granularity, provider: 'lrclib', ...content });
  })
);
