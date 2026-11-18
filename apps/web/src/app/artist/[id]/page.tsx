import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { EntityCard, PlayButton } from '@/components/catalog/Cards';
import { DetailHeader } from '@/components/catalog/DetailHeader';
import { TrackList } from '@/components/catalog/TrackList';
import { getArtist } from '@/lib/catalog';

/** Public catalog page: cached and refreshed hourly (user-specific parts load in the browser). */
export const revalidate = 3600;
/** No pages at build time; each one is rendered on first visit and then served from cache. */
export async function generateStaticParams() { return []; }

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

export async function generateMetadata({ params }: PageProps<'/artist/[id]'>): Promise<Metadata> {
  const { id } = await params;
  const a = isUuid(id) ? await getArtist(id) : null;
  return { title: a?.artist.name ?? 'Artist' };
}

export default async function ArtistPage({ params }: PageProps<'/artist/[id]'>) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await getArtist(id);
  if (!data) notFound();
  const { artist, topTracks, albums } = data;
  // the artist's own photo when we have it; otherwise it's resolved on the page (album cover as last resort)
  const cover = data.photo ?? null;
  return (
    <div>
      <DetailHeader
        kind="Artist"
        title={artist.name}
        artwork={cover}
        albumId={topTracks[0]?.album_id ?? albums[0]?.id}
        artistId={artist.id}
        round
        meta={<span>{[artist.disambiguation, artist.country].filter(Boolean).join(' · ')}</span>}
        actions={<PlayButton tracks={topTracks} size="lg" label={`Play ${artist.name}`} />}
      />
      {topTracks.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-4 font-display text-2xl font-bold">Popular</h2>
          <TrackList tracks={topTracks.slice(0, 10)} />
        </section>
      )}
      {albums.length > 0 && (
        <section>
          <h2 className="mb-4 font-display text-2xl font-bold">Discography</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {albums.map((a) => (
              <EntityCard
                key={a.id}
                href={`/album/${a.id}`}
                title={a.title}
                subtitle={[a.release_year, a.primary_type === 'album' ? 'Album' : a.primary_type === 'ep' ? 'EP' : 'Single'].filter(Boolean).join(' · ')}
                artwork={a.artwork_url}
                albumId={a.id}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
