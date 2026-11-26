'use client';
/**
 * Make karaoke from your own recording, on this device: pick a file (or a direct link to one), pick the song (for
 * its synced lyrics), and the vocal is split off in the browser (HTDemucs, see stems/). The result plays on the
 * Stage with a "singer's voice" slider over the real recording. Nothing is uploaded; it's kept in this browser.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Cpu, Link2, Loader2, Mic2, Search, Trash2, Upload } from 'lucide-react';
import clsx from 'clsx';
import { supabaseBrowser } from '@/lib/supabase/client';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/env';
import { useUser } from '@/lib/hooks/useUser';
import { hasWebGpu, splitVocals, type SplitProgress } from '@/stems/separate';
import { deleteLocalSong, listLocalSongs, saveLocalSong, type LocalSongMeta } from '@/stems/store';

interface Song { id: string; title: string; artist_credit: string }
type Input = { kind: 'file'; file: File } | { kind: 'link'; url: string };

const mb = (n: number) => `${Math.round(n / 1e6)} MB`;
const fmtLen = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

async function tagsOf(file: File): Promise<string> {
  try {
    const { parseBlob } = await import('music-metadata');
    const m = await parseBlob(file, { skipCovers: true });
    const t = [m.common.title, m.common.artist ?? m.common.albumartist].filter(Boolean).join(' ');
    if (t.trim()) return t.trim();
  } catch { /* not readable: use the name */ }
  return file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').replace(/^\d+[\s.-]+/, '');
}

async function fetchLink(url: string, onBytes: (n: number, total: number) => void, signal: AbortSignal): Promise<ArrayBuffer> {
  const sb = supabaseBrowser();
  const { data: { session } } = await sb.auth.getSession();
  const key = SUPABASE_PUBLISHABLE_KEY;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/fetch-audio`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${session?.access_token ?? key}` },
    body: JSON.stringify({ url }),
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(err?.error ?? `Couldn’t download that link (${res.status}).`);
  }
  const total = Number(res.headers.get('Content-Length')) || 0;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    n += value.length;
    onBytes(n, total);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out.buffer;
}

