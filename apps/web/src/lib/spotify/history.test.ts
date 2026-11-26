// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { isHistoryFile, MAX_TRACKS, readStream, summarize, summarizeExport } from './history';

// Synthetic rows in the Extended streaming history shape (made-up songs and values).
const row = (o: Partial<Record<string, unknown>>) => ({
  ts: '2024-03-01T10:00:00Z', platform: 'test', ms_played: 200_000, conn_country: 'ZZ', ip_addr: '203.0.113.9',
  master_metadata_track_name: 'Paper Lanterns', master_metadata_album_artist_name: 'The Test Pilots',
  master_metadata_album_album_name: 'Night Shift', spotify_track_uri: 'spotify:track:0123456789abcdefABCDEF',
  episode_name: null, episode_show_name: null, spotify_episode_uri: null,
  audiobook_title: null, audiobook_uri: null, audiobook_chapter_uri: null, audiobook_chapter_title: null,
  reason_start: 'clickrow', reason_end: 'trackdone', shuffle: false, skipped: false, offline: false,
  offline_timestamp: null, incognito_mode: false,
  ...o,
});

describe('readStream', () => {
  it('reads an extended-history song', () => {
    expect(readStream(row({}))).toEqual({
      title: 'Paper Lanterns', artist: 'The Test Pilots', album: 'Night Shift',
      uri: 'spotify:track:0123456789abcdefABCDEF', ms: 200_000, skipped: false, at: Date.parse('2024-03-01T10:00:00Z'),
    });
  });
  it('reads the account-data format', () => {
    expect(readStream({ endTime: '2023-04-01 18:22', artistName: 'Ada', trackName: 'Loops', msPlayed: 5000 }))
      .toMatchObject({ title: 'Loops', artist: 'Ada', ms: 5000, uri: null, at: Date.parse('2023-04-01T18:22:00Z') });
  });
  it('skips podcasts, audiobooks, incognito and broken rows', () => {
    expect(readStream(row({ master_metadata_track_name: null, master_metadata_album_artist_name: null, episode_name: 'Ep 1', spotify_episode_uri: 'spotify:episode:x' }))).toBeNull();
    expect(readStream(row({ master_metadata_track_name: null, audiobook_title: 'A Book', audiobook_uri: 'spotify:audiobook:x' }))).toBeNull();
    expect(readStream(row({ incognito_mode: true }))).toBeNull();
    expect(readStream(row({ ts: 'not a date' }))).toBeNull();
    expect(readStream(row({ master_metadata_track_name: null }))).toBeNull();
    expect(readStream(null)).toBeNull();
    expect(readStream('x')).toBeNull();
  });
  it('drops malformed track URIs', () => {
    expect(readStream(row({ spotify_track_uri: 'javascript:alert(1)' }))?.uri).toBeNull();
  });
});

