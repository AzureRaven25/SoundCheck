'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Mic2, Upload } from 'lucide-react';
import { licenseLabel } from '@soundcheck/contracts';
import { useUser } from '@/lib/hooks/useUser';
import { loadServers, searchAllServers, type ServerTrack } from '@/lib/personal/servers';
import { supabaseBrowser } from '@/lib/supabase/client';
import { FULL_SOURCE_ORDER, PROVIDER_LABEL } from '@/lib/acquire';

const STAGES: Record<string, string> = {
  download: 'Fetching your upload', separate: 'Separating vocals from the band', melody: 'Mapping the melody',
  lyrics: 'Finding lyrics', align: 'Timing every word', analyze: 'Detecting key and tempo', upload: 'Saving karaoke tracks',
};

type State =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'uploading'; pct: number }
  | { kind: 'processing'; stage: string | null; progress: number }
  | { kind: 'ready' }
  | { kind: 'failed'; error: string; assetId: string };

/**
 * "Upload your copy": the legitimate way a song becomes playable in full and karaoke-ready.
 * The file goes to the user's private Storage folder, then the processing queue builds the
 * instrumental, vocal guide, melody and word-timed lyrics (services/pipeline worker).
 */
export function UploadYourCopy({ trackId, title }: { trackId: string; title: string }) {
  const user = useUser();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [open, setOpen] = useState<{ provider: string; license_url: string | null; karaoke_ok: boolean; url: string | null } | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const [serverHits, setServerHits] = useState<ServerTrack[] | null>(null);
  const [hasServer, setHasServer] = useState(false);
  useEffect(() => { setHasServer(loadServers().length > 0); }, []);

  /** Find this song on the user's own server; picking a match uploads that file like a manual upload. */
  async function findOnServer() {
    setServerHits(null);
    setServerHits(await searchAllServers(title, 8));
  }
  async function takeServerCopy(t: ServerTrack) {
    setServerHits(null);
    setState({ kind: 'uploading', pct: 0 });
    try {
      const r = await fetch(t.streamUrl);
      if (!r.ok) throw new Error(`your server answered ${r.status}`);
      const blob = await r.blob();
      const type = blob.type.startsWith('audio/') ? blob.type : 'audio/mpeg';
      const ext = type.includes('flac') ? 'flac' : type.includes('mp4') || type.includes('aac') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'mp3';
      await upload(new File([blob], `${t.title}.${ext}`, { type }));
    } catch (e) {
      setState({ kind: 'failed', error: e instanceof Error ? e.message : 'Couldn’t fetch the song from your server', assetId: '' });
    }
  }

  const refresh = useCallback(async () => {
    if (!user) return;
    const sb = supabaseBrowser();
    const [{ data: own }, { data: shared }, { data: src }] = await Promise.all([
      sb.from('audio_assets').select('id').eq('track_id', trackId).eq('owner_id', user.id)
        .eq('kind', 'original').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      // an open-licensed recording made karaoke-ready once is shared with everyone
      sb.from('audio_assets').select('id').eq('track_id', trackId).eq('kind', 'original').is('owner_id', null)
        .in('provider', FULL_SOURCE_ORDER).limit(1).maybeSingle(),
      sb.from('track_sources').select('provider, license_url, karaoke_ok, url').eq('track_id', trackId).in('provider', FULL_SOURCE_ORDER)
        .not('stream_url', 'is', null).order('karaoke_ok', { ascending: false }).limit(1).maybeSingle(),
    ]);
    setOpen(src ?? null);
    const asset = own ?? shared;
    if (!asset) return setState({ kind: 'none' });
    const [{ data: analysis }, { data: job }] = await Promise.all([
      sb.from('karaoke_analysis').select('id').eq('source_asset_id', asset.id).maybeSingle(),
      sb.from('processing_jobs').select('status, stage, progress, error').eq('asset_id', asset.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (analysis) return setState({ kind: 'ready' });
    if (job?.status === 'failed') return setState({ kind: 'failed', error: job.error ?? 'Processing failed', assetId: asset.id });
    setState({ kind: 'processing', stage: job?.stage ?? null, progress: job?.progress ?? 0 });
  }, [trackId, user]);

  useEffect(() => {
    if (user === null) setState({ kind: 'none' });
    else if (user) void refresh();
  }, [user, refresh]);

  // Poll while a job is running (jobs take ~1–2 min; Realtime would be overkill for one row).
  useEffect(() => {
    if (state.kind !== 'processing') return;
    const t = setInterval(() => void refresh(), 2500);
    return () => clearInterval(t);
  }, [state.kind, refresh]);

  async function upload(file: File) {
    if (!user) return;
    if (!file.type.startsWith('audio/')) return setState({ kind: 'failed', error: 'That isn’t an audio file.', assetId: '' });
    if (file.size > 200 * 1024 * 1024) return setState({ kind: 'failed', error: 'Files up to 200 MB, please.', assetId: '' });
    const sb = supabaseBrowser();
    setState({ kind: 'uploading', pct: 0 });
    const ext = (file.name.split('.').pop() ?? 'audio').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${user.id}/uploads/${trackId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await sb.storage.from('audio').upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) return setState({ kind: 'failed', error: upErr.message, assetId: '' });
    const { data: asset, error: insErr } = await sb.from('audio_assets')
      .insert({ track_id: trackId, owner_id: user.id, kind: 'original', provider: 'upload', storage_path: path, mime_type: file.type })
      .select('id').single();
    if (insErr) return setState({ kind: 'failed', error: insErr.message, assetId: '' });
    await requestProcessing(asset.id);
  }

  /** Open-licensed recording: the server checks the license, then queues the same pipeline as uploads. */
  async function prepareOpen() {
    setState({ kind: 'processing', stage: null, progress: 0 });
    const { error } = await supabaseBrowser().functions.invoke('acquire', { body: { action: 'prepare', track_id: trackId } });
    if (error) return setState({ kind: 'failed', error: 'Couldn’t start processing this recording.', assetId: '' });
    await refresh();
  }

  async function requestProcessing(assetId: string) {
    const { error } = await supabaseBrowser().rpc('request_processing', { p_asset_id: assetId });
    if (error) return setState({ kind: 'failed', error: error.message, assetId });
    setState({ kind: 'processing', stage: null, progress: 0 });
  }

  if (user === undefined || user === null || state.kind === 'loading') return null;
  return (
    <section aria-label="Your copy" className="mb-8 max-w-3xl rounded-xl border border-ink-800 bg-ink-850 p-5">
      {state.kind === 'none' && open && (
        <div className="mb-4 flex flex-wrap items-center gap-4 border-b border-ink-800 pb-4">
          <Mic2 className="text-cyan-400" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">{open.license_url ? 'Full song available under an open license' : 'Full song available to stream'}</p>
            <p className="text-sm text-ink-300">
              From <a href={open.url ?? '#'} target="_blank" rel="noreferrer" className="underline">{PROVIDER_LABEL[open.provider] ?? open.provider}</a>
              {open.license_url && <> · <a href={open.license_url} target="_blank" rel="noreferrer" className="underline">{licenseLabel(open.license_url)}</a></>}.
              {open.karaoke_ok ? ' Its license allows us to build karaoke tracks from it.'
                : open.license_url ? ' Its license doesn’t allow derivatives, so it’s for listening only.'
                : ' The artist hasn’t given an open license, so it’s for listening only.'}
            </p>
          </div>
          {open.karaoke_ok && (
            <button type="button" onClick={() => void prepareOpen()} className="stage-gradient flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold text-white hover:scale-105">
              <Mic2 size={16} /> Make karaoke-ready
            </button>
          )}
        </div>
      )}
      {state.kind === 'none' && (
        <div className="flex flex-wrap items-center gap-4">
          <Mic2 className="text-pink-400" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">Make “{title}” karaoke-ready</p>
            <p className="text-sm text-ink-300">Upload your own copy (MP3, M4A, FLAC, WAV). We separate the vocals, map the melody and time every word.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {hasServer && (
              <button type="button" onClick={() => void findOnServer()} className="rounded-full border border-ink-600 px-5 py-2.5 text-sm font-bold hover:border-ink-300">
                Use my music server’s copy
              </button>
            )}
            <button type="button" onClick={() => input.current?.click()} className="flex items-center gap-2 rounded-full bg-ink-50 px-5 py-2.5 text-sm font-bold text-ink-950 hover:scale-105">
              <Upload size={16} /> Upload your copy
            </button>
          </div>
          {serverHits && (
            <ul className="w-full space-y-1" aria-label="Matches on your music server">
              {serverHits.length === 0 && <li className="text-sm text-ink-500">Your server doesn’t seem to have this song.</li>}
              {serverHits.map((t) => (
                <li key={t.key}>
                  <button type="button" onClick={() => void takeServerCopy(t)} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-800">
                    <b>{t.title}</b> · {t.artist}{t.album ? ` · ${t.album}` : ''} <span className="text-ink-500">({t.serverName})</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {state.kind === 'uploading' && <p className="flex items-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" /> Uploading…</p>}
      {state.kind === 'processing' && (
        <div role="status">
          <p className="flex items-center gap-2 text-sm font-bold">
            <Loader2 size={16} className="animate-spin text-pink-400" />
            {state.stage ? STAGES[state.stage] ?? 'Processing' : 'Queued, waiting for a free processor'}…
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-700">
            <div className="stage-gradient h-full transition-all" style={{ width: `${Math.max(4, state.progress * 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-ink-500">Usually 1–2 minutes. You can keep browsing.</p>
        </div>
      )}
      {state.kind === 'ready' && (
        <div className="flex flex-wrap items-center gap-4">
          <p className="flex flex-1 items-center gap-2 text-sm font-bold text-success-400" role="status">
            <CheckCircle2 size={18} /> Karaoke-ready: full-length playback and karaoke tracks are unlocked.
          </p>
          <Link href={`/stage/${trackId}`} className="stage-gradient flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold text-white shadow-lift hover:scale-105">
            <Mic2 size={16} /> Sing on Stage
          </Link>
        </div>
      )}
      {state.kind === 'failed' && (
        <div role="alert" className="text-sm">
          <p className="font-bold text-danger-400">That didn’t work: {state.error}</p>
          <div className="mt-2 flex gap-3">
            {state.assetId && <button type="button" className="underline" onClick={() => void requestProcessing(state.assetId)}>Retry processing</button>}
            <button type="button" className="underline" onClick={() => input.current?.click()}>Upload a different file</button>
          </div>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="audio/*"
        hidden
        aria-label="Audio file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void upload(f);
        }}
      />
    </section>
  );
}
