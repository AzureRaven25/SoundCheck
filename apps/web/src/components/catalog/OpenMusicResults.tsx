'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { licenseLabel } from '@soundcheck/contracts';
import { supabaseBrowser } from '@/lib/supabase/client';

interface OpenAlbum { identifier: string; title: string; creator: string; year: number | null; license_url: string | null; karaoke_ok: boolean; cover: string }

/** Search results from the Internet Archive: complete recordings under Creative Commons / public-domain licenses. */
export function OpenMusicResults({ q }: { q: string }) {
  const [albums, setAlbums] = useState<OpenAlbum[] | null>(null);
  useEffect(() => {
    let live = true;
    setAlbums(null);
    void supabaseBrowser().functions.invoke<{ albums: OpenAlbum[] }>('open-music', { body: { action: 'search', q, limit: 6 } })
      .then(({ data }) => { if (live) setAlbums(data?.albums ?? []); });
    return () => { live = false; };
  }, [q]);
  if (!albums?.length) return null;
  return (
    <section className="mt-10" aria-label="Open music">
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="font-display text-2xl font-bold">Full songs, free to play</h2>
        <p className="text-sm text-ink-500">Creative Commons recordings from the Internet Archive</p>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {albums.map((a) => (
          <Link key={a.identifier} href={`/open/${encodeURIComponent(a.identifier)}`} className="group rounded-lg p-2 hover:bg-ink-850">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.cover} alt="" loading="lazy" className="aspect-square w-full rounded-md object-cover" />
            <p className="mt-2 truncate text-sm font-bold">{a.title}</p>
            <p className="truncate text-xs text-ink-300">{a.creator}</p>
            <p className="mt-1 text-[11px] text-ink-500">{licenseLabel(a.license_url)}{a.karaoke_ok ? ' · karaoke OK' : ''}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
