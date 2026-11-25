import type { MetadataRoute } from 'next';

/** Installable on phones and desktops ("Add to Home Screen"): opens straight into the app, dark, no browser chrome. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SoundCheck',
    short_name: 'SoundCheck',
    description: 'Stream music, sing karaoke with your phone as the mic, and get scored.',
    start_url: '/',
    display: 'standalone',
    background_color: '#07060c',
    theme_color: '#07060c',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Join a party', url: '/join' },
      { name: 'Sing', url: '/sing' },
      { name: 'Search', url: '/search' },
    ],
  };
}
