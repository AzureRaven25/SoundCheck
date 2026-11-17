'use client';
import { useEffect, useState } from 'react';
import { PROVIDER_LABEL, trackAvailability, type Availability, type AvailabilityLevel } from '@/lib/acquire';

const LEVELS: { level: AvailabilityLevel; label: string }[] = [
  { level: 'catalog', label: 'In the catalog' },
  { level: 'preview', label: 'Preview' },
  { level: 'full', label: 'Full song' },
  { level: 'karaoke_ok', label: 'Karaoke-eligible' },
  { level: 'karaoke_ready', label: 'Karaoke ready' },
];

/**
 * Where this song stands for the viewer, on one scale: in the catalog → preview → full song → karaoke-eligible →
 * karaoke ready, plus the full-length sources behind it. (YouTube/Apple Music play in their own players and aren't
 * counted as playable files here.)
 */
export function SourceAvailability({ trackId }: { trackId: string }) {
  const [a, setA] = useState<Availability | null>(null);
  useEffect(() => {
    let live = true;
    void trackAvailability([trackId]).then((m) => { if (live) setA(m.get(trackId) ?? null); });
    return () => { live = false; };
  }, [trackId]);
  if (!a) return null;
  const reached = LEVELS.findIndex((l) => l.level === a.level);
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 text-xs" data-testid="availability" data-level={a.level}>
      <ol className="flex flex-wrap gap-1" aria-label="Availability">
        {LEVELS.map((l, i) => (
          <li key={l.level} aria-current={i === reached ? 'true' : undefined}
            className={`rounded-full px-2.5 py-1 ${i <= reached ? (i === reached ? 'bg-ink-50 font-bold text-ink-950' : 'bg-ink-700 text-ink-100') : 'bg-ink-850 text-ink-500'}`}>
            {l.label}
          </li>
        ))}
      </ol>
      {a.full_sources.length > 0 && (
        <span className="text-ink-500">Full-length from {a.full_sources.map((p) => PROVIDER_LABEL[p] ?? p).join(', ')}</span>
      )}
    </div>
  );
}
