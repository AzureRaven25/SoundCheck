'use client';
import { useEffect, useState } from 'react';
import { Shelf, TrackCard } from './Cards';
import { useUser } from '@/lib/hooks/useUser';
import { supabaseBrowser } from '@/lib/supabase/client';
import { TRACK_SELECT, withArtworkClient, type Row } from '@/lib/track-mapping';
import type { TrackItem } from '@/lib/types';

/**
 * "Picked for you": other songs by the artists you've been playing (and favoriting), skipping songs you've
 * already played. Signed-in users only; hidden until there's some history.
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
      const [{ data: hist }, { data: favs }] = await Promise.all([
        sb.from('listening_history').select('track_id, tracks(artist_credit)').order('played_at', { ascending: false }).limit(100),
        sb.from('favorites').select('track_id, tracks(artist_credit)').order('created_at', { ascending: false }).limit(100),
      ]);
      type H = { track_id: string; tracks: { artist_credit: string } | null };
      const all = [...((favs ?? []) as unknown as H[]), ...((hist ?? []) as unknown as H[])];
      const heard = new Set(all.map((h) => h.track_id));
      const weight = new Map<string, number>();
      for (const h of all) if (h.tracks) weight.set(h.tracks.artist_credit, (weight.get(h.tracks.artist_credit) ?? 0) + 1);
      const artists = [...weight.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([a]) => a);
      if (!artists.length) return;
      const { data } = await sb.from('tracks').select(TRACK_SELECT).in('artist_credit', artists)
        .order('popularity', { ascending: false }).limit(80);
      // round-robin across artists so one prolific artist doesn't fill the shelf
      const byArtist = new Map<string, Row[]>();
      for (const r of (data ?? []) as unknown as Row[]) {
        if (heard.has(r.id)) continue;
        byArtist.set(r.artist_credit, [...(byArtist.get(r.artist_credit) ?? []), r]);
      }
      const picked: Row[] = [];
      for (let i = 0; picked.length < 12 && [...byArtist.values()].some((l) => l[i]); i++) {
        for (const a of artists) { const r = byArtist.get(a)?.[i]; if (r && picked.length < 12) picked.push(r); }
      }
      const items = await withArtworkClient(sb, picked);
      if (live) { setTracks(items); setBecause(artists[0] ?? null); }
    })();
    return () => { live = false; };
  }, [user]);
  if (!tracks.length) return null;
  return (
    <Shelf title="Picked for you" subtitle={because ? `Because you've been listening to ${because}` : undefined}>
      {tracks.map((t) => <TrackCard key={t.id} t={t} list={tracks} />)}
    </Shelf>
  );
}
