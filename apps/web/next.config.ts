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
    remotePatterns: [
      { protocol: 'https', hostname: 'coverartarchive.org' },
      { protocol: 'https', hostname: '**.archive.org' },
      { protocol: 'https', hostname: '**.mzstatic.com' },
      { protocol: 'https', hostname: '**.supabase.co' },
    ],
  },
};

export default nextConfig;
