'use client';
import { useEffect, useState } from 'react';
import { Shelf, TrackCard } from './Cards';
import { tracksInOrder } from './ForYou';
import { useUser } from '@/lib/hooks/useUser';
import { supabaseBrowser } from '@/lib/supabase/client';
import { rankTaste } from '@/lib/taste/rank';
import { SOURCE_LABEL, type TasteSource } from '@/lib/taste/summary';
import type { TrackItem } from '@/lib/types';

/** "From your Spotify" (or Apple Music, …): the songs you play most elsewhere that are in the catalog, ready to sing. */
export function TopSongs() {
  const user = useUser();
  const [tracks, setTracks] = useState<TrackItem[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  useEffect(() => {
    if (!user) return;
    const sb = supabaseBrowser();
    let live = true;
    void (async () => {
      const { data } = await sb.from('taste_tracks').select('track_id, source, plays, skip_rate, last_played')
        .not('track_id', 'is', null).order('rank').limit(400);
      const rows = (data ?? []) as { track_id: string; source: string; plays: number; skip_rate: number; last_played: string }[];
      const ranked = rankTaste(rows).slice(0, 12);
      const items = await tracksInOrder(sb, ranked.map((r) => r.track_id));
      if (live) { setTracks(items); setSources([...new Set(rows.map((r) => r.source))]); }
    })();
    return () => { live = false; };
  }, [user]);
  if (!user || !tracks.length) return null;
  const title = sources.length === 1 ? `From your ${SOURCE_LABEL[sources[0] as TasteSource] ?? 'music'}` : 'From your listening';
  return (
    <Shelf title={title} subtitle="Songs you play a lot, ready to sing">
      {tracks.map((t) => <TrackCard key={t.id} t={t} list={tracks} />)}
    </Shelf>
  );
}
