/**
 * Acquisition adapters: one interface for every source SoundCheck can find songs in (research.md §8).
 *
 * Each adapter reports, per result, exactly what it offers: `full` (a complete recording we may stream),
 * `preview`, or `metadata` only, and whether its license lets us derive karaoke stems. Adding a provider means
 * writing one object that satisfies `Adapter` and registering it in ADAPTERS; nothing else changes.
 *
 * Sources that only work by decrypting protected streams or by using shared/pooled subscription accounts are not
 * adapters here, by design (research.md §8.3).
 */
import { licenseAllowsKaraoke } from './openmusic.ts';

export type AcqProvider = 'audius' | 'ccmixter' | 'jamendo' | 'openverse' | 'deezer';
export type Availability = 'full' | 'preview' | 'metadata';

export interface Candidate {
  provider: AcqProvider;
  external_id: string;
  title: string;
  artist: string;
  album: string | null;
  duration_ms: number | null;
  year: number | null;
  artwork: string | null;
  isrc: string | null;
  /** page to credit/open */
  page_url: string | null;
  /** complete recording, streamable by the player (null for metadata-only results) */
  stream_url: string | null;
  availability: Availability;
  license_url: string | null;
  /** may we derive stems (license allows derivatives, provider permits the download) */
  karaoke_ok: boolean;
  format: string | null;
  bitrate_kbps: number | null;
  attribution: string;
}

export interface Adapter {
  id: AcqProvider;
  label: string;
  /** missing credentials → the adapter is listed as "not configured", never silently dropped */
  missing(): string[];
  search(q: string, limit: number): Promise<Candidate[]>;
  get(externalId: string): Promise<Candidate | null>;
}

const UA = 'SoundCheck/0.2 (acquisition)';
async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`${new URL(url).hostname} answered ${r.status}`);
  return r.json();
}

/** "4:54" / "1:02:03" → ms */
export function clockToMs(v: string | null | undefined): number | null {
  if (!v || !/^\d+(:\d{1,2}){1,2}$/.test(v)) return null;
  return v.split(':').map(Number).reduce((s, n) => s * 60 + n, 0) * 1000 || null;
}

/**
 * Audius license names → Creative Commons deed URLs ("Attribution-NonCommercial CC BY-NC" → …/by-nc/4.0/).
 * "All rights reserved" and unknown values → null (stream only, no karaoke).
 */
export function audiusLicenseUrl(name: string | null | undefined): string | null {
  if (!name) return null;
  const m = /CC (BY(?:-NC)?(?:-SA|-ND)?)\b/i.exec(name);
  if (m) return `https://creativecommons.org/licenses/${m[1]!.toLowerCase()}/4.0/`;
  if (/public domain|cc0/i.test(name)) return 'https://creativecommons.org/publicdomain/zero/1.0/';
  return null;
}

