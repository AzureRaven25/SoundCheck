'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, Copy, FolderOpen, Loader2, Mic2, RotateCcw, Server, Upload } from 'lucide-react';
import { SignInGate } from '@/components/social/SignInGate';
import { SongListImport } from '@/components/catalog/SongListImport';
import { loadServers, type ServerConfig } from '@/lib/personal/servers';
import { expandZips, filesFromDrop, filesFromInput, planImport, planServerImport, runImport, type ImportItem, type InputFile, type PlaylistResult } from '@/lib/import/engine';

const SOURCES = [
  'My music files', 'Bandcamp purchase', 'CD rip', 'Store purchase (DRM-free)', 'Artist download', 'Recording I made',
];

const STATUS_TEXT: Record<ImportItem['status'], string> = {
  waiting: 'Waiting', reading: 'Reading tags', uploading: 'Uploading', processing: 'Queuing karaoke', done: 'Imported',
  duplicate: 'Already imported', failed: 'Failed', skipped: 'Skipped',
};

/**
 * Import your music: drop folders, albums, ZIPs (Bandcamp downloads), CD rips with their EAC/whipper logs, or
 * playlists. Songs become full-length in SoundCheck for you and, if you like, karaoke-ready.
 */
function Importer() {
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof planImport>> | null>(null);
  const [, setTick] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'ready' | 'running' | 'finished'>('idle');
  const [note, setNote] = useState<string | null>(null);
  const [source, setSource] = useState(SOURCES[0]!);
  const [karaoke, setKaraoke] = useState(true);
  const [playlists, setPlaylists] = useState<PlaylistResult[]>([]);
  const [filter, setFilter] = useState<'all' | 'failed'>('all');
  const [drag, setDrag] = useState(false);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  const rerender = () => setTick((n) => n + 1);
  const [servers, setServers] = useState<ServerConfig[]>([]);
  useEffect(() => { setServers(loadServers()); }, []); // connected in Settings; stored on this device only

  async function fromServer(server: ServerConfig) {
    setPhase('scanning');
    setNote(`Listing songs on ${server.name}…`);
    try {
      const p = await planServerImport(server, (n) => setNote(`Found ${n.toLocaleString()} songs on ${server.name}…`));
      setPlan(p);
      setPlaylists([]);
      setSource('My music files');
      setNote(p.items.length ? null : `${server.name} has no songs to import.`);
      setPhase(p.items.length ? 'ready' : 'idle');
    } catch (e) {
      setNote(e instanceof Error ? `Couldn’t list your server’s songs: ${e.message}` : 'Couldn’t list your server’s songs.');
      setPhase('idle');
    }
  }

  async function accept(files: InputFile[]) {
    setPhase('scanning');
    setNote(null);
    try {
      const expanded = await expandZips(files, (z) => setNote(`Opening ${z.split('/').pop()}…`));
      const p = await planImport(expanded);
      setPlan(p);
      setPlaylists([]);
      setNote(p.items.length ? null : 'No audio files found. SoundCheck imports MP3, M4A/AAC/ALAC, FLAC, Ogg/Opus, WAV and AIFF.');
      setPhase(p.items.length ? 'ready' : 'idle');
    } catch (e) {
      setNote(e instanceof Error ? `Couldn’t read those files: ${e.message}` : 'Couldn’t read those files.');
      setPhase('idle');
    }
  }

  async function start() {
    if (!plan) return;
    setPhase('running');
    abort.current = new AbortController();
    try {
      const pls = await runImport(plan, { sourceLabel: source, makeKaraoke: karaoke }, rerender, abort.current.signal);
      setPlaylists(pls);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
    setPhase('finished');
  }

  const items = plan?.items ?? [];
  const count = (s: ImportItem['status'][]) => items.filter((i) => s.includes(i.status)).length;
  const finished = count(['done', 'duplicate', 'failed', 'skipped']);
  const failed = count(['failed']);
  const shown = filter === 'failed' ? items.filter((i) => i.status === 'failed') : items;

  return (
    <div className="mx-auto max-w-4xl pt-6">
      <h1 className="font-display text-3xl font-bold">Import your music</h1>
      <p className="mt-2 max-w-2xl text-ink-300">
        Bring in songs you own: folders, albums, ZIP downloads from Bandcamp, CD rips (with their Exact Audio Copy or whipper logs) and
        playlists. They play in full for you, and SoundCheck can turn each one into a karaoke track. Your files stay private to you.
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void filesFromDrop(e.dataTransfer).then(accept); }}
        className={`mt-6 rounded-2xl border-2 border-dashed p-8 text-center transition ${drag ? 'border-pink-500 bg-ink-850' : 'border-ink-700'}`}
        data-testid="import-dropzone"
      >
        <Upload className="mx-auto size-8 text-ink-300" aria-hidden />
        <p className="mt-3 font-bold">Drop music folders, ZIP files or songs here</p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => folderInput.current?.click()} disabled={phase === 'running' || phase === 'scanning'}
            className="inline-flex items-center gap-2 rounded-full bg-ink-50 px-5 py-2 text-sm font-bold text-ink-950 disabled:opacity-50">
            <FolderOpen className="size-4" aria-hidden /> Choose a folder
          </button>
          <button type="button" onClick={() => fileInput.current?.click()} disabled={phase === 'running' || phase === 'scanning'}
            className="inline-flex items-center gap-2 rounded-full bg-ink-800 px-5 py-2 text-sm font-bold disabled:opacity-50">
            Choose files
          </button>
        </div>
        <input ref={folderInput} type="file" className="hidden" multiple aria-label="Music folder"
          // @ts-expect-error non-standard but universally supported folder picker
          webkitdirectory="" onChange={(e) => e.target.files && void accept(filesFromInput(e.target.files))} />
        <input ref={fileInput} type="file" className="hidden" multiple aria-label="Music files"
          accept="audio/*,.flac,.m4a,.opus,.zip,.m3u,.m3u8,.pls,.log,.cue"
          onChange={(e) => e.target.files && void accept(filesFromInput(e.target.files))} />
        {phase === 'scanning' && <p className="mt-4 flex items-center justify-center gap-2 text-sm text-ink-300"><Loader2 className="size-4 animate-spin" aria-hidden /> {note ?? 'Reading your files…'}</p>}
      </div>
      {servers.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-ink-850 p-4" aria-label="Music servers">
          <Server className="text-cyan-400" aria-hidden />
          <p className="min-w-0 flex-1 text-sm text-ink-300">Bring in the whole library from your music server. Each song is copied when its turn comes.</p>
          {servers.map((sv) => (
            <button key={sv.id} type="button" onClick={() => void fromServer(sv)} disabled={phase === 'running' || phase === 'scanning'}
              className="rounded-full bg-ink-50 px-4 py-2 text-sm font-bold text-ink-950 disabled:opacity-50">
              Import from {sv.name}
            </button>
          ))}
        </div>
      )}
      {note && phase !== 'scanning' && <p role="alert" className="mt-3 text-sm text-danger-400">{note}</p>}

      {plan && items.length > 0 && (
        <section className="mt-6" aria-label="Import">
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-sm">
              <span className="mb-1 block text-ink-300">Where these files came from</span>
              <select value={source} onChange={(e) => setSource(e.target.value)} disabled={phase === 'running'}
                className="rounded-lg bg-ink-850 px-3 py-2">
                {SOURCES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" checked={karaoke} onChange={(e) => setKaraoke(e.target.checked)} disabled={phase === 'running'} />
              <Mic2 className="size-4" aria-hidden /> Make karaoke versions
            </label>
            <div className="ml-auto flex gap-2">
              {phase === 'ready' && (
                <button type="button" onClick={() => void start()} className="rounded-full bg-pink-500 px-6 py-2.5 font-bold text-ink-950">
                  Import {items.length} song{items.length === 1 ? '' : 's'}
                </button>
              )}
              {phase === 'running' && (
                <button type="button" onClick={() => abort.current?.abort()} className="rounded-full bg-ink-800 px-5 py-2.5 text-sm font-bold">Pause</button>
              )}
              {phase === 'finished' && finished < items.length && (
                <button type="button" onClick={() => void start()} className="rounded-full bg-pink-500 px-5 py-2.5 text-sm font-bold text-ink-950">Resume</button>
              )}
              {phase === 'finished' && failed > 0 && (
                <button type="button" onClick={() => void start()} className="inline-flex items-center gap-2 rounded-full bg-ink-800 px-5 py-2.5 text-sm font-bold">
                  <RotateCcw className="size-4" aria-hidden /> Retry {failed} failed
                </button>
              )}
            </div>
          </div>

          <div className="mt-5" aria-live="polite">
            <div className="h-2 overflow-hidden rounded-full bg-ink-800" role="progressbar" aria-label="Import progress"
              aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={finished}>
              <div className="h-full bg-pink-500 transition-all" style={{ width: `${(finished / items.length) * 100}%` }} />
            </div>
            <p className="mt-2 text-sm text-ink-300" data-testid="import-summary">
              {finished} of {items.length} · {count(['done'])} imported · {count(['duplicate'])} already in your library · {failed} failed
              {plan.rips.size > 0 && ` · ${plan.rips.size} CD rip log${plan.rips.size === 1 ? '' : 's'} read`}
              {plan.playlists.length > 0 && ` · ${plan.playlists.length} playlist${plan.playlists.length === 1 ? '' : 's'}`}
            </p>
          </div>

          {playlists.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {playlists.map((p) => (
                <li key={p.name}>
                  Playlist “{p.name}”: {p.matched} of {p.total} songs
                  {p.playlistId && <> · <Link href={`/playlist/${p.playlistId}`} className="underline">open</Link></>}
                </li>
              ))}
            </ul>
          )}

          {failed > 0 && (
            <div className="mt-4 flex gap-2 text-sm">
              <button type="button" onClick={() => setFilter('all')} aria-pressed={filter === 'all'} className={`rounded-full px-3 py-1 ${filter === 'all' ? 'bg-ink-50 text-ink-950' : 'bg-ink-850'}`}>All</button>
              <button type="button" onClick={() => setFilter('failed')} aria-pressed={filter === 'failed'} className={`rounded-full px-3 py-1 ${filter === 'failed' ? 'bg-ink-50 text-ink-950' : 'bg-ink-850'}`}>Failed ({failed})</button>
            </div>
          )}

          <ol className="mt-3 divide-y divide-ink-800 rounded-xl bg-ink-900/60 text-sm" data-testid="import-items">
            {shown.slice(0, 500).map((i) => (
              <li key={i.path} className="flex items-center gap-3 px-3 py-2" data-status={i.status}>
                <span className="w-5 shrink-0" aria-hidden>
                  {i.status === 'done' ? <CheckCircle2 className="size-4 text-emerald-400" />
                    : i.status === 'duplicate' ? <Copy className="size-4 text-ink-500" />
                    : i.status === 'failed' ? <CircleAlert className="size-4 text-danger-400" />
                    : i.status === 'waiting' ? null : <Loader2 className="size-4 animate-spin text-ink-300" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">
                    {i.trackId ? <Link href={`/track/${i.trackId}`} className="hover:underline">{i.title ?? i.path}</Link> : i.title ?? i.path.split('/').pop()}
                  </p>
                  <p className="truncate text-xs text-ink-500">
                    {i.artist ? `${i.artist}${i.album ? ` · ${i.album}` : ''}` : i.path}
                    {i.format ? ` · ${i.format}${i.bitrateKbps ? ` ${i.bitrateKbps} kbps` : ''}${i.lossless ? ' · lossless' : ''}` : ''}
                    {i.provenance && i.provenance.includes('AccurateRip') ? ` · ${i.provenance.replace(/^[^·]+· /, '')}` : ''}
                  </p>
                  {i.error && <p className="text-xs text-danger-400">{i.error}</p>}
                </div>
                <span className="shrink-0 text-xs text-ink-300">
                  {STATUS_TEXT[i.status]}
                  {i.status === 'done' && i.matched ? ' · matched' : ''}
                  {i.karaoke === 'queued' ? ' · karaoke queued' : ''}
                </span>
              </li>
            ))}
          </ol>
          {shown.length > 500 && <p className="mt-2 text-xs text-ink-500">Showing the first 500 of {shown.length}.</p>}
        </section>
      )}
      <SongListImport />
      <p className="mt-8 text-xs text-ink-500">
        Import music you have the right to use: your own files, purchases, CD rips of discs you own, and downloads artists offer.
        Imported songs stay private to your account.
      </p>
    </div>
  );
}

export default function ImportPage() {
  return <SignInGate next="/import" what="your music import"><Importer /></SignInGate>;
}
