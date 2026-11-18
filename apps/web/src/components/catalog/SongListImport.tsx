'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ListMusic, Loader2 } from 'lucide-react';
import { parseSongList, type WantedSong } from '@/lib/import/songlist';
import { supabaseBrowser } from '@/lib/supabase/client';

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)|\[.*?\]|feat\..*$/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Find a song in the catalog (catalog-search grows the catalog when it has to). */
async function match(w: WantedSong): Promise<string | null> {
  const sb = supabaseBrowser();
  const q = [w.title, w.artist].filter(Boolean).join(' ').slice(0, 100);
  const { data } = await sb.functions.invoke<{ results: { id: string; title: string; artist_credit: string }[] }>('catalog-search', { body: { q, limit: 10 } });
  const rows = data?.results ?? [];
  const t = norm(w.title), a = w.artist ? norm(w.artist) : null;
  const best = rows.find((r) => norm(r.title) === t && (!a || norm(r.artist_credit).includes(a) || a.includes(norm(r.artist_credit))))
    ?? rows.find((r) => norm(r.title) === t)
    ?? rows.find((r) => norm(r.title).startsWith(t) || t.startsWith(norm(r.title)));
  return best?.id ?? null;
}

/** "Bring a playlist from another app": paste song names or upload a CSV export; matched songs become a playlist. */
export function SongListImport() {
  const [text, setText] = useState('');
  const [name, setName] = useState('Imported playlist');
  const [state, setState] = useState<{ done: number; total: number; matched: number; missing: WantedSong[]; playlistId?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    const wanted = parseSongList(text).slice(0, 500);
    if (!wanted.length) return;
    setBusy(true);
    const ids: (string | null)[] = new Array(wanted.length).fill(null);
    const missing: WantedSong[] = [];
    let done = 0, next = 0;
    setState({ done: 0, total: wanted.length, matched: 0, missing: [] });
    const worker = async () => {
      while (next < wanted.length) {
        const i = next++;
        ids[i] = await match(wanted[i]!).catch(() => null);
        if (!ids[i]) missing.push(wanted[i]!);
        done++;
        setState({ done, total: wanted.length, matched: done - missing.length, missing: [...missing] });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    const found = [...new Set(ids.filter((x): x is string => !!x))];
    const sb = supabaseBrowser();
    let playlistId: string | undefined;
    if (found.length) {
      const { data: pl } = await sb.from('playlists').insert({ title: name.slice(0, 100) || 'Imported playlist', description: 'Imported from a song list' }).select('id').single();
      if (pl) {
        playlistId = pl.id;
        await sb.from('playlist_tracks').insert(found.map((track_id, n) => ({ playlist_id: pl.id, track_id, position: n + 1 })));
      }
    }
    setState({ done, total: wanted.length, matched: found.length, missing, playlistId });
    setBusy(false);
  }

  return (
    <section aria-label="Import a playlist" className="mt-10 rounded-2xl bg-ink-850 p-5">
      <h2 className="flex items-center gap-2 font-display text-xl font-bold"><ListMusic size={20} className="text-pink-400" aria-hidden /> Bring a playlist from another app</h2>
      <p className="mt-1 text-sm text-ink-300">
        Paste song names (one per line, like “Queen - Bohemian Rhapsody”) or upload a CSV export of a playlist. SoundCheck finds each
        song and makes a playlist. Songs play in full where a full source exists, otherwise as previews.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
        <label className="block text-sm">
          <span className="sr-only">Song list</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder={'Queen - Bohemian Rhapsody\nStand by Me by Ben E. King'}
            className="w-full rounded-lg bg-ink-900 p-3 font-mono text-xs placeholder:text-ink-700" aria-label="Song list" />
        </label>
        <div className="flex flex-col gap-2 text-sm">
          <label>
            <span className="mb-1 block text-ink-300">Playlist name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg bg-ink-900 px-3 py-2" aria-label="Playlist name" />
          </label>
          <label className="cursor-pointer rounded-lg border border-dashed border-ink-700 px-3 py-2 text-center text-ink-300 hover:border-ink-500">
            Upload CSV
            <input type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" aria-label="Song list file"
              onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setText(await f.text()); setName(f.name.replace(/\.(csv|txt)$/i, '')); } }} />
          </label>
          <button type="button" onClick={() => void run()} disabled={busy || !text.trim()}
            className="rounded-full bg-pink-500 px-5 py-2 font-bold text-ink-950 disabled:opacity-40">
            {busy ? <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden /> Matching…</span> : 'Make playlist'}
          </button>
        </div>
      </div>
      {state && (
        <div className="mt-3 text-sm" aria-live="polite" data-testid="songlist-status">
          <p>{state.done} of {state.total} checked · {state.matched} found{state.missing.length ? ` · ${state.missing.length} not found` : ''}
            {state.playlistId && <> · <Link href={`/playlist/${state.playlistId}`} className="font-bold underline">Open playlist</Link></>}</p>
          {!busy && state.missing.length > 0 && (
            <details className="mt-1 text-xs text-ink-500"><summary className="cursor-pointer">Songs not found</summary>
              <ul className="mt-1 list-disc pl-5">{state.missing.map((m, i) => <li key={i}>{m.artist ? `${m.artist} - ` : ''}{m.title}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
