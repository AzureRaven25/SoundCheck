/**
 * Artist picture.  POST { artist_id }  → { url: string | null, provider: 'wikimedia' | 'deezer' | null, credit }
 *
 * 1. Wikidata entity with this MusicBrainz artist id (P434) → its image (P18) on Wikimedia Commons. Freely
 *    licensed photos; we keep the Commons file page as the credit.
 * 2. Deezer artist search, only on an exact (normalised) name match.
 * Results (including "none found") are stored/cached so each artist is looked up once.
 */
import { adminClient, cacheGet, cachePut, handle, json, USER_AGENT } from '../_shared/runtime.ts';
import { norm } from '../_shared/norm.ts';

const H = { 'User-Agent': USER_AGENT, Accept: 'application/json' };

async function fromWikimedia(mbid: string) {
  const s = await fetch(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: 'query', list: 'search', srsearch: `haswbstatement:P434=${mbid}`, format: 'json' })}`, { headers: H });
  if (!s.ok) throw new Error(`wikidata ${s.status}`);
  const qid: string | undefined = (await s.json()).query?.search?.[0]?.title;
  if (!qid) return null;
  const e = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, { headers: H });
  if (!e.ok) throw new Error(`wikidata ${e.status}`);
  const file: string | undefined = (await e.json()).entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  if (!file) return null;
  const name = file.replace(/ /g, '_');
  return {
    url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=800`,
    credit: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name)}`,
  };
}

async function fromDeezer(name: string) {
  const r = await fetch(`https://api.deezer.com/search/artist?${new URLSearchParams({ q: name, limit: '5' })}`, { headers: H });
  if (!r.ok) throw new Error(`deezer ${r.status}`);
  const hit = ((await r.json()).data ?? []).find((a: { name: string; picture_xl?: string }) => norm(a.name) === norm(name) && a.picture_xl);
  // Deezer returns a generic silhouette for artists without a photo; skip it
  if (!hit || /\/images\/artist\/\/|d41d8cd98f00b204e9800998ecf8427e/.test(hit.picture_xl)) return null;
  return { url: hit.picture_xl as string, credit: `https://www.deezer.com/artist/${hit.id}` };
}

Deno.serve((req) => handle(req, async (body) => {
  const artistId = String(body.artist_id ?? '');
  if (!/^[0-9a-f-]{36}$/.test(artistId)) return json({ error: 'artist_id required' }, 400);
  const db = adminClient();
  const { data: have } = await db.from('artwork').select('source_url, provider, credit').eq('entity_type', 'artist').eq('entity_id', artistId)
    .eq('is_primary', true).maybeSingle();
  if (have) return json({ url: have.source_url, provider: have.provider, credit: have.credit });
  const cached = await cacheGet('wikimedia', artistId);
  if (cached?.status === 'miss') return json({ url: null, provider: null, credit: null });

  const { data: a } = await db.from('artists').select('name, mbid').eq('id', artistId).maybeSingle();
  if (!a) return json({ error: 'artist not found' }, 404);
  let found: { url: string; credit: string } | null = null, provider: 'wikimedia' | 'deezer' | null = null;
  try {
    if (a.mbid) { found = await fromWikimedia(a.mbid); if (found) provider = 'wikimedia'; }
    if (!found) { found = await fromDeezer(a.name); if (found) provider = 'deezer'; }
  } catch (e) {
    console.error(e);
    return json({ url: null, provider: null, credit: null, retry: true });     // transient: don't cache
  }
  if (!found) {
    await cachePut('wikimedia', artistId, 'miss', null, 30 * 86400);
    return json({ url: null, provider: null, credit: null });
  }
  await db.from('artwork').upsert({ entity_type: 'artist', entity_id: artistId, provider, source_url: found.url, credit: found.credit, is_primary: true },
    { onConflict: 'entity_type,entity_id,provider,source_url' });
  return json({ url: found.url, provider, credit: found.credit });
}));
