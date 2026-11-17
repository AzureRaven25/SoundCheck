import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PlayButton } from '@/components/catalog/Cards';
import { ArtistLine, DetailHeader, FavoriteButton } from '@/components/catalog/DetailHeader';
import { Lyrics } from '@/components/catalog/Lyrics';
import { UploadYourCopy } from '@/components/catalog/UploadYourCopy';
import { ListenElsewhere } from '@/components/catalog/ListenElsewhere';
import { getTrack } from '@/lib/catalog';
import { formatDuration } from '@/lib/format';

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
        actions={<><PlayButton tracks={[t]} size="lg" label={`Play ${t.title}`} /><FavoriteButton trackId={t.id} title={t.title} /></>}
      />
      <UploadYourCopy trackId={t.id} title={t.title} />
      <ListenElsewhere trackId={t.id} title={t.title} artist={t.artist_credit} isrcs={(t as { isrcs?: string[] }).isrcs ?? []} />
      <section aria-labelledby="lyrics-h" className="max-w-3xl">
        <h2 id="lyrics-h" className="mb-4 font-display text-2xl font-bold">Lyrics</h2>
        <Lyrics trackId={t.id} />
      </section>
    </div>
  );
}
