import { assertEquals } from 'jsr:@std/assert@1';
import { blockedHost, directLink, isPublicAddress } from './links.ts';

Deno.test('streaming services are refused by name', () => {
  assertEquals(blockedHost('www.youtube.com'), 'YouTube');
  assertEquals(blockedHost('youtu.be'), 'YouTube');
  assertEquals(blockedHost('music.youtube.com'), 'YouTube');
  assertEquals(blockedHost('rr3---sn-abc.googlevideo.com'), 'YouTube');
  assertEquals(blockedHost('open.spotify.com'), 'Spotify');
  assertEquals(blockedHost('soundcloud.com'), 'SoundCloud');
  assertEquals(blockedHost('music.apple.com'), 'Apple Music');
  assertEquals(blockedHost('music.amazon.co.uk'), 'Amazon Music');
  assertEquals(blockedHost('www.dropbox.com'), null);
  assertEquals(blockedHost('archive.org'), null);
  assertEquals(blockedHost('notyoutube.com'), null);
});

Deno.test('share links become direct downloads', () => {
  assertEquals(directLink('https://www.dropbox.com/scl/fi/abc/song.mp3?rlkey=x&dl=0'), 'https://www.dropbox.com/scl/fi/abc/song.mp3?rlkey=x&dl=1');
  assertEquals(directLink('https://drive.google.com/file/d/1AbC-d_E/view?usp=sharing'), 'https://drive.usercontent.google.com/download?id=1AbC-d_E&export=download&confirm=t');
  assertEquals(directLink('https://example.com/a.mp3'), 'https://example.com/a.mp3');
});

Deno.test('only public addresses', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '224.0.0.1']) {
    assertEquals(isPublicAddress(ip), false, ip);
  }
  for (const ip of ['8.8.8.8', '151.101.1.69', '2606:4700::6810:84e5', '172.32.0.1']) assertEquals(isPublicAddress(ip), true, ip);
});
