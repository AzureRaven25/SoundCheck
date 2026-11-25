'use client';
import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import clsx from 'clsx';
import { Clock3, Heart, ListEnd, ListPlus, ListStart, Mic2, MoreHorizontal, Pause, Play } from 'lucide-react';
import { trackAvailability, type Availability } from '@/lib/acquire';
import { Artwork } from '@/components/ui/Artwork';
import { formatDuration } from '@/lib/format';
import { useLibrary } from '@/lib/hooks/useLibrary';
import { toQueueTrack, type TrackItem } from '@/lib/types';
import { usePlayer, useCurrentTrack } from '@/player/store';

function ArtistLinks({ t }: { t: TrackItem }) {
  if (!t.artists?.length) return <>{t.artist_credit}</>;
  return (
    <>
      {t.artists.map((a) => (
        <Fragment key={a.id}>
          <Link prefetch={false} href={`/artist/${a.id}`} className="hover:text-ink-50 hover:underline" onClick={(e) => e.stopPropagation()}>{a.name}</Link>
          {a.join_phrase}
        </Fragment>
      ))}
    </>
  );
}

/** Tiny tag after a title: "Sing" when a karaoke version is ready, "Full" when the whole song plays here. */
function AvailabilityTag({ a }: { a: Availability | undefined }) {
  if (!a) return null;
  if (a.karaoke_ready) {
    return <span className="stage-gradient inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-px text-[10px] font-bold uppercase text-white" title="Karaoke version ready"><Mic2 size={10} aria-hidden />Sing</span>;
  }
  if (a.full_sources.length) {
    return <span className="inline-flex shrink-0 rounded border border-ink-500 px-1 py-px text-[10px] font-bold uppercase text-ink-300" title="Plays in full">Full</span>;
  }
  return null;
}

