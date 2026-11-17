'use client';
import { useEffect, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { loadServers, searchAllServers, type ServerTrack } from '@/lib/personal/servers';
import { useCurrentTrack, usePlayer } from '@/player/store';

const fmt = (ms: number | null) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}` : '');

export const toQueue = (t: ServerTrack) => ({
  id: t.key, title: t.title, artist: t.artist, albumId: null, artworkUrl: t.coverUrl, durationMs: t.durationMs,
  stream: { url: t.streamUrl, label: t.serverName },
});

/** Search results from the user's connected music servers (full-length, their own files). */
export function ServerResults({ q }: { q: string }) {
  const [hits, setHits] = useState<ServerTrack[]>([]);
  const p = usePlayer();
  const current = useCurrentTrack();
  useEffect(() => {
    let live = true;
    if (!loadServers().length) { setHits([]); return; }
    void searchAllServers(q, 12).then((r) => { if (live) setHits(r); });
    return () => { live = false; };
  }, [q]);
  if (!hits.length) return null;
  return (
    <section className="mt-10" aria-label="From your music server">
      <h2 className="mb-4 font-display text-2xl font-bold">From your music server</h2>
      <ul className="divide-y divide-ink-850">
        {hits.map((t, i) => {
          const isCur = current?.id === t.key;
          return (
            <li key={t.key} className="flex items-center gap-3 py-2">
              <button type="button" aria-label={isCur && p.playing ? `Pause ${t.title}` : `Play ${t.title}`}
                onClick={() => (isCur ? p.toggle() : p.playTracks(hits.map(toQueue), i))}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-800 hover:bg-ink-700">
                {isCur && p.playing ? <Pause size={16} /> : <Play size={16} className="translate-x-px" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={`truncate font-bold ${isCur ? 'text-pink-400' : ''}`}>{t.title}</p>
                <p className="truncate text-sm text-ink-300">{t.artist}{t.album ? ` · ${t.album}` : ''} · {t.serverName}</p>
              </div>
              <span className="text-sm tabular-nums text-ink-500">{fmt(t.durationMs)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
