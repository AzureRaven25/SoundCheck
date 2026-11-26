// @vitest-environment node
// (jsdom's typed arrays come from another realm, which trips fflate's zip writer)
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseCsv, xlsxSheets } from './formats';
import {
  appleActivityPlay, appleDailyPlay, deezerPlays, expandExports, isSpotifyFile, lastfmPlays, parseTime, spotifyPlay,
  summarizeExports, summarizeFiles, youtubeMusicPlay, type ExportFile,
} from './sources';
import { MAX_TRACKS, summarize } from './summary';

// All fixtures are synthetic: made-up songs, artists, IPs and devices.
const sp = (o: Partial<Record<string, unknown>> = {}) => ({
  ts: '2024-03-01T10:00:00Z', platform: 'test', ms_played: 200_000, conn_country: 'ZZ', ip_addr: '203.0.113.9',
  master_metadata_track_name: 'Paper Lanterns', master_metadata_album_artist_name: 'The Test Pilots',
  master_metadata_album_album_name: 'Night Shift', spotify_track_uri: 'spotify:track:0123456789abcdefABCDEF',
  episode_name: null, episode_show_name: null, spotify_episode_uri: null,
  audiobook_title: null, audiobook_uri: null, audiobook_chapter_uri: null, audiobook_chapter_title: null,
  reason_start: 'clickrow', reason_end: 'trackdone', shuffle: false, skipped: false, offline: false,
  offline_timestamp: null, incognito_mode: false, ...o,
});
const file = (name: string, text: string): ExportFile => ({ name, bytes: strToU8(text) });
const csv = (rows: string[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n');
const zip = (files: Record<string, string | Uint8Array>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])));