function RowMenu({ t, onClose }: { t: TrackItem; onClose: () => void }) {
  const playNext = usePlayer((s) => s.playNext);
  const addToQueue = usePlayer((s) => s.addToQueue);
  const { userId, playlists, addToPlaylist } = useLibrary();
  const item = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-700';
  const [note, setNote] = useState<string | null>(null);
  const add = async (id: string, title: string) => {
    const r = await addToPlaylist(id, t.id);
    setNote(r === 'added' ? `Added to ${title}` : r === 'exists' ? `Already in ${title}` : 'Couldn’t add it. Try again.');
    setTimeout(onClose, 1200);
  };
  return (
    <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-56 rounded-md bg-ink-800 py-1 shadow-lift" onMouseLeave={onClose}>
      {note && <p role="status" className="px-3 py-2 text-sm font-bold text-success-400">{note}</p>}
      <button role="menuitem" type="button" className={item} onClick={() => { playNext(toQueueTrack(t)); onClose(); }}>
        <ListStart size={16} /> Play next
      </button>
      <button role="menuitem" type="button" className={item} onClick={() => { addToQueue(toQueueTrack(t)); onClose(); }}>
        <ListEnd size={16} /> Add to queue
      </button>
      {userId && playlists.length > 0 && (
        <div className="border-t border-ink-700 py-1">
          <p className="px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-ink-500">Add to playlist</p>
          {playlists.slice(0, 8).map((p) => (
            <button key={p.id} role="menuitem" type="button" className={item} onClick={() => void add(p.id, p.title)}>
              <ListPlus size={16} /> <span className="truncate">{p.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Track table used by search, albums, artists, playlists, favorites and history. Clicking a row plays
 * the whole list from that song (so Next continues through the list, Spotify-style).
 */
export function TrackList({
  tracks, showArtwork = true, showAlbum = true, numbered = true, onRemove,
}: {
  tracks: TrackItem[]; showArtwork?: boolean; showAlbum?: boolean; numbered?: boolean; onRemove?: (t: TrackItem, i: number) => void;
}) {
  const playTracks = usePlayer((s) => s.playTracks);
  const toggle = usePlayer((s) => s.toggle);
  const playing = usePlayer((s) => s.playing);
  const current = useCurrentTrack();
  const { userId, favorites, toggleFavorite } = useLibrary();
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [avail, setAvail] = useState<Map<string, Availability>>(new Map());
  const idKey = tracks.map((t) => t.id).join(',');
  useEffect(() => {
    let live = true;
    void trackAvailability(idKey ? idKey.split(',') : []).then((m) => { if (live) setAvail(m); }).catch(() => {});
    return () => { live = false; };
  }, [idKey]);

  if (!tracks.length) return null;
  return (
    <div role="table" aria-label="Tracks" className="text-sm">
      <div role="row" className="mb-2 grid grid-cols-[2rem_1fr_auto] items-center gap-4 border-b border-ink-800 px-3 pb-2 text-xs font-bold uppercase tracking-widest text-ink-500 md:grid-cols-[2rem_6fr_4fr_auto]">
        <span role="columnheader">#</span>
        <span role="columnheader">Title</span>
        {showAlbum ? <span role="columnheader" className="hidden md:block">Album</span> : <span className="hidden md:block" />}
        <span role="columnheader" className="flex justify-end pr-14"><Clock3 size={14} aria-label="Duration" /></span>
      </div>
      {tracks.map((t, i) => {
        const isCurrent = current?.id === t.id;
        const liked = favorites.has(t.id);
        return (
          <div
            role="row"
            key={`${t.id}-${i}`}
            onDoubleClick={() => playTracks(tracks.map(toQueueTrack), i)}
            className={clsx(
              'group relative grid grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-md px-2 py-2 hover:bg-ink-800 sm:gap-4 sm:px-3 md:grid-cols-[2rem_6fr_4fr_auto]',
              menuFor === i && 'bg-ink-800',
            )}
          >
            <div role="cell" className="relative flex h-6 items-center justify-center text-ink-300">
              <span className={clsx('tabular-nums group-hover:invisible [@media(hover:none)]:invisible', isCurrent && 'text-pink-500')}>{numbered ? i + 1 : '•'}</span>
              <button
                type="button"
                aria-label={isCurrent && playing ? `Pause ${t.title}` : `Play ${t.title}`}
                onClick={() => (isCurrent ? toggle() : playTracks(tracks.map(toQueueTrack), i))}
                // touch screens have no hover: the play button is always shown there
                className="invisible absolute inset-0 flex items-center justify-center text-ink-50 group-hover:visible focus:visible [@media(hover:none)]:visible"
              >
                {isCurrent && playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
              </button>
            </div>
            <div role="cell" className="flex min-w-0 items-center gap-3">
              {showArtwork && (
                <div className="w-10 shrink-0"><Artwork src={t.artwork_url} albumId={t.album_id} title={t.album_title ?? t.title} sizes="40px" /></div>
              )}
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <Link prefetch={false} href={`/track/${t.id}`} className={clsx('truncate font-medium hover:underline', isCurrent ? 'text-pink-400' : 'text-ink-50')}>
                    {t.title}
                  </Link>
                  <AvailabilityTag a={avail.get(t.id)} />
                </div>
                <p className="truncate text-ink-300"><ArtistLinks t={t} /></p>
              </div>
            </div>
            <div role="cell" className="hidden min-w-0 truncate text-ink-300 md:block">
              {showAlbum && t.album_id && t.album_title ? (
                <Link prefetch={false} href={`/album/${t.album_id}`} className="hover:text-ink-50 hover:underline">{t.album_title}</Link>
              ) : null}
            </div>
            <div role="cell" className="flex items-center justify-end gap-2 text-ink-300">
              {userId && (
                <button
                  type="button"
                  aria-label={liked ? `Remove ${t.title} from favorites` : `Save ${t.title} to favorites`}
                  aria-pressed={liked}
                  onClick={() => void toggleFavorite(t.id)}
                  className={clsx('p-1', liked ? 'text-pink-500' : 'invisible max-sm:hidden hover:text-ink-50 group-hover:visible focus:visible')}
                >
                  <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
                </button>
              )}
              <span className="hidden w-12 text-right tabular-nums sm:inline">{formatDuration(t.duration_ms)}</span>
              <div className="relative">
                <button
                  type="button"
                  aria-label={`More options for ${t.title}`}
                  aria-haspopup="menu"
                  onClick={() => setMenuFor(menuFor === i ? null : i)}
                  className="invisible p-1 hover:text-ink-50 group-hover:visible focus:visible [@media(hover:none)]:visible"
                >
                  <MoreHorizontal size={18} />
                </button>
                {menuFor === i && <RowMenu t={t} onClose={() => setMenuFor(null)} />}
              </div>
              {onRemove && (
                <button type="button" aria-label={`Remove ${t.title}`} onClick={() => onRemove(t, i)} className="invisible p-1 text-xs hover:text-danger-400 group-hover:visible focus:visible">
                  Remove
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
