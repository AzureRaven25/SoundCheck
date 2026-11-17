'use client';
import { useEffect, useState } from 'react';
import { Check, ListPlus, Search } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { enqueue, queueChanged, useSessionQueue } from './queue';

interface Hit { id: string; title: string; artist_credit: string }

/** Phone panel: search the catalog and add songs to the party's queue; shows what's up next. */
export function RequestSong({ sessionId, version, notify }: { sessionId: string; version: number; notify: (e: typeof queueChanged) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [added, setAdded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { items, reload } = useSessionQueue(sessionId, version);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabaseBrowser().functions.invoke<{ results: Hit[] }>('catalog-search', { body: { q: q.trim(), limit: 6 } });
      setHits(data?.results ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  async function add(h: Hit) {
    setError(null);
    try {
      await enqueue(sessionId, h.id);
      notify(queueChanged);
      setAdded(h.id);
      setQ(''); setHits([]);
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add the song'); }
  }

  const upcoming = items.filter((i) => i.status === 'queued');
  return (
    <section className="w-full max-w-sm text-left" aria-label="Song requests">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="mx-auto flex items-center gap-2 rounded-full bg-ink-850 px-5 py-2.5 text-sm font-bold ring-1 ring-ink-700">
          <ListPlus size={16} /> Request a song{upcoming.length ? ` · ${upcoming.length} up next` : ''}
        </button>
      ) : (
        <div className="rounded-2xl bg-ink-900 p-4">
          <label className="flex items-center gap-2 rounded-full bg-ink-850 px-3 py-2">
            <Search size={16} className="text-ink-300" /><span className="sr-only">Search songs</span>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search songs" className="w-full bg-transparent text-sm outline-none" />
          </label>
          {hits.length > 0 && (
            <ul className="mt-2 divide-y divide-ink-800">
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => void add(h)} className="flex w-full items-center gap-2 py-2 text-left">
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{h.title}</span><span className="block truncate text-xs text-ink-300">{h.artist_credit}</span></span>
                    <ListPlus size={16} className="text-pink-400" aria-label="Add to queue" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {added && <p role="status" className="mt-2 flex items-center gap-1 text-xs text-success-400"><Check size={14} /> Added to the queue</p>}
          {error && <p role="alert" className="mt-2 text-xs text-danger-400">{error}</p>}
          <p className="mt-4 text-xs font-bold uppercase tracking-widest text-ink-300">Up next</p>
          {upcoming.length === 0 ? <p className="text-xs text-ink-500">Nothing queued yet.</p> : (
            <ol className="mt-1 space-y-0.5 text-sm" aria-label="Up next">
              {upcoming.slice(0, 6).map((i, n) => <li key={i.id} className="truncate"><span className="text-ink-500">{n + 1}.</span> {i.title} <span className="text-ink-500">· {i.artist_credit}</span></li>)}
            </ol>
          )}
          <button type="button" onClick={() => setOpen(false)} className="mt-3 text-xs text-ink-300 underline">Close</button>
        </div>
      )}
    </section>
  );
}
