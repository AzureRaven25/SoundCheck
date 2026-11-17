/**
 * Apple Music (MusicKit) developer token for the web/apps (research.md §3).
 *
 *   POST {}  → { configured: false } | { configured: true, token, storefront_default }
 *
 * Needs APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID and APPLE_MUSIC_PRIVATE_KEY (the MusicKit .p8 key from the
 * Apple Developer Program), all server-side. Full songs then play for users who sign in with an Apple Music
 * subscription. The stream is FairPlay-protected, so Apple Music is listen-only (never a karaoke source).
 */
import { handle, json } from '../_shared/runtime.ts';
import { developerToken, importP8 } from '../_shared/applemusic.ts';

let cached: { token: string; exp: number } | null = null;

Deno.serve((req) => handle(req, async () => {
  const teamId = Deno.env.get('APPLE_MUSIC_TEAM_ID'), keyId = Deno.env.get('APPLE_MUSIC_KEY_ID'), pem = Deno.env.get('APPLE_MUSIC_PRIVATE_KEY');
  if (!teamId || !keyId || !pem) return json({ configured: false });
  const now = Date.now();
  if (!cached || cached.exp - now < 3600_000) {
    const origins = (Deno.env.get('APPLE_MUSIC_ORIGINS') ?? 'https://soundcheck-gules.vercel.app,http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean);
    cached = { token: await developerToken({ teamId, keyId, key: await importP8(pem), origins }), exp: now + 12 * 3600_000 };
  }
  return json({ configured: true, token: cached.token, storefront_default: 'us' });
}));
