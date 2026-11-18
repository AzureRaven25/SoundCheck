'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { GENRE_INFO } from '@/lib/genres';
import { Suspense, useEffect, useRef, useState } from 'react';
import { EntityCard, Shelf } from '@/components/catalog/Cards';
import { TrackList } from '@/components/catalog/TrackList';
import { OpenMusicResults } from '@/components/catalog/OpenMusicResults';
import { MoreSources } from '@/components/catalog/MoreSources';
import { ServerResults } from '@/components/personal/ServerResults';
import { useUser } from '@/lib/hooks/useUser';
import { supabaseBrowser } from '@/lib/supabase/client';
import { TRACK_SELECT, withArtworkClient, type Row } from '@/lib/track-mapping';
import type { TrackItem } from '@/lib/types';

interface SearchRow { id: string }
interface ArtistHit { id: string; name: string; disambiguation: string | null }

function Results() {
  const q = (useSearchParams().get('q') ?? '').trim();
  const user = useUser();
  const [tracks, setTracks] = useState<TrackItem[]>([]);
  const [artists, setArtists] = useState<ArtistHit[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [source, setSource] = useState<string | null>(null);
  const req = useRef(0);

  useEffect(() => {
    if (!q) {
      setTracks([]);
      setArtists([]);
      setState('idle');
      return;
    }
    const id = ++req.current;
    setState('loading');
    const sb = supabaseBrowser();
    void (async () => {
      try {
        // Tiered search (Supabase → Turso long tail → MusicBrainz), ranked ids.
        const { data, error } = await sb.functions.invoke<{ results: SearchRow[]; source: string }>('catalog-search', { body: { q, limit: 30 } });
        if (error) throw error;
        const ids = (data?.results ?? []).map((r) => r.id);
        const [{ data: rows }, { data: artistRows }] = await Promise.all([
          ids.length ? sb.from('tracks').select(TRACK_SELECT).in('id', ids) : Promise.resolve({ data: [] }),
          sb.from('artists').select('id, name, disambiguation').ilike('name', `%${q.replace(/[%_]/g, '')}%`).limit(12),
        ]);
        const byId = new Map(((rows ?? []) as unknown as Row[]).map((r) => [r.id, r]));
        const ordered = ids.map((i) => byId.get(i)).filter((r): r is Row => !!r);
        const items = await withArtworkClient(sb, ordered);
        if (id !== req.current) return;
        const lower = q.toLowerCase();
        setArtists(((artistRows ?? []) as ArtistHit[])
          .sort((a, b) => Number(b.name.toLowerCase() === lower) - Number(a.name.toLowerCase() === lower) || a.name.length - b.name.length)
          .slice(0, 6));
        setTracks(items);
        setSource(data?.source ?? null);
        setState('done');
        // ask the session directly: on a fresh page load the user hook may not have resolved yet
        void sb.auth.getSession().then(({ data }) => {
          if (data.session && !data.session.user.is_anonymous) void sb.from('search_history').insert({ query: q.slice(0, 200) }).then(() => {}, () => {}); // builders only run when awaited/then'd
        });
      } catch {
        if (id === req.current) setState('error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  if (!q) return <SearchHome />;
  return (
    <div className="pt-4" aria-busy={state === 'loading'}>
      {state === 'error' && <p role="alert" className="text-danger-400">Search failed. Check your connection and try again.</p>}
      {state === 'loading' && !tracks.length && <p className="text-ink-300">Searching…</p>}
      {state === 'done' && !tracks.length && !artists.length && (
        <p className="text-ink-300">No results for “{q}”. Check the spelling or try fewer words.</p>
      )}
      {tracks.length > 0 && (
        <section>
          <h2 className="mb-4 font-display text-2xl font-bold">Songs</h2>
          <TrackList tracks={tracks} />
          {source && source !== 'catalog' && (
            <p className="mt-4 text-xs text-ink-500">Some results were added from the extended catalog just now.</p>
          )}
        </section>
      )}
      {artists.length > 0 && (
        <div className="mt-8">
          <Shelf title="Artists">
            {artists.map((a) => (
              <EntityCard key={a.id} href={`/artist/${a.id}`} artistId={a.id} title={a.name} subtitle={a.disambiguation ?? 'Artist'} round />
            ))}
          </Shelf>
        </div>
      )}
      {q && <ServerResults q={q} />}
      {q && <MoreSources key={q} q={q} />}
      {q && <OpenMusicResults q={q} />}
    </div>
  );
}

/** Empty search: your recent searches and genres to browse. */
function SearchHome() {
  const user = useUser();
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    if (!user) return;
    void supabaseBrowser().from('search_history').select('query').order('created_at', { ascending: false }).limit(40)
      .then(({ data }) => setRecent([...new Set((data ?? []).map((r) => r.query as string))].slice(0, 10)));
  }, [user]);
  return (
    <div className="pt-8">
      <h1 className="font-display text-3xl font-bold">Search</h1>
      <p className="mt-2 text-ink-300">Search a million songs by title or artist. Typos are fine.</p>
      {recent.length > 0 && (
        <section className="mt-8" aria-label="Recent searches">
          <h2 className="mb-3 font-display text-xl font-bold">Recent searches</h2>
          <ul className="flex flex-wrap gap-2">
            {recent.map((r) => (
              <li key={r}><Link href={`/search?q=${encodeURIComponent(r)}`} className="rounded-full bg-ink-800 px-4 py-1.5 text-sm hover:bg-ink-700">{r}</Link></li>
            ))}
          </ul>
        </section>
      )}
      <section className="mt-8" aria-label="Browse genres">
        <h2 className="mb-3 font-display text-xl font-bold">Browse full songs by genre</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Object.entries(GENRE_INFO).map(([slug, g]) => (
            <li key={slug}>
              <Link href={`/genre/${slug}`} className="flex aspect-[5/2] items-end rounded-xl p-3 font-display font-bold text-white shadow-lift transition hover:scale-[1.02]"
                style={{ background: `linear-gradient(135deg, ${g.from}, ${g.to})` }}>{g.label}</Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<p className="pt-4 text-ink-300">Searching…</p>}>
      <Results />
    </Suspense>
  );
}
