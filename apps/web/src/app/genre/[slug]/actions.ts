'use server';

import { getGenreTracks } from '@/lib/catalog';
import { GENRE_INFO } from '@/lib/genres';
import type { TrackItem } from '@/lib/types';

/** The next page of a genre's full-length songs (public catalog data only). */
export async function loadGenrePage(slug: string, offset: number): Promise<TrackItem[]> {
  if (!GENRE_INFO[slug] || !Number.isInteger(offset) || offset < 0 || offset > 50_000) return [];
  return getGenreTracks(slug, 100, offset);
}
