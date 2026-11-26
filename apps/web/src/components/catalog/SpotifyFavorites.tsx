'use client';
import { useEffect, useState } from 'react';
import { Shelf, TrackCard } from './Cards';
import { tracksInOrder } from './ForYou';
import { useUser } from '@/lib/hooks/useUser';
import { supabaseBrowser } from '@/lib/supabase/client';
import { rankTaste } from '@/lib/spotify/rank';
import type { TrackItem } from '@/lib/types';

/** "From your Spotify": the songs you play most on Spotify that are in the catalog, ready to sing. */
export function SpotifyFavorites() {
  const user = useUser();
  const [tracks, setTracks] = useState<TrackItem[]>([]);
  useEffect(() => {
    if (!user) return;
    const sb = supabaseBrowser();
    let live = true;
    void (async () => {
      const { data } = await sb.from('taste_tracks').select('track_id, plays, skip_rate, last_played')
        .not('track_id', 'is', null).order('rank').limit(200);
      const ranked = rankTaste((data ?? []) as { track_id: string; plays: number; skip_rate: number; last_played: string }[]);
      const items = await tracksInOrder(sb, ranked.slice(0, 12).map((r) => r.track_id));
      if (live) setTracks(items);
    })();
    return () => { live = false; };
  }, [user]);
  if (!user || !tracks.length) return null;
  return (
    <Shelf title="From your Spotify" subtitle="Songs you play a lot, ready to sing">
      {tracks.map((t) => <TrackCard key={t.id} t={t} list={tracks} />)}
    </Shelf>
  );
}
