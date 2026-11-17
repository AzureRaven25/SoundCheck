import { assertEquals } from 'jsr:@std/assert@1';
import { itunesToRows } from './itunes_catalog.ts';

Deno.test('maps iTunes songs to catalog rows, skipping karaoke versions and duplicates', async () => {
  const song = { kind: 'song', trackId: 1, trackName: 'Golden Hour', artistName: 'JVKE', collectionId: 9, collectionName: 'this is what ____ feels like', trackTimeMillis: 209000, releaseDate: '2022-07-15T07:00:00Z', artworkUrl100: 'https://is1-ssl.mzstatic.com/x/100x100bb.jpg', trackViewUrl: 'https://music.apple.com/x' };
  const r = await itunesToRows([song, { ...song, trackId: 2 }, { ...song, trackId: 3, trackName: 'Golden Hour (Karaoke Version)' }, { ...song, kind: 'music-video', trackId: 4 }]);
  assertEquals(r.tracks.length, 1);
  assertEquals(r.tracks[0]!.duration_ms, 209000);
  assertEquals(r.tracks[0]!.release_year, 2022);
  assertEquals(r.albums.length, 1);
  assertEquals(r.artwork[0]!.source_url.includes('1200x1200'), true);
  assertEquals(r.sources[0]!.karaoke_ok, false);
});
