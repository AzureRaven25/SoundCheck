'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import clsx from 'clsx';
import { ListMusic, Plus } from 'lucide-react';
import { TrackList } from '@/components/catalog/TrackList';
import { SungHistory } from '@/components/catalog/SungHistory';
import { useLibrary } from '@/lib/hooks/useLibrary';
import { supabaseBrowser } from '@/lib/supabase/client';
import { TRACK_SELECT, withArtworkClient, type Row } from '@/lib/track-mapping';
import type { TrackItem } from '@/lib/types';

const TABS = [
  { id: 'favorites', label: 'Favorites' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'history', label: 'Listened' },
  { id: 'sung', label: 'Sung' },
  { id: 'music', label: 'Your music' },
] as const;

function LibraryInner() {
  const tab = (useSearchParams().get('tab') ?? 'favorites') as (typeof TABS)[number]['id'];
  const router = useRouter();
  const { userId, favorites, playlists, createPlaylist } = useLibrary();
  const [tracks, setTracks] = useState<TrackItem[] | null>(null);

  useEffect(() => {
    if (!userId || tab === 'playlists' || tab === 'sung') return;
    const sb = supabaseBrowser();
    setTracks(null);
    void (async () => {
      if (tab === 'favorites') {
        const { data } = await sb.from('favorites').select(`created_at, tracks(${TRACK_SELECT})`).order('created_at', { ascending: false }).limit(500);
        setTracks(await withArtworkClient(sb, ((data ?? []) as unknown as { tracks: Row | null }[]).flatMap((f) => (f.tracks ? [f.tracks] : []))));
      } else if (tab === 'music') {
        // songs you uploaded or imported (your own copies, newest first)
        const { data } = await sb.from('audio_assets').select(`created_at, tracks(${TRACK_SELECT})`).eq('owner_id', userId)
          .eq('kind', 'original').order('created_at', { ascending: false }).limit(1000);
        const seen = new Set<string>();
        const rows = ((data ?? []) as unknown as { tracks: Row | null }[]).flatMap((a) => (a.tracks && !seen.has(a.tracks.id) && seen.add(a.tracks.id) ? [a.tracks] : []));
        setTracks(await withArtworkClient(sb, rows));
      } else {
        const { data } = await sb.from('listening_history').select(`played_at, tracks(${TRACK_SELECT})`).order('played_at', { ascending: false }).limit(200);
        setTracks(await withArtworkClient(sb, ((data ?? []) as unknown as { tracks: Row | null }[]).flatMap((h) => (h.tracks ? [h.tracks] : []))));
      }
    })();
    // favorites.size: refresh the list when a heart is toggled elsewhere
  }, [userId, tab, tab === 'favorites' ? favorites.size : 0]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="pt-4">
      <h1 className="mb-6 font-display text-4xl font-extrabold tracking-tight">Your Library</h1>
      <div role="tablist" className="mb-8 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            href={`/library?tab=${t.id}`}
            className={clsx('rounded-full px-4 py-1.5 text-sm font-bold', tab === t.id ? 'bg-ink-50 text-ink-950' : 'bg-ink-800 text-ink-50 hover:bg-ink-700')}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {tab === 'sung' ? (userId ? <SungHistory userId={userId} /> : <p className="text-ink-300">Loading…</p>) : tab === 'playlists' ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <button
            type="button"
            onClick={async () => {
              const id = await createPlaylist(`My Playlist #${playlists.length + 1}`);
              if (id) router.push(`/playlist/${id}`);
            }}
            className="flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink-700 text-ink-300 hover:border-ink-300 hover:text-ink-50"
          >
            <Plus size={32} /> <span className="text-sm font-bold">New playlist</span>
          </button>
          {playlists.map((p) => (
            <Link key={p.id} href={`/playlist/${p.id}`} className="rounded-lg bg-ink-850 p-3 hover:bg-ink-800">
              <div className="stage-gradient mb-3 flex aspect-square items-center justify-center rounded-md"><ListMusic size={48} /></div>
              <p className="truncate text-sm font-bold">{p.title}</p>
              <p className="text-xs text-ink-300">{p.is_public ? 'Public' : 'Private'} playlist</p>
            </Link>
          ))}
        </div>
      ) : tracks === null ? (
        <p className="text-ink-300">Loading…</p>
      ) : tracks.length === 0 ? (
        <p className="text-ink-300">
          {tab === 'favorites' ? 'Tap the heart on any song to save it here.'
            : tab === 'music' ? <>Songs you upload or <Link href="/import" className="underline">import</Link> show up here.</>
            : 'Songs you play will show up here.'}
        </p>
      ) : (
        <TrackList tracks={tracks} numbered={tab === 'favorites'} />
      )}
    </div>
  );
}

export default function LibraryPage() {
  return <Suspense><LibraryInner /></Suspense>;
}
