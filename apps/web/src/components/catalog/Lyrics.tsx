'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { supabaseBrowser } from '@/lib/supabase/client';
import { usePlayer, useCurrentTrack } from '@/player/store';

interface Line { start?: number; end?: number; text: string; words?: { start: number; end: number; text: string }[] }
interface LyricsResponse { granularity: 'plain' | 'line' | 'word' | null; provider?: string; lines: Line[] }

/** Index of the line being sung at time t (binary search over line starts). */
export function activeLine(lines: Line[], t: number): number {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((lines[mid]!.start ?? Infinity) <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * Lyrics for a track. When the track is the one playing, synced lyrics follow playback (current line
 * highlighted and scrolled into view; clicking a line seeks there). Previews start at an unknown point
 * in the song, so syncing is only enabled for full-length sources.
 */
export function Lyrics({ trackId }: { trackId: string }) {
  // keyed so all state resets when the song changes
  return <LyricsInner key={trackId} trackId={trackId} />;
}

function LyricsInner({ trackId }: { trackId: string }) {
  const [data, setData] = useState<LyricsResponse | null>(null);
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');
  const current = useCurrentTrack();
  const position = usePlayer((s) => s.position);
  const sourceKind = usePlayer((s) => s.sourceKind);
  const seek = usePlayer((s) => s.seek);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let live = true;
    void supabaseBrowser().functions.invoke<LyricsResponse>('fetch-lyrics', { body: { track_id: trackId } })
      .then(({ data: d, error }) => {
        if (!live) return;
        if (error) setState('error');
        else { setData(d); setState('done'); }
      });
    return () => { live = false; };
  }, [trackId]);

  const synced = !!data && data.granularity !== 'plain' && current?.id === trackId && sourceKind === 'original';
  const lines = useMemo(() => data?.lines ?? [], [data]);
  const idx = useMemo(() => (synced ? activeLine(lines, position) : -1), [synced, lines, position]);

  useEffect(() => {
    if (idx < 0 || !box.current) return;
    box.current.querySelector<HTMLElement>(`[data-line="${idx}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [idx]);

  if (state === 'loading') return <p className="text-ink-300">Loading lyrics…</p>;
  if (state === 'error') return <p className="text-ink-300">Lyrics are unavailable right now.</p>;
  if (!lines.length) return <p className="text-ink-300">No lyrics found for this song yet.</p>;
  return (
    <div>
      <div ref={box} className="scrollbar-thin max-h-[28rem] space-y-3 overflow-y-auto pr-2 font-display text-2xl font-bold leading-snug">
        {lines.map((l, i) => (
          <p
            key={i}
            data-line={i}
            onClick={() => synced && l.start != null && seek(l.start)}
            className={clsx(
              'transition-colors',
              !synced ? 'text-ink-50' : i === idx ? 'text-ink-50' : i < idx ? 'text-ink-500' : 'text-ink-300',
              synced && 'cursor-pointer hover:text-ink-50',
              !l.text && 'h-4',
            )}
          >
            {l.text || '♪'}
          </p>
        ))}
      </div>
      <p className="mt-4 text-xs text-ink-500">
        Lyrics via {data?.provider === 'lrclib' ? <a className="underline" href="https://lrclib.net" target="_blank" rel="noreferrer">LRCLIB</a> : 'SoundCheck'}
        {data?.granularity === 'word' ? ' · word-synced' : data?.granularity === 'line' ? ' · line-synced' : ''}
        {data?.granularity !== 'plain' && sourceKind === 'preview' && current?.id === trackId ? ' · sync follows full-length playback only' : ''}
      </p>
    </div>
  );
}
