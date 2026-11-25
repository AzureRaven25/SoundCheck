'use client';
import { useEffect, useState } from 'react';
import { PROVIDER_LABEL, trackAvailability, type Availability, type AvailabilityLevel } from '@/lib/acquire';

/** One plain-language line for where a song stands (internally: catalog → preview → full → karaoke-eligible → ready). */
const LABEL: Record<AvailabilityLevel, string> = {
  catalog: 'Sing along with the karaoke video',
  preview: '30-second preview · sing along with the karaoke video',
  full: 'Plays in full',
  karaoke_ok: 'Plays in full · a scored karaoke version can be made',
  karaoke_ready: 'Karaoke ready · scored note by note',
};

/**
 * Where this song stands for the viewer, in one line, plus the full-length sources behind it. (YouTube and Apple
 * Music play in their own players and aren't counted as playable files here.)
 */
export function SourceAvailability({ trackId }: { trackId: string }) {
  const [a, setA] = useState<Availability | null>(null);
  useEffect(() => {
    let live = true;
    void trackAvailability([trackId]).then((m) => { if (live) setA(m.get(trackId) ?? null); });
    return () => { live = false; };
  }, [trackId]);
  if (!a) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 text-xs" data-testid="availability" data-level={a.level}>
      <span className={`rounded-full px-3 py-1 font-bold ${a.level === 'karaoke_ready' ? 'stage-gradient text-white' : 'bg-ink-800 text-ink-100'}`}>{LABEL[a.level]}</span>
      {a.full_sources.length > 0 && (
        <span className="text-ink-500">Full-length from {a.full_sources.map((p) => PROVIDER_LABEL[p] ?? p).join(', ')}</span>
      )}
    </div>
  );
}
