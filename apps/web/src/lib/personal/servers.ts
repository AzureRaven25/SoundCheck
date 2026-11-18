'use client';
/**
 * Personal music servers (research.md §4): the user's own library on Navidrome / Airsonic / Gonic (Subsonic
 * API) or Jellyfin. Full-length, and karaoke-eligible because the user owns the files.
 *
 * Credentials never leave this device: Subsonic keeps only a salted token (md5(password + salt)), Jellyfin an
 * access token, both in localStorage. Nothing about the server is stored in SoundCheck's database.
 */
import { md5 } from './md5';

export type ServerKind = 'subsonic' | 'jellyfin';
export interface ServerConfig {
  id: string;
  kind: ServerKind;
  name: string;           // what the server calls itself (Navidrome, Jellyfin…)
  url: string;            // base URL, no trailing slash
  username: string;
  /** Subsonic: md5(password + salt) and the salt. Jellyfin: access token + user id. */
  token: string;
  salt?: string;
  userId?: string;
}

export interface ServerTrack {
  key: string;            // "server:<serverId>:<songId>"
  serverId: string;
  serverName: string;
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number | null;
  coverUrl: string | null;
  streamUrl: string;
}

const STORE = 'soundcheck.servers.v1';
const CLIENT = 'SoundCheck';

export function loadServers(): ServerConfig[] {
  try { return JSON.parse(localStorage.getItem(STORE) ?? '[]') as ServerConfig[]; } catch { return []; }
}
function saveServers(list: ServerConfig[]) {
  try { localStorage.setItem(STORE, JSON.stringify(list)); } catch { /* private mode: connection lasts this tab only */ }
  window.dispatchEvent(new Event('soundcheck-servers'));
}
export function removeServer(id: string) { saveServers(loadServers().filter((s) => s.id !== id)); }

export function normalizeUrl(u: string): string {
  let url = u.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

/** An https page can't load an http server (mixed content), except localhost during development. */
export function mixedContentProblem(url: string): boolean {
  if (typeof window === 'undefined' || window.location.protocol !== 'https:') return false;
  const u = new URL(url);
  return u.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(u.hostname);
}

// ---------------------------------------------------------------- Subsonic (Navidrome, Airsonic, Gonic…)
function subsonicParams(s: ServerConfig, extra: Record<string, string> = {}) {
  return new URLSearchParams({ u: s.username, t: s.token, s: s.salt ?? '', v: '1.16.1', c: CLIENT, f: 'json', ...extra });
}
async function subsonic<T>(s: ServerConfig, method: string, extra: Record<string, string> = {}): Promise<T> {
  const r = await fetch(`${s.url}/rest/${method}?${subsonicParams(s, extra)}`);
  if (!r.ok) throw new Error(`server answered ${r.status}`);
  const body = (await r.json())['subsonic-response'];
  if (!body || body.status !== 'ok') throw new Error(body?.error?.message ?? 'not a Subsonic server');
  return body as T;
}

// ---------------------------------------------------------------- Jellyfin
const jellyfinAuth = (token?: string) =>
  `MediaBrowser Client="${CLIENT}", Device="Web", DeviceId="soundcheck-web", Version="1.0"${token ? `, Token="${token}"` : ''}`;

/** Sign in and remember the server. Throws a readable error when it fails. */
export async function connectServer(kind: ServerKind, rawUrl: string, username: string, password: string): Promise<ServerConfig> {
  const url = normalizeUrl(rawUrl);
  if (mixedContentProblem(url)) throw new Error('This page is secure (https), so browsers block an http server. Use your server’s https address.');
  let cfg: ServerConfig;
  if (kind === 'subsonic') {
    const salt = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
    cfg = { id: crypto.randomUUID(), kind, name: 'Music server', url, username, token: md5(password + salt), salt };
    const ping = await subsonic<{ type?: string }>(cfg, 'ping').catch((e: Error) => {
      throw new Error(e.message.includes('Failed to fetch') ? 'Couldn’t reach that server.' : `Sign-in failed: ${e.message}`);
    });
    cfg.name = ping.type ? ping.type[0]!.toUpperCase() + ping.type.slice(1) : 'Subsonic server';
  } else {
    const r = await fetch(`${url}/Users/AuthenticateByName`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: jellyfinAuth() },
      body: JSON.stringify({ Username: username, Pw: password }),
    }).catch(() => { throw new Error('Couldn’t reach that server.'); });
    if (!r.ok) throw new Error(r.status === 401 ? 'Wrong username or password.' : `Sign-in failed (${r.status})`);
    const d = await r.json();
    cfg = { id: crypto.randomUUID(), kind, name: 'Jellyfin', url, username, token: d.AccessToken, userId: d.User?.Id };
  }
  saveServers([...loadServers().filter((s) => !(s.url === url && s.username === username)), cfg]);
  return cfg;
}

