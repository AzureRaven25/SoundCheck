'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Mic2 } from 'lucide-react';
import { trackAvailability } from '@/lib/acquire';

/** "Sing" call-to-action shown next to Play when a karaoke version of this song is ready for the viewer. */
export function SingButton({ trackId }: { trackId: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void trackAvailability([trackId]).then((m) => { if (live) setReady(!!m.get(trackId)?.karaoke_ready); }).catch(() => {});
    return () => { live = false; };
  }, [trackId]);
  if (!ready) return null;
  return (
    <Link href={`/stage/${trackId}`} className="stage-gradient inline-flex h-14 items-center gap-2 rounded-full px-7 text-base font-bold text-white shadow-lift transition hover:scale-105">
      <Mic2 size={20} aria-hidden /> Sing
    </Link>
  );
}
