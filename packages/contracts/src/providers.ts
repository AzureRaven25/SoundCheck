/**
 * SoundCheck music providers and what each one is actually allowed and able to do (research.md §1–4).
 * Catalog data and audio are separate capabilities: having a song's metadata never implies playable audio.
 */
export type ProviderId =
  | 'upload'            // the user's own uploaded copy
  | 'personal_server'   // the user's Navidrome / Subsonic / Jellyfin server
  | 'internet_archive'  // Creative Commons / public-domain recordings
  | 'apple_music'       // MusicKit, subscribers only, DRM
  | 'youtube'           // official embedded player
  | 'itunes_preview'    // 30 s previews
  | 'spotify';          // metadata and links only

export type PlaybackKind = 'full' | 'preview' | 'none';

export interface ProviderCapabilities {
  label: string;
  search: boolean;
  metadata: boolean;
  artwork: boolean;
  /** what the provider lets us play */
  playback: PlaybackKind;
  /** needs the user to sign in to the provider (or connect a server) */
  needsUserAuth: boolean;
  /** needs SoundCheck-side credentials (env) before it works at all */
  needsAppCredentials: string[];
  /** we may decode the audio and derive stems for karaoke */
  karaoke: boolean | 'license';
  /** playback happens inside the provider's own player (no Web Audio processing, no key shift) */
  ownPlayer: boolean;
  note: string;
}

export const PROVIDERS: Record<ProviderId, ProviderCapabilities> = {
  upload: {
    label: 'Your upload', search: false, metadata: false, artwork: false, playback: 'full', needsUserAuth: true,
    needsAppCredentials: [], karaoke: true, ownPlayer: false, note: 'Your own copy; stems stay private to you.',
  },
  personal_server: {
    label: 'Your music server', search: true, metadata: true, artwork: true, playback: 'full', needsUserAuth: true,
    needsAppCredentials: [], karaoke: true, ownPlayer: false,
    note: 'Navidrome, Airsonic, Gonic (Subsonic API) or Jellyfin. Credentials stay on this device.',
  },
  internet_archive: {
    label: 'Internet Archive', search: true, metadata: true, artwork: true, playback: 'full', needsUserAuth: false,
    needsAppCredentials: [], karaoke: 'license', ownPlayer: false,
    note: 'Creative Commons and public-domain recordings. Karaoke only when the license allows derivatives.',
  },
  apple_music: {
    label: 'Apple Music', search: true, metadata: true, artwork: true, playback: 'full', needsUserAuth: true,
    needsAppCredentials: ['APPLE_MUSIC_TEAM_ID', 'APPLE_MUSIC_KEY_ID', 'APPLE_MUSIC_PRIVATE_KEY'], karaoke: false, ownPlayer: true,
    note: 'Full songs for Apple Music subscribers through MusicKit. DRM-protected, so not available for karaoke.',
  },
  youtube: {
    label: 'YouTube', search: true, metadata: true, artwork: true, playback: 'full', needsUserAuth: false,
    needsAppCredentials: ['YOUTUBE_API_KEY'], karaoke: false, ownPlayer: true,
    note: 'Full videos in YouTube’s own player. YouTube’s policies don’t allow separating the audio, so no karaoke.',
  },
  itunes_preview: {
    label: 'Preview', search: true, metadata: true, artwork: true, playback: 'preview', needsUserAuth: false,
    needsAppCredentials: [], karaoke: false, ownPlayer: false, note: '30-second preview courtesy of Apple Music.',
  },
  spotify: {
    label: 'Spotify', search: false, metadata: true, artwork: true, playback: 'none', needsUserAuth: false,
    needsAppCredentials: [], karaoke: false, ownPlayer: true,
    note: 'Links only: Spotify’s developer terms prohibit syncing its audio with lyrics or altering it.',
  },
};

/** Creative Commons licenses with ND (no derivatives) don't allow making an instrumental. */
export function licenseAllowsKaraoke(licenseUrl: string | null | undefined): boolean {
  if (!licenseUrl) return false;
  const u = licenseUrl.toLowerCase();
  if (u.includes('publicdomain') || u.includes('/zero/')) return true;
  return u.includes('creativecommons.org/licenses/') && !u.includes('-nd');
}

/** "CC BY-NC-SA 3.0" from a Creative Commons deed URL. */
export function licenseLabel(licenseUrl: string | null | undefined): string | null {
  if (!licenseUrl) return null;
  const m = licenseUrl.match(/licenses\/([a-z-]+)\/([\d.]+)/i);
  if (m) return `CC ${m[1]!.toUpperCase()} ${m[2]}`;
  if (/publicdomain\/zero/i.test(licenseUrl)) return 'CC0';
  if (/publicdomain/i.test(licenseUrl)) return 'Public domain';
  return 'Open license';
}


/** Video id from any YouTube / YouTube Music link, or a bare 11-character id. */
export function youtubeId(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else { const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/); id = m?.[1] ?? null; }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}
