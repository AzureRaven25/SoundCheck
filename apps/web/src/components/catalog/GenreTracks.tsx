'use client';

import { useState, useTransition } from 'react';
import { TrackList } from './TrackList';
import type { TrackItem } from '@/lib/types';
import { loadGenrePage } from '@/app/genre/[slug]/actions';

/** A genre's songs, 100 at a time, with "Load more" until the genre runs out. */
export function GenreTracks({ slug, initial, total }: { slug: string; initial: TrackItem[]; total: number }) {
  const [tracks, setTracks] = useState(initial);
  const [done, setDone] = useState(initial.length < 100 || initial.length >= total);
  const [pending, start] = useTransition();

  const more = () => start(async () => {
    const next = await loadGenrePage(slug, tracks.length);
    const seen = new Set(tracks.map((t) => t.id));
    const fresh = next.filter((t) => !seen.has(t.id));
    setTracks((cur) => [...cur, ...fresh]);
    if (next.length < 100 || tracks.length + fresh.length >= total) setDone(true);
  });

  return (
    <>
      <TrackList tracks={tracks} />
      <div className="mt-6 flex flex-col items-center gap-2 pb-4">
        <p className="text-sm text-ink-300" aria-live="polite">Showing {tracks.length.toLocaleString()} of {Math.max(total, tracks.length).toLocaleString()}</p>
        {!done && (
          <button type="button" onClick={more} disabled={pending}
            className="rounded-full bg-ink-800 px-6 py-2.5 text-sm font-bold text-ink-50 transition hover:bg-ink-700 disabled:opacity-60">
            {pending ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </>
  );
}
