'use client';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { Heart } from 'lucide-react';
import clsx from 'clsx';
import { Artwork } from '@/components/ui/Artwork';
import { useLibrary } from '@/lib/hooks/useLibrary';

export function ArtistLine({ artists, fallback }: { artists?: { id: string; name: string; join_phrase: string }[]; fallback: string }) {
  if (!artists?.length) return <>{fallback}</>;
  return (
    <>
      {artists.map((a) => (
        <Fragment key={a.id}>
          <Link href={`/artist/${a.id}`} className="font-bold text-ink-50 hover:underline">{a.name}</Link>
          {a.join_phrase}
        </Fragment>
      ))}
    </>
  );
}

/** Hero header for track / album / artist / playlist pages. */
export function DetailHeader({
  kind, title, artwork, albumId, artistId, round, meta, actions,
}: {
  kind: string; title: string; artwork?: string | null; albumId?: string | null; artistId?: string | null; round?: boolean; meta: ReactNode; actions?: ReactNode;
}) {
  return (
    <header className="relative -mx-4 mb-6 overflow-hidden px-4 pb-6 pt-6 md:-mx-8 md:px-8">
      {artwork && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={artwork} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-3xl [mask-image:linear-gradient(to_bottom,black_40%,transparent)]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent to-ink-900" aria-hidden />
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end">
        <div className="w-48 shrink-0 shadow-lift md:w-56">
          <Artwork src={artwork} albumId={albumId} artistId={artistId} title={title} rounded={round ? 'rounded-full' : 'rounded-lg'} priority sizes="224px" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-ink-300">{kind}</p>
          <h1 className={clsx('mt-2 font-display font-extrabold leading-none tracking-tight', title.length > 30 ? 'text-3xl md:text-5xl' : 'text-4xl md:text-7xl')}>
            {title}
          </h1>
          <div className="mt-4 text-sm text-ink-300">{meta}</div>
        </div>
      </div>
      {actions && <div className="relative mt-6 flex items-center gap-4">{actions}</div>}
    </header>
  );
}

export function FavoriteButton({ trackId, title }: { trackId: string; title: string }) {
  const { userId, favorites, toggleFavorite } = useLibrary();
  if (!userId) return null;
  const liked = favorites.has(trackId);
  return (
    <button
      type="button"
      aria-label={liked ? `Remove ${title} from favorites` : `Save ${title} to favorites`}
      aria-pressed={liked}
      onClick={() => void toggleFavorite(trackId)}
      className={clsx('rounded-full p-2 transition-transform hover:scale-110', liked ? 'text-pink-500' : 'text-ink-300 hover:text-ink-50')}
    >
      <Heart size={30} fill={liked ? 'currentColor' : 'none'} />
    </button>
  );
}
