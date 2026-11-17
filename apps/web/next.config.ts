import type { NextConfig } from 'next';

/**
 * Cache Components are off: SoundCheck is a highly interactive app (player, realtime sessions) and
 * every Supabase session read would otherwise need its own Suspense boundary. Public catalog pages
 * still render on the server. See docs/ARCHITECTURE.md (Website).
 */
const nextConfig: NextConfig = {
  cacheComponents: false,
  turbopack: {
    rules: {
      '*.css': { loaders: ['@tailwindcss/turbopack'], as: '*.css' },
    },
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60 * 60 * 24 * 30, // covers never change
    remotePatterns: [
      { protocol: 'https', hostname: 'coverartarchive.org' },
      { protocol: 'https', hostname: 'archive.org' },        // Internet Archive item images (open music)
      { protocol: 'https', hostname: '**.archive.org' },
      { protocol: 'https', hostname: '**.mzstatic.com' },
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: '**.wikimedia.org' },     // artist photos (Wikimedia Commons)
      { protocol: 'https', hostname: 'commons.wikimedia.org' },
      { protocol: 'https', hostname: '**.dzcdn.net' },         // artist photos (Deezer fallback)
    ],
  },
};

export default nextConfig;
