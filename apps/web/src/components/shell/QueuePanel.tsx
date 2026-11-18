'use client';
import { X } from 'lucide-react';
import { Artwork } from '@/components/ui/Artwork';
import { upNext } from '@/player/queue';
import { usePlayer, useCurrentTrack } from '@/player/store';

export function QueuePanel() {
  const open = usePlayer((s) => s.queueOpen);
  const queue = usePlayer((s) => s.queue);
  const jump = usePlayer((s) => s.jump);
  const remove = usePlayer((s) => s.remove);
  const toggle = usePlayer((s) => s.toggleQueue);
  const autoplay = usePlayer((s) => s.autoplay);
  const setAutoplay = usePlayer((s) => s.setAutoplay);
  const current = useCurrentTrack();
  if (!open) return null;
  const upcoming = upNext(queue);

  return (
    <aside aria-label="Queue" className="scrollbar-thin w-80 shrink-0 overflow-y-auto border-l border-ink-800 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">Queue</h2>
        <button type="button" aria-label="Close queue" onClick={toggle} className="rounded-full p-1 text-ink-300 hover:text-ink-50">
          <X size={18} />
        </button>
      </div>
      <label className="mb-5 flex items-center justify-between gap-3 rounded-lg bg-ink-850 px-3 py-2 text-sm">
        <span>
          <span className="block font-bold">Autoplay</span>
          <span className="block text-xs text-ink-500">Keep going with similar songs when the queue ends</span>
        </span>
        <input type="checkbox" role="switch" checked={autoplay} onChange={(e) => setAutoplay(e.target.checked)} className="size-4 accent-pink-500" />
      </label>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-ink-500">Now playing</h3>
      {current ? (
        <div className="mb-6 flex items-center gap-3">
          <div className="w-12 shrink-0"><Artwork src={current.artworkUrl} albumId={current.albumId} title={current.title} /></div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-pink-400">{current.title}</p>
            <p className="truncate text-xs text-ink-300">{current.artist}</p>
          </div>
        </div>
      ) : (
        <p className="mb-6 text-sm text-ink-500">Nothing playing</p>
      )}
      <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-ink-500">Next up</h3>
      {upcoming.length === 0 ? (
        <p className="text-sm text-ink-500">Your queue is empty.</p>
      ) : (
        <ol className="space-y-1">
          {upcoming.map(({ track, orderPos }) => (
            <li key={`${track.id}-${orderPos}`} className="group flex items-center gap-3 rounded-md p-1.5 hover:bg-ink-800">
              <button type="button" onClick={() => jump(orderPos)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`Play ${track.title}`}>
                <div className="w-10 shrink-0"><Artwork src={track.artworkUrl} albumId={track.albumId} title={track.title} resolve={false} /></div>
                <div className="min-w-0">
                  <p className="truncate text-sm">{track.title}</p>
                  <p className="truncate text-xs text-ink-300">{track.artist}</p>
                </div>
              </button>
              <button
                type="button"
                aria-label={`Remove ${track.title} from queue`}
                onClick={() => remove(orderPos)}
                className="rounded-full p-1 text-ink-500 opacity-0 hover:text-ink-50 group-hover:opacity-100 focus:opacity-100"
              >
                <X size={16} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
