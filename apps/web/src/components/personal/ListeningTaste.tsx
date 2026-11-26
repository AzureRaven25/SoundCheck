'use client';
import { useEffect, useRef, useState } from 'react';
import { Music2, Trash2, Upload } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { summarizeExports, UNSUPPORTED_SERVICES } from '@/lib/taste/sources';
import { SOURCE_LABEL, type TasteSource } from '@/lib/taste/summary';
import { plural } from '@/lib/format';
import type { Tables } from '@soundcheck/contracts/database';

type Import = Tables<'taste_imports'>;

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '?');
const label = (s: string) => SOURCE_LABEL[s as TasteSource] ?? s;

const HOW: [string, string][] = [
  ['Spotify', 'Account → Privacy → Download your data → Extended streaming history. Choose my_spotify_data.zip.'],
  ['Apple Music', 'privacy.apple.com → Get a copy of your data → Apple Media Services information. Choose the zip Apple sends.'],
  ['YouTube Music', 'Google Takeout → YouTube and YouTube Music → history, with the history format set to JSON. Choose the Takeout zip.'],
  ['Deezer', 'Account settings → Privacy → Request my personal data. Choose the deezer-data .xlsx file.'],
  ['Last.fm', 'Export your scrobbles to CSV (for example with lastfm-to-csv) and choose the .csv.'],
];

/**
 * Settings → "Your listening": pick one or more exports (Spotify, Apple Music, YouTube Music, Deezer, Last.fm).
 * The service is detected and the file summarized here in the browser (lib/taste); only per-song and per-artist
 * totals are saved, one summary per service. Buttons are type="button": this sits inside the settings form.
 */
export function ListeningTaste({ userId }: { userId: string }) {
  const [imports, setImports] = useState<Import[] | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void supabaseBrowser().from('taste_imports').select('*').eq('user_id', userId).order('imported_at')
      .then(({ data }) => setImports(data ?? []));
  }, [userId]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null); setDone(null);
    try {
      setBusy('Reading your history on this device…');
      const summaries = await summarizeExports([...files]);
      const saved: Import[] = [];
      for (const s of summaries) {
        setBusy(`Saving ${label(s.source)} totals for ${plural(s.tracks.length, 'song')} and ${plural(s.artists.length, 'artist')}…`);
        const { data, error: err } = await supabaseBrowser().rpc('import_taste', { p_summary: s as never });
        if (err) throw new Error(err.message);
        saved.push(data);
      }
      setImports((cur) => [...(cur ?? []).filter((i) => !saved.some((s) => s.source === i.source)), ...saved]);
      setDone(saved.map((s) => `${label(s.source)} imported: ${s.matched_tracks.toLocaleString()} of your songs are in the catalog.`).join(' '));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  }

  async function remove(source: string) {
    setError(null); setDone(null);
    setBusy('Deleting…');
    const { error: err } = await supabaseBrowser().from('taste_imports').delete().eq('user_id', userId).eq('source', source);
    setBusy(null);
    if (err) setError(err.message);
    else { setImports((cur) => (cur ?? []).filter((i) => i.source !== source)); setDone(`Deleted your imported ${label(source)} listening.`); }
  }

  return (
    <section id="listening" className="space-y-3" aria-labelledby="listening-heading">
      <h2 id="listening-heading" className="flex items-center gap-2 text-lg font-bold"><Music2 size={18} aria-hidden /> Your listening history</h2>
      <p className="text-sm text-ink-300">
        Get picks based on what you actually listen to. Download your history from your music service and choose the
        file here; we work out which service it came from. It&rsquo;s read on this device: we save only how often you
        played each song and artist, never the raw history, your IP address or your devices. Podcasts, audiobooks and
        videos are skipped.
      </p>
      <details className="rounded-xl bg-ink-900 p-3 text-sm">
        <summary className="cursor-pointer font-bold">How to get your file</summary>
        <ul className="mt-2 space-y-1.5 text-ink-300">
          {HOW.map(([name, how]) => <li key={name}><b className="text-ink-50">{name}:</b> {how}</li>)}
          <li>{UNSUPPORTED_SERVICES.join(', ')} don&rsquo;t offer a listening-history download we can read yet. If you scrobble to Last.fm, that export works.</li>
        </ul>
      </details>
      {imports?.map((i) => (
        <div key={i.source} className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-ink-900 p-4 text-sm" data-testid={`taste-import-${i.source}`}>
          <div>
            <p className="font-bold">{label(i.source)}: {plural(i.streams, 'play')} from {day(i.first_played)} to {day(i.last_played)}</p>
            <p className="text-ink-300">
              {plural(i.artist_count, 'artist')} and {plural(i.track_count, 'song')} saved
              ({i.matched_artists} artists and {i.matched_tracks} songs found in the catalog). Imported {day(i.imported_at)}.
            </p>
          </div>
          <button type="button" onClick={() => void remove(i.source)} disabled={!!busy} aria-label={`Delete imported ${label(i.source)} listening`}
            className="inline-flex items-center gap-2 rounded-full bg-ink-800 px-4 py-2 text-sm font-bold hover:bg-ink-700 disabled:opacity-60">
            <Trash2 size={14} aria-hidden /> Delete
          </button>
        </div>
      ))}
      <label className={`inline-flex cursor-pointer items-center gap-2 rounded-full bg-ink-50 px-5 py-2.5 text-sm font-bold text-ink-950 hover:scale-105 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
        <Upload size={16} aria-hidden /> {imports?.length ? 'Add or replace an export' : 'Choose your export'}
        <input ref={input} type="file" accept=".zip,.json,.csv,.xlsx,application/zip,application/json,text/csv" multiple className="sr-only"
          aria-label="Listening history export" disabled={!!busy} onChange={(e) => void upload(e.target.files)} />
      </label>
      {busy && <p role="status" className="text-sm text-ink-300">{busy}</p>}
      {done && <p role="status" className="text-sm text-success-400">{done}</p>}
      {error && <p role="alert" className="text-sm text-danger-400">{error}</p>}
    </section>
  );
}
