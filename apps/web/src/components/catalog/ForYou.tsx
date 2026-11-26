'use client';
import { useEffect, useState } from 'react';
import { Shelf, TrackCard } from './Cards';
import { useUser } from '@/lib/hooks/useUser';
import { supabaseBrowser } from '@/lib/supabase/client';
import { TRACK_SELECT, withArtworkClient, type Row } from '@/lib/track-mapping';
import type { TrackItem } from '@/lib/types';

/** Catalog rows for `ids`, in the order given. */
export async function tracksInOrder(sb: ReturnType<typeof supabaseBrowser>, ids: string[]): Promise<TrackItem[]> {
  if (!ids.length) return [];
  const { data } = await sb.from('tracks').select(TRACK_SELECT).in('id', ids);
  const byId = new Map(((data ?? []) as unknown as Row[]).map((r) => [r.id, r]));
  return withArtworkClient(sb, ids.map((id) => byId.get(id)).filter((r): r is Row => !!r));
}

/**
 * "Picked for you": songs by the artists you like most: what you play and favorite here, plus your imported
 * Spotify history (see recommended_tracks in supabase/migrations/20261126040001_listening_taste.sql).
 * Signed-in users only; hidden until there's some history.
 */
export function ForYou() {
  const user = useUser();
  const [tracks, setTracks] = useState<TrackItem[]>([]);
  const [because, setBecause] = useState<string | null>(null);
  useEffect(() => {
    if (!user) return;
    const sb = supabaseBrowser();
    let live = true;
    void (async () => {
      const { data } = await sb.rpc('recommended_tracks', { p_limit: 12 });
      const recs = data ?? [];
      if (!recs.length) return;
      const items = await tracksInOrder(sb, recs.map((r) => r.track_id));
      if (live) { setTracks(items); setBecause(recs[0]?.artist_name ?? null); }
    })();
    return () => { live = false; };
  }, [user]);
  if (!user || !tracks.length) return null;
  return (
    <Shelf title="Picked for you" subtitle={because ? `Because you've been listening to ${because}` : undefined}>
      {tracks.map((t) => <TrackCard key={t.id} t={t} list={tracks} />)}
    </Shelf>
  );
}