/** A minimal .xlsx: shared strings for text, plain numbers otherwise. */
function xlsx(sheets: Record<string, (string | number)[][]>): Uint8Array {
  const strings: string[] = [];
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const col = (i: number) => String.fromCharCode(65 + i);
  const names = Object.keys(sheets);
  const files: Record<string, string> = {
    'xl/workbook.xml': `<workbook xmlns:r="r"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships>${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="ws" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
  };
  names.forEach((n, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet><sheetData>${sheets[n]!.map((r, y) => `<row r="${y + 1}">${r.map((v, x) =>
      typeof v === 'number' ? `<c r="${col(x)}${y + 1}"><v>${v}</v></c>` : `<c r="${col(x)}${y + 1}" t="s"><v>${strings.push(v) - 1}</v></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
  });
  files['xl/sharedStrings.xml'] = `<sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`;
  return zip(files);
}

describe('parseTime', () => {
  it('reads every export’s timestamp style as UTC', () => {
    const t = Date.UTC(2023, 3, 1, 18, 22);
    expect(parseTime('2023-04-01T18:22:00Z')).toBe(t);
    expect(parseTime('2023-04-01 18:22')).toBe(t);
    expect(parseTime('2023-04-01 18:22:00')).toBe(t);
    expect(parseTime('1 Apr 2023 18:22')).toBe(t);
    expect(parseTime('01 Apr 2023, 18:22')).toBe(t);
    expect(parseTime(String(t / 1000))).toBe(t);
    expect(parseTime('20230401')).toBe(Date.UTC(2023, 3, 1));
    expect(parseTime('nope')).toBeNull();
    expect(parseTime('')).toBeNull();
  });
});

describe('Spotify', () => {
  it('reads extended history and account-data rows', () => {
    expect(spotifyPlay(sp())).toMatchObject({ title: 'Paper Lanterns', artist: 'The Test Pilots', ms: 200_000, skips: 0, uri: 'spotify:track:0123456789abcdefABCDEF' });
    expect(spotifyPlay({ endTime: '2023-04-01 18:22', artistName: 'Ada', trackName: 'Loops', msPlayed: 5000 })).toMatchObject({ title: 'Loops', artist: 'Ada', ms: 5000, uri: null });
  });
  it('skips podcasts, audiobooks, incognito and broken rows, and bad URIs', () => {
    expect(spotifyPlay(sp({ master_metadata_track_name: null, episode_name: 'Ep 1', spotify_episode_uri: 'spotify:episode:x' }))).toBeNull();
    expect(spotifyPlay(sp({ master_metadata_track_name: null, audiobook_title: 'A Book' }))).toBeNull();
    expect(spotifyPlay(sp({ incognito_mode: true }))).toBeNull();
    expect(spotifyPlay(sp({ ts: 'not a date' }))).toBeNull();
    expect(spotifyPlay(null)).toBeNull();
    expect(spotifyPlay(sp({ spotify_track_uri: 'javascript:alert(1)' }))?.uri).toBeNull();
  });
  it('picks audio history files only', () => {
    expect(isSpotifyFile('Spotify Extended Streaming History/Streaming_History_Audio_2019-2021_0.json')).toBe(true);
    expect(isSpotifyFile('MyData/endsong_3.json')).toBe(true);
    expect(isSpotifyFile('MyData/StreamingHistory_music_0.json')).toBe(true);
    expect(isSpotifyFile('Spotify Extended Streaming History/Streaming_History_Video_2020.json')).toBe(false);
    expect(isSpotifyFile('MyData/StreamingHistory_podcast_0.json')).toBe(false);
  });
});

describe('summarize', () => {
  const plays = [
    sp({ ts: '2024-01-01T00:00:00Z', ms_played: 180_000 }),
    sp({ ts: '2024-02-01T00:00:00Z', ms_played: 10_000, skipped: true }),
    sp({ ts: '2024-03-01T00:00:00Z', ms_played: 190_000, master_metadata_track_name: 'paper lanterns' }),
    sp({ ts: '2023-12-01T00:00:00Z', ms_played: 100_000, master_metadata_track_name: 'Second Song' }),
    sp({ ts: '2024-02-15T00:00:00Z', ms_played: 50_000, master_metadata_album_artist_name: 'Solo Act', master_metadata_track_name: 'Only One' }),
  ].map(spotifyPlay).filter((p) => !!p);
  const s = summarize('spotify', plays);

  it('totals, per track and per artist', () => {
    expect(s).toMatchObject({ source: 'spotify', streams: 5, ms_played: 530_000, first_played: '2023-12-01T00:00:00.000Z', last_played: '2024-03-01T00:00:00.000Z' });
    expect(s.tracks[0]).toEqual({
      title: 'Paper Lanterns', artist: 'The Test Pilots', album: 'Night Shift', spotify_uri: 'spotify:track:0123456789abcdefABCDEF',
      plays: 2, streams: 3, ms_played: 380_000, skip_rate: 0.333, last_played: '2024-03-01T00:00:00.000Z',
    });
    expect(s.artists).toEqual([
      { name: 'The Test Pilots', plays: 3, streams: 4, ms_played: 480_000, skip_rate: 0.25, last_played: '2024-03-01T00:00:00.000Z', track_count: 2 },
      { name: 'Solo Act', plays: 1, streams: 1, ms_played: 50_000, skip_rate: 0, last_played: '2024-02-15T00:00:00.000Z', track_count: 1 },
    ]);
  });
  it('carries no IPs, countries, devices or per-stream timestamps', () => {
    const json = JSON.stringify(s);
    for (const leak of ['203.0.113.9', 'ZZ', 'ip_addr', 'conn_country', 'platform', 'shuffle', '2024-01-01', '2024-02-01']) expect(json).not.toContain(leak);
  });
  it('counts plays without a listening time, and daily totals as given', () => {
    const t = Date.UTC(2024, 0, 1);
    const r = summarize('youtube_music', [{ title: 'A', artist: 'B', at: t, ms: null }, { title: 'A', artist: 'B', at: t + 1, ms: null }]);
    expect(r.tracks[0]).toMatchObject({ plays: 2, streams: 2, ms_played: 0 });
    const d = summarize('apple_music', [{ title: 'A', artist: 'B', at: t, ms: 600_000, count: 3, skips: 1 }]);
    expect(d.tracks[0]).toMatchObject({ plays: 3, streams: 3, ms_played: 600_000, skip_rate: 0.333 });
  });
  it('keeps the most-listened tracks when there are too many', () => {
    const many = Array.from({ length: MAX_TRACKS + 50 }, (_, i) => ({ title: `Song ${i}`, artist: 'X', at: 1e12, ms: 1000 + i }));
    const big = summarize('spotify', many);
    expect(big.tracks).toHaveLength(MAX_TRACKS);
    expect(big.tracks[0]!.title).toBe(`Song ${MAX_TRACKS + 49}`);
    expect(big.artists[0]!.track_count).toBe(MAX_TRACKS + 50);
  });
});

describe('Apple Music', () => {
  it('reads Play History Daily Tracks ("Artist - Song", daily totals)', () => {
    expect(appleDailyPlay({ 'Track Description': 'The Test Pilots - Paper Lanterns - Remastered', 'Date Played': '20240115', 'Play Count': '3', 'Play Duration Milliseconds': '540000', 'Skip Count': '1' }))
      .toEqual({ artist: 'The Test Pilots', title: 'Paper Lanterns - Remastered', at: Date.UTC(2024, 0, 15), count: 3, ms: 540_000, skips: 1 });
    expect(appleDailyPlay({ 'Track Description': 'No separator here', 'Date Played': '20240115' })).toBeNull();
  });
  it('reads Play Activity end-of-play events and spots skips', () => {
    const r = { 'Song Name': 'Glass Harbor', 'Artist Name': 'The Test Pilots', 'Album Name': 'Night Shift', 'Event Type': 'PLAY_END',
      'Event Start Timestamp': '2024-02-01T10:00:00.000Z', 'Event End Timestamp': '2024-02-01T10:00:20.000Z',
      'Play Duration Milliseconds': '20000', 'End Reason Type': 'TRACK_SKIPPED_FORWARDS', 'IP Address': '203.0.113.9' };
    expect(appleActivityPlay(r)).toEqual({ title: 'Glass Harbor', artist: 'The Test Pilots', album: 'Night Shift', at: Date.parse('2024-02-01T10:00:20Z'), ms: 20_000, skips: 1 });
    expect(appleActivityPlay({ ...r, 'Event Type': 'PLAY_START' })).toBeNull();
    expect(appleActivityPlay({ ...r, 'Artist Name': '', 'Container Artist Name': 'Fallback Artist', 'End Reason Type': 'NATURAL_END_OF_TRACK' }))
      .toMatchObject({ artist: 'Fallback Artist', skips: 0 });
    expect(appleActivityPlay({ ...r, 'Artist Name': '' })).toBeNull();
  });
  it('unpacks the zip-of-zips and prefers Daily Tracks', async () => {
    const daily = csv([['Track Description', 'Date Played', 'Play Count', 'Play Duration Milliseconds'], ['The Test Pilots - Paper Lanterns', '20240115', '4', '720000']]);
    const activity = csv([['Song Name', 'Artist Name', 'Event Type', 'Event End Timestamp', 'Play Duration Milliseconds', 'End Reason Type'],
      ['Paper Lanterns', 'The Test Pilots', 'PLAY_END', '2024-01-15T10:00:00Z', '180000', 'NATURAL_END_OF_TRACK']]);
    const inner = zip({
      'Apple_Media_Services/Apple Music Activity/Apple Music - Play History Daily Tracks.csv': daily,
      'Apple_Media_Services/Apple Music Activity/Apple Music Play Activity.csv': activity,
      'Apple_Media_Services/Apple Music Activity/Apple Music Library Tracks.json': '[]',
    });
    const outer = new File([zip({ 'Apple Media Services information/Apple_Media_Services.zip': inner }) as BlobPart], 'Apple Media Services information.zip');
    const [s, ...rest] = await summarizeExports([outer]);
    expect(rest).toHaveLength(0);
    expect(s).toMatchObject({ source: 'apple_music', streams: 4, ms_played: 720_000 });
    expect(s!.tracks[0]).toMatchObject({ title: 'Paper Lanterns', artist: 'The Test Pilots', plays: 4 });
  });
  it('falls back to Play Activity, and explains one without artists', () => {
    const activity = (artist: string) => file('Apple Music Activity/Apple Music Play Activity.csv', csv([['Song Name', 'Artist Name', 'Event Type', 'Event End Timestamp', 'Play Duration Milliseconds', 'End Reason Type'],
      ['Glass Harbor', artist, 'PLAY_END', '2024-01-15T10:00:00Z', '180000', 'NATURAL_END_OF_TRACK']]));
    expect(summarizeFiles([activity('The Test Pilots')])[0]).toMatchObject({ source: 'apple_music', streams: 1 });
    expect(() => summarizeFiles([activity('')])).toThrow(/no artist names/);
  });
});

describe('YouTube Music', () => {
  const entry = (o: Record<string, unknown> = {}) => ({
    header: 'YouTube Music', title: 'Watched Paper Lanterns', titleUrl: 'https://music.youtube.com/watch?v=abc',
    subtitles: [{ name: 'The Test Pilots - Topic', url: 'https://www.youtube.com/channel/x' }], time: '2024-04-28T12:23:47.000Z',
    products: ['YouTube'], activityControls: ['YouTube watch history'], ...o,
  });
  it('keeps YouTube Music plays only, cleaning "Watched" and " - Topic"', () => {
    expect(youtubeMusicPlay(entry())).toEqual({ title: 'Paper Lanterns', artist: 'The Test Pilots', at: Date.parse('2024-04-28T12:23:47Z'), ms: null });
    expect(youtubeMusicPlay(entry({ header: 'YouTube' }))).toBeNull();
    expect(youtubeMusicPlay(entry({ details: [{ name: 'From Google Ads' }] }))).toBeNull();
    expect(youtubeMusicPlay(entry({ title: 'Watched https://music.youtube.com/watch?v=gone', subtitles: undefined }))).toBeNull();
  });
  it('finds watch-history.json in a Takeout zip, and explains the HTML version', async () => {
    const takeout = new File([zip({
      'Takeout/YouTube and YouTube Music/history/watch-history.json': JSON.stringify([entry(), entry({ header: 'YouTube', title: 'Watched a cat video' })]),
      'Takeout/YouTube and YouTube Music/subscriptions/subscriptions.csv': 'Channel Id,Channel Url,Channel Title\nx,y,z',
    }) as BlobPart], 'takeout-20241126.zip');
    const [s] = await summarizeExports([takeout]);
    expect(s).toMatchObject({ source: 'youtube_music', streams: 1 });
    expect(() => summarizeFiles([file('Takeout/YouTube and YouTube Music/history/watch-history.html', '<html>')])).toThrow(/JSON/);
  });
});

describe('Deezer', () => {
  const head = ['Song Title', 'Artist', 'ISRC', 'Album Title', 'IP Address', 'Listening Time', 'Platform Name', 'Platform Model', 'Date'];
  it('reads the listening-history sheet (English or French headers, seconds, -1 unknown, Excel dates)', () => {
    expect(deezerPlays([head, ['Paper Lanterns', 'The Test Pilots', 'ZZ0000000001', 'Night Shift', '203.0.113.9', 185, 'web', 'test', '2024-10-24 23:00:00']]))
      .toEqual([{ title: 'Paper Lanterns', artist: 'The Test Pilots', album: 'Night Shift', at: Date.UTC(2024, 9, 24, 23), ms: 185_000 }]);
    expect(deezerPlays([['Titre du morceau', 'Artiste', "Titre de l'album", "Durée d'écoute", "Date d'écoute"], ['Chanson', 'Groupe', 'Disque', -1, 45000.5]]))
      .toEqual([{ title: 'Chanson', artist: 'Groupe', album: 'Disque', at: Date.UTC(2023, 2, 15, 12), ms: null }]);
    expect(deezerPlays([['Something', 'Else'], ['a', 'b']])).toEqual([]);
  });
  it('reads a real .xlsx workbook and ignores other sheets', () => {
    const book = xlsxSheets(xlsx({ '1_accountInfo': [['Email'], ['x']], '10_listeningHistory': [head, ['A & B', 'Band', '', '', '', 200, '', '', '2024-01-01 10:00:00']] }));
    expect(book.names).toEqual(['1_accountInfo', '10_listeningHistory']);
    expect(book.read('10_listeningHistory')[1]).toEqual(['A & B', 'Band', '', '', '', 200, '', '', '2024-01-01 10:00:00']);
  });
  it('detects a Deezer export', async () => {
    const f = new File([xlsx({ '10_listeningHistory': [head, ['Paper Lanterns', 'The Test Pilots', '', '', '203.0.113.9', 185, '', '', '2024-10-24 23:00:00']] }) as BlobPart], 'deezer-data_123.xlsx');
    const [s] = await summarizeExports([f]);
    expect(s).toMatchObject({ source: 'deezer', streams: 1, ms_played: 185_000 });
    expect(JSON.stringify(s)).not.toContain('203.0.113.9');
  });
});

describe('Last.fm', () => {
  it('reads a headerless lastfm-to-csv export', () => {
    expect(lastfmPlays(parseCsv('The Test Pilots,Night Shift,Paper Lanterns,15 Jan 2024 09:15\n"Band, The",,"Song ""Q""",16 Jan 2024 10:00\n')))
      .toEqual([
        { artist: 'The Test Pilots', album: 'Night Shift', title: 'Paper Lanterns', at: Date.UTC(2024, 0, 15, 9, 15), ms: null },
        { artist: 'Band, The', album: null, title: 'Song "Q"', at: Date.UTC(2024, 0, 16, 10), ms: null },
      ]);
  });
  it('reads a CSV with a header row (unix timestamps)', () => {
    expect(lastfmPlays(parseCsv('uts,utc_time,artist,album,track\n1705310100,"15 Jan 2024, 09:15",The Test Pilots,Night Shift,Paper Lanterns')))
      .toEqual([{ artist: 'The Test Pilots', album: 'Night Shift', title: 'Paper Lanterns', at: Date.UTC(2024, 0, 15, 9, 15), ms: null }]);
  });
  it('ignores playlist CSVs without play dates', () => {
    expect(lastfmPlays(parseCsv('Track Name,Artist Name(s),Album Name\nA,B,C'))).toEqual([]);
  });
});

describe('detection', () => {
  it('handles several services in one pick', async () => {
    const spotifyZip = new File([zip({ 'Spotify Extended Streaming History/Streaming_History_Audio_2024_0.json': JSON.stringify([sp(), sp()]) }) as BlobPart], 'my_spotify_data.zip');
    const scrobbles = new File(['The Test Pilots,Night Shift,Paper Lanterns,15 Jan 2024 09:15'], 'scrobbles.csv');
    const got = await summarizeExports([spotifyZip, scrobbles]);
    expect(got.map((s) => [s.source, s.streams])).toEqual([['spotify', 2], ['lastfm', 1]]);
  });
  it('explains a file that is no listening history, naming unsupported services', async () => {
    await expect(summarizeExports([new File([zip({ 'photos/a.json': '[]' }) as BlobPart], 'x.zip')])).rejects.toThrow(/No listening history found.*Amazon Music/);
  });
  it('unpacks only files a reader wants', async () => {
    const files = await expandExports([new File([zip({ 'a/photo.jpg': 'x', 'a/watch-history.json': '[]', 'a/Streaming_History_Video_1.json': '[]' }) as BlobPart], 'x.zip')]);
    expect(files.map((f) => f.name)).toEqual(['a/watch-history.json']);
  });
});
