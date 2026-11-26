'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { refreshArtist } from '@/app/artist/[id]/actions';

/**
 * When we only know a few of an artist's songs, fetch the rest from Apple's catalog in the background and refresh
 * the page (once a week per artist, server-side cached).
 */
export function ArtistFill({ artistId, known }: { artistId: string; known: number }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  useEffect(() => {
    if (known >= 20) return;   // the page shows up to 20: a full page means we already know plenty
    let live = true;
    setState('loading');
    void supabaseBrowser().functions.invoke<{ added: number }>('catalog-search', { body: { action: 'artist', artist_id: artistId } })
      .then(async ({ data }) => {
        if (!live) return;
        if (data?.added) { await refreshArtist(artistId); router.refresh(); }
        setState('done');
      }, () => live && setState('done'));
    return () => { live = false; };
  }, [artistId, known, router]);
  if (state !== 'loading') return null;
  return <p className="mb-6 flex items-center gap-2 text-sm text-ink-300" role="status"><Loader2 size={14} className="animate-spin" aria-hidden /> Finding more of their songs…</p>;
}
