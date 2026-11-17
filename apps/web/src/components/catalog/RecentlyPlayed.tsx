'use client';
import { useEffect, useState } from 'react';
import { Shelf, TrackCard } from './Cards';
import { useUser } from '@/lib/hooks/useUser';
import { supabaseBrowser } from '@/lib/supabase/client';
import { TRACK_SELECT, withArtworkClient, type Row } from '@/lib/track-mapping';
import type { TrackItem } from '@/lib/types';

/** Last distinct songs the signed-in user played (any platform). Hidden when signed out or empty. */
export function RecentlyPlayed() {
  const user = useUser();
  const [tracks, setTracks] = useState<TrackItem[]>([]);
  useEffect(() => {
    if (!user) {
      setTracks([]);
      return;
    }
    const sb = supabaseBrowser();
    void (async () => {
      const { data } = await sb.from('listening_history').select(`played_at, tracks(${TRACK_SELECT})`)
        .order('played_at', { ascending: false }).limit(50);
      const seen = new Set<string>();
      const rows: Row[] = [];
      for (const h of (data ?? []) as unknown as { tracks: Row | null }[]) {
        if (h.tracks && !seen.has(h.tracks.id)) {
          seen.add(h.tracks.id);
          rows.push(h.tracks);
        }
      }
      setTracks(await withArtworkClient(sb, rows.slice(0, 6)));
    })();
  }, [user]);
  if (!tracks.length) return null;
  return (
    <Shelf title="Recently played" href="/library?tab=history">
      {tracks.map((t) => <TrackCard key={t.id} t={t} list={tracks} />)}
    </Shelf>
  );
}
