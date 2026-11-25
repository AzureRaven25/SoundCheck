'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Mic2, Search } from 'lucide-react';

const IDEAS = ['Bohemian Rhapsody', 'Someone Like You', 'Mr. Brightside', 'Dancing Queen', 'Shallow', 'Don’t Stop Believin’', 'Valerie', 'Rolling in the Deep'];

/** The home page's main action: type any song and go sing it. */
export function HeroSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [idea, setIdea] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setIdea((i) => (i + 1) % IDEAS.length), 2600);
    return () => clearInterval(iv);
  }, []);
  return (
    <form role="search" className="mt-6 max-w-xl" onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`); }}>
      <label htmlFor="hero-q" className="sr-only">What do you want to sing?</label>
      <div className="flex items-center gap-2 rounded-full bg-white p-1.5 pl-5 shadow-lift ring-4 ring-white/20 focus-within:ring-white/50">
        <Search size={20} className="shrink-0 text-ink-700" aria-hidden />
        <input id="hero-q" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
          placeholder={`Try “${IDEAS[idea]}”`}
          className="min-w-0 flex-1 bg-transparent py-2 text-base font-semibold text-ink-950 placeholder:text-ink-500 focus:outline-none" />
        <button type="submit" className="stage-gradient flex shrink-0 items-center gap-2 rounded-full px-4 py-2.5 sm:px-5 text-sm font-bold text-white transition hover:scale-105">
          <Mic2 size={16} aria-hidden /> <span>Let’s sing</span>
        </button>
      </div>
    </form>
  );
}

/** Decorative equaliser bars. */
export function Equalizer({ bars = 18, className = '' }: { bars?: number; className?: string }) {
  return (
    <div className={`flex h-full items-end gap-1 ${className}`} aria-hidden>
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} className="block w-1.5 origin-bottom animate-eq rounded-full bg-white/70"
          style={{ height: `${40 + ((i * 37) % 60)}%`, animationDelay: `${-((i * 0.13) % 1.1).toFixed(2)}s`, animationDuration: `${0.8 + ((i * 7) % 5) / 10}s` }} />
      ))}
    </div>
  );
}

/** Decorative music notes drifting up. */
export function FloatingNotes() {
  const notes = ['♪', '♫', '♬', '♩', '♪', '♫'];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {notes.map((n, i) => (
        <span key={i} className="absolute bottom-0 animate-float-note text-3xl text-white/60"
          style={{ left: `${8 + i * 15}%`, animationDelay: `${-i * 1.6}s`, animationDuration: `${8 + (i % 3) * 2}s` }}>{n}</span>
      ))}
    </div>
  );
}
