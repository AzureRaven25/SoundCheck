'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ExternalLink, Loader2, Mic2, Play } from 'lucide-react';
import { licenseLabel } from '@soundcheck/contracts';
import { importCandidate, PROVIDER_LABEL, searchSources, type SourceCandidate, type SourceStatus } from '@/lib/acquire';
import { formatDuration } from '@/lib/format';
import { usePlayer } from '@/player/store';

/** What a result offers, as a short label (the source-availability scale used across the app). */
export function availabilityLabel(c: Pick<SourceCandidate, 'availability' | 'karaoke_ok'>): string {
  if (c.availability === 'full') return c.karaoke_ok ? 'Full song · karaoke-eligible' : 'Full song';
  if (c.availability === 'preview') return 'Preview only';
  return 'Info only';
}

/**
 * Full-length songs from every registered source (Audius, Openverse → Jamendo / Wikimedia Commons, Jamendo, …),
 * with each source's status. Playing a result adds it to the catalog first (de-duplicated) so it gets a song page,
 * history and, when the license allows, karaoke.
 */
export function MoreSources({ q }: { q: string }) {
  const [results, setResults] = useState<SourceCandidate[] | null>(null);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [imported, setImported] = useState<Record<string, string>>({});
  const playTracks = usePlayer((s) => s.playTracks);

  useEffect(() => {
    let live = true; // the parent keys this component by query, so state starts fresh per search
    void searchSources(q, 8)
      .then((r) => { if (live) { setResults(r.results); setSources(r.sources); } })
      .catch(() => { if (live) setResults([]); });
    return () => { live = false; };
  }, [q]);

  const key = (c: SourceCandidate) => `${c.provider}:${c.external_id}`;
  async function play(c: SourceCandidate) {
    setBusy(key(c));
    setFailed(null);
    try {
      const id = c.track_id ?? imported[key(c)] ?? (await importCandidate(c));
      setImported((m) => ({ ...m, [key(c)]: id }));
      playTracks([{ id, title: c.title, artist: c.artist, albumId: null, artworkUrl: c.artwork, durationMs: c.duration_ms }]);
    } catch {
      setFailed(key(c));
    } finally {
      setBusy(null);
    }
  }

  if (results === null) return <p className="mt-10 text-sm text-ink-500" aria-live="polite">Looking for full songs in open sources…</p>;
  const full = results.filter((r) => r.availability === 'full');
  const info = results.filter((r) => r.availability !== 'full');
  if (!results.length && !sources.length) return null;
  return (
    <section className="mt-10" aria-label="More sources">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-display text-2xl font-bold">Full songs from open sources</h2>
        <p className="text-sm text-ink-500">Independent artists and openly licensed recordings, playable in full</p>
      </div>
      <ul className="mb-4 flex flex-wrap gap-2 text-[11px]" aria-label="Source status">
        {sources.map((s) => (
          <li key={s.id} data-testid={`source-${s.id}`}
            className={`rounded-full px-2.5 py-1 ${s.ok ? 'bg-ink-800 text-ink-300' : 'bg-ink-850 text-ink-500'}`}
            title={s.ok ? undefined : s.missing.length ? `Needs ${s.missing.join(', ')}` : s.error}>
            {s.label}: {s.ok ? `${s.count}` : s.missing.length ? 'not set up' : 'unavailable'}
          </li>
        ))}
      </ul>
      {full.length > 0 && (
        <ol className="divide-y divide-ink-800 rounded-xl bg-ink-900/60" data-testid="source-results">
          {full.map((c) => {
            const k = key(c);
            const trackId = c.track_id ?? imported[k];
            return (
              <li key={k} className="flex items-center gap-3 px-3 py-2">
                <button type="button" onClick={() => void play(c)} disabled={busy === k}
                  aria-label={`Play ${c.title} by ${c.artist}`}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-pink-500 text-white hover:bg-pink-400 disabled:opacity-60">
                  {busy === k ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">
                    {trackId ? <Link href={`/track/${trackId}`} className="hover:underline">{c.title}</Link> : c.title}
                  </p>
                  <p className="truncate text-xs text-ink-300">
                    {c.artist} · {PROVIDER_LABEL[c.provider] ?? c.provider}
                    {c.attribution.includes('Wikimedia') ? ' (Wikimedia Commons)' : c.attribution.includes('Jamendo') && c.provider === 'openverse' ? ' (Jamendo)' : ''}
                    {c.license_url ? ` · ${licenseLabel(c.license_url)}` : ''}
                  </p>
                  {failed === k && <p role="alert" className="text-xs text-danger-400">Couldn’t add this song. Try again.</p>}
                </div>
                <span className="hidden text-[11px] text-ink-500 sm:inline">
                  {c.karaoke_ok && <Mic2 className="mr-1 inline size-3" aria-hidden />}{availabilityLabel(c)}
                </span>
                <span className="w-12 text-right text-xs tabular-nums text-ink-500">{formatDuration(c.duration_ms)}</span>
              </li>
            );
          })}
        </ol>
      )}
      {info.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-ink-300">Info-only matches ({info.length}): song details, no playable audio</summary>
          <ul className="mt-2 space-y-1 text-xs text-ink-500">
            {info.map((c) => (
              <li key={key(c)}>
                {c.title}, {c.artist} · {PROVIDER_LABEL[c.provider] ?? c.provider}
                {c.page_url && (
                  <a href={c.page_url} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 underline">
                    open <ExternalLink className="size-3" aria-hidden />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
