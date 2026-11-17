import { assertEquals } from 'jsr:@std/assert@1';
import { cleanTitle, licenseAllowsKaraoke, parseLength, pickCover, pickTracks, stableUuid } from './openmusic.ts';

Deno.test('parses Internet Archive lengths', () => {
  assertEquals(parseLength('509.22'), 509220);
  assertEquals(parseLength('3:05'), 185000);
  assertEquals(parseLength('1:02:03'), 3723000);
  assertEquals(parseLength(undefined), null);
});

Deno.test('cleans track titles', () => {
  assertEquals(cleanTitle('01 Riding Alone For Thousands Of Miles - lullaby', 'Riding Alone For Thousands Of Miles'), 'Lullaby');
  assertEquals(cleanTitle('03_my_song.mp3', 'X'), 'My song');
});

Deno.test('picks one file per song in the best format, in order', () => {
  const t = pickTracks('item', [
    { name: '02b.ogg', format: 'Ogg Vorbis', length: '100', track: '2/2' },
    { name: '02b.mp3', format: 'VBR MP3', length: '99', title: 'B', track: '2/2' },
    { name: '01a.mp3', format: 'VBR MP3', length: '120', title: 'A', track: '1/2' },
    { name: 'cover.jpg', format: 'JPEG' },
  ], 'Artist');
  assertEquals(t.map((x) => x.file), ['01a.mp3', '02b.mp3']);
  assertEquals(t[0]!.durationMs, 120000);
  assertEquals(t[0]!.streamUrl, 'https://archive.org/download/item/01a.mp3');
});

Deno.test('stable ids and license rules', async () => {
  assertEquals(await stableUuid('x/y'), await stableUuid('x/y'));
  assertEquals((await stableUuid('x/y')).length, 36);
  assertEquals(licenseAllowsKaraoke('http://creativecommons.org/licenses/by-nc-nd/3.0/'), false);
  assertEquals(licenseAllowsKaraoke('http://creativecommons.org/licenses/by-sa/4.0/'), true);
});

Deno.test('picks a real cover image', () => {
  assertEquals(pickCover('x', [{ name: 'back.jpg', format: 'JPEG' }, { name: 'Front Cover.jpg', format: 'JPEG' }]), 'https://archive.org/download/x/Front%20Cover.jpg');
  assertEquals(pickCover('x', [{ name: 'a_thumb.jpg', format: 'JPEG Thumb' }, { name: 'art.png', format: 'PNG' }]), 'https://archive.org/download/x/art.png');
  assertEquals(pickCover('x', [{ name: 'song.mp3', format: 'VBR MP3' }]), 'https://archive.org/services/img/x');
});
