import { assertEquals } from 'jsr:@std/assert@1';
import { cleanTitle, primaryArtist } from './lrc.ts';

Deno.test('cleanTitle strips versions and credits', () => {
  assertEquals(cleanTitle('Hey Jude - Remastered 2015'), 'Hey Jude');
  assertEquals(cleanTitle('Wonderwall (Remastered)'), 'Wonderwall');
  assertEquals(cleanTitle('Umbrella (feat. JAY-Z)'), 'Umbrella');
  assertEquals(cleanTitle('Bohemian Rhapsody - Live Aid'), 'Bohemian Rhapsody');
  assertEquals(cleanTitle('Love Story (Taylor’s Version)'), 'Love Story');
  assertEquals(cleanTitle('(I Can’t Get No) Satisfaction'), '(I Can’t Get No) Satisfaction');
  assertEquals(cleanTitle('Stand by Me'), 'Stand by Me');
});

Deno.test('primaryArtist keeps the main act', () => {
  assertEquals(primaryArtist('Calvin Harris feat. Rihanna'), 'Calvin Harris');
  assertEquals(primaryArtist('Simon & Garfunkel'), 'Simon & Garfunkel');
  assertEquals(primaryArtist('Lil Nas X, Billy Ray Cyrus'), 'Lil Nas X');
  assertEquals(primaryArtist('Silk Sonic'), 'Silk Sonic');
});
