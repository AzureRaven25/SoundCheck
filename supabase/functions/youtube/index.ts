/**
 * YouTube for listening (research.md §3): find the song's video for the official embedded player.
 *
 *   POST { track_id }  → { configured: boolean, videos: [{ id, title, channel }] }
 *   POST { track_id, action: 'stage' } → { configured, songS, originals: RankedVideo[], karaoke: RankedVideo[] }
 *     videos to sing along to: the original (for the guide vocal) and karaoke versions (no lead vocal), each with its
 *     length and a first guess at where the lyrics start. Two searches + one videos.list (≈201 quota units), cached
 *     for 14 days per song.
 *
 * Needs YOUTUBE_API_KEY (YouTube Data API v3, server-side). Without it, the apps let people paste a link
 * instead. Results are cached for 7 days (search costs 100 of the 10,000 daily quota units). Audio is never
 * separated or downloaded: YouTube's developer policies restrict that, so YouTube is listen-only.
 */
import { adminClient, cacheGet, cachePut, handle, json } from '../_shared/runtime.ts';
import { isoSeconds, rankVideos, type YtVideo } from '../_shared/youtube_rank.ts';

type Item = { id: { videoId: string } | string; snippet: { title: string; channelTitle: string } };

async function search(q: string, key: string, max = 8): Promise<{ id: string; title: string; channel: string }[]> {
  const params = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: String(max), q, key });
  const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!r.ok) throw new Error(`youtube ${r.status}`);
  const d = await r.json();
  return (d.items ?? []).map((i: Item) => ({ id: typeof i.id === 'string' ? i.id : i.id.videoId, title: decodeEntities(i.snippet.title), channel: i.snippet.channelTitle }));
}
const decodeEntities = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

async function stage(trackId: string, key: string) {
  const cacheKey = `stage:${trackId}`;
  const cached = await cacheGet('youtube', cacheKey);
  if (cached?.status === 'hit') return json({ configured: true, ...(cached.value as object) });
  const { data: t } = await adminClient().from('tracks').select('title, artist_credit, duration_ms').eq('id', trackId).maybeSingle();
  if (!t) return json({ error: 'song not found' }, 404);
  const songS = t.duration_ms ? Math.round(t.duration_ms / 1000) : null;
  const [orig, kar] = await Promise.all([
    search(`${t.artist_credit} ${t.title} audio`, key),
    search(`${t.artist_credit} ${t.title} karaoke`, key),
  ]);
  const all = [...orig, ...kar];
  const durations = new Map<string, number | null>();
  if (all.length) {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: 'contentDetails,status', id: [...new Set(all.map((v) => v.id))].join(','), key })}`);
    if (r.ok) {
      for (const v of (await r.json()).items ?? []) {
        if (v.status?.embeddable === false) continue;
        durations.set(v.id, isoSeconds(v.contentDetails?.duration));
      }
    }
  }
  const videos: YtVideo[] = all.filter((v) => durations.has(v.id)).map((v) => ({ ...v, durationS: durations.get(v.id) ?? null }));
  const ranked = rankVideos(videos, { title: t.title, artist: t.artist_credit, durationS: songS });
  const value = { songS, ...ranked };
  await cachePut('youtube', cacheKey, 'hit', value, 14 * 86400);
  return json({ configured: true, ...value });
}

Deno.serve((req) => handle(req, async (body) => {
  const key = Deno.env.get('YOUTUBE_API_KEY');
  const trackId = String(body.track_id ?? '');
  if (!/^[0-9a-f-]{36}$/.test(trackId)) return json({ error: 'track_id required' }, 400);
  if (!key) return json({ configured: false, videos: [], originals: [], karaoke: [] });
  if (body.action === 'stage') return stage(trackId, key);

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
