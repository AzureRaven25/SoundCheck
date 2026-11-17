import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PlayButton } from '@/components/catalog/Cards';
import { ArtistLine, DetailHeader } from '@/components/catalog/DetailHeader';
import { TrackList } from '@/components/catalog/TrackList';
import { getAlbum } from '@/lib/catalog';
import { plural } from '@/lib/format';

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const TYPES: Record<string, string> = { album: 'Album', single: 'Single', ep: 'EP', other: 'Release' };

export async function generateMetadata({ params }: PageProps<'/album/[id]'>): Promise<Metadata> {
  const { id } = await params;
  const a = isUuid(id) ? await getAlbum(id) : null;
  return { title: a ? `${a.album.title} · ${a.album.artist_credit}` : 'Album' };
}

export default async function AlbumPage({ params }: PageProps<'/album/[id]'>) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await getAlbum(id);
  if (!data) notFound();
  const { album, tracks } = data;
  return (
    <div>
      <DetailHeader
        kind={TYPES[album.primary_type] ?? 'Album'}
        title={album.title}
        artwork={album.artwork_url}
        albumId={album.id}
        meta={
          <span>
            <ArtistLine artists={album.artists} fallback={album.artist_credit} />
            {album.release_year && <> · {album.release_year}</>} · {plural(tracks.length, 'song')} in SoundCheck
          </span>
        }
        actions={<PlayButton tracks={tracks} size="lg" label={`Play ${album.title}`} />}
      />
      {tracks.length ? (
        <TrackList tracks={tracks} showAlbum={false} showArtwork={false} />
      ) : (
        <p className="text-ink-300">No songs from this release are in the catalog yet.</p>
      )}
    </div>
  );
}