export async function searchServer(s: ServerConfig, q: string, limit = 20): Promise<ServerTrack[]> {
  if (s.kind === 'subsonic') {
    type Song = { id: string; title: string; artist?: string; album?: string; duration?: number; coverArt?: string };
    const d = await subsonic<{ searchResult3?: { song?: Song[] } }>(s, 'search3', { query: q, songCount: String(limit), albumCount: '0', artistCount: '0' });
    return (d.searchResult3?.song ?? []).map((x) => ({
      key: `server:${s.id}:${x.id}`, serverId: s.id, serverName: s.name, id: x.id, title: x.title, artist: x.artist ?? 'Unknown artist',
      album: x.album ?? null, durationMs: x.duration ? x.duration * 1000 : null,
      coverUrl: x.coverArt ? `${s.url}/rest/getCoverArt?${subsonicParams(s, { id: x.coverArt, size: '300' })}` : null,
      streamUrl: `${s.url}/rest/stream?${subsonicParams(s, { id: x.id })}`,
    }));
  }
  const params = new URLSearchParams({ searchTerm: q, IncludeItemTypes: 'Audio', Recursive: 'true', Limit: String(limit), Fields: 'RunTimeTicks' });
  const r = await fetch(`${s.url}/Users/${s.userId}/Items?${params}`, { headers: { Authorization: jellyfinAuth(s.token) } });
  if (!r.ok) throw new Error(`server answered ${r.status}`);
  type Item = { Id: string; Name: string; AlbumArtist?: string; Artists?: string[]; Album?: string; RunTimeTicks?: number; AlbumId?: string };
  const items = ((await r.json()).Items ?? []) as Item[];
  return items.map((x) => ({
    key: `server:${s.id}:${x.Id}`, serverId: s.id, serverName: s.name, id: x.Id, title: x.Name,
    artist: x.Artists?.[0] ?? x.AlbumArtist ?? 'Unknown artist', album: x.Album ?? null,
    durationMs: x.RunTimeTicks ? Math.round(x.RunTimeTicks / 10_000) : null,
    coverUrl: `${s.url}/Items/${x.AlbumId ?? x.Id}/Images/Primary?maxHeight=300&api_key=${s.token}`,
    // the original file, untouched (Jellyfin 10.x–12.x accept api_key here; /universal rejects it on 12.4)
    streamUrl: `${s.url}/Audio/${x.Id}/stream?${new URLSearchParams({ static: 'true', api_key: s.token })}`,
  }));
}

/** Search every connected server; one failing server doesn't hide the others' results. */
export async function searchAllServers(q: string, limit = 20): Promise<ServerTrack[]> {
  const results = await Promise.allSettled(loadServers().map((s) => searchServer(s, q, limit)));
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

export interface ServerSong { id: string; title: string; artist: string; album: string | null; suffix: string; streamUrl: string }

/** Every song on a server, a page at a time (Subsonic search3 with an empty query; Jellyfin Items paging). */
export async function listServerSongs(s: ServerConfig, offset: number, size = 200): Promise<ServerSong[]> {
  if (s.kind === 'subsonic') {
    type Song = { id: string; title: string; artist?: string; album?: string; suffix?: string };
    const d = await subsonic<{ searchResult3?: { song?: Song[] } }>(s, 'search3', {
      query: '', songCount: String(size), songOffset: String(offset), albumCount: '0', artistCount: '0',
    });
    return (d.searchResult3?.song ?? []).map((x) => ({
      id: x.id, title: x.title, artist: x.artist ?? 'Unknown artist', album: x.album ?? null, suffix: (x.suffix ?? 'mp3').toLowerCase(),
      // format=raw: the original file, never a transcode
      streamUrl: `${s.url}/rest/stream?${subsonicParams(s, { id: x.id, format: 'raw' })}`,
    }));
  }
  const params = new URLSearchParams({
    IncludeItemTypes: 'Audio', Recursive: 'true', StartIndex: String(offset), Limit: String(size), Fields: 'MediaSources', SortBy: 'AlbumArtist,Album,IndexNumber',
  });
  const r = await fetch(`${s.url}/Users/${s.userId}/Items?${params}`, { headers: { Authorization: jellyfinAuth(s.token) } });
  if (!r.ok) throw new Error(`server answered ${r.status}`);
  type Item = { Id: string; Name: string; AlbumArtist?: string; Artists?: string[]; Album?: string; Container?: string };
  return (((await r.json()).Items ?? []) as Item[]).map((x) => ({
    id: x.Id, title: x.Name, artist: x.Artists?.[0] ?? x.AlbumArtist ?? 'Unknown artist', album: x.Album ?? null,
    suffix: (x.Container ?? 'mp3').split(',')[0]!.toLowerCase(),
    streamUrl: `${s.url}/Audio/${x.Id}/stream?${new URLSearchParams({ static: 'true', api_key: s.token })}`,
  }));
}
