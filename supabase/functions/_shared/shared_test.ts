import { assert, assertEquals } from 'jsr:@std/assert@1';
import { parseLrc, plainToContent } from './lrc.ts';
import { mapRecordingSearch, recordingQuery, type MbRecording } from './musicbrainz.ts';
import { norm, similarity, stripEditionNoise } from './norm.ts';
import { pickAlbum, upscaleArtwork } from './itunes.ts';

Deno.test('parseLrc: line-level, metadata ignored, repeated timestamps, last line ends at song end', () => {
  const r = parseLrc('[ar:Someone]\n[00:01.50]first line\n[00:04.00]\n[00:05.25][00:20.00]chorus\n[00:10.000]last', 30);
  assertEquals(r.granularity, 'line');
  assertEquals(r.lines.map((l) => l.text), ['first line', '', 'chorus', 'last', 'chorus']);
  assertEquals(r.lines[0], { start: 1.5, end: 4, text: 'first line' });
  assertEquals(r.lines.at(-1)!.end, 30);
});

Deno.test('parseLrc: enhanced LRC word timing', () => {
  const r = parseLrc('[00:12.00]<00:12.00>Hello <00:12.50>bright <00:13.10>world\n[00:15.00]<00:15.00>Next');
  assertEquals(r.granularity, 'word');
  assertEquals(r.lines[0]!.text, 'Hello bright world');
  assertEquals(r.lines[0]!.words, [
    { start: 12, end: 12.5, text: 'Hello' },
    { start: 12.5, end: 13.1, text: 'bright' },
    { start: 13.1, end: 15, text: 'world' },
  ]);
});

Deno.test('plainToContent keeps lines without timing', () => {
  assertEquals(plainToContent('a\nb ').lines, [{ text: 'a' }, { text: 'b' }]);
});

Deno.test('norm/similarity/stripEditionNoise', () => {
  assertEquals(norm('  Beyoncé’s  Song '), "beyonce's song");
  assertEquals(similarity('Midnight Signal', 'midnight signal'), 1);
  assert(similarity('Midnite Signal', 'Midnight Signal') > 0.7);
  assertEquals(stripEditionNoise('First Light (2011 Remaster)'), 'First Light');
  assertEquals(stripEditionNoise('Song - Remastered 2009'), 'Song');
  assertEquals(stripEditionNoise('Live Wire'), 'Live Wire');
});

const rg = (id: string, type: string, secondary: string[] = []) => ({ id, title: 'First Light', 'primary-type': type, 'secondary-types': secondary });
const credit = [
  { name: 'Aurora Vale', joinphrase: ' & ', artist: { id: 'art-1', name: 'Aurora Vale', 'sort-name': 'Vale, Aurora' } },
  { name: 'The Night Owls', joinphrase: '', artist: { id: 'art-2', name: 'The Night Owls' } },
];
const recordings: MbRecording[] = [
  { id: 'rec-1', title: 'Midnight Signal', length: 200000, score: 100, isrcs: ['US-ABC-15-00001'], 'artist-credit': credit,
    releases: [
      { id: 'rel-2', title: 'Hits', status: 'Official', date: '2020', 'release-group': rg('rg-hits', 'Album', ['Compilation']) },
      { id: 'rel-1', title: 'First Light', status: 'Official', date: '2015-03-02', 'release-group': rg('rg-1', 'Album') },
    ] },
  { id: 'rec-2', title: 'Midnight  Signal', length: 201000, score: 95, 'artist-credit': credit,      // remaster → same song
    releases: [{ id: 'rel-3', title: 'First Light (Deluxe)', status: 'Official', date: '2021', 'release-group': rg('rg-1', 'Album') }] },
  { id: 'rec-3', title: 'Midnight Signal', score: 90, disambiguation: 'live, 2016', 'artist-credit': credit,
    releases: [{ id: 'rel-4', title: 'Pier', status: 'Official', 'release-group': rg('rg-live', 'Album') }] },
  { id: 'rec-4', title: 'Midnight Signal', score: 90, 'artist-credit': credit,                       // only on a live album
    releases: [{ id: 'rel-5', title: 'Pier', status: 'Official', 'release-group': rg('rg-live2', 'Album', ['Live']) }] },
  { id: 'rec-5', title: 'Midnight Signal', score: 90, 'artist-credit': credit,                       // bootleg only
    releases: [{ id: 'rel-6', title: 'Tapes', status: 'Bootleg', 'release-group': rg('rg-boot', 'Album') }] },
  { id: 'rec-6', title: 'Midnight Signal', score: 90, video: true, 'artist-credit': credit,
    releases: [{ id: 'rel-7', title: 'X', status: 'Official', 'release-group': rg('rg-1', 'Album') }] },
  { id: 'rec-7', title: 'Midnight Signal (Instrumental)', score: 90, 'artist-credit': credit,
    releases: [{ id: 'rel-8', title: 'X', status: 'Official', 'release-group': rg('rg-1', 'Album') }] },
  { id: 'rec-8', title: 'Other Song', score: 40, 'artist-credit': credit,                            // low search score
    releases: [{ id: 'rel-9', title: 'X', status: 'Official', 'release-group': rg('rg-1', 'Album') }] },
];

Deno.test('mapRecordingSearch: eligibility, grouping, ids = MBIDs', () => {
  const rows = mapRecordingSearch(recordings);
  assertEquals(rows.tracks.length, 1);
  const t = rows.tracks[0]!;
  assertEquals(t.id, 'rec-1');
  assertEquals(t.artist_credit, 'Aurora Vale & The Night Owls');
  assertEquals(t.album_id, 'rg-1');            // earliest eligible release's group
  assertEquals(t.release_year, 2015);
  assertEquals(t.popularity, 3);               // 2 releases + 1 from the remaster
  assertEquals(t.isrcs, ['USABC1500001']);
  assertEquals(rows.track_recordings.map((r) => r.recording_mbid), ['rec-1', 'rec-2']);
  assertEquals(rows.artists.map((a) => a.id), ['art-1', 'art-2']);
  assertEquals(rows.track_artists.map((a) => [a.position, a.artist_id, a.join_phrase]), [[0, 'art-1', ' & '], [1, 'art-2', '']]);
  assertEquals(rows.albums.map((a) => [a.id, a.primary_type]), [['rg-1', 'album']]);
});

Deno.test('recordingQuery builds a safe Lucene query', () => {
  assertEquals(recordingQuery('bohemian rhaps'), 'bohemian AND (rhaps OR rhaps*)');
  assertEquals(recordingQuery('a:b "c" OR'), 'a AND b AND c AND or');
  assertEquals(recordingQuery('!!!'), '');
});

Deno.test('iTunes: upscale and pick the right album', () => {
  assertEquals(upscaleArtwork('https://is1.mzstatic.com/x/source/100x100bb.jpg'), 'https://is1.mzstatic.com/x/source/1200x1200bb.jpg');
  const pick = pickAlbum([
    { collectionName: 'First Light - EP', artistName: 'Someone Else', artworkUrl100: 'u1' },
    { collectionName: 'First Light (Deluxe Edition)', artistName: 'Aurora Vale', artworkUrl100: 'u2', releaseDate: '2015-03-02' },
    { collectionName: 'Last Light', artistName: 'Aurora Vale', artworkUrl100: 'u3' },
  ], 'First Light', 'Aurora Vale', 2015);
  assertEquals(pick?.artworkUrl100, 'u2');
  assertEquals(pickAlbum([{ collectionName: 'Nope', artistName: 'Nobody', artworkUrl100: 'x' }], 'First Light', 'Aurora Vale'), null);
});
