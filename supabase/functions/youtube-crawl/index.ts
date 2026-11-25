/**
 * youtube-crawl: run hourly by pg_cron (see migration 20261125030001_song_videos.sql). Builds the shared song_videos
 * table ahead of demand, within the quota the site doesn't need:
 *
 *   1. refresh: re-check stored videos older than 25 days (and newly shared links) with videos.list, 50 per unit;
 *      update their details, drop ones that are gone or no longer embeddable (YouTube's 30-day storage rule)
 *   2. search: the most popular songs nobody has searched yet, a few per run, never spending past
 *      YOUTUBE_DAILY_UNITS − YOUTUBE_LIVE_RESERVE for the day
 *
 * Called with the x-crawl-token header (YOUTUBE_CRAWL_TOKEN secret; the same value sits in Vault for pg_cron).
 * POST {} → { refreshed, removed, searched, found, unitsToday, stopped? }
 */
import { adminClient, handle, json } from '../_shared/runtime.ts';
import { dailyUnits, liveReserve, QuotaExhausted, searchAndStore, videoDetails } from '../_shared/youtube_api.ts';

function sameToken(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve((req) => handle(req, async (body) => {
  const expected = Deno.env.get('YOUTUBE_CRAWL_TOKEN') ?? '';
  if (!expected || !sameToken(req.headers.get('x-crawl-token') ?? '', expected)) return json({ error: 'forbidden' }, 403);
  const key = Deno.env.get('YOUTUBE_API_KEY');
  if (!key) return json({ error: 'YOUTUBE_API_KEY not set' }, 503);
  const db = adminClient();
  const limit = dailyUnits() - liveReserve();
  const songsPerRun = Math.max(0, Math.min(20, Number(body.songs ?? Deno.env.get('YOUTUBE_CRAWL_SONGS_PER_RUN') ?? 3)));
  const out = { refreshed: 0, removed: 0, searched: 0, found: 0, unitsToday: 0, stopped: null as string | null };

  try {
    // 1. refresh (cheap): stale or never-checked rows
    const stale = new Date(Date.now() - 25 * 86400_000).toISOString();
    const { data: rows } = await db.from('song_videos').select('track_id, video_id')
      .or(`refreshed_at.is.null,refreshed_at.lt.${stale}`).order('refreshed_at', { ascending: true, nullsFirst: true }).limit(1000);
    const ids = [...new Set((rows ?? []).map((r) => r.video_id))];
    if (ids.length) {
      const details = await videoDetails(ids, key, limit);
      const now = new Date().toISOString();
      for (const r of rows ?? []) {
        const d = details.get(r.video_id);
        if (!d || !d.embeddable) {
          await db.from('song_videos').delete().eq('track_id', r.track_id).eq('video_id', r.video_id);
          out.removed++;
        } else {
          await db.from('song_videos').update({ title: d.title, channel: d.channel, duration_s: d.durationS, refreshed_at: now })
            .eq('track_id', r.track_id).eq('video_id', r.video_id);
          out.refreshed++;
        }
      }
    }
    // 2. search ahead: most popular unsearched songs
    if (songsPerRun) {
      const { data: songs, error } = await db.rpc('youtube_crawl_candidates', { p_limit: songsPerRun });
      if (error) throw error;
      for (const s of songs ?? []) {
        const r = await searchAndStore(s, key, limit);
        out.searched++;
        out.found += r.originals.length + r.karaoke.length;
      }
    }
  } catch (e) {
    if (!(e instanceof QuotaExhausted)) throw e;
    out.stopped = 'quota';
  }
  const { data: units } = await db.rpc('youtube_quota_today');
  out.unitsToday = Number(units ?? 0);
  console.log('youtube-crawl', JSON.stringify(out));
  return json(out);
}));
