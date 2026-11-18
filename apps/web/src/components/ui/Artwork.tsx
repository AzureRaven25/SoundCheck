'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import Image from 'next/image';
import { supabaseBrowser } from '@/lib/supabase/client';
import { sizedArtwork } from '@/lib/artwork-size';

const resolved = new Map<string, Promise<string | null>>();
const MAX_CONCURRENT = 4;
let active = 0;
const waiting: (() => void)[] = [];

/** Run at most MAX_CONCURRENT artwork lookups at once (a grid can ask for dozens). */
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/**
 * Stored artwork is read straight from the `artwork` table, batched: every <Artwork> that mounts within the same
 * 20 ms asks together (one query for a whole grid). Only images never looked up before go to the Edge Functions.
 */
type Kind = 'album' | 'artist';
const pending: Record<Kind, Map<string, ((u: string | null) => void)[]>> = { album: new Map(), artist: new Map() };
const flushTimer: Record<Kind, ReturnType<typeof setTimeout> | null> = { album: null, artist: null };

function storedArt(kind: Kind, id: string): Promise<string | null> {
  return new Promise((resolve) => {
    const waiters = pending[kind].get(id) ?? [];
    waiters.push(resolve);
    pending[kind].set(id, waiters);
    flushTimer[kind] ??= setTimeout(() => void flush(kind), 20);
  });
}
async function flush(kind: Kind) {
  flushTimer[kind] = null;
  const batch = pending[kind];
  pending[kind] = new Map();
  const ids = [...batch.keys()];
  const found = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabaseBrowser().from('artwork').select('entity_id, source_url, storage_path, is_primary')
      .eq('entity_type', kind).in('entity_id', ids.slice(i, i + 100)).eq('status', 'ok')
      .order('is_primary', { ascending: false });
    for (const a of data ?? []) if (!found.has(a.entity_id)) found.set(a.entity_id, a.storage_path ?? a.source_url);
  }
  for (const [id, waiters] of batch) for (const w of waiters) w(found.get(id) ?? null);
}

/** Images we asked a provider for this session and got nothing (don't ask again until reload). */
const NONE = new Set<string>();

function resolveAlbumArt(albumId: string): Promise<string | null> {
  return resolveVia(albumId, 'album', albumId, 'resolve-artwork', { album_id: albumId });
}
/** Artist photo (Wikimedia Commons via Wikidata, Deezer fallback). */
function resolveArtistImage(artistId: string): Promise<string | null> {
  return resolveVia(`artist:${artistId}`, 'artist', artistId, 'resolve-artist-image', { artist_id: artistId });
}
function resolveVia(key: string, kind: Kind, id: string, fn: string, body: Record<string, string>): Promise<string | null> {
  if (!resolved.has(key)) {
    const p = storedArt(kind, id).then((stored) => {
      if (stored || NONE.has(key)) return stored;
      return limited(() => supabaseBrowser().functions.invoke<{ url: string | null; retry?: boolean }>(fn, { body }))
        .then(({ data, error }) => {
          if (error || data?.retry) setTimeout(() => resolved.delete(key), 30_000);
          else if (!data?.url) NONE.add(key);
          return data?.url ?? null;
        })
        .catch(() => {
          setTimeout(() => resolved.delete(key), 30_000);
          return null;
        });
    });
    resolved.set(key, p);
  }
  return resolved.get(key)!;
}

const PALETTES = [
  ['#ff3d9a', '#8b5cff'], ['#8b5cff', '#38e1ff'], ['#38e1ff', '#3d7bff'],
  ['#ff8a3d', '#ff3d9a'], ['#ffc94d', '#ff5e5e'], ['#3ddc97', '#38e1ff'],
];
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Album artwork with graceful fallback: uses the given URL, otherwise resolves the album's cover on
 * demand, otherwise shows a generated gradient with initials. Never blocks rendering.
 */

export function Artwork({
  src, albumId, artistId, title, className, rounded = 'rounded-md', resolve = true, priority = false,
  sizes = '(max-width: 768px) 45vw, 220px',
}: {
  /** artistId: show the artist's photo, falling back to albumId's cover */
  src?: string | null; albumId?: string | null; artistId?: string | null; title: string; className?: string;
  rounded?: string; resolve?: boolean; priority?: boolean; sizes?: string;
}) {
  const [resolvedArt, setResolvedArt] = useState<{ albumId: string; url: string } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (src || (!albumId && !artistId) || !resolve) return;
    let live = true;
    const key = artistId ? `artist:${artistId}` : albumId!;
    void (async () => {
      const u = (artistId ? await resolveArtistImage(artistId) : null) ?? (albumId ? await resolveAlbumArt(albumId) : null);
      if (live && u) setResolvedArt({ albumId: key, url: u });
    })();
    return () => {
      live = false;
    };
  }, [src, albumId, artistId, resolve]);

  const url = src ?? (resolvedArt && resolvedArt.albumId === (artistId ? `artist:${artistId}` : albumId) ? resolvedArt.url : null);
  const failed = !!url && failedUrl === url;

  if (url && !failed) {
    // next/image: fetched once through the Next image optimizer (follows the CAA → archive.org
    // redirect server-side), cached, and served as a right-sized WebP/AVIF.
    return (
      <div className={clsx('relative aspect-square w-full overflow-hidden bg-ink-800', rounded, className)}>
        <Image
          // the host's own thumbnail at about the drawn size (2× for sharp screens): no optimizer quota, no cold resize
          src={sizedArtwork(url, priority || /(?:2\d\d|[3-9]\d\d)px\s*$/.test(sizes) ? 600 : 300)}
          alt=""
          fill
          sizes={sizes}
          priority={priority}
          onError={() => setFailedUrl(url)}
          unoptimized
          className="object-cover"
        />
      </div>
    );
  }
  const [a, b] = PALETTES[hash(title) % PALETTES.length]!;
  const initials = title.split(/\s+/).filter((w) => /\w/.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  return (
    <div
      aria-hidden
      className={clsx('flex aspect-square w-full items-center justify-center font-display font-bold text-white/90', rounded, className)}
      style={{ background: `linear-gradient(135deg, ${a}, ${b})`, containerType: 'inline-size' }}
    >
      <span style={{ fontSize: '32cqw' }}>{initials || '♪'}</span>
    </div>
  );
}
