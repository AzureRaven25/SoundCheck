'use client';
import { supabaseBrowser } from './supabase/client';

/** Thrown when audio couldn't be resolved right now (provider busy, network): try again later. */
export class AudioTemporarilyUnavailable extends Error {}

export interface ResolvedAudio {
  url: string;
  kind: 'original' | 'preview';
  /** Store page to credit (previews). */
  attributionUrl: string | null;
}

const cache = new Map<string, ResolvedAudio | null>();

/**
 * Pick the best playable source a user may access for a track (AudioSourceProvider, docs/ARCHITECTURE.md):
 *   1. the user's own uploaded original (private Storage, short-lived signed URL)
 *   2. a shared licensed original (future licensed provider, `shared/` Storage prefix)
 *   3. a 30 s store preview (resolved on demand by the resolve-preview Edge Function)
 */
export async function resolveAudio(trackId: string): Promise<ResolvedAudio | null> {
  if (cache.has(trackId)) return cache.get(trackId)!;
  const sb = supabaseBrowser();
  const { data: assets } = await sb
    .from('audio_assets')
    .select('kind, storage_path, external_url, attribution_url, owner_id')
    .eq('track_id', trackId)
    .in('kind', ['original', 'preview']);

  const original = assets?.find((a) => a.kind === 'original' && a.storage_path);
  if (original?.storage_path) {
    const { data } = await sb.storage.from('audio').createSignedUrl(original.storage_path, 3600);
    if (data?.signedUrl) {
      const r: ResolvedAudio = { url: data.signedUrl, kind: 'original', attributionUrl: null };
      cache.set(trackId, r);
      return r;
    }
  }
  const preview = assets?.find((a) => a.kind === 'preview' && a.external_url);
  if (preview?.external_url) {
    const r: ResolvedAudio = { url: preview.external_url, kind: 'preview', attributionUrl: preview.attribution_url };
    cache.set(trackId, r);
    return r;
  }
  const { data, error } = await sb.functions.invoke<{ url: string | null; attribution_url: string | null; retry?: boolean }>('resolve-preview', {
    body: { track_id: trackId },
  });
  if (error || data?.retry) throw new AudioTemporarilyUnavailable('audio source busy'); // not cached: retry next time
  const r = data?.url ? { url: data.url, kind: 'preview' as const, attributionUrl: data.attribution_url } : null;
  cache.set(trackId, r); // definitive answer (including "no preview exists")
  return r;
}
