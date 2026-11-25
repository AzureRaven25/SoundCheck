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
