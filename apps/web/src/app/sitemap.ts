import type { MetadataRoute } from 'next';
import { supabasePublic } from '@/lib/supabase/public';
import { GENRE_INFO } from '@/lib/genres';
import { SITE_ORIGIN } from '@/lib/site';

export const revalidate = 86400;

/** Public pages: home, browse, genres, and the newest full-length + most popular songs. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const sb = supabasePublic();
  const [{ data: full }, { data: popular }] = await Promise.all([
    sb.from('track_sources').select('track_id').not('stream_url', 'is', null).order('created_at', { ascending: false }).limit(5000),
    sb.from('tracks').select('id').order('popularity', { ascending: false }).limit(5000),
  ]);
  const ids = [...new Set([...(full ?? []).map((r) => r.track_id as string), ...(popular ?? []).map((r) => r.id as string)])];
  const now = new Date();
  return [
    { url: SITE_ORIGIN, lastModified: now, changeFrequency: 'daily', priority: 1 },
    ...['/sing', '/genre', '/search', '/leaderboards'].map((p) => ({ url: `${SITE_ORIGIN}${p}`, lastModified: now })),
    ...Object.keys(GENRE_INFO).map((g) => ({ url: `${SITE_ORIGIN}/genre/${g}`, lastModified: now, changeFrequency: 'daily' as const })),
    ...ids.map((id) => ({ url: `${SITE_ORIGIN}/track/${id}` })),
  ];
}
