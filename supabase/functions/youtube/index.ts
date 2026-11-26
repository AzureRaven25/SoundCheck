/**
 * YouTube for listening and singing (research.md §3): videos for YouTube's official embedded player.
 *
 *   POST { track_id }  → { configured, videos: [{ id, title, channel }] }   (originals, for listening)
 *   POST { track_id, action: 'stage' } → { configured, songS, originals: RankedVideo[], karaoke: RankedVideo[], quotaExhausted? }
 *
 * Reads the shared song_videos table first (filled ahead of time by the hourly youtube-crawl, and by links singers
 * share); only a song nobody has looked up yet costs a search (2 searches + 1 details call ≈ 201 units, counted in
 * the quota ledger). Needs YOUTUBE_API_KEY (server-side). Audio is never separated or downloaded: YouTube's
 * developer policies restrict that, so YouTube is listen and sing-along only.
 */
import { adminClient, handle, json } from '../_shared/runtime.ts';
import { dailyUnits, QuotaExhausted, searchAndStore, storedVideos } from '../_shared/youtube_api.ts';
import type { RankedVideo } from '../_shared/youtube_rank.ts';

/** Stored videos, or a live search when the song has none (null when the day's quota is used up). */
async function videosFor(trackId: string, key: string): Promise<{ songS: number | null; originals: RankedVideo[]; karaoke: RankedVideo[] } | null | 'missing'> {
  const { data: t } = await adminClient().from('tracks').select('id, title, artist_credit, duration_ms').eq('id', trackId).maybeSingle();
  if (!t) return 'missing';
  const songS = t.duration_ms ? Math.round(t.duration_ms / 1000) : null;
  const stored = await storedVideos(t);
  if (stored) return { songS, ...stored };
  if (!key) return null;   // no API key: only videos found earlier (or shared by singers)
  try {
    return { songS, ...(await searchAndStore(t, key, dailyUnits())) };
  } catch (e) {
    if (e instanceof QuotaExhausted) return null;
    throw e;
  }
}

async function stage(trackId: string, key: string) {
  const v = await videosFor(trackId, key);
  if (v === 'missing') return json({ error: 'song not found' }, 404);
  if (!v) return json({ configured: !!key, songS: null, originals: [], karaoke: [], quotaExhausted: !!key });
  return json({ configured: !!key, ...v });
}

Deno.serve((req) => handle(req, async (body) => {
  const key = Deno.env.get('YOUTUBE_API_KEY');
  const trackId = String(body.track_id ?? '');
  if (!/^[0-9a-f-]{36}$/.test(trackId)) return json({ error: 'track_id required' }, 400);
  if (body.action === 'stage') return stage(trackId, key ?? '');
  if (!key) return json({ configured: false, videos: [], originals: [], karaoke: [] });

  const v = await videosFor(trackId, key);
  if (v === 'missing') return json({ error: 'song not found' }, 404);
  const videos = (v?.originals ?? []).map((o) => ({ id: o.id, title: o.title, channel: o.channel }));
  if (videos[0]) {
    await adminClient().from('track_sources').upsert({
      track_id: trackId, provider: 'youtube', external_id: videos[0].id, url: `https://www.youtube.com/watch?v=${videos[0].id}`, karaoke_ok: false,
    }, { onConflict: 'provider,external_id' });
  }
  return json({ configured: true, videos, ...(v ? {} : { quotaExhausted: true }) });
}));
