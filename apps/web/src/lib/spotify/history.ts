/**
 * Spotify listening history → a small taste summary, all in the browser.
 *
 * The export Spotify emails (my_spotify_data.zip) holds every stream with IP address, country, device and
 * timestamps. None of that leaves the device: we read the audio streams, drop podcasts, audiobooks, videos and
 * incognito plays, and keep only per-track and per-artist totals (plays, time listened, skip rate, last played).
 * That summary is what gets saved to the user's account.
 *
 * Both export flavours are understood:
 *  - Extended streaming history: Streaming_History_Audio_*.json (and the older endsong_*.json), fields
 *    ts, ms_played, master_metadata_track_name, master_metadata_album_artist_name, spotify_track_uri, skipped…
 *  - Account data: StreamingHistory_music_*.json (or StreamingHistory*.json), fields endTime, artistName,
 *    trackName, msPlayed.
 */

/** A stream counts as a play once it ran this long (Spotify's own threshold for a stream). */
export const PLAY_MS = 30_000;
/** Caps on what we keep, by time listened. Plenty for recommendations and small enough to send in one request. */
export const MAX_TRACKS = 2000;
export const MAX_ARTISTS = 500;

export interface TasteTrack {
  title: string;
  artist: string;
  album: string | null;
  spotify_uri: string | null;
  plays: number;       // streams of at least PLAY_MS
  streams: number;     // every stream, however short
  ms_played: number;
  skip_rate: number;   // 0..1, skipped streams / streams
  last_played: string; // ISO timestamp
}

export interface TasteArtist {
  name: string;
  plays: number;
  streams: number;
  ms_played: number;
  skip_rate: number;
  last_played: string;
  track_count: number;
}

export interface TasteSummary {
  source: 'spotify';
  first_played: string | null;
  last_played: string | null;
  streams: number;
  ms_played: number;
  tracks: TasteTrack[];
  artists: TasteArtist[];
}

interface Acc { title: string; artist: string; album: string | null; uri: string | null; plays: number; streams: number; ms: number; skips: number; last: number }

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** Spotify's account-data export writes "2023-04-01 18:22" (UTC, no zone). */
function parseTime(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s) ? `${s.replace(' ', 'T')}Z` : s);
  return Number.isFinite(t) ? t : null;
}

/** One stream in either export flavour, or null for podcasts, audiobooks, videos, incognito and broken rows. */
export function readStream(r: unknown): { title: string; artist: string; album: string | null; uri: string | null; ms: number; skipped: boolean; at: number } | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  if (str(o.episode_name) || str(o.spotify_episode_uri) || str(o.audiobook_title) || str(o.audiobook_uri) || str(o.audiobook_chapter_uri)) return null;
  if (o.incognito_mode === true) return null;
  const title = str(o.master_metadata_track_name) ?? str(o.trackName);
  const artist = str(o.master_metadata_album_artist_name) ?? str(o.artistName);
  const at = parseTime(o.ts ?? o.endTime);
  if (!title || !artist || at == null) return null;
  const uri = str(o.spotify_track_uri);
  return {
    title: title.slice(0, 500), artist: artist.slice(0, 500),
    album: str(o.master_metadata_album_album_name)?.slice(0, 500) ?? null,
    uri: uri && /^spotify:track:[A-Za-z0-9]{10,40}$/.test(uri) ? uri : null,
    ms: num(o.ms_played ?? o.msPlayed),
    skipped: o.skipped === true,
    at,
  };
}

/** Streaming history files inside the export (audio only; video and the ReadMe PDF are ignored). */
export function isHistoryFile(path: string): boolean {
  const name = path.split('/').pop() ?? '';
  return /\.json$/i.test(name) && (/^Streaming_History_Audio/i.test(name) || /^endsong/i.test(name) || /^StreamingHistory(_music)?_?\d*\.json$/i.test(name));
}