// ------------------------------------------------------------------------------------------------ Audius
// Decentralised streaming service where artists upload their own music; its public API is meant for third-party
// players (no key; requests carry an app_name). Full-length streams for listening; karaoke only for CC tracks.
const AUDIUS = 'https://api.audius.co/v1';
const AUDIUS_APP = 'SoundCheck';
interface AudiusTrack {
  id: string; title: string; duration: number; genre?: string; license?: string | null; is_streamable?: boolean;
  is_downloadable?: boolean; permalink?: string; release_date?: string | null; isrc?: string | null;
  artwork?: Record<string, string> | null; user: { name: string; handle: string };
  stream_conditions?: unknown; is_stream_gated?: boolean;
}
export function audiusToCandidate(t: AudiusTrack): Candidate | null {
  if (t.is_streamable === false || t.is_stream_gated || t.stream_conditions) return null; // gated/premium tracks: not ours to play
  const license = audiusLicenseUrl(t.license);
  const year = Number.parseInt(String(t.release_date ?? '').slice(0, 4), 10);
  return {
    provider: 'audius', external_id: t.id, title: t.title, artist: t.user.name, album: null,
    duration_ms: t.duration ? t.duration * 1000 : null, year: year >= 1800 && year <= 2200 ? year : null,
    artwork: t.artwork?.['1000x1000'] ?? t.artwork?.['480x480'] ?? null, isrc: t.isrc ?? null,
    page_url: t.permalink ? `https://audius.co${t.permalink}` : null,
    stream_url: `${AUDIUS}/tracks/${encodeURIComponent(t.id)}/stream?app_name=${AUDIUS_APP}`,
    availability: 'full', license_url: license, karaoke_ok: licenseAllowsKaraoke(license),
    format: 'mp3', bitrate_kbps: 320, attribution: `${t.user.name} on Audius`,
  };
}
const audius: Adapter = {
  id: 'audius', label: 'Audius', missing: () => [],
  async search(q, limit) {
    const d = await getJson(`${AUDIUS}/tracks/search?query=${encodeURIComponent(q)}&limit=${limit}&app_name=${AUDIUS_APP}`) as { data?: AudiusTrack[] };
    return (d.data ?? []).map(audiusToCandidate).filter((c): c is Candidate => !!c);
  },
  async get(id) {
    if (!/^[A-Za-z0-9]{1,20}$/.test(id)) return null;
    const d = await getJson(`${AUDIUS}/tracks/${id}?app_name=${AUDIUS_APP}`) as { data?: AudiusTrack };
    return d.data ? audiusToCandidate(d.data) : null;
  },
};

// ------------------------------------------------------------------------------------------------ ccMixter
// Creative Commons remix community (many uploads ship with a cappella / stem files). No key.
// Its file server answers 403 to requests that don't come from ccmixter.org's own pages (verified 2026-11-17), so
// SoundCheck lists ccMixter results for discovery and links to them, but neither streams nor downloads them.
interface CcFile { file_name: string; download_url: string; file_format_info?: { 'default-ext'?: string; ps?: string; br?: string; mime_type?: string } }
interface CcUpload { upload_id: number; upload_name: string; user_name: string; user_real_name?: string; license_url?: string; file_page_url?: string; upload_date_format?: string; files?: CcFile[] }
export function ccmixterToCandidate(u: CcUpload): Candidate | null {
  // the browser plays MP3 everywhere; FLAC/others only if that's all there is
  const files = (u.files ?? []).filter((f) => f.download_url?.startsWith('https://ccmixter.org/'));
  const f = files.find((x) => x.file_format_info?.['default-ext'] === 'mp3') ?? files.find((x) => /\.(ogg|flac|wav)$/i.test(x.file_name));
  if (!f) return null;
  const artist = u.user_real_name || u.user_name;
  const year = Number.parseInt(String(u.upload_date_format ?? '').match(/\d{4}/)?.[0] ?? '', 10);
  const license = u.license_url?.replace(/^http:/, 'https:') ?? null;
  return {
    provider: 'ccmixter', external_id: String(u.upload_id), title: u.upload_name, artist, album: null,
    duration_ms: clockToMs(f.file_format_info?.ps), year: year >= 1800 && year <= 2200 ? year : null, artwork: null, isrc: null,
    page_url: u.file_page_url ?? `https://ccmixter.org/files/${encodeURIComponent(u.user_name)}/${u.upload_id}`,
    stream_url: null, availability: 'metadata', license_url: license, karaoke_ok: false,
    format: f.file_format_info?.['default-ext'] ?? null, bitrate_kbps: null, attribution: `${artist} (ccMixter)`,
  };
}
const ccmixter: Adapter = {
  id: 'ccmixter', label: 'ccMixter', missing: () => [],
  async search(q, limit) {
    const d = await getJson(`https://ccmixter.org/api/query?f=json&search=${encodeURIComponent(q)}&search_type=all&limit=${limit}`) as CcUpload[];
    return (Array.isArray(d) ? d : []).map(ccmixterToCandidate).filter((c): c is Candidate => !!c);
  },
  async get(id) {
    if (!/^\d{1,9}$/.test(id)) return null;
    const d = await getJson(`https://ccmixter.org/api/query?f=json&ids=${id}`) as CcUpload[];
    return Array.isArray(d) && d[0] ? ccmixterToCandidate(d[0]) : null;
  },
};

