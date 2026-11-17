'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import Image from 'next/image';
import { supabaseBrowser } from '@/lib/supabase/client';

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
 * Lazily ask resolve-artwork for an album's cover (once per album per page load). Transient failures
 * (provider busy/slow, reported as retry=true) are forgotten after 30 s so a later render retries.
 */
function resolveAlbumArt(albumId: string): Promise<string | null> {
  if (!resolved.has(albumId)) {
    const p = limited(() =>
      supabaseBrowser().functions.invoke<{ url: string | null; retry?: boolean }>('resolve-artwork', { body: { album_id: albumId } }),
    )
      .then(({ data, error }) => {
        if (error || data?.retry) setTimeout(() => resolved.delete(albumId), 30_000);
        return data?.url ?? null;
      })
      .catch(() => {
        setTimeout(() => resolved.delete(albumId), 30_000);
        return null;
      });
    resolved.set(albumId, p);
  }
  return resolved.get(albumId)!;
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
  src, albumId, title, className, rounded = 'rounded-md', resolve = true, priority = false,
  sizes = '(max-width: 768px) 45vw, 220px',
}: {
  src?: string | null; albumId?: string | null; title: string; className?: string;
  rounded?: string; resolve?: boolean; priority?: boolean; sizes?: string;
}) {
  const [resolvedArt, setResolvedArt] = useState<{ albumId: string; url: string } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (src || !albumId || !resolve) return;
    let live = true;
    void resolveAlbumArt(albumId).then((u) => live && u && setResolvedArt({ albumId, url: u }));
    return () => {
      live = false;
    };
  }, [src, albumId, resolve]);

  const url = src ?? (resolvedArt && resolvedArt.albumId === albumId ? resolvedArt.url : null);
  const failed = !!url && failedUrl === url;

  if (url && !failed) {
    // next/image: fetched once through the Next image optimizer (follows the CAA → archive.org
    // redirect server-side), cached, and served as a right-sized WebP/AVIF.
    return (
      <div className={clsx('relative aspect-square w-full overflow-hidden bg-ink-800', rounded, className)}>
        <Image
          src={url}
          alt=""
          fill
          sizes={sizes}
          priority={priority}
          onError={() => setFailedUrl(url)}
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
