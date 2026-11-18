import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PlayButton, Shelf, TrackCard } from '@/components/catalog/Cards';
import { SingButton } from '@/components/catalog/SingButton';
import { ArtistLine, DetailHeader, FavoriteButton } from '@/components/catalog/DetailHeader';
import { Lyrics } from '@/components/catalog/Lyrics';
import { UploadYourCopy } from '@/components/catalog/UploadYourCopy';
import { SourceAvailability } from '@/components/catalog/SourceAvailability';
import { ListenElsewhere } from '@/components/catalog/ListenElsewhere';
import { getMoreByArtist, getTrack } from '@/lib/catalog';
import { formatDuration } from '@/lib/format';

/** Public catalog page: cached and refreshed hourly (user-specific parts load in the browser). */
export const revalidate = 3600;
/** No pages at build time; each one is rendered on first visit and then served from cache. */
export async function generateStaticParams() { return []; }

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

export async function generateMetadata({ params }: PageProps<'/track/[id]'>): Promise<Metadata> {
  const { id } = await params;
  const t = isUuid(id) ? await getTrack(id) : null;
  return { title: t ? `${t.title} · ${t.artist_credit}` : 'Song' };
}

export default async function TrackPage({ params }: PageProps<'/track/[id]'>) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const t = await getTrack(id);
  if (!t) notFound();
  const more = await getMoreByArtist(t.artist_credit, t.id);
  return (
    <div>
      <DetailHeader
        kind="Song"
        title={t.title}
        artwork={t.artwork_url}
        albumId={t.album_id}
        meta={
          <span>
            <ArtistLine artists={t.artists} fallback={t.artist_credit} />
            {t.album_id && t.album_title && <> · <Link href={`/album/${t.album_id}`} className="hover:underline">{t.album_title}</Link></>}
            {t.release_year && <> · {t.release_year}</>}
            {t.duration_ms && <> · {formatDuration(t.duration_ms)}</>}
          </span>
        }
        actions={<><PlayButton tracks={[t]} size="lg" label={`Play ${t.title}`} /><SingButton trackId={t.id} /><FavoriteButton trackId={t.id} title={t.title} /></>}
      />
      <SourceAvailability trackId={t.id} />
      <UploadYourCopy trackId={t.id} title={t.title} />
      <ListenElsewhere trackId={t.id} title={t.title} artist={t.artist_credit} isrcs={(t as { isrcs?: string[] }).isrcs ?? []} />
      <section aria-labelledby="lyrics-h" className="max-w-3xl">
        <h2 id="lyrics-h" className="mb-4 font-display text-2xl font-bold">Lyrics</h2>
        <Lyrics trackId={t.id} />
      </section>
      {more.length > 0 && (
        <div className="mt-12">
          <Shelf title={`More by ${t.artist_credit}`}>
            {more.map((m) => <TrackCard key={m.id} t={m} list={more} />)}
          </Shelf>
        </div>
      )}
    </div>
  );
}
