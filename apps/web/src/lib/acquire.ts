'use client';
import { supabaseBrowser } from './supabase/client';

/** One result from the acquire Edge Function (supabase/functions/_shared/acquisition.ts). */
export interface SourceCandidate {
  provider: string;
  external_id: string;
  title: string;
  artist: string;
  album: string | null;
  duration_ms: number | null;
  year: number | null;
  artwork: string | null;
  page_url: string | null;
  stream_url: string | null;
  availability: 'full' | 'preview' | 'metadata';
  license_url: string | null;
  karaoke_ok: boolean;
  format: string | null;
  attribution: string;
  /** set when this result is already in the catalog */
  track_id?: string | null;
}
export interface SourceStatus { id: string; label: string; ok: boolean; count: number; missing: string[]; error?: string }

export async function searchSources(q: string, limit = 8): Promise<{ results: SourceCandidate[]; sources: SourceStatus[] }> {
  const { data, error } = await supabaseBrowser().functions.invoke<{ results: SourceCandidate[]; sources: SourceStatus[] }>('acquire', {
    body: { action: 'search', q, limit },
  });
  if (error) throw error;
  return { results: data?.results ?? [], sources: data?.sources ?? [] };
}

/** Add a result to the catalog (idempotent, de-duplicated server-side); returns its track id. */
export async function importCandidate(c: Pick<SourceCandidate, 'provider' | 'external_id'>): Promise<string> {
  const { data, error } = await supabaseBrowser().functions.invoke<{ track_id: string }>('acquire', {
    body: { action: 'import', provider: c.provider, external_id: c.external_id },
  });
  if (error || !data?.track_id) throw error ?? new Error('import failed');
  return data.track_id;
}

/** Queue karaoke processing for a song with an open-licensed full recording. */
export async function prepareKaraoke(trackId: string): Promise<void> {
  const { error } = await supabaseBrowser().functions.invoke('acquire', { body: { action: 'prepare', track_id: trackId } });
  if (error) throw error;
}

/** Display name for a source provider. */
export const PROVIDER_LABEL: Record<string, string> = {
  upload: 'Your copy', internet_archive: 'Internet Archive', audius: 'Audius', jamendo: 'Jamendo', openverse: 'Openverse',
  ccmixter: 'ccMixter', deezer: 'Deezer', youtube: 'YouTube', apple_music: 'Apple Music', itunes: 'iTunes',
};

/** Playback preference among full-length sources: files we may also process first, then stream-only. */
export const FULL_SOURCE_ORDER = ['internet_archive', 'jamendo', 'openverse', 'audius'];

export type AvailabilityLevel = 'karaoke_ready' | 'karaoke_ok' | 'full' | 'preview' | 'catalog';
export interface Availability { track_id: string; level: AvailabilityLevel; full_sources: string[]; karaoke_ok: boolean; karaoke_ready: boolean; has_preview: boolean }

export async function trackAvailability(ids: string[]): Promise<Map<string, Availability>> {
  if (!ids.length) return new Map();
  const { data } = await supabaseBrowser().rpc('track_availability', { p_ids: ids.slice(0, 200) });
  return new Map(((data ?? []) as Availability[]).map((a) => [a.track_id, a]));
}
