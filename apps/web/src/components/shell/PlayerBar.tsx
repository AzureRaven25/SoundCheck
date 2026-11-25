'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  Heart, ListMusic, Loader2, Mic2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX,
} from 'lucide-react';
import { Artwork } from '@/components/ui/Artwork';
import { formatSeconds } from '@/lib/format';
import { useLibrary } from '@/lib/hooks/useLibrary';
import { usePlayer, useCurrentTrack } from '@/player/store';
import { trackAvailability } from '@/lib/acquire';

function IconButton({ label, active, onClick, children, disabled }: {
  label: string; active?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={clsx('rounded-full p-2 transition-colors disabled:opacity-30', active ? 'text-pink-500' : 'text-ink-300 hover:text-ink-50')}
    >
      {children}
    </button>
  );
}

/** Small "Sing" shortcut to SoundCheck Stage when the playing song has a karaoke version. */
function SingChip({ trackId }: { trackId: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true; // keyed by track, so state starts fresh for each song
    void trackAvailability([trackId]).then((m) => { if (live) setReady(!!m.get(trackId)?.karaoke_ready); }).catch(() => {});
    return () => { live = false; };
  }, [trackId]);
  if (!ready) return null;
  return (
    <Link href={`/stage/${trackId}`} className="stage-gradient inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-bold text-white hover:scale-105">
      <Mic2 size={12} aria-hidden /> Sing
    </Link>
  );
}

