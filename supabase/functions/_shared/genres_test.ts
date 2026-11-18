import { assertEquals } from 'jsr:@std/assert@1';
import { toGenres } from './genres.ts';

Deno.test('maps source tags to canonical genres', () => {
  assertEquals(toGenres('Hip-Hop/Rap'), ['hip-hop']);
  assertEquals(toGenres('R&B/Soul'), ['r-and-b', 'soul']);
  assertEquals(toGenres(['Lo-Fi', 'chill']), ['lofi', 'ambient']);
  assertEquals(toGenres('Drum & Bass'), ['electronic']);
  assertEquals(toGenres('Alternative'), ['indie']);
  assertEquals(toGenres('Singer Songwriter; acoustic'), ['folk', 'acoustic']);
  assertEquals(toGenres(null, undefined, ''), []);
  assertEquals(toGenres('Folk dance, Sweden'), ['folk', 'world']);
});
