'use client';
/**
 * Bulk import of music the user owns: folders, ZIP archives (Bandcamp purchases), CD rips (EAC / whipper / XLD logs
 * with AccurateRip results), and playlists (M3U/M3U8/PLS → SoundCheck playlists).
 *
 * For each audio file: read its tags → SHA-256 → skip if this user already imported the same bytes → find or create
 * the catalog song (import_owned_track: same title + artist, duration within 4 s) → upload to the user's private
 * Storage folder → register the original (audio_assets) → optionally queue karaoke processing.
 * Every step is idempotent, so "Retry failed" (or importing the same folder again) only redoes what didn't finish.
 */
import { supabaseBrowser } from '@/lib/supabase/client';
import { AUDIO_EXT, classify, extOf, guessFromPath, mimeFor, parsePlaylist, parseRipLog, provenanceLabel, resolveEntry, type RipLog } from './parse';

export interface InputFile { path: string; file: File }
export type ItemStatus = 'waiting' | 'reading' | 'uploading' | 'processing' | 'done' | 'duplicate' | 'failed' | 'skipped';
export interface ImportItem {
  path: string;
  file: File;
  status: ItemStatus;
  title?: string;
  artist?: string;
  album?: string | null;
  durationMs?: number | null;
  format?: string | null;
  bitrateKbps?: number | null;
  lossless?: boolean;
  provenance?: string;
  trackId?: string;
  matched?: boolean;   // matched an existing catalog song
  karaoke?: 'queued' | 'skipped';
  error?: string;
}
export interface ImportOptions { sourceLabel: string; makeKaraoke: boolean; concurrency?: number }
export interface PlaylistResult { name: string; playlistId: string | null; matched: number; total: number }

const MAX_BYTES = 200 * 1024 * 1024;

// ------------------------------------------------------------------------------------------------ gathering files
/** Files from a drop: walks dropped folders (webkitGetAsEntry) so whole libraries can be dropped at once. */
export async function filesFromDrop(dt: DataTransfer): Promise<InputFile[]> {
  const out: InputFile[] = [];
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return [...dt.files].map((f) => ({ path: f.name, file: f }));
  const walk = async (e: FileSystemEntry, prefix: string): Promise<void> => {
    if (e.isFile) {
      const f = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej));
      out.push({ path: prefix + f.name, file: f });
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const c of batch) await walk(c, `${prefix}${e.name}/`);
      }
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}

/** Files from an <input> (webkitdirectory keeps relative paths). */
export function filesFromInput(list: FileList): InputFile[] {
  return [...list].map((f) => ({ path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, file: f }));
}

