'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Mic2 } from 'lucide-react';
import { Artwork } from '@/components/ui/Artwork';
import { formatDuration } from '@/lib/format';
import { useUser } from '@/lib/hooks/useUser';
import { supabaseBrowser } from '@/lib/supabase/client';
import { TRACK_SELECT, withArtworkClient, type Row } from '@/lib/track-mapping';
import type { TrackItem } from '@/lib/types';

/** Karaoke-ready songs as a list with a "Sing" button that opens SoundCheck Stage. */
export function SingRows({ tracks }: { tracks: TrackItem[] }) {
  return (
    <ul className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
      {tracks.map((t) => (
        <li key={t.id} className="flex items-center gap-3 rounded-xl p-2 hover:bg-ink-800">
          <div className="w-12 shrink-0"><Artwork src={t.artwork_url} albumId={t.album_id} title={t.album_title ?? t.title} sizes="48px" /></div>
          <div className="min-w-0 flex-1">
            <Link prefetch={false} href={`/track/${t.id}`} className="block truncate text-sm font-bold hover:underline">{t.title}</Link>
            <p className="truncate text-xs text-ink-300">{t.artist_credit} · {formatDuration(t.duration_ms)}</p>
          </div>
          <Link prefetch={false} href={`/stage/${t.id}`} aria-label={`Sing ${t.title}`}
            className="stage-gradient inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold text-white hover:scale-105">
            <Mic2 size={14} aria-hidden /> Sing
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The signed-in user's own karaoke tracks (from their uploads and imports). */
export function MyKaraoke() {
  const user = useUser();
  const [tracks, setTracks] = useState<TrackItem[] | null>(null);
  useEffect(() => {
    if (!user) return;
    const sb = supabaseBrowser();
    void (async () => {
      const { data } = await sb.from('karaoke_analysis')
        .select(`track_id, created_at, audio_assets!karaoke_analysis_source_asset_id_fkey!inner(owner_id), tracks(${TRACK_SELECT})`)
        .eq('audio_assets.owner_id', user.id).order('created_at', { ascending: false }).limit(60);
      const rows = ((data ?? []) as unknown as { tracks: Row | null }[]).map((r) => r.tracks).filter((r): r is Row => !!r);
      setTracks(await withArtworkClient(sb, rows));
    })();
  }, [user]);
  if (!user || !tracks) return null;
  return (
    <section className="mb-10">
      <h2 className="mb-3 font-display text-2xl font-bold">Your karaoke tracks</h2>
      {tracks.length ? <SingRows tracks={tracks} /> : (
        <p className="text-sm text-ink-300">
          None yet. <Link href="/import" className="underline">Import your music</Link> or open any song and upload your copy, and
          SoundCheck builds the karaoke version.
        </p>
      )}
    </section>
  );
}
