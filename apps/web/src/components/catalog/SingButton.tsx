'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Mic2 } from 'lucide-react';
import { trackAvailability } from '@/lib/acquire';

/**
 * "Sing" next to Play. With a karaoke version ready, Stage scores note by note against the melody; otherwise it
 * opens the sing-along Stage over the song's YouTube karaoke video with synced lyrics.
 */
export function SingButton({ trackId }: { trackId: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void trackAvailability([trackId]).then((m) => { if (live) setReady(!!m.get(trackId)?.karaoke_ready); }).catch(() => {});
    return () => { live = false; };
  }, [trackId]);
  return (
    <Link href={`/stage/${trackId}`} title={ready ? 'Karaoke version ready: scored note by note' : 'Sing along to the karaoke video with synced lyrics'}
      className="stage-gradient inline-flex h-14 items-center gap-2 rounded-full px-7 text-base font-bold text-white shadow-lift transition hover:scale-105">
      <Mic2 size={20} aria-hidden /> Sing
    </Link>
  );
}
