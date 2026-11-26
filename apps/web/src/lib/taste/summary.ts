/**
 * Listening history → a small taste summary, all in the browser.
 *
 * Every service's export (lib/taste/sources.ts) is read into `Play`s; only per-track and per-artist totals
 * (plays, time listened, skip rate, last played) are kept. IP addresses, countries, devices and per-stream
 * timestamps never leave the device.
 */

export type TasteSource = 'spotify' | 'apple_music' | 'youtube_music' | 'deezer' | 'lastfm';

export const SOURCE_LABEL: Record<TasteSource, string> = {
  spotify: 'Spotify', apple_music: 'Apple Music', youtube_music: 'YouTube Music', deezer: 'Deezer', lastfm: 'Last.fm',
};

/** A stream counts as a play once it ran this long (Spotify's own threshold for a stream). */
export const PLAY_MS = 30_000;
/** Caps on what we keep, by time listened. Plenty for recommendations and small enough to send in one request. */
export const MAX_TRACKS = 2000;
export const MAX_ARTISTS = 500;

/** One stream (or, for exports that are already daily totals, one day's plays of a song). */
export interface Play {
  title: string;
  artist: string;
  album?: string | null;
  uri?: string | null;     // spotify:track:… when known
  ms: number | null;       // time listened; null when the export doesn't say (YouTube Music, Last.fm)
  at: number;              // epoch ms
  count?: number;          // plays this row stands for (default 1)
  skips?: number;          // skipped plays among them (default 0)
}

export interface TasteTrack {
  title: string; artist: string; album: string | null; spotify_uri: string | null;
  plays: number; streams: number; ms_played: number; skip_rate: number; last_played: string;
}
export interface TasteArtist {
  name: string; plays: number; streams: number; ms_played: number; skip_rate: number; last_played: string; track_count: number;
}
export interface TasteSummary {
  source: TasteSource;
  first_played: string | null;
  last_played: string | null;
  streams: number;
  ms_played: number;
  tracks: TasteTrack[];
  artists: TasteArtist[];
}

interface Acc { title: string; artist: string; album: string | null; uri: string | null; plays: number; streams: number; ms: number; skips: number; last: number }

const clip = (s: string) => s.trim().slice(0, 500);
const key = (artist: string, title: string) => `${artist.toLowerCase()}\u0000${title.toLowerCase()}`;
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Folds plays into a taste summary. */
export function summarize(source: TasteSource, plays: Iterable<Play>): TasteSummary {
  const tracks = new Map<string, Acc>();
  let streams = 0, ms = 0, first = Infinity, last = -Infinity;
  for (const p of plays) {
    const title = clip(p.title), artist = clip(p.artist);
    if (!title || !artist || !Number.isFinite(p.at)) continue;
    const count = Math.max(1, Math.round(p.count ?? 1));
    const pms = p.ms != null && Number.isFinite(p.ms) && p.ms > 0 ? p.ms : 0;
    streams += count;
    ms += pms;
    first = Math.min(first, p.at);
    last = Math.max(last, p.at);
    const k = key(artist, title);
    let a = tracks.get(k);
    if (!a) tracks.set(k, (a = { title, artist, album: null, uri: null, plays: 0, streams: 0, ms: 0, skips: 0, last: 0 }));
    a.streams += count;
    a.ms += pms;
    // counted plays: daily totals count as given; single streams once they ran 30 s (or when length is unknown)
    a.plays += p.count != null ? count : p.ms == null || pms >= PLAY_MS ? 1 : 0;
    a.skips += Math.min(count, Math.max(0, p.skips ?? 0));
    if (p.at >= a.last) { a.last = p.at; a.album = p.album?.trim().slice(0, 500) || a.album; a.uri = p.uri ?? a.uri; }
  }

  const artists = new Map<string, Acc & { tracks: number }>();
  for (const t of tracks.values()) {
    const k = t.artist.toLowerCase();
    let a = artists.get(k);
    if (!a) artists.set(k, (a = { ...t, plays: 0, streams: 0, ms: 0, skips: 0, last: 0, tracks: 0 }));
    a.plays += t.plays; a.streams += t.streams; a.ms += t.ms; a.skips += t.skips; a.tracks++;
    a.last = Math.max(a.last, t.last);
  }

  const order = <T extends Acc>(x: T, y: T) => y.ms - x.ms || y.plays - x.plays || y.last - x.last;
  return {
    source,
    first_played: streams ? new Date(first).toISOString() : null,
    last_played: streams ? new Date(last).toISOString() : null,
    streams,
    ms_played: ms,
    tracks: [...tracks.values()].sort(order).slice(0, MAX_TRACKS).map((t) => ({
      title: t.title, artist: t.artist, album: t.album, spotify_uri: t.uri, plays: t.plays, streams: t.streams,
      ms_played: t.ms, skip_rate: round3(t.skips / t.streams), last_played: new Date(t.last).toISOString(),
    })),
    artists: [...artists.values()].sort(order).slice(0, MAX_ARTISTS).map((a) => ({
      name: a.artist, plays: a.plays, streams: a.streams, ms_played: a.ms, skip_rate: round3(a.skips / a.streams),
      last_played: new Date(a.last).toISOString(), track_count: a.tracks,
    })),
  };
}