function SongPicker({ song, onPick, hint }: { song: Song | null; onPick: (s: Song | null) => void; hint: string }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Song[]>([]);
  const [busy, setBusy] = useState(false);
  const hinted = useRef('');
  useEffect(() => { if (hint && hint !== hinted.current && !song) { hinted.current = hint; setQ(hint); } }, [hint, song]);
  useEffect(() => {
    if (song || q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      setBusy(true);
      const { data } = await supabaseBrowser().functions.invoke<{ results: Song[] }>('catalog-search', { body: { q: q.trim(), limit: 6 } });
      setHits(data?.results ?? []);
      setBusy(false);
    }, 300);
    return () => clearTimeout(t);
  }, [q, song]);
  if (song) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl bg-ink-850 p-3">
        <p className="min-w-0 truncate"><b>{song.title}</b> <span className="text-ink-300">· {song.artist_credit}</span></p>
        <button type="button" onClick={() => onPick(null)} className="shrink-0 text-xs font-bold text-ink-300 underline">Change</button>
      </div>
    );
  }
  return (
    <div>
      <label className="flex items-center gap-2 rounded-full bg-ink-850 px-4 py-2">
        <Search size={16} className="text-ink-300" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Song and artist" aria-label="Which song is it?"
          className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-ink-500 focus:outline-none" />
        {busy && <Loader2 size={14} className="animate-spin text-ink-300" />}
      </label>
      {hits.length > 0 && (
        <ul className="mt-2 divide-y divide-ink-800 rounded-xl bg-ink-850" aria-label="Matching songs">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => onPick(h)} className="w-full truncate px-4 py-2 text-left text-sm hover:bg-ink-800">
                <b>{h.title}</b> <span className="text-ink-300">· {h.artist_credit}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Maker() {
  const router = useRouter();
  const params = useSearchParams();
  const user = useUser();
  const [song, setSong] = useState<Song | null>(null);
  const [input, setInput] = useState<Input | null>(null);
  const [link, setLink] = useState('');
  const [hint, setHint] = useState('');
  const [progress, setProgress] = useState<SplitProgress | { step: 'fetching'; loaded: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gpu, setGpu] = useState<boolean | null>(null);
  const [saved, setSaved] = useState<LocalSongMeta[]>([]);
  const [drag, setDrag] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => { void hasWebGpu().then(setGpu); void listLocalSongs().then(setSaved); }, []);
  useEffect(() => {   // /make-karaoke?track=… from a song's Stage
    const id = params.get('track');
    if (!id) return;
    void supabaseBrowser().from('tracks').select('id, title, artist_credit').eq('id', id).maybeSingle().then(({ data }) => { if (data) setSong(data); });
  }, [params]);
  useEffect(() => () => abort.current?.abort(), []);

  function pickFile(f: File | undefined) {
    if (!f) return;
    if (!/^(audio|video)\//.test(f.type) && !/\.(mp3|m4a|aac|wav|flac|ogg|opus|aiff?|webm|mp4)$/i.test(f.name)) { setError('That isn’t an audio file.'); return; }
    setError(null);
    setInput({ kind: 'file', file: f });
    void tagsOf(f).then(setHint);
  }

  async function run() {
    if (!input || !song) return;
    setError(null);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      let bytes: ArrayBuffer, source: string;
      if (input.kind === 'file') { bytes = await input.file.arrayBuffer(); source = input.file.name; }
      else {
        setProgress({ step: 'fetching', loaded: 0, total: 0 });
        bytes = await fetchLink(input.url, (loaded, total) => setProgress({ step: 'fetching', loaded, total }), ctl.signal);
        source = new URL(input.url).hostname.replace(/^www\./, '');
      }
      const stems = await splitVocals(bytes, setProgress, ctl.signal);
      const meta = await saveLocalSong({ trackId: song.id, title: song.title, artist: song.artist_credit, source }, stems);
      router.push(`/stage/${song.id}?local=${meta.id}`);
    } catch (e) {
      if (ctl.signal.aborted) setError(null);
      else setError(e instanceof Error ? (/decod/i.test(e.message) ? 'This browser can’t read that audio format. Try an MP3, M4A or WAV.' : e.message) : String(e));
      setProgress(null);
    } finally {
      abort.current = null;
    }
  }

  const running = progress != null;
  const step = (n: number, done: boolean, label: string) => (
    <h2 className="flex items-center gap-2 font-display text-lg font-bold">
      <span className={clsx('flex h-6 w-6 items-center justify-center rounded-full text-xs', done ? 'bg-success-400 text-ink-950' : 'bg-ink-800')}>{done ? '✓' : n}</span>{label}
    </h2>
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-6">
      <h1 className="font-display text-3xl font-extrabold tracking-tight">Make karaoke from your own recording</h1>
      <p className="mt-2 text-sm text-ink-300">
        Pick a song file you have, and SoundCheck splits the singer out of it right here on your device. Then sing over the real recording,
        with a slider for how much of the original singer you hear. The audio never leaves this device.
      </p>

      <section className="mt-6 space-y-3 rounded-2xl bg-ink-900/70 p-4 ring-1 ring-ink-800">
        {step(1, !!input, 'The recording')}
        <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pickFile(e.dataTransfer.files[0]); }}
          className={clsx('flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-5 text-center text-sm', drag ? 'border-pink-400 bg-pink-400/5' : 'border-ink-700')}>
          {input?.kind === 'file' ? (
            <p className="flex items-center gap-2"><CheckCircle2 size={16} className="text-success-400" /> <b className="truncate">{input.file.name}</b> <span className="text-ink-300">({mb(input.file.size)})</span></p>
          ) : <p className="text-ink-300">Drop an MP3, M4A, WAV or FLAC here</p>}
          <button type="button" onClick={() => fileInput.current?.click()} disabled={running} className="flex items-center gap-2 rounded-full bg-ink-50 px-4 py-2 text-sm font-bold text-ink-950 disabled:opacity-40">
            <Upload size={16} /> Choose a file
          </button>
          <input ref={fileInput} type="file" accept="audio/*,.m4a,.flac,.opus" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
        </div>
        <form className="flex gap-2" onSubmit={(e) => {
          e.preventDefault();
          try { new URL(link); } catch { setError('That doesn’t look like a link.'); return; }
          setError(null); setInput({ kind: 'link', url: link.trim() });
          const name = decodeURIComponent(new URL(link).pathname.split('/').pop() ?? '').replace(/\.[a-z0-9]+$/i, '').replace(/[_+-]+/g, ' ');
          if (name.trim().length > 2) setHint(name.trim());
        }}>
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-ink-850 px-4 py-2">
            <Link2 size={16} className="text-ink-300" aria-hidden />
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="…or paste a link to an audio file" aria-label="Link to an audio file"
              className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-ink-500 focus:outline-none" disabled={running} />
          </label>
          <button type="submit" disabled={!link.trim() || running || !user} className="rounded-full bg-ink-800 px-4 py-2 text-sm font-bold disabled:opacity-40">Use link</button>
        </form>
        {input?.kind === 'link' && <p className="truncate text-xs text-success-400">Using {input.url}</p>}
        <p className="text-xs text-ink-500">
          Links: a direct link to an audio file, or a Dropbox, Google Drive or OneDrive share of one{user === null ? ' (log in to use links)' : ''}.
          Streaming services (YouTube, Spotify, Apple Music, SoundCloud…) can’t be used: their songs only play inside their own apps.
        </p>
      </section>

      <section className="mt-4 space-y-3 rounded-2xl bg-ink-900/70 p-4 ring-1 ring-ink-800">
        {step(2, !!song, 'Which song is it?')}
        <p className="text-xs text-ink-300">For its synced lyrics and scoring.</p>
        <SongPicker song={song} onPick={setSong} hint={hint} />
      </section>

      <section className="mt-4 space-y-3 rounded-2xl bg-ink-900/70 p-4 ring-1 ring-ink-800">
        {step(3, false, 'Split the singer out')}
        {gpu === false && (
          <p className="flex gap-2 rounded-lg bg-gold-400/10 p-2 text-xs text-gold-400"><Cpu size={14} className="mt-0.5 shrink-0" />
            This browser can’t use the graphics chip for this, so it will be slow (around 10–30 minutes for a song). Chrome, Edge or Safari 26 on a recent computer is much faster.
          </p>
        )}
        <p className="text-xs text-ink-300">The first time, this downloads the vocal-separation model (about 180 MB, kept for next time). With a recent computer it takes about a minute per song.</p>
        {progress && (
          <div role="status" aria-live="polite" className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-bold"><Loader2 size={16} className="animate-spin text-pink-400" />
              {progress.step === 'fetching' ? `Downloading the recording… ${mb(progress.loaded)}${progress.total ? ` of ${mb(progress.total)}` : ''}`
                : progress.step === 'decoding' ? 'Reading the recording…'
                : progress.step === 'downloading' ? `Downloading the vocal model… ${mb(progress.loaded)} of ${mb(progress.total)}`
                : `Splitting the singer out… ${Math.round((progress.done / progress.total) * 100)}%${progress.backend === 'wasm' ? ' (slow mode)' : ''}`}
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-ink-800">
              <div className="h-full bg-pink-400 transition-[width]" style={{ width: `${
                progress.step === 'separating' ? (progress.done / progress.total) * 100
                : progress.step === 'downloading' || progress.step === 'fetching' ? (progress.total ? (progress.loaded / progress.total) * 100 : 5) : 3}%` }} />
            </div>
            <button type="button" onClick={() => abort.current?.abort()} className="text-xs font-bold text-ink-300 underline">Stop</button>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-danger-400">{error}</p>}
        {!progress && (
          <button type="button" onClick={() => void run()} disabled={!input || !song}
            className="stage-gradient flex items-center gap-2 rounded-full px-8 py-3 font-display text-lg font-bold disabled:opacity-40">
            <Mic2 size={18} /> Make karaoke
          </button>
        )}
        <p className="text-xs text-ink-500">Use recordings you have the right to use: your own files, purchases, and downloads artists offer.</p>
      </section>

      {saved.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-bold">On this device</h2>
          <ul className="mt-2 divide-y divide-ink-800 rounded-2xl bg-ink-900/70 ring-1 ring-ink-800" aria-label="Karaoke made on this device">
            {saved.map((s) => (
              <li key={s.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{s.title} <span className="font-normal text-ink-300">· {s.artist}</span></p>
                  <p className="truncate text-xs text-ink-500">{s.source} · {fmtLen(s.seconds)}</p>
                </div>
                <Link href={`/stage/${s.trackId}?local=${s.id}`} className="rounded-full bg-ink-50 px-4 py-1.5 text-sm font-bold text-ink-950">Sing</Link>
                <button type="button" aria-label={`Delete ${s.title}`} onClick={() => void deleteLocalSong(s.id).then(listLocalSongs).then(setSaved)}
                  className="rounded-full p-2 text-ink-300 hover:bg-ink-800 hover:text-ink-50"><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function MakeKaraokePage() {
  return <Suspense><Maker /></Suspense>;
}
