'use client';
import { useEffect, useRef, useState } from 'react';
import { Music2, Trash2, Upload } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { summarizeExport } from '@/lib/spotify/history';
import { plural } from '@/lib/format';
import type { Tables } from '@soundcheck/contracts/database';

type Import = Tables<'taste_imports'>;

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '?');

/**
 * Settings → "Your Spotify listening": pick the my_spotify_data.zip export; it's unzipped and summarized here in
 * the browser (lib/spotify/history.ts) and only per-song / per-artist totals are saved, to tailor recommendations.
 * Buttons are type="button": this sits inside the settings form.
 */
export function SpotifyTaste({ userId }: { userId: string }) {
  const [current, setCurrent] = useState<Import | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void supabaseBrowser().from('taste_imports').select('*').eq('user_id', userId).maybeSingle()
      .then(({ data }) => setCurrent(data ?? null));
  }, [userId]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null); setDone(null);
    try {
      setBusy('Reading your history on this device…');
      const summary = await summarizeExport([...files]);
      setBusy(`Saving totals for ${plural(summary.tracks.length, 'song')} and ${plural(summary.artists.length, 'artist')}…`);
      const { data, error: err } = await supabaseBrowser().rpc('import_taste', { p_summary: summary as never });
      if (err) throw new Error(err.message);
      setCurrent(data);
      setDone(`Imported. ${data.matched_tracks.toLocaleString()} of your songs are in the catalog.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  }

  async function remove() {
    setError(null); setDone(null);
    setBusy('Deleting…');
    const { error: err } = await supabaseBrowser().from('taste_imports').delete().eq('user_id', userId);
    setBusy(null);
    if (err) setError(err.message);
    else { setCurrent(null); setDone('Deleted your imported Spotify listening.'); }
  }

  return (
    <section id="spotify" className="space-y-3" aria-labelledby="spotify-heading">
      <h2 id="spotify-heading" className="flex items-center gap-2 text-lg font-bold"><Music2 size={18} aria-hidden /> Your Spotify listening</h2>
      <p className="text-sm text-ink-300">
        Get picks based on what you actually listen to. In Spotify, go to Account → Privacy → Download your data and
        request your <b>Extended streaming history</b>. When the email arrives, choose <code>my_spotify_data.zip</code> here.
        It&rsquo;s read on this device: we save only how often you played each song and artist, never the raw history,
        your IP address or your devices. Podcasts, audiobooks and videos are skipped.
      </p>
      {current && (
        <div className="rounded-xl bg-ink-900 p-4 text-sm" data-testid="spotify-import-summary">
          <p className="font-bold">
            {plural(current.streams, 'play')} from {day(current.first_played)} to {day(current.last_played)}
          </p>
          <p className="text-ink-300">
            {plural(current.artist_count, 'artist')} and {plural(current.track_count, 'song')} saved
            ({current.matched_artists} artists and {current.matched_tracks} songs found in the catalog). Imported {day(current.imported_at)}.
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <label className={`inline-flex cursor-pointer items-center gap-2 rounded-full bg-ink-50 px-5 py-2.5 text-sm font-bold text-ink-950 hover:scale-105 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
          <Upload size={16} aria-hidden /> {current ? 'Replace with a newer export' : 'Choose Spotify export'}
          <input ref={input} type="file" accept=".zip,.json,application/zip,application/json" multiple className="sr-only"
            aria-label="Spotify data export" disabled={!!busy} onChange={(e) => void upload(e.target.files)} />
        </label>
        {current && (
          <button type="button" onClick={() => void remove()} disabled={!!busy}
            className="inline-flex items-center gap-2 rounded-full bg-ink-800 px-5 py-2.5 text-sm font-bold hover:bg-ink-700 disabled:opacity-60">
            <Trash2 size={16} aria-hidden /> Delete imported listening
          </button>
        )}
      </div>
      {busy && <p role="status" className="text-sm text-ink-300">{busy}</p>}
      {done && <p role="status" className="text-sm text-success-400">{done}</p>}
      {error && <p role="alert" className="text-sm text-danger-400">{error}</p>}
    </section>
  );
}
