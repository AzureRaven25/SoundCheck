/**
 * resolve-preview: find a 30-second store preview for a track (iTunes Search API) and register it as
 * a shared `preview` audio asset, so the catalog is playable before anyone uploads their own copy.
 * Previews are listen-only (never processed for karaoke) and must credit the store (attribution_url).
 *
 * POST { track_id: uuid }  →  { url: string | null, attribution_url: string | null }
 */
import { pickPreview, type ItunesSong } from '../_shared/preview.ts';
import { adminClient, cacheGet, cachePut, DAY, handle, json, providerFetch, ProviderBusyError } from '../_shared/runtime.ts';

Deno.serve((req) =>
  handle(req, async (body) => {
    const trackId = typeof body.track_id === 'string' ? body.track_id : '';
    if (!trackId) return json({ error: 'track_id required' }, 400);
    const db = adminClient();

    const { data: existing } = await db.from('audio_assets').select('external_url, attribution_url')
      .eq('track_id', trackId).eq('kind', 'preview').is('owner_id', null).maybeSingle();
    if (existing) return json({ url: existing.external_url, attribution_url: existing.attribution_url });
    if ((await cacheGet('itunes', `preview:${trackId}`))?.status === 'miss') return json({ url: null, attribution_url: null });

    const { data: track } = await db.from('tracks').select('title, artist_credit, duration_ms').eq('id', trackId).maybeSingle();
    if (!track) return json({ error: 'track not found' }, 404);

    const term = `${track.artist_credit} ${track.title}`.slice(0, 120);
    // User-initiated (someone pressed play): allowed to wait longer for an iTunes slot than background artwork.
    let res: Response;
    try {
      res = await providerFetch('itunes', `https://itunes.apple.com/search?media=music&entity=song&limit=15&term=${encodeURIComponent(term)}`, {}, 8000, 10000);
    } catch (e) {
      if (e instanceof ProviderBusyError) return json({ url: null, attribution_url: null, retry: true });
      throw e;
    }
    if (!res.ok) return json({ url: null, attribution_url: null, retry: true, warning: `itunes ${res.status}` });
    const pick = pickPreview(((await res.json()) as { results?: ItunesSong[] }).results ?? [], track.title, track.artist_credit, track.duration_ms);
    if (!pick) {
      await cachePut('itunes', `preview:${trackId}`, 'miss', null, 14 * DAY);
      return json({ url: null, attribution_url: null });
    }
    const { error } = await db.from('audio_assets').insert({
      track_id: trackId, owner_id: null, kind: 'preview', provider: 'itunes_preview',
      external_url: pick.previewUrl, attribution_url: pick.trackViewUrl, mime_type: 'audio/mp4', duration_ms: 30000,
    });
    if (error && error.code !== '23505') throw error; // 23505: another request registered it first
    return json({ url: pick.previewUrl, attribution_url: pick.trackViewUrl });
  })
);
