import type { Metadata } from 'next';
import Link from 'next/link';
import { getGenreCounts } from '@/lib/catalog';
import { GENRE_INFO } from '@/lib/genres';

export const metadata: Metadata = { title: 'Genres' };
export const revalidate = 1800;

export default async function GenresPage() {
  const counts = new Map((await getGenreCounts()).map((c) => [c.genre, c.songs]));
  const genres = Object.entries(GENRE_INFO).sort((a, b) => (counts.get(b[0]) ?? 0) - (counts.get(a[0]) ?? 0));
  return (
    <div className="pt-4">
      <h1 className="font-display text-4xl font-extrabold tracking-tight">Browse by genre</h1>
      <p className="mt-2 text-ink-300">Every song here plays in full, free.</p>
      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {genres.map(([slug, g]) => (
          <li key={slug}>
            <Link href={`/genre/${slug}`} className="flex aspect-[5/3] flex-col justify-end rounded-xl p-4 text-white shadow-lift transition hover:scale-[1.02]"
              style={{ background: `linear-gradient(135deg, ${g.from}, ${g.to})` }}>
              <span className="font-display text-xl font-bold">{g.label}</span>
              <span className="text-xs text-white/80">{(counts.get(slug) ?? 0).toLocaleString()} songs</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
