'use client';

import { useRouter } from 'next/navigation';
import { Shuffle } from 'lucide-react';

/** Opens Stage on a random song from the ones ready to sing. */
export function SurpriseMe({ ids }: { ids: string[] }) {
  const router = useRouter();
  if (!ids.length) return null;
  return (
    <button type="button" onClick={() => router.push(`/stage/${ids[Math.floor(Math.random() * ids.length)]}`)}
      className="stage-gradient inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold text-white shadow-lift transition hover:scale-105">
      <Shuffle size={16} aria-hidden /> Surprise me
    </button>
  );
}
