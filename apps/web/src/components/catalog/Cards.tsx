'use client';
import Link from 'next/link';
import { Pause, Play } from 'lucide-react';
import clsx from 'clsx';
import { Artwork } from '@/components/ui/Artwork';
import { toQueueTrack, type TrackItem } from '@/lib/types';
import { usePlayer, useCurrentTrack } from '@/player/store';

/** Big round play button: plays `tracks` from the start, or pauses if one of them is playing. */
export function PlayButton({ tracks, size = 'md', label = 'Play' }: { tracks: TrackItem[]; size?: 'md' | 'lg'; label?: string }) {
  const playTracks = usePlayer((s) => s.playTracks);
  const toggle = usePlayer((s) => s.toggle);
  const playing = usePlayer((s) => s.playing);
  const current = useCurrentTrack();
  const active = !!current && tracks.some((t) => t.id === current.id);
  return (
    <button
      type="button"
      aria-label={active && playing ? 'Pause' : label}
      disabled={!tracks.length}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (active) toggle();
        else playTracks(tracks.map(toQueueTrack), 0);
      }}
      className={clsx(
        'flex items-center justify-center rounded-full bg-pink-500 text-ink-950 shadow-lift transition-transform hover:scale-105 disabled:opacity-40',
        size === 'lg' ? 'h-14 w-14' : 'h-11 w-11',
      )}
    >
      {active && playing ? <Pause size={size === 'lg' ? 24 : 20} fill="currentColor" /> : <Play size={size === 'lg' ? 24 : 20} fill="currentColor" className="translate-x-0.5" />}
    </button>
  );
}

export function TrackCard({ t, list }: { t: TrackItem; list?: TrackItem[] }) {
  const playTracks = usePlayer((s) => s.playTracks);
  return (
    <Link href={`/track/${t.id}`} className="group block rounded-lg bg-ink-850 p-3 transition-colors hover:bg-ink-800">
      <div className="relative mb-3 shadow-lift">
        <Artwork src={t.artwork_url} albumId={t.album_id} title={t.album_title ?? t.title} />
        <div
          className="absolute bottom-2 right-2 translate-y-2 opacity-0 transition-all group-hover:translate-y-0 group-hover:opacity-100 focus-within:translate-y-0 focus-within:opacity-100"
          onClick={(e) => {
            e.preventDefault();
            const l = list ?? [t];
            playTracks(l.map(toQueueTrack), Math.max(0, l.findIndex((x) => x.id === t.id)));
          }}
        >
          <PlayButton tracks={[t]} label={`Play ${t.title}`} />
        </div>
      </div>
      <p className="truncate text-sm font-bold">{t.title}</p>
      <p className="truncate text-xs text-ink-300">{t.artist_credit}{t.release_year ? ` · ${t.release_year}` : ''}</p>
    </Link>
  );
}

export function EntityCard({ href, title, subtitle, artwork, albumId, round }: {
  href: string; title: string; subtitle?: string; artwork?: string | null; albumId?: string | null; round?: boolean;
}) {
  return (
    <Link href={href} className="group block rounded-lg bg-ink-850 p-3 transition-colors hover:bg-ink-800">
      <div className="mb-3 shadow-lift">
        <Artwork src={artwork} albumId={albumId} title={title} rounded={round ? 'rounded-full' : 'rounded-md'} />
      </div>
      <p className="truncate text-sm font-bold">{title}</p>
      {subtitle && <p className="truncate text-xs text-ink-300">{subtitle}</p>}
    </Link>
  );
}

export function Shelf({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-end justify-between">
        <h2 className="font-display text-2xl font-bold tracking-tight">{title}</h2>
        {href && <Link href={href} className="text-xs font-bold text-ink-300 hover:underline">Show all</Link>}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">{children}</div>
    </section>
  );
}