describe('summarize', () => {
  const history = [
    row({ ts: '2024-01-01T00:00:00Z', ms_played: 180_000 }),
    row({ ts: '2024-02-01T00:00:00Z', ms_played: 10_000, skipped: true }),
    row({ ts: '2024-03-01T00:00:00Z', ms_played: 190_000, master_metadata_track_name: 'paper lanterns' }), // same song, other case
    row({ ts: '2023-12-01T00:00:00Z', ms_played: 100_000, master_metadata_track_name: 'Second Song' }),
    row({ ts: '2024-02-15T00:00:00Z', ms_played: 50_000, master_metadata_album_artist_name: 'Solo Act', master_metadata_track_name: 'Only One' }),
    row({ ts: '2025-01-01T00:00:00Z', master_metadata_track_name: null, master_metadata_album_artist_name: null, episode_name: 'Pod' }),
  ];
  const s = summarize([history.slice(0, 3), history.slice(3)]); // spread across two files

  it('totals only song streams', () => {
    expect(s.streams).toBe(5);
    expect(s.ms_played).toBe(530_000);
    expect(s.first_played).toBe('2023-12-01T00:00:00.000Z');
    expect(s.last_played).toBe('2024-03-01T00:00:00.000Z');
  });
  it('aggregates per track: plays, skip rate, last played', () => {
    expect(s.tracks[0]).toEqual({
      title: 'Paper Lanterns', artist: 'The Test Pilots', album: 'Night Shift', spotify_uri: 'spotify:track:0123456789abcdefABCDEF',
      plays: 2, streams: 3, ms_played: 380_000, skip_rate: 0.333, last_played: '2024-03-01T00:00:00.000Z',
    });
    expect(s.tracks.map((t) => t.title)).toEqual(['Paper Lanterns', 'Second Song', 'Only One']);
  });
  it('aggregates per artist, ordered by time listened', () => {
    expect(s.artists).toEqual([
      { name: 'The Test Pilots', plays: 3, streams: 4, ms_played: 480_000, skip_rate: 0.25, last_played: '2024-03-01T00:00:00.000Z', track_count: 2 },
      { name: 'Solo Act', plays: 1, streams: 1, ms_played: 50_000, skip_rate: 0, last_played: '2024-02-15T00:00:00.000Z', track_count: 1 },
    ]);
  });
  it('never carries IP address, country, device or raw timestamps per stream', () => {
    const json = JSON.stringify(s);
    for (const leak of ['203.0.113.9', 'ZZ', 'ip_addr', 'conn_country', 'platform', 'shuffle', '2024-01-01', '2024-02-01']) expect(json).not.toContain(leak);
  });
  it('keeps the most-listened tracks when there are too many', () => {
    const many = Array.from({ length: MAX_TRACKS + 50 }, (_, i) => row({ master_metadata_track_name: `Song ${i}`, ms_played: 1000 + i }));
    const big = summarize([many]);
    expect(big.tracks).toHaveLength(MAX_TRACKS);
    expect(big.tracks[0]!.title).toBe(`Song ${MAX_TRACKS + 49}`);
    expect(big.artists[0]!.track_count).toBe(MAX_TRACKS + 50);
  });
  it('handles empty and junk input', () => {
    expect(summarize([[], 'junk' as unknown as unknown[], [null, 1, {}]])).toMatchObject({ streams: 0, tracks: [], artists: [], first_played: null });
  });
});

describe('isHistoryFile', () => {
  it('picks audio history files only', () => {
    expect(isHistoryFile('Spotify Extended Streaming History/Streaming_History_Audio_2019-2021_0.json')).toBe(true);
    expect(isHistoryFile('MyData/endsong_3.json')).toBe(true);
    expect(isHistoryFile('MyData/StreamingHistory_music_0.json')).toBe(true);
    expect(isHistoryFile('MyData/StreamingHistory0.json')).toBe(true);
    expect(isHistoryFile('Spotify Extended Streaming History/Streaming_History_Video_2020.json')).toBe(false);
    expect(isHistoryFile('Spotify Extended Streaming History/ReadMeFirst_ExtendedStreamingHistory.pdf')).toBe(false);
    expect(isHistoryFile('MyData/StreamingHistory_podcast_0.json')).toBe(false);
  });
});

describe('summarizeExport', () => {
  const zipFile = (files: Record<string, string>) => {
    const z = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
    return new File([z as BlobPart], 'my_spotify_data.zip', { type: 'application/zip' });
  };
  it('unzips the export and summarizes the audio history', async () => {
    const f = zipFile({
      'Spotify Extended Streaming History/Streaming_History_Audio_2024_0.json': JSON.stringify([row({}), row({})]),
      'Spotify Extended Streaming History/Streaming_History_Video_2024.json': JSON.stringify([row({ master_metadata_track_name: 'Video' })]),
      'Spotify Extended Streaming History/ReadMeFirst_ExtendedStreamingHistory.pdf': '%PDF',
    });
    const s = await summarizeExport([f]);
    expect(s.streams).toBe(2);
    expect(s.tracks.map((t) => t.title)).toEqual(['Paper Lanterns']);
  });
  it('accepts loose json files', async () => {
    const f = new File([JSON.stringify([row({})])], 'Streaming_History_Audio_2024_1.json');
    expect((await summarizeExport([f])).tracks).toHaveLength(1);
  });
  it('explains a zip that is not a Spotify export', async () => {
    await expect(summarizeExport([zipFile({ 'photos/a.json': '[]' })])).rejects.toThrow(/No Spotify streaming history/);
  });
  it('explains an export with only podcasts', async () => {
    const f = zipFile({ 'x/Streaming_History_Audio_1.json': JSON.stringify([row({ master_metadata_track_name: null, episode_name: 'Pod' })]) });
    await expect(summarizeExport([f])).rejects.toThrow(/no songs/);
  });
});