/** Space plays/pauses, ←/→ seek 10 s, Shift+←/→ previous/next, M mutes (not while typing). */
function useMediaKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || !el) return;
      if (el.closest('input, textarea, select, [contenteditable="true"], button, a, [role="slider"]')) return;
      const p = usePlayer.getState();
      if (!p.queue.items.length) return;
      if (e.code === 'Space') { e.preventDefault(); p.toggle(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (e.shiftKey) p.nextTrack(); else p.seek(Math.min(p.duration || Infinity, p.position + 10)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); if (e.shiftKey) p.previousTrack(); else p.seek(Math.max(0, p.position - 10)); }
      else if (e.key === 'm' || e.key === 'M') p.toggleMute();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function PlayerBar({ signedIn }: { signedIn: boolean }) {
  const track = useCurrentTrack();
  const p = usePlayer();
  const favorites = useLibrary((s) => s.favorites);
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);
  const liked = track ? favorites.has(track.id) : false;
  const VolumeIcon = p.muted || p.volume === 0 ? VolumeX : p.volume < 0.5 ? Volume1 : Volume2;
  const pct = p.duration ? (p.position / p.duration) * 100 : 0;
  useMediaKeys();
  // nothing playing or queued yet: no empty player taking up the bottom of the screen
  if (!track) return null;

  return (
    <footer className="grid h-[76px] grid-cols-[1fr_auto] items-center gap-4 px-2 md:grid-cols-[minmax(180px,1fr)_minmax(320px,2fr)_minmax(180px,1fr)]" aria-label="Player">
      <div className="flex min-w-0 items-center gap-3">
        {track ? (
          <>
            <div className="w-14 shrink-0">
              <Artwork src={track.artworkUrl} albumId={track.albumId} title={track.title} />
            </div>
            <div className="min-w-0">
              <Link href={`/track/${track.id}`} className="block truncate text-sm font-bold hover:underline">{track.title}</Link>
              <p className="truncate text-xs text-ink-300">{track.artist}</p>
            </div>
            {!track.id.startsWith('server:') && <SingChip key={track.id} trackId={track.id} />}
            {signedIn && (
              <IconButton label={liked ? 'Remove from favorites' : 'Save to favorites'} active={liked} onClick={() => void toggleFavorite(track.id)}>
                <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
              </IconButton>
            )}
          </>
        ) : (
          <p className="px-2 text-sm text-ink-500">Pick a song to start listening</p>
        )}
      </div>

      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-2">
          <IconButton label="Shuffle" active={p.queue.shuffle} onClick={p.toggleShuffle} disabled={!track}>
            <Shuffle size={18} />
          </IconButton>
          <IconButton label="Previous" onClick={p.previousTrack} disabled={!track}>
            <SkipBack size={20} fill="currentColor" />
          </IconButton>
          <button
            type="button"
            aria-label={p.playing ? 'Pause' : 'Play'}
            disabled={!track}
            onClick={p.toggle}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-50 text-ink-950 transition-transform hover:scale-105 disabled:opacity-30"
          >
            {p.playing && p.load === 'loading' ? (
              <Loader2 size={18} className="animate-spin" />
            ) : p.playing ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" className="translate-x-px" />
            )}
          </button>
          <IconButton label="Next" onClick={() => p.nextTrack()} disabled={!track}>
            <SkipForward size={20} fill="currentColor" />
          </IconButton>
          <IconButton
            label={p.queue.repeat === 'one' ? 'Repeat one' : p.queue.repeat === 'all' ? 'Repeat all' : 'Repeat off'}
            active={p.queue.repeat !== 'off'}
            onClick={p.cycleRepeat}
            disabled={!track}
          >
            {p.queue.repeat === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
          </IconButton>
        </div>
        <div className="hidden w-full max-w-xl items-center gap-2 text-[11px] text-ink-300 md:flex">
          <span className="w-10 text-right tabular-nums">{formatSeconds(p.position)}</span>
          <input
            type="range"
            min={0}
            max={p.duration || 1}
            step={0.1}
            value={Math.min(p.position, p.duration || 1)}
            onChange={(e) => p.seek(Number(e.target.value))}
            disabled={!track || !p.duration}
            aria-label="Seek"
            className="h-1 flex-1"
            style={{ background: `linear-gradient(to right, var(--color-ink-50) ${pct}%, var(--color-ink-700) ${pct}%)` }}
          />
          <span className="w-10 tabular-nums">{formatSeconds(p.duration)}</span>
        </div>
        {track && p.load === 'error' && (
          <p className="text-[11px] text-gold-400" role="status">
            Couldn&apos;t load this song right now.{' '}
            <button type="button" className="underline" onClick={p.retry}>Try again</button>
          </p>
        )}
        {track && p.load === 'unavailable' && (
          <p className="text-[11px] text-gold-400" role="status">No playable audio for this song yet. Upload your copy to play it in full.</p>
        )}
        {track && p.sourceKind === 'preview' && p.load !== 'unavailable' && (
          <p className="text-[11px] text-ink-500">
            <span data-testid="source-label">30-second preview</span> ·{' '}
            {p.attributionUrl && (
              <a href={p.attributionUrl} target="_blank" rel="noreferrer" className="underline hover:text-ink-300">Listen on Apple Music</a>
            )}
          </p>
        )}
        {track && p.sourceKind === 'full' && p.load !== 'unavailable' && (
          <p className="text-[11px] text-ink-500" data-testid="source-label">
            Full track ·{' '}
            {p.attributionUrl ? <a href={p.attributionUrl} target="_blank" rel="noreferrer" className="underline hover:text-ink-300">{p.sourceLabel}</a> : p.sourceLabel}
          </p>
        )}
      </div>

      <div className="hidden items-center justify-end gap-1 md:flex">
        <IconButton label="Queue" active={p.queueOpen} onClick={p.toggleQueue}>
          <ListMusic size={18} />
        </IconButton>
        <IconButton label={p.muted ? 'Unmute' : 'Mute'} onClick={p.toggleMute}>
          <VolumeIcon size={18} />
        </IconButton>
        <input
          type="range" min={0} max={1} step={0.01} value={p.muted ? 0 : p.volume}
          onChange={(e) => p.setVolume(Number(e.target.value))} aria-label="Volume" className="h-1 w-24"
        />
      </div>
    </footer>
  );
}
