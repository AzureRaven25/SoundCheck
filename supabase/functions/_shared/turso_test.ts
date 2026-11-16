import { assertEquals } from 'jsr:@std/assert@1';
import { matchQuery, searchTurso, songsToRows } from './turso.ts';

Deno.test('matchQuery quotes words and prefixes the last', () => {
  assertEquals(matchQuery('Stand by Me'), '"stand" "by" "me"*');
  assertEquals(matchQuery('a" OR title:x'), '"a" "or" "title" "x"');
  assertEquals(matchQuery('Beyoncé halo'), '"beyoncé" "halo"*');
  assertEquals(matchQuery('???'), '');
});

Deno.test('searchTurso parses a Hrana pipeline response', async () => {
  Deno.env.set('TURSO_DATABASE_URL', 'libsql://example.turso.io');
  Deno.env.set('TURSO_AUTH_TOKEN', 'test-token');
  let seen: { url: string; body: unknown } | null = null;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen = { url, body: JSON.parse(String(init.body)) };
    const t = (v: string) => ({ type: 'text', value: v });
    const i = (v: number) => ({ type: 'integer', value: String(v) });
    return new Response(JSON.stringify({ results: [{ type: 'ok', response: { type: 'execute', result: { rows: [[
      i(123456), t('rec-1'), t('Deep Cut'), t('Band A & Singer B'), t('rg-1'), t('Rare LP'), t('album'), i(1999), i(201000), i(4),
      t(JSON.stringify([{ position: 0, artist_id: 'a1', name: 'Band A', sort_name: 'Band A', join_phrase: ' & ' },
                        { position: 1, artist_id: 'a2', name: 'Singer B', sort_name: null, join_phrase: '' }])),
      t('["USX9P0000001"]'), t('["rec-9","rec-1","rec-2","rec-3","rec-4","rec-5","rec-6"]'),
    ]] } } }, { type: 'ok' }] }));
  }) as unknown as typeof fetch;
  const songs = await searchTurso('deep cut', 10, fakeFetch);
  assertEquals(seen!.url, 'https://example.turso.io/v2/pipeline');
  assertEquals(songs[0]!.credits.length, 2);
  const rows = songsToRows(songs);
  assertEquals(rows.tracks[0]!.id, 'rec-1');
  assertEquals(rows.albums[0]!.primary_type, 'album');
  assertEquals(rows.track_artists.map((a) => a.artist_id), ['a1', 'a2']);
  assertEquals(rows.track_recordings.map((r) => r.recording_mbid), ['rec-1', 'rec-9', 'rec-2', 'rec-3', 'rec-4']); // rep first, capped at 5
});
