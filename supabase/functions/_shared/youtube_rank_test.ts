import { assert, assertEquals } from 'jsr:@std/assert@1';
import { isoSeconds, offsetGuessMs, rankVideos } from './youtube_rank.ts';

Deno.test('isoSeconds', () => {
  assertEquals(isoSeconds('PT3M25S'), 205);
  assertEquals(isoSeconds('PT1H2M'), 3720);
  assertEquals(isoSeconds('garbage'), null);
});

Deno.test('offset guess: Topic uploads are the studio track; longer videos have an intro', () => {
  assertEquals(offsetGuessMs('original', 240, 200, true), 0);
  assertEquals(offsetGuessMs('original', 201, 200, false), 0);
  assertEquals(offsetGuessMs('karaoke', 208, 200, false), 8000);
  assertEquals(offsetGuessMs('karaoke', 300, 200, false), 20000);
});

Deno.test('rankVideos: Topic audio first, karaoke versions split out, covers and wrong songs dropped', () => {
  const song = { title: 'Someone Like You', artist: 'Adele', durationS: 285 };
  const r = rankVideos([
    { id: 'a1aaaaaaaaa', title: 'Adele - Someone Like You (Official Music Video)', channel: 'AdeleVEVO', durationS: 290 },
    { id: 'b1bbbbbbbbb', title: 'Someone Like You', channel: 'Adele - Topic', durationS: 285 },
    { id: 'c1ccccccccc', title: 'Someone Like You (Live at the Royal Albert Hall)', channel: 'Adele', durationS: 300 },
    { id: 'd1ddddddddd', title: 'Adele - Someone Like You (Karaoke Version)', channel: 'Sing King', durationS: 292 },
    { id: 'e1eeeeeeeee', title: 'Someone Like You - Adele | Piano Karaoke Instrumental Lower Key', channel: 'Random', durationS: 280 },
    { id: 'f1fffffffff', title: 'Someone Like You cover by Jane', channel: 'Jane', durationS: 270 },
    { id: 'g1ggggggggg', title: 'Rolling in the Deep', channel: 'Adele - Topic', durationS: 228 },
  ], song);
  assertEquals(r.originals.map((v) => v.id), ['b1bbbbbbbbb', 'a1aaaaaaaaa']);
  assertEquals(r.originals[0]!.offsetGuessMs, 0);
  assertEquals(r.karaoke[0]!.id, 'd1ddddddddd');
  assertEquals(r.karaoke[0]!.offsetGuessMs, 7000);
  assert(r.karaoke.every((v) => v.kind === 'karaoke'));
});

Deno.test('rankVideos: the artist’s official instrumental beats lyric karaoke videos and is marked same-master', () => {
  const song = { title: 'Treat You Better', artist: 'Shawn Mendes', durationS: 187 };
  const r = rankVideos([
    { id: 'k1kkkkkkkkk', title: 'Treat You Better - Shawn Mendes Karaoke 【With Guide Melody】 Instrumental', channel: 'EdKara', durationS: 187 },
    { id: 'k2kkkkkkkkk', title: 'Shawn Mendes - Treat You Better (Karaoke Version)', channel: 'Sing King', durationS: 190 },
    { id: 'k3kkkkkkkkk', title: 'Treat You Better (Instrumental)', channel: 'Shawn Mendes - Topic', durationS: 187 },
    { id: 'k4kkkkkkkkk', title: 'Treat You Better - Backing Track (No Vocals)', channel: 'Backing Tracks', durationS: 189 },
  ], song);
  assertEquals(r.karaoke[0]!.id, 'k3kkkkkkkkk');
  assertEquals(r.karaoke[0]!.sameMaster, true);
  assertEquals(r.karaoke[0]!.offsetGuessMs, 0);
  assertEquals(r.karaoke.at(-1)!.id, 'k1kkkkkkkkk');   // guide melody + lyrics on screen: last
});

Deno.test('rankVideos: another act’s Topic instrumental or a re-recording is not the official instrumental', () => {
  const song = { title: 'Great Balls of Fire', artist: 'Jerry Lee Lewis', durationS: 112 };
  const r = rankVideos([
    { id: 'a1aaaaaaaaa', title: 'Great Balls Of Fire (Instrumental)', channel: 'The Rocking Saxists - Topic', durationS: 112 },
    { id: 'b1bbbbbbbbb', title: 'Great Balls of Fire (Instrumental - Re-Recorded)', channel: 'Jerry Lee Lewis - Topic', durationS: 112 },
    { id: 'c1ccccccccc', title: 'Great Balls of Fire (Official Instrumental)', channel: 'Some Uploader', durationS: 113 },
  ], song);
  const by = Object.fromEntries(r.karaoke.map((v) => [v.id, v]));
  assertEquals(by['a1aaaaaaaaa']!.sameMaster, false);
  assertEquals(by['b1bbbbbbbbb']!.sameMaster, false);
  assertEquals(by['c1ccccccccc']!.sameMaster, true);
  assertEquals(r.karaoke[0]!.id, 'c1ccccccccc');
});

Deno.test('rankVideos: a karaoke video of another artist’s version ranks below the right artist’s', () => {
  const r = rankVideos([
    { id: 'e1eeeeeeeee', title: 'Blue Suede Shoes by Elvis Presley - Karaoke', channel: 'Stingray Karaoke', durationS: 130 },
    { id: 'c1ccccccccc', title: 'Carl Perkins - Blue Suede Shoes (Karaoke)', channel: 'Some Karaoke', durationS: 135 },
  ], { title: 'Blue Suede Shoes', artist: 'Carl Perkins', durationS: 135 });
  assertEquals(r.karaoke[0]!.id, 'c1ccccccccc');
});
