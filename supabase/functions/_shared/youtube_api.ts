/**
 * YouTube Data API v3 calls shared by the `youtube` (live) and `youtube-crawl` (hourly) functions, with every unit
 * accounted for in the quota ledger (youtube_quota_take) so the crawl never starves people using the site.
 * Results are stored in song_videos and kept fresh (≤ 30 days) as YouTube's developer policies require.
 */
import { adminClient } from './runtime.ts';
import { isoSeconds, rankVideos, type RankedVideo, type YtVideo } from './youtube_rank.ts';

export const SEARCH_UNITS = 100;
export const LIST_UNITS = 1;
/** Daily quota granted by Google (raise YOUTUBE_DAILY_UNITS if a quota extension is approved). */
export const dailyUnits = () => Number(Deno.env.get('YOUTUBE_DAILY_UNITS') ?? 10_000);
/** Units the crawl leaves for live lookups by people on the site. */
export const liveReserve = () => Number(Deno.env.get('YOUTUBE_LIVE_RESERVE') ?? 3_000);

export class QuotaExhausted extends Error {}

export async function takeQuota(units: number, limit: number): Promise<boolean> {
  const { data, error } = await adminClient().rpc('youtube_quota_take', { p_units: units, p_limit: limit });
  if (error) throw error;
  return data === true;
}

const decodeEntities = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
type Item = { id: { videoId: string } | string; snippet: { title: string; channelTitle: string } };

export async function search(q: string, key: string, limit: number, max = 8, fetcher = fetch): Promise<{ id: string; title: string; channel: string }[]> {
  if (!(await takeQuota(SEARCH_UNITS, limit))) throw new QuotaExhausted('youtube quota reserved for today');
  const params = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: String(max), q, key });
  const r = await fetcher(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (r.status === 403) throw new QuotaExhausted(`youtube ${r.status}`);
  if (!r.ok) throw new Error(`youtube ${r.status}`);
  const d = await r.json();
  return (d.items ?? []).map((i: Item) => ({ id: typeof i.id === 'string' ? i.id : i.id.videoId, title: decodeEntities(i.snippet.title), channel: i.snippet.channelTitle }));
}

export interface VideoDetails { id: string; title: string; channel: string; durationS: number | null; embeddable: boolean }

/** Details for up to 50 videos per call (1 unit). Videos missing from the result are gone or private. */
export async function videoDetails(ids: string[], key: string, limit: number, fetcher = fetch): Promise<Map<string, VideoDetails>> {
  const out = new Map<string, VideoDetails>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    if (!(await takeQuota(LIST_UNITS, limit))) throw new QuotaExhausted('youtube quota reserved for today');
    const r = await fetcher(`https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: 'snippet,contentDetails,status', id: chunk.join(','), key })}`);
    if (!r.ok) throw new Error(`youtube ${r.status}`);
    for (const v of (await r.json()).items ?? []) {
      out.set(v.id, { id: v.id, title: decodeEntities(v.snippet?.title ?? ''), channel: v.snippet?.channelTitle ?? '',
                      durationS: isoSeconds(v.contentDetails?.duration), embeddable: v.status?.embeddable !== false });
    }
  }
  return out;
}

export interface Song { id: string; title: string; artist_credit: string; duration_ms: number | null }

/** Search a song's originals and karaoke versions (2 searches + 1 details call) and store them. */
export async function searchAndStore(song: Song, key: string, limit: number, fetcher = fetch): Promise<{ originals: RankedVideo[]; karaoke: RankedVideo[] }> {
  const songS = song.duration_ms ? Math.round(song.duration_ms / 1000) : null;
  const [orig, kar] = await Promise.all([
    search(`${song.artist_credit} ${song.title} audio`, key, limit, 8, fetcher),
    search(`${song.artist_credit} ${song.title} karaoke`, key, limit, 8, fetcher),
  ]);
  const ids = [...new Set([...orig, ...kar].map((v) => v.id))];
  const details = ids.length ? await videoDetails(ids, key, limit, fetcher) : new Map<string, VideoDetails>();
  const videos: YtVideo[] = [...orig, ...kar].filter((v) => details.get(v.id)?.embeddable)
    .map((v) => ({ ...v, durationS: details.get(v.id)?.durationS ?? null }));
  const ranked = rankVideos(videos, { title: song.title, artist: song.artist_credit, durationS: songS });
  const rows = [...ranked.originals, ...ranked.karaoke].map((v) => ({
    track_id: song.id, video_id: v.id, kind: v.kind, title: v.title, channel: v.channel, duration_s: v.durationS,
    quality: v.quality, offset_guess_ms: v.offsetGuessMs, source: 'search', refreshed_at: new Date().toISOString(),
  }));
  const db = adminClient();
  if (rows.length) {
    const { error } = await db.from('song_videos').upsert(rows, { onConflict: 'track_id,video_id' });
    if (error) throw error;
  }
  await db.rpc('youtube_mark_searched', { p_track_id: song.id, p_found: rows.length });
  return ranked;
}

/** Stored videos for a song, best first, in the shape the Stage expects. */
export async function storedVideos(trackId: string): Promise<{ originals: RankedVideo[]; karaoke: RankedVideo[] } | null> {
  const { data } = await adminClient().from('song_videos')
    .select('video_id, kind, title, channel, duration_s, quality, offset_guess_ms').eq('track_id', trackId).order('quality', { ascending: false });
  if (!data?.length) return null;
  const toRanked = (r: typeof data[number]): RankedVideo => ({
    id: r.video_id, kind: r.kind as RankedVideo['kind'], title: r.title ?? 'Shared video', channel: r.channel ?? 'YouTube',
    durationS: r.duration_s, quality: r.quality, offsetGuessMs: r.offset_guess_ms,
  });
  return { originals: data.filter((r) => r.kind === 'original').map(toRanked), karaoke: data.filter((r) => r.kind === 'karaoke').map(toRanked) };
}