const key = (artist: string, title: string) => `${artist.toLowerCase()}\u0000${title.toLowerCase()}`;
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Folds streams (from any number of files) into a taste summary. */
export function summarize(files: unknown[][]): TasteSummary {
  const tracks = new Map<string, Acc>();
  let streams = 0, ms = 0, first = Infinity, last = -Infinity;
  for (const rows of files) {
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      const s = readStream(r);
      if (!s) continue;
      streams++;
      ms += s.ms;
      first = Math.min(first, s.at);
      last = Math.max(last, s.at);
      const k = key(s.artist, s.title);
      let a = tracks.get(k);
      if (!a) tracks.set(k, (a = { title: s.title, artist: s.artist, album: s.album, uri: s.uri, plays: 0, streams: 0, ms: 0, skips: 0, last: 0 }));
      a.streams++;
      a.ms += s.ms;
      if (s.ms >= PLAY_MS) a.plays++;
      if (s.skipped) a.skips++;
      if (s.at >= a.last) { a.last = s.at; a.album = s.album ?? a.album; a.uri = s.uri ?? a.uri; }
    }
  }

  const artists = new Map<string, Acc & { tracks: number }>();
  for (const t of tracks.values()) {
    const k = t.artist.toLowerCase();
    let a = artists.get(k);
    if (!a) artists.set(k, (a = { ...t, plays: 0, streams: 0, ms: 0, skips: 0, last: 0, tracks: 0 }));
    a.plays += t.plays; a.streams += t.streams; a.ms += t.ms; a.skips += t.skips; a.tracks++;
    a.last = Math.max(a.last, t.last);
  }

  const byListening = <T extends Acc>(x: T, y: T) => y.ms - x.ms || y.plays - x.plays || y.last - x.last;
  return {
    source: 'spotify',
    first_played: streams ? new Date(first).toISOString() : null,
    last_played: streams ? new Date(last).toISOString() : null,
    streams,
    ms_played: ms,
    tracks: [...tracks.values()].sort(byListening).slice(0, MAX_TRACKS).map((t) => ({
      title: t.title, artist: t.artist, album: t.album, spotify_uri: t.uri, plays: t.plays, streams: t.streams,
      ms_played: t.ms, skip_rate: round3(t.skips / t.streams), last_played: new Date(t.last).toISOString(),
    })),
    artists: [...artists.values()].sort(byListening).slice(0, MAX_ARTISTS).map((a) => ({
      name: a.artist, plays: a.plays, streams: a.streams, ms_played: a.ms, skip_rate: round3(a.skips / a.streams),
      last_played: new Date(a.last).toISOString(), track_count: a.tracks,
    })),
  };
}

/** Reads the zip (or loose .json files) in the browser and returns only the summary. */
export async function summarizeExport(files: File[]): Promise<TasteSummary> {
  const { unzip, strFromU8 } = await import('fflate');
  const parsed: unknown[][] = [];
  const take = (name: string, bytes: Uint8Array) => {
    if (!isHistoryFile(name)) return;
    try {
      const rows = JSON.parse(strFromU8(bytes));
      if (Array.isArray(rows)) parsed.push(rows);
    } catch { /* not a history file after all */ }
  };
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const buf = new Uint8Array(await f.arrayBuffer());
      const entries = await new Promise<Record<string, Uint8Array>>((res, rej) =>
        unzip(buf, { filter: (e) => isHistoryFile(e.name) }, (err, data) => (err ? rej(err) : res(data))));
      for (const [name, bytes] of Object.entries(entries)) take(name, bytes);
    } else {
      take(f.name, new Uint8Array(await f.arrayBuffer()));
    }
  }
  if (!parsed.length) throw new Error('No Spotify streaming history found. Pick the my_spotify_data.zip file Spotify emailed you.');
  const summary = summarize(parsed);
  if (!summary.tracks.length) throw new Error('That export has no songs in it (podcasts and videos are skipped).');
  return summary;
}
