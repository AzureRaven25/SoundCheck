/**
 * YouTube for listening (research.md §3): find the song's video for the official embedded player.
 *
 *   POST { track_id }  → { configured: boolean, videos: [{ id, title, channel }] }
 *
 * Needs YOUTUBE_API_KEY (YouTube Data API v3, server-side). Without it, the apps let people paste a link
 * instead. Results are cached for 7 days (search costs 100 of the 10,000 daily quota units). Audio is never
 * separated or downloaded: YouTube's developer policies restrict that, so YouTube is listen-only.
 */
import { adminClient, cacheGet, cachePut, handle, json } from '../_shared/runtime.ts';

Deno.serve((req) => handle(req, async (body) => {
  const key = Deno.env.get('YOUTUBE_API_KEY');
  const trackId = String(body.track_id ?? '');
  if (!/^[0-9a-f-]{36}$/.test(trackId)) return json({ error: 'track_id required' }, 400);
  if (!key) return json({ configured: false, videos: [] });

  const cached = await cacheGet('youtube', trackId);
  if (cached?.status === 'hit') return json({ configured: true, videos: cached.value });

  const { data: t } = await adminClient().from('tracks').select('title, artist_credit').eq('id', trackId).maybeSingle();
  if (!t) return json({ error: 'song not found' }, 404);
  const params = new URLSearchParams({
    part: 'snippet', type: 'video', videoEmbeddable: 'true', videoCategoryId: '10', maxResults: '3',
    q: `${t.artist_credit} ${t.title}`, key,
  });
  const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!r.ok) return json({ configured: true, videos: [], error: `youtube ${r.status}` }, 502);
  const d = await r.json();
  const videos = (d.items ?? []).map((i: { id: { videoId: string }; snippet: { title: string; channelTitle: string } }) => ({
    id: i.id.videoId, title: i.snippet.title, channel: i.snippet.channelTitle,
  }));
  await cachePut('youtube', trackId, 'hit', videos, 7 * 86400);
  if (videos[0]) {
    await adminClient().from('track_sources').upsert({
      track_id: trackId, provider: 'youtube', external_id: videos[0].id, url: `https://www.youtube.com/watch?v=${videos[0].id}`, karaoke_ok: false,
    }, { onConflict: 'provider,external_id' });
  }
  return json({ configured: true, videos });
}));
