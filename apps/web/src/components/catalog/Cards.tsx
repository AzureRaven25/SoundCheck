'use client';
import Link from 'next/link';
import { Mic2, Pause, Play } from 'lucide-react';
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

/** Small corner badge on a card: what you can do with the song. */
export type CardBadge = 'full' | 'karaoke' | null | undefined;
function Badge({ kind }: { kind: CardBadge }) {
  if (!kind) return null;
  return (
    <span className={clsx(
      'absolute left-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide backdrop-blur',
      kind === 'karaoke' ? 'stage-gradient text-white' : 'bg-ink-950/75 text-ink-50',
    )}>
      {kind === 'karaoke' ? <><Mic2 size={10} aria-hidden /> Sing</> : 'Full song'}
    </span>
  );
}

export function TrackCard({ t, list, badge }: { t: TrackItem; list?: TrackItem[]; badge?: CardBadge }) {
  const playTracks = usePlayer((s) => s.playTracks);
  return (
    <Link href={`/track/${t.id}`} className="group block rounded-xl p-2.5 transition-colors hover:bg-ink-800">
      <div className="relative mb-2.5 shadow-lift">
        <Artwork src={t.artwork_url} albumId={t.album_id} title={t.album_title ?? t.title} sizes="(max-width: 640px) 40vw, 180px" />
        <Badge kind={badge} />
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

export function EntityCard({ href, title, subtitle, artwork, albumId, artistId, round }: {
  href: string; title: string; subtitle?: string; artwork?: string | null; albumId?: string | null; artistId?: string | null; round?: boolean;
}) {
  return (
    <Link href={href} className="group block rounded-xl p-2.5 transition-colors hover:bg-ink-800">
      <div className="mb-2.5 shadow-lift">
        <Artwork src={artwork} albumId={albumId} artistId={artistId} title={title} rounded={round ? 'rounded-full' : 'rounded-md'} />
      </div>
      <p className="truncate text-sm font-bold">{title}</p>
      {subtitle && <p className="truncate text-xs text-ink-300">{subtitle}</p>}
    </Link>
  );
}

/**
 * A titled row of cards. `row` (default) scrolls sideways with snap points, so a shelf is one line on every screen;
 * `grid` wraps (used for result pages).
 */
export function Shelf({ title, subtitle, href, layout = 'row', children }: {
  title: string; subtitle?: string; href?: string; layout?: 'row' | 'grid'; children: React.ReactNode;
}) {
  return (
    <section className="mb-9" aria-label={title}>
      <div className="mb-3 flex items-end justify-between gap-4 px-0.5">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold tracking-tight md:text-2xl">{title}</h2>
          {subtitle && <p className="truncate text-sm text-ink-500">{subtitle}</p>}
        </div>
        {href && <Link href={href} className="shrink-0 text-xs font-bold text-ink-300 hover:text-ink-50 hover:underline">Show all</Link>}
      </div>
      {layout === 'grid' ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">{children}</div>
      ) : (
        <div className="scrollbar-thin -mx-2.5 flex snap-x snap-mandatory gap-1 overflow-x-auto pb-2 [&>*]:w-[42vw] [&>*]:shrink-0 [&>*]:snap-start sm:[&>*]:w-44 lg:[&>*]:w-48">
          {children}
        </div>
      )}
    </section>
  );
}
