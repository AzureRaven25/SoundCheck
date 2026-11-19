import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PlayButton } from '@/components/catalog/Cards';
import { GenreTracks } from '@/components/catalog/GenreTracks';
import { getGenreCounts, getGenreTracks } from '@/lib/catalog';
import { GENRE_INFO } from '@/lib/genres';

export const revalidate = 1800;
export async function generateStaticParams() { return []; }

export async function generateMetadata({ params }: PageProps<'/genre/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  return { title: GENRE_INFO[slug]?.label ?? 'Genre' };
}

export default async function GenrePage({ params }: PageProps<'/genre/[slug]'>) {
  const { slug } = await params;
  const info = GENRE_INFO[slug];
  if (!info) notFound();
  const [tracks, counts] = await Promise.all([getGenreTracks(slug, 100), getGenreCounts()]);
  const total = Number(counts.find((c) => c.genre === slug)?.songs ?? tracks.length);
  return (
    <div className="pt-2">
      <header className="relative -mx-4 mb-6 overflow-hidden px-4 py-10 md:-mx-8 md:px-8" style={{ background: `linear-gradient(135deg, ${info.from}, ${info.to})` }}>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-ink-900" aria-hidden />
        <div className="relative">
          <Link href="/genre" className="text-xs font-bold uppercase tracking-widest text-white/80 hover:underline">Genres</Link>
          <h1 className="mt-2 font-display text-5xl font-extrabold tracking-tight text-white">{info.label}</h1>
          <p className="mt-2 text-white/85">{total.toLocaleString()} full songs, free to play: openly licensed and independent recordings</p>
          <div className="mt-5"><PlayButton tracks={tracks} size="lg" label={`Play ${info.label}`} /></div>
        </div>
      </header>
      {tracks.length ? <GenreTracks slug={slug} initial={tracks} total={total} /> : <p className="text-ink-300">No full songs in this genre yet.</p>}
    </div>
  );
}
