/**
 * Readers for each service's own listening-history export, and detection of which service a file came from.
 * Formats were checked against published descriptions of real exports (Nov 2026); unknown columns are ignored.
 *
 *  - Spotify (Account → Privacy → Download your data): Extended streaming history
 *    Streaming_History_Audio_*.json / endsong_*.json, or the account-data StreamingHistory_music_*.json.
 *  - Apple Music (privacy.apple.com → "Apple Media Services information"): a zip of zips; the Apple Music Activity
 *    folder holds "Apple Music - Play History Daily Tracks.csv" (Track Description = "Artist - Song", Date Played,
 *    Play Count, Play Duration Milliseconds[, Skip Count]) and/or "Apple Music Play Activity.csv" (Song Name,
 *    Artist Name / Container Artist Name, Album Name, Event Type, Event Start/End Timestamp,
 *    Play Duration Milliseconds, End Reason Type).
 *  - YouTube Music (Google Takeout, history as JSON): watch-history.json entries with header "YouTube Music",
 *    title "Watched <song>", subtitles[0].name "<artist> - Topic", time (ISO). No listening time.
 *  - Deezer (GDPR data request): deezer-data_*.xlsx, sheet "10_listeningHistory" (Song Title, Artist, ISRC,
 *    Album Title, IP Address, Listening Time [s], Platform Name, Platform Model, Date "yyyy-MM-dd HH:mm:ss"),
 *    English or French headers.
 *  - Last.fm scrobbles (CSV from an exporter such as lastfm-to-csv: artist,album,track,date with no header, or a
 *    header row with Artist / Track / Album / Date|Timestamp|uts).
 *
 * Not supported (no self-serve export with a documented format): Amazon Music, Tidal, SoundCloud, Pandora.
 */
import { strFromU8 } from 'fflate';
import { csvRecords, parseCsv, xlsxSheets } from './formats';
import { summarize, type Play, type TasteSource, type TasteSummary } from './summary';

export interface ExportFile { name: string; bytes: Uint8Array }

export const UNSUPPORTED_SERVICES = ['Amazon Music', 'Tidal', 'SoundCloud', 'Pandora'];

const base = (path: string) => path.split('/').pop() ?? path;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.trim().replace(',', '.')) : NaN;
  return Number.isFinite(n) ? n : null;
};
const json = (f: ExportFile): unknown => { try { return JSON.parse(strFromU8(f.bytes)); } catch { return null; } };

