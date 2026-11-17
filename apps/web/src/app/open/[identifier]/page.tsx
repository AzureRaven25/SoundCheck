'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';

/** Opens an Internet Archive album: imports it into the catalog (idempotent), then shows the normal album page. */
export default function OpenAlbumPage() {
  const { identifier } = useParams<{ identifier: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void supabaseBrowser().functions.invoke<{ album: { id: string } }>('open-music', { body: { action: 'album', identifier: decodeURIComponent(identifier) } })
      .then(({ data, error: e }) => {
        if (e || !data?.album) setError('Couldn’t open this album from the Internet Archive. Try again in a moment.');
        else router.replace(`/album/${data.album.id}`);
      });
  }, [identifier, router]);
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      {error ? <p role="alert" className="text-danger-400">{error}</p> : <p className="flex items-center gap-3 text-ink-300"><Loader2 className="animate-spin" /> Opening album…</p>}
    </div>
  );
}
