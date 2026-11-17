'use client';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Globe, Lock, Trash2 } from 'lucide-react';
import { PlayButton } from '@/components/catalog/Cards';
import { DetailHeader } from '@/components/catalog/DetailHeader';
import { TrackList } from '@/components/catalog/TrackList';
import { plural } from '@/lib/format';
import { useLibrary } from '@/lib/hooks/useLibrary';
import { supabaseBrowser } from '@/lib/supabase/client';
import { TRACK_SELECT, withArtworkClient, type Row } from '@/lib/track-mapping';
import type { TrackItem } from '@/lib/types';

interface Playlist { id: string; title: string; description: string | null; is_public: boolean; owner_id: string; profiles: { display_name: string } | null }

export default function PlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { userId, refreshPlaylists } = useLibrary();
  const [pl, setPl] = useState<Playlist | null | undefined>(undefined);
  const [entries, setEntries] = useState<{ entryId: number; track: TrackItem }[]>([]);
  const [title, setTitle] = useState('');

  const load = useCallback(async () => {
    const sb = supabaseBrowser();
    const { data } = await sb.from('playlists').select('id, title, description, is_public, owner_id').eq('id', id).maybeSingle();
    if (!data) return setPl(null);
    const { data: owner } = await sb.from('profiles').select('display_name').eq('id', data.owner_id).maybeSingle();
    setPl({ ...data, profiles: owner });
    setTitle(data.title);
    const { data: rows } = await sb.from('playlist_tracks').select(`id, position, tracks(${TRACK_SELECT})`).eq('playlist_id', id).order('position');
    const list = ((rows ?? []) as unknown as { id: number; tracks: Row | null }[]).filter((r) => r.tracks);
    const items = await withArtworkClient(sb, list.map((r) => r.tracks!));
    setEntries(list.map((r, i) => ({ entryId: r.id, track: items[i]! })));
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (pl === undefined) return <p className="pt-6 text-ink-300">Loading…</p>;
  if (pl === null) return <p className="pt-6 text-ink-300">This playlist doesn&apos;t exist or is private.</p>;
  const mine = pl.owner_id === userId;
  const sb = supabaseBrowser();

  return (
    <div>
      <DetailHeader
        kind={`${pl.is_public ? 'Public' : 'Private'} playlist`}
        title={pl.title}
        artwork={entries.find((e) => e.track.artwork_url)?.track.artwork_url ?? null}
        meta={<span><b className="text-ink-50">{pl.profiles?.display_name ?? 'Someone'}</b> · {plural(entries.length, 'song')}</span>}
        actions={
          <>
            <PlayButton tracks={entries.map((e) => e.track)} size="lg" label={`Play ${pl.title}`} />
            {mine && (
              <>
                <button
                  type="button"
                  onClick={async () => { await sb.from('playlists').update({ is_public: !pl.is_public }).eq('id', pl.id); await load(); await refreshPlaylists(); }}
                  className="flex items-center gap-2 rounded-full border border-ink-700 px-4 py-2 text-sm font-bold hover:border-ink-300"
                >
                  {pl.is_public ? <><Lock size={16} /> Make private</> : <><Globe size={16} /> Make public</>}
                </button>
                <button
                  type="button"
                  aria-label="Delete playlist"
                  onClick={async () => {
                    if (!confirm(`Delete “${pl.title}”? This can't be undone.`)) return;
                    await sb.from('playlists').delete().eq('id', pl.id);
                    await refreshPlaylists();
                    router.push('/library?tab=playlists');
                  }}
                  className="rounded-full p-2 text-ink-300 hover:text-danger-400"
                >
                  <Trash2 size={20} />
                </button>
              </>
            )}
          </>
        }
      />
      {mine && (
        <form
          className="mb-6 flex max-w-md gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim()) return;
            await sb.from('playlists').update({ title: title.trim().slice(0, 100) }).eq('id', pl.id);
            await load();
            await refreshPlaylists();
          }}
        >
          <label className="sr-only" htmlFor="pl-title">Playlist name</label>
          <input id="pl-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} className="flex-1 rounded-md border border-ink-700 bg-ink-850 px-3 py-2 text-sm" />
          <button type="submit" className="rounded-full bg-ink-50 px-4 text-sm font-bold text-ink-950">Rename</button>
        </form>
      )}
      {entries.length ? (
        <TrackList
          tracks={entries.map((e) => e.track)}
          onRemove={mine ? async (_t, i) => { await sb.from('playlist_tracks').delete().eq('id', entries[i]!.entryId); await load(); } : undefined}
        />
      ) : (
        <p className="text-ink-300">{mine ? 'Add songs from any song’s ⋯ menu.' : 'This playlist is empty.'}</p>
      )}
    </div>
  );
}
