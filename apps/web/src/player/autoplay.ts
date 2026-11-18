'use client';
import { supabaseBrowser } from '@/lib/supabase/client';
import { TRACK_SELECT, withArtworkClient, type Row } from '@/lib/track-mapping';
import { toQueueTrack } from '@/lib/types';
import type { QueueTrack } from './queue';

/**
 * Songs to keep going with when the queue runs out: more by the same artist first, then songs that play in full
 * for everyone (open sources), skipping anything already in the queue.
 */
export async function suggestAfter(current: QueueTrack, exclude: string[], count = 8): Promise<QueueTrack[]> {
  const sb = supabaseBrowser();
  const skip = new Set(exclude);
  const picked: Row[] = [];
  if (!current.id.startsWith('server:')) {
    const { data } = await sb.from('tracks').select(TRACK_SELECT).eq('artist_credit', current.artist)
      .order('popularity', { ascending: false }).limit(20);
    for (const r of (data ?? []) as unknown as Row[]) if (!skip.has(r.id) && picked.length < Math.ceil(count / 2)) { picked.push(r); skip.add(r.id); }
  }
  const { data: src } = await sb.from('track_sources').select('track_id')
    .in('provider', ['openverse', 'audius', 'internet_archive']).not('stream_url', 'is', null)
    .order('created_at', { ascending: false }).limit(200);
  const ids = [...new Set((src ?? []).map((s) => s.track_id as string))].filter((i) => !skip.has(i));
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j]!, ids[i]!]; }
  const want = ids.slice(0, count - picked.length);
  if (want.length) {
    const { data } = await sb.from('tracks').select(TRACK_SELECT).in('id', want);
    picked.push(...((data ?? []) as unknown as Row[]));
  }
  return (await withArtworkClient(sb, picked)).map(toQueueTrack);
}
