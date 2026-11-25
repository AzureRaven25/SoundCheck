import Link from 'next/link';
import { Mic2, Search } from 'lucide-react';

export const metadata = { title: 'Page not found' };

/** Wrong turn: a friendly way back instead of a bare 404. */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="font-display text-7xl font-black text-ink-700">404</p>
      <h1 className="font-display text-3xl font-extrabold tracking-tight">That page missed its cue</h1>
      <p className="max-w-md text-ink-300">The link may be old or mistyped. Find a song and get back on stage.</p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <Link href="/search" className="flex items-center gap-2 rounded-full bg-ink-50 px-5 py-2.5 text-sm font-bold text-ink-950"><Search size={16} aria-hidden /> Search songs</Link>
        <Link href="/sing" className="stage-gradient flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold text-white"><Mic2 size={16} aria-hidden /> Sing</Link>
        <Link href="/" className="rounded-full border border-ink-700 px-5 py-2.5 text-sm font-bold hover:border-ink-300">Home</Link>
      </div>
    </div>
  );
}