// ------------------------------------------------------------------------------------------------ Jamendo
// ~600k Creative Commons tracks with full-length streams. Needs a free client_id (JAMENDO_CLIENT_ID).
interface JamTrack {
  id: string; name: string; artist_name: string; album_name?: string; duration: number; releasedate?: string; image?: string;
  audio?: string; audiodownload?: string; audiodownload_allowed?: boolean; license_ccurl?: string; shareurl?: string;
}
export function jamendoToCandidate(t: JamTrack): Candidate | null {
  if (!t.audio) return null;
  const license = t.license_ccurl?.replace(/^http:/, 'https:') ?? null;
  const year = Number.parseInt(String(t.releasedate ?? '').slice(0, 4), 10);
  return {
    provider: 'jamendo', external_id: String(t.id), title: t.name, artist: t.artist_name, album: t.album_name || null,
    duration_ms: t.duration ? t.duration * 1000 : null, year: year >= 1800 && year <= 2200 ? year : null, artwork: t.image || null,
    isrc: null, page_url: t.shareurl ?? `https://www.jamendo.com/track/${t.id}`, stream_url: t.audio, availability: 'full',
    license_url: license, karaoke_ok: !!t.audiodownload_allowed && licenseAllowsKaraoke(license),
    format: 'mp3', bitrate_kbps: 96, attribution: `${t.artist_name} (Jamendo)`,
  };
}
const jamendoKey = () => Deno.env.get('JAMENDO_CLIENT_ID') ?? '';
const jamendo: Adapter = {
  id: 'jamendo', label: 'Jamendo', missing: () => (jamendoKey() ? [] : ['JAMENDO_CLIENT_ID']),
  async search(q, limit) {
    const d = await getJson(`https://api.jamendo.com/v3.0/tracks/?client_id=${jamendoKey()}&format=json&limit=${limit}&search=${encodeURIComponent(q)}&include=licenses&audioformat=mp32&order=popularity_total`) as { results?: JamTrack[] };
    return (d.results ?? []).map(jamendoToCandidate).filter((c): c is Candidate => !!c);
  },
  async get(id) {
    if (!/^\d{1,12}$/.test(id)) return null;
    const d = await getJson(`https://api.jamendo.com/v3.0/tracks/?client_id=${jamendoKey()}&format=json&id=${id}&include=licenses&audioformat=mp32`) as { results?: JamTrack[] };
    return d.results?.[0] ? jamendoToCandidate(d.results[0]) : null;
  },
};