/** Expand ZIP archives in place (Bandcamp downloads arrive as one zip per album). */
export async function expandZips(files: InputFile[], onZip?: (name: string) => void): Promise<InputFile[]> {
  const out: InputFile[] = [];
  for (const f of files) {
    if (classify(f.path) !== 'zip') { out.push(f); continue; }
    onZip?.(f.path);
    const { unzip } = await import('fflate');
    const buf = new Uint8Array(await f.file.arrayBuffer());
    const entries = await new Promise<Record<string, Uint8Array>>((res, rej) =>
      unzip(buf, { filter: (e) => classify(e.name) !== 'other' && classify(e.name) !== 'zip' }, (err, data) => (err ? rej(err) : res(data))));
    const dir = f.path.replace(/\.zip$/i, '');
    for (const [name, data] of Object.entries(entries)) {
      const path = `${dir}/${name}`;
      out.push({ path, file: new File([data as BlobPart], name.split('/').pop()!, { type: AUDIO_EXT[extOf(name)] ?? '' }) });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ per-file steps
async function sha256(file: File): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function readTags(item: ImportItem): Promise<void> {
  const guess = guessFromPath(item.path);
  try {
    const { parseBlob } = await import('music-metadata');
    const m = await parseBlob(item.file, { duration: true, skipCovers: true });
    item.title = m.common.title?.trim() || guess.title;
    item.artist = m.common.artist?.trim() || m.common.albumartist?.trim() || guess.artist || 'Unknown artist';
    item.album = m.common.album?.trim() || guess.album;
    item.durationMs = m.format.duration ? Math.round(m.format.duration * 1000) : null;
    item.format = m.format.codec ?? m.format.container ?? extOf(item.path);
    item.bitrateKbps = m.format.bitrate ? Math.round(m.format.bitrate / 1000) : null;
    item.lossless = !!m.format.lossless;
  } catch {
    item.title = guess.title;
    item.artist = guess.artist ?? 'Unknown artist';
    item.album = guess.album;
    item.format = extOf(item.path);
  }
}

async function importOne(item: ImportItem, uid: string, opts: ImportOptions, rip: RipLog | null): Promise<void> {
  const sb = supabaseBrowser();
  if (item.file.size > MAX_BYTES) throw new Error('larger than 200 MB');
  item.status = 'reading';
  await readTags(item);
  const trackNo = guessFromPath(item.path).trackNo;
  item.provenance = provenanceLabel(opts.sourceLabel, rip && trackNo ? rip.tracks.get(trackNo) : null);
  const hash = await sha256(item.file);

  // same bytes already imported by this user → nothing to do
  const { data: dup } = await sb.from('audio_assets').select('id, track_id').eq('owner_id', uid).eq('content_sha256', hash).maybeSingle();
  if (dup) {
    item.trackId = dup.track_id;
    item.status = 'duplicate';
    return;
  }
  const { data: t, error: te } = await sb.rpc('import_owned_track', {
    p_title: item.title!, p_artist: item.artist!, p_album: item.album ?? undefined, p_duration_ms: item.durationMs ?? undefined,
  });
  if (te || !t?.[0]) throw new Error(te?.message ?? 'couldn’t add the song to the catalog');
  item.trackId = t[0].track_id;
  item.matched = !t[0].created;

  item.status = 'uploading';
  const ext = extOf(item.path) || 'audio';
  const path = `${uid}/uploads/${item.trackId}/${hash}.${ext}`; // content-addressed: a retry overwrites nothing new
  const { error: ue } = await sb.storage.from('audio').upload(path, item.file, { contentType: mimeFor(item.path, item.file.type), upsert: false });
  if (ue && !/exists|duplicate/i.test(ue.message)) throw new Error(ue.message);

  const { data: asset, error: ae } = await sb.from('audio_assets').insert({
    track_id: item.trackId!, owner_id: uid, kind: 'original', provider: 'upload', storage_path: path, mime_type: mimeFor(item.path, item.file.type),
    duration_ms: item.durationMs ?? null, bitrate_kbps: item.bitrateKbps ?? null, content_sha256: hash, source_label: item.provenance.slice(0, 200),
  }).select('id').single();
  if (ae) {
    if (/duplicate key/i.test(ae.message)) { item.status = 'duplicate'; return; } // raced with another tab
    throw new Error(ae.message);
  }
  if (opts.makeKaraoke) {
    item.status = 'processing';
    const { error: pe } = await sb.rpc('request_processing', { p_asset_id: asset.id });
    item.karaoke = pe ? 'skipped' : 'queued';
  }
  item.status = 'done';
}

// ------------------------------------------------------------------------------------------------ the run
export interface ImportRun {
  items: ImportItem[];
  playlists: PlaylistResult[];
  ripLogs: number;
}

/** Prepare a run: classify files, read rip logs, keep audio as items. */
export async function planImport(files: InputFile[]): Promise<{ items: ImportItem[]; playlists: { dir: string; text: string; name: string }[]; rips: Map<string, RipLog> }> {
  const items: ImportItem[] = [];
  const playlists: { dir: string; text: string; name: string }[] = [];
  const rips = new Map<string, RipLog>();
  for (const f of files) {
    const kind = classify(f.path);
    const dir = f.path.split('/').slice(0, -1).join('/');
    if (kind === 'audio') items.push({ path: f.path, file: f.file, status: 'waiting' });
    else if (kind === 'playlist') playlists.push({ dir, name: f.path, text: await f.file.text() });
    else if (kind === 'riplog') {
      const r = parseRipLog(await f.file.text());
      if (r) rips.set(dir, r);
    }
  }
  items.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  return { items, playlists, rips };
}

/**
 * Run (or re-run) an import. `onUpdate` fires after every state change so the UI can show progress.
 * Items already done/duplicate are left alone, so calling this again retries only the failures.
 */
export async function runImport(
  plan: Awaited<ReturnType<typeof planImport>>, opts: ImportOptions, onUpdate: () => void, signal?: AbortSignal,
): Promise<PlaylistResult[]> {
  const sb = supabaseBrowser();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('sign in required');
  const queue = plan.items.filter((i) => i.status !== 'done' && i.status !== 'duplicate');
  for (const i of queue) { i.status = 'waiting'; i.error = undefined; }
  onUpdate();
  let next = 0;
  const worker = async () => {
    while (next < queue.length && !signal?.aborted) {
      const item = queue[next++]!;
      const dir = item.path.split('/').slice(0, -1).join('/');
      try {
        await importOne(item, user.id, opts, plan.rips.get(dir) ?? null);
      } catch (e) {
        item.status = 'failed';
        item.error = e instanceof Error ? e.message : String(e);
        void sb.from('acquisition_log').insert({ user_id: user.id, provider: 'upload', action: 'upload', external_id: item.path.slice(0, 200), ok: false, error: item.error.slice(0, 500) });
      }
      onUpdate();
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 3 }, worker));

  // playlists: in file order, using whatever imported (or was already imported)
  const results: PlaylistResult[] = [];
  const paths = plan.items.map((i) => i.path);
  for (const p of plan.playlists) {
    const parsed = parsePlaylist(p.name, p.text);
    const ids: string[] = [];
    for (const e of parsed.entries) {
      const path = resolveEntry(e.path, p.dir, paths);
      const it = path ? plan.items.find((i) => i.path === path) : null;
      if (it?.trackId) ids.push(it.trackId);
    }
    let playlistId: string | null = null;
    if (ids.length) {
      const { data: pl } = await sb.from('playlists').insert({ title: parsed.name.slice(0, 100) || 'Imported playlist', description: 'Imported playlist' }).select('id').single();
      if (pl) {
        playlistId = pl.id;
        await sb.from('playlist_tracks').insert(ids.map((track_id, n) => ({ playlist_id: pl.id, track_id, position: n + 1 })));
      }
    }
    results.push({ name: parsed.name, playlistId, matched: ids.length, total: parsed.entries.length });
  }
  onUpdate();
  return results;
}