/** Timestamps as the exports write them: ISO, "2023-04-01 18:22[:05]" (UTC), "20230401", "15 Jan 2021 09:15", unix. */
export function parseTime(v: unknown): number | null {
  if (typeof v === 'number') return v > 1e11 ? v : v > 1e8 ? v * 1000 : null;
  const s = str(v);
  if (!s) return null;
  if (/^\d{9,13}$/.test(s)) return parseTime(Number(s));
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!);
  m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(:\d{2}(\.\d+)?)?)$/.exec(s);
  if (m) return Date.parse(`${m[1]}T${m[2]}Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(`${s}T00:00:00Z`);
  if (/^\d{1,2} [A-Za-z]{3,9} \d{4}(,? \d{1,2}:\d{2}(:\d{2})?)?$/.test(s)) {
    const t = Date.parse(`${s.replace(',', '')} UTC`);
    return Number.isFinite(t) ? t : null;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// ------------------------------------------------------------------------------------------------ Spotify
export const isSpotifyFile = (path: string) => {
  const n = base(path);
  return /\.json$/i.test(n) && (/^Streaming_History_Audio/i.test(n) || /^endsong/i.test(n) || /^StreamingHistory(_music)?_?\d*\.json$/i.test(n));
};

/** One Spotify stream, or null for podcasts, audiobooks, videos, incognito and broken rows. */
export function spotifyPlay(r: unknown): Play | null {
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
    title, artist, at, album: str(o.master_metadata_album_album_name),
    uri: uri && /^spotify:track:[A-Za-z0-9]{10,40}$/.test(uri) ? uri : null,
    ms: Math.max(0, num(o.ms_played ?? o.msPlayed) ?? 0), skips: o.skipped === true ? 1 : 0,
  };
}

function* spotify(files: ExportFile[]): Generator<Play> {
  for (const f of files) {
    if (!isSpotifyFile(f.name)) continue;
    const rows = json(f);
    if (Array.isArray(rows)) for (const r of rows) { const p = spotifyPlay(r); if (p) yield p; }
  }
}

// ------------------------------------------------------------------------------------------------ Apple Music
const isAppleDaily = (p: string) => /Play History Daily Tracks\.csv$/i.test(base(p));
const isAppleActivity = (p: string) => /Play Activity\.csv$/i.test(base(p));

export function appleDailyPlay(r: Record<string, string>): Play | null {
  const desc = str(r['Track Description']);
  const sep = desc?.indexOf(' - ') ?? -1;
  if (!desc || sep <= 0) return null;
  const at = parseTime(r['Date Played']);
  if (at == null) return null;
  const count = Math.max(1, num(r['Play Count']) ?? 1);
  return {
    artist: desc.slice(0, sep), title: desc.slice(sep + 3), at, count,
    ms: Math.max(0, num(r['Play Duration Milliseconds']) ?? 0), skips: Math.max(0, num(r['Skip Count']) ?? 0),
  };
}

export function appleActivityPlay(r: Record<string, string>): Play | null {
  if ('Event Type' in r && r['Event Type'] !== 'PLAY_END') return null;
  const title = str(r['Song Name']);
  const artist = str(r['Artist Name']) ?? str(r['Container Artist Name']);
  const at = parseTime(r['Event End Timestamp'] || r['Event Start Timestamp'] || r['Event Received Timestamp']);
  if (!title || !artist || at == null) return null;
  return {
    title, artist, at, album: str(r['Album Name']) ?? str(r['Container Album Name']),
    ms: Math.max(0, num(r['Play Duration Milliseconds']) ?? 0), skips: /SKIP/i.test(r['End Reason Type'] ?? '') ? 1 : 0,
  };
}

/** Daily Tracks when present (it always names the artist); otherwise the per-play activity log. */
function apple(files: ExportFile[]): Play[] {
  const read = (pred: (p: string) => boolean, fn: (r: Record<string, string>) => Play | null) =>
    files.filter((f) => pred(f.name)).flatMap((f) => csvRecords(parseCsv(strFromU8(f.bytes))).map(fn)).filter((p): p is Play => !!p);
  const daily = read(isAppleDaily, appleDailyPlay);
  return daily.length ? daily : read(isAppleActivity, appleActivityPlay);
}

// ------------------------------------------------------------------------------------------------ YouTube Music
const isYouTubeHistory = (p: string) => /^watch-history\.json$/i.test(base(p));

export function youtubeMusicPlay(r: unknown): Play | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as { header?: unknown; title?: unknown; time?: unknown; details?: unknown; subtitles?: { name?: unknown }[] };
  if (o.header !== 'YouTube Music' || o.details) return null; // details = "From Google Ads"
  const title = str(o.title)?.replace(/^Watched\s+/, '');
  const artist = str(o.subtitles?.[0]?.name)?.replace(/\s+-\s+Topic$/, '');
  const at = parseTime(o.time);
  if (!title || !artist || at == null || /^https?:\/\//.test(title)) return null; // removed videos show the URL
  return { title, artist, at, ms: null };
}

function* youtube(files: ExportFile[]): Generator<Play> {
  for (const f of files) {
    if (!isYouTubeHistory(f.name)) continue;
    const rows = json(f);
    if (Array.isArray(rows)) for (const r of rows) { const p = youtubeMusicPlay(r); if (p) yield p; }
  }
}

// ------------------------------------------------------------------------------------------------ Deezer
const norm = (h: unknown) => String(h ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const DEEZER_COLS = {
  title: ['song title', 'titre', 'titre du morceau', 'titre de la chanson'],
  artist: ['artist', 'artists', 'artiste', 'artistes'],
  album: ['album title', 'album', "titre de l'album"],
  seconds: ['listening time', "temps d'ecoute", "duree d'ecoute", 'ecoute'],
  date: ['date', "date d'ecoute", "date de l'ecoute"],
};

export function deezerPlays(rows: (string | number)[][]): Play[] {
  const head = (rows[0] ?? []).map(norm);
  const col = (names: string[]) => head.findIndex((h) => names.includes(h));
  const ix = { title: col(DEEZER_COLS.title), artist: col(DEEZER_COLS.artist), album: col(DEEZER_COLS.album), seconds: col(DEEZER_COLS.seconds), date: col(DEEZER_COLS.date) };
  if (ix.title < 0 || ix.artist < 0 || ix.date < 0) return [];
  const out: Play[] = [];
  for (const r of rows.slice(1)) {
    const d = r[ix.date];
    const at = typeof d === 'number' && d < 1e6 ? Math.round((d - 25569) * 86_400_000) : parseTime(d); // Excel serial day
    const title = str(String(r[ix.title] ?? '')), artist = str(String(r[ix.artist] ?? ''));
    if (!title || !artist || at == null) continue;
    const secs = ix.seconds >= 0 ? num(r[ix.seconds]) : null;
    out.push({ title, artist, at, album: ix.album >= 0 ? str(String(r[ix.album] ?? '')) : null, ms: secs == null || secs < 0 ? null : secs * 1000 });
  }
  return out;
}

function deezer(files: ExportFile[]): Play[] {
  const out: Play[] = [];
  for (const f of files) {
    if (!/\.xlsx$/i.test(f.name)) continue;
    try {
      const book = xlsxSheets(f.bytes);
      const sheet = book.names.find((n) => /(^|_)listeningHistory$/i.test(n));
      if (sheet) out.push(...deezerPlays(book.read(sheet)));
    } catch { /* not a workbook */ }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ Last.fm
export function lastfmPlays(rows: string[][]): Play[] {
  const head = (rows[0] ?? []).map(norm);
  const find = (names: string[]) => head.findIndex((h) => names.includes(h));
  let ix = { artist: find(['artist', 'artist name', 'artist_name']), title: find(['track', 'title', 'track name', 'track_name', 'name']),
    album: find(['album', 'album name', 'album_name']), date: find(['date', 'timestamp', 'uts', 'utc_time', 'time', 'played at', 'date_utc']) };
  let body = rows.slice(1);
  if (ix.artist < 0 || ix.title < 0 || ix.date < 0) {
    // lastfm-to-csv: artist,album,track,date with no header row
    if (!rows.length || rows[0]!.length !== 4 || parseTime(rows[0]![3]) == null) return [];
    ix = { artist: 0, album: 1, title: 2, date: 3 };
    body = rows;
  }
  const out: Play[] = [];
  for (const r of body) {
    const at = parseTime(r[ix.date]);
    const title = str(r[ix.title]), artist = str(r[ix.artist]);
    if (title && artist && at != null) out.push({ title, artist, at, album: ix.album >= 0 ? str(r[ix.album]) : null, ms: null });
  }
  return out;
}

function lastfm(files: ExportFile[]): Play[] {
  return files.filter((f) => /\.csv$/i.test(f.name) && !isAppleDaily(f.name) && !isAppleActivity(f.name) && !/^Apple Music/i.test(base(f.name)))
    .flatMap((f) => lastfmPlays(parseCsv(strFromU8(f.bytes))));
}

// ------------------------------------------------------------------------------------------------ detection
const READERS: [TasteSource, (files: ExportFile[]) => Iterable<Play>][] = [
  ['spotify', spotify], ['apple_music', apple], ['youtube_music', youtube], ['deezer', deezer], ['lastfm', lastfm],
];

/** Every service found in the files, summarized. Throws a helpful message when nothing usable is found. */
export function summarizeFiles(files: ExportFile[]): TasteSummary[] {
  const out: TasteSummary[] = [];
  for (const [source, read] of READERS) {
    const s = summarize(source, read(files));
    if (s.tracks.length) out.push(s);
  }
  if (out.length) return out;
  if (files.some((f) => /^watch-history\.html$/i.test(base(f.name))))
    throw new Error('That Takeout has your YouTube history as HTML. Export it again with the history format set to JSON.');
  if (files.some((f) => /Play Activity\.csv$/i.test(base(f.name))))
    throw new Error('That Apple Music export has no artist names, so we can’t match the songs. Include "Play History Daily Tracks" if it’s there.');
  throw new Error(`No listening history found. Choose the export file from Spotify, Apple Music, YouTube Music (Google Takeout), Deezer or a Last.fm scrobble CSV. (${UNSUPPORTED_SERVICES.join(', ')} don’t offer a history download we can read yet.)`);
}

/** Files and folders worth unpacking from an export archive (Apple nests zips inside zips). */
const wanted = (p: string) => /\.zip$/i.test(p) || isSpotifyFile(p) || /\.csv$/i.test(p) || /\.xlsx$/i.test(p) || /^watch-history\.(json|html)$/i.test(base(p));

/** Expands zips (nested up to 3 deep) in the browser, keeping only files a reader might want. */
export async function expandExports(files: File[]): Promise<ExportFile[]> {
  const { unzip } = await import('fflate');
  const out: ExportFile[] = [];
  const open = async (name: string, bytes: Uint8Array, depth: number): Promise<void> => {
    if (!/\.zip$/i.test(name)) { if (wanted(name)) out.push({ name, bytes }); return; }
    if (depth > 3) return;
    const entries = await new Promise<Record<string, Uint8Array>>((res, rej) =>
      unzip(bytes, { filter: (e) => !e.name.endsWith('/') && wanted(e.name) }, (err, data) => (err ? rej(err) : res(data))));
    for (const [inner, data] of Object.entries(entries)) await open(inner, data, depth + 1);
  };
  for (const f of files) await open(f.name, new Uint8Array(await f.arrayBuffer()), 0);
  return out;
}

/** Reads the chosen export files in the browser and returns only the summaries, one per service found. */
export async function summarizeExports(files: File[]): Promise<TasteSummary[]> {
  return summarizeFiles(await expandExports(files));
}