// ------------------------------------------------------------------------------------------------ Openverse
// WordPress's openly licensed media search. Its audio index carries Jamendo's catalog (~645k tracks, full-length
// MP3 streams) and Wikimedia Commons music (public-domain / CC recordings, e.g. Musopen), with no API key.
// Freesound is excluded (sound effects, not songs).
interface OvAudio {
  id: string; title?: string; creator?: string; source: string; license: string; license_version?: string; license_url?: string;
  duration?: number | null; url: string; filetype?: string | null; foreign_landing_url?: string; thumbnail?: string | null;
  bit_rate?: number | null; genres?: string[] | null; category?: string | null;
}
/** Commons serves an MP3 transcode of every Ogg/WAV/FLAC upload; MP3 plays in every browser and TV app. */
export function commonsMp3(url: string): string {
  const m = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+)$/.exec(url);
  if (!m || /\.mp3$/i.test(m[3]!)) return url;
  return `https://upload.wikimedia.org/wikipedia/commons/transcoded/${m[1]}/${m[2]}/${m[3]}/${m[3]}.mp3`;
}
export function openverseToCandidate(a: OvAudio): Candidate | null {
  if (a.source !== 'jamendo' && a.source !== 'wikimedia_audio') return null;
  if (!a.url?.startsWith('https://')) return null;
  if (a.duration != null && a.duration < 45_000) return null; // clips, pronunciations, jingles: not songs
  const license = (a.license_url ?? '').replace(/^http:/, 'https:') || null;
  const wiki = a.source === 'wikimedia_audio';
  const title = (a.title ?? 'Untitled').replace(/\.(ogg|oga|ogx|flac|wav|mp3|opus)$/i, '').replace(/_/g, ' ');
  const artist = a.creator?.trim() || 'Unknown artist';
  return {
    provider: 'openverse', external_id: a.id, title, artist, album: null, duration_ms: a.duration ?? null, year: null,
    artwork: wiki ? null : a.thumbnail ?? null, isrc: null, page_url: a.foreign_landing_url ?? null,
    stream_url: wiki ? commonsMp3(a.url) : a.url, availability: 'full', license_url: license,
    karaoke_ok: licenseAllowsKaraoke(license), format: wiki ? 'mp3' : 'mp3', bitrate_kbps: a.bit_rate ? Math.round(a.bit_rate / 1000) : null,
    attribution: `${artist} (${wiki ? 'Wikimedia Commons' : 'Jamendo'}, via Openverse)`,
  };
}
const OV = 'https://api.openverse.org/v1/audio';
const openverse: Adapter = {
  id: 'openverse', label: 'Openverse (Jamendo · Wikimedia Commons)', missing: () => [],
  async search(q, limit) {
    const d = await getJson(`${OV}/?q=${encodeURIComponent(q)}&page_size=${Math.min(20, limit)}&source=jamendo,wikimedia_audio&mature=false`) as { results?: OvAudio[] };
    return (d.results ?? []).map(openverseToCandidate).filter((c): c is Candidate => !!c);
  },
  async get(id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    const d = await getJson(`${OV}/${id}/`) as OvAudio;
    return d?.id ? openverseToCandidate(d) : null;
  },
};

// ------------------------------------------------------------------------------------------------ Deezer (metadata)
// Deezer's public API: catalog metadata, ISRCs and artwork (the catalog side of what Deezer rippers use).
// Its audio is DRM-protected outside 30 s previews, so this adapter never offers audio.
interface DzTrack { id: number; title: string; duration: number; isrc?: string; link?: string; artist: { name: string }; album?: { title?: string; cover_xl?: string; release_date?: string } }
export function deezerToCandidate(t: DzTrack): Candidate {
  const year = Number.parseInt(String(t.album?.release_date ?? '').slice(0, 4), 10);
  return {
    provider: 'deezer', external_id: String(t.id), title: t.title, artist: t.artist.name, album: t.album?.title ?? null,
    duration_ms: t.duration ? t.duration * 1000 : null, year: year >= 1800 && year <= 2200 ? year : null,
    artwork: t.album?.cover_xl ?? null, isrc: t.isrc ?? null, page_url: t.link ?? `https://www.deezer.com/track/${t.id}`,
    stream_url: null, availability: 'metadata', license_url: null, karaoke_ok: false, format: null, bitrate_kbps: null,
    attribution: 'Metadata from Deezer',
  };
}
const deezer: Adapter = {
  id: 'deezer', label: 'Deezer (metadata)', missing: () => [],
  async search(q, limit) {
    const d = await getJson(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${limit}`) as { data?: DzTrack[] };
    return (d.data ?? []).map(deezerToCandidate);
  },
  async get(id) {
    if (!/^\d{1,15}$/.test(id)) return null;
    const d = await getJson(`https://api.deezer.com/track/${id}`) as DzTrack & { error?: unknown };
    return d.error ? null : deezerToCandidate(d);
  },
};

export const ADAPTERS: Record<AcqProvider, Adapter> = { audius, ccmixter, jamendo, openverse, deezer };
