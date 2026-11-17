'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Mic2, Upload } from 'lucide-react';
import { useUser } from '@/lib/hooks/useUser';
import { supabaseBrowser } from '@/lib/supabase/client';

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
  const input = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    const sb = supabaseBrowser();
    const { data: asset } = await sb.from('audio_assets').select('id').eq('track_id', trackId).eq('owner_id', user.id)
      .eq('kind', 'original').order('created_at', { ascending: false }).limit(1).maybeSingle();
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

  async function requestProcessing(assetId: string) {
    const { error } = await supabaseBrowser().rpc('request_processing', { p_asset_id: assetId });
    if (error) return setState({ kind: 'failed', error: error.message, assetId });
    setState({ kind: 'processing', stage: null, progress: 0 });
  }

  if (user === undefined || user === null || state.kind === 'loading') return null;
  return (
    <section aria-label="Your copy" className="mb-8 max-w-3xl rounded-xl border border-ink-800 bg-ink-850 p-5">
      {state.kind === 'none' && (
        <div className="flex flex-wrap items-center gap-4">
          <Mic2 className="text-pink-400" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">Make “{title}” karaoke-ready</p>
            <p className="text-sm text-ink-300">Upload your own copy (MP3, M4A, FLAC, WAV). We separate the vocals, map the melody and time every word.</p>
          </div>
          <button type="button" onClick={() => input.current?.click()} className="flex items-center gap-2 rounded-full bg-ink-50 px-5 py-2.5 text-sm font-bold text-ink-950 hover:scale-105">
            <Upload size={16} /> Upload your copy
          </button>
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
        <p className="flex items-center gap-2 text-sm font-bold text-success-400" role="status">
          <CheckCircle2 size={18} /> Your copy is ready: full-length playback and karaoke tracks are unlocked.
        </p>
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
