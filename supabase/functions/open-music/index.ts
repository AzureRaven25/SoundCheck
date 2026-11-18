/**
 * Open music: full-length Creative Commons / public-domain recordings from the Internet Archive.
 *
 *   POST { action: 'search', q, limit? }        → { albums: [{ identifier, title, creator, year, license_url, karaoke_ok, cover }] }
 *   POST { action: 'album', identifier }         → { album, tracks }  (imports the album into the catalog, idempotent)
 *   POST { action: 'prepare', track_id }  (JWT)  → { job_id, status, analysis_id }  (karaoke stems, license permitting)
 *
 * Only items with a license URL are offered. Karaoke processing is refused for "no derivatives" licenses.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { adminClient, cors, json, USER_AGENT } from '../_shared/runtime.ts';
import { licenseAllowsKaraoke, pickCover, pickTracks, stableUuid, type IaFile } from '../_shared/openmusic.ts';
import { toGenres } from '../_shared/genres.ts';

const IA = 'https://archive.org';
const ID_RE = /^[A-Za-z0-9._-]{1,100}$/;
const cover = (id: string) => `${IA}/services/img/${encodeURIComponent(id)}`;

async function iaJson(url: string) {
  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`internet archive ${r.status}`);
  return r.json();
}

async function search(q: string, limit: number) {
  const words = q.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 8);
  if (!words.length) return [];
  const terms = words.map((w) => `"${w}"`).join(' AND ');
  // netlabel releases, Jamendo's catalog as mirrored on the archive (235k albums), the Free Music Archive mirror
  // (8.8k) and community uploads tagged as music, always with an explicit open license (counted 2026-11-17)
  const collections = '(collection:netlabels OR collection:jamendo-albums OR collection:freemusicarchive OR (collection:opensource_audio AND subject:music) OR collection:audio_music)';
  const query = `(title:(${terms}) OR creator:(${terms})) AND mediatype:audio AND licenseurl:* AND ${collections}`;
  const params = new URLSearchParams({ q: query, rows: String(limit), output: 'json', 'sort[]': 'downloads desc' });
  for (const f of ['identifier', 'title', 'creator', 'year', 'licenseurl', 'downloads']) params.append('fl[]', f);
  const d = await iaJson(`${IA}/advancedsearch.php?${params}`);
  return (d.response?.docs ?? []).map((x: Record<string, unknown>) => {
    const creator = Array.isArray(x.creator) ? String(x.creator[0]) : String(x.creator ?? 'Unknown artist');
    return {
      identifier: x.identifier, title: String(x.title ?? x.identifier), creator,
      year: Number.parseInt(String(x.year ?? ''), 10) || null, license_url: x.licenseurl ?? null,
      karaoke_ok: licenseAllowsKaraoke(x.licenseurl as string), cover: cover(String(x.identifier)),
    };
  });
}

async function album(identifier: string) {
  const d = await iaJson(`${IA}/metadata/${encodeURIComponent(identifier)}`);
  const m = d.metadata ?? {};
  const license: string | null = m.licenseurl ?? null;
  if (!license) throw new Error('this item has no open license');
  const creator = Array.isArray(m.creator) ? String(m.creator[0]) : String(m.creator ?? 'Unknown artist');
  const title = String(m.title ?? identifier);
  const year = Number.parseInt(String(m.year ?? m.date ?? '').slice(0, 4), 10);
  const files = pickTracks(identifier, (d.files ?? []) as IaFile[], creator).filter((t) => t.durationMs && t.durationMs > 1000);
  if (!files.length) throw new Error('no playable audio in this item');
  const karaokeOk = licenseAllowsKaraoke(license);
  const page = `${IA}/details/${identifier}`;
  const genres = toGenres(m.subject, m.genre, title);

  const db = adminClient();
  const albumId = await stableUuid(identifier);
  const coverUrl = pickCover(identifier, (d.files ?? []) as IaFile[]);
  // insert-only (ignoreDuplicates): re-importing must never overwrite what we've since measured or corrected,
  // e.g. the decoded duration the worker writes back
  const { error: ae } = await db.from('albums').upsert({
    id: albumId, title: title.slice(0, 500), artist_credit: creator,
    primary_type: files.length <= 3 ? 'single' : 'album', release_year: year >= 1800 && year <= 2200 ? year : null,
  }, { ignoreDuplicates: true });
  if (ae) throw ae;
  await db.from('artwork').delete().eq('entity_type', 'album').eq('entity_id', albumId).eq('provider', 'internet_archive').neq('source_url', coverUrl);
  await db.from('artwork').upsert({ entity_type: 'album', entity_id: albumId, provider: 'internet_archive', source_url: coverUrl, is_primary: true },
    { onConflict: 'entity_type,entity_id,provider,source_url', ignoreDuplicates: true });

  const tracks = [];
  for (const f of files) {
    const id = await stableUuid(`${identifier}/${f.file}`);
    tracks.push({ id, ...f });
  }
  const { error: te } = await db.from('tracks').upsert(tracks.map((t) => ({
    id: t.id, title: t.title.slice(0, 500), artist_credit: creator, album_id: albumId, duration_ms: t.durationMs,
    release_year: year >= 1800 && year <= 2200 ? year : null, genres,
  })), { ignoreDuplicates: true });
  if (te) throw te;
  const { error: se } = await db.from('track_sources').upsert(tracks.map((t) => ({
    track_id: t.id, provider: 'internet_archive', external_id: `${identifier}/${t.file}`, url: page, stream_url: t.streamUrl,
    duration_ms: t.durationMs, license_url: license, attribution: `${creator} — ${title} (Internet Archive)`, karaoke_ok: karaokeOk,
  })), { onConflict: 'provider,external_id', ignoreDuplicates: true });
  if (se) throw se;

  return {
    album: { id: albumId, identifier, title, creator, year: year || null, license_url: license, karaoke_ok: karaokeOk, cover: coverUrl, page },
    tracks: tracks.map((t) => ({ id: t.id, title: t.title, track_no: t.trackNo, duration_ms: t.durationMs, stream_url: t.streamUrl })),
  };
}

async function prepare(req: Request, trackId: string) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const db = adminClient();
  const { data: { user } } = token ? await db.auth.getUser(token) : { data: { user: null } };
  if (!user) return json({ error: 'sign in required' }, 401);
  const { data: src } = await db.from('track_sources').select('stream_url, license_url, karaoke_ok, duration_ms')
    .eq('track_id', trackId).eq('provider', 'internet_archive').maybeSingle();
  if (!src?.stream_url) return json({ error: 'not an open-licensed track' }, 404);
  if (!src.karaoke_ok) return json({ error: 'this recording’s license doesn’t allow derivatives, so it can’t be made into karaoke' }, 403);

  let { data: asset } = await db.from('audio_assets').select('id').eq('track_id', trackId).eq('kind', 'original')
    .eq('provider', 'internet_archive').maybeSingle();
  if (!asset) {
    const ins = await db.from('audio_assets').insert({
      track_id: trackId, owner_id: null, kind: 'original', provider: 'internet_archive', external_url: src.stream_url,
      license_url: src.license_url, duration_ms: src.duration_ms, mime_type: 'audio/mpeg',
    }).select('id').single();
    if (ins.error) throw ins.error;
    asset = ins.data;
  }
  // queue as the requesting user (request_processing is per-user and idempotent)
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  });
  const { data, error } = await asUser.rpc('request_processing', { p_asset_id: asset!.id });
  if (error) throw error;
  return json(data?.[0] ?? {});
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
  try {
    if (body.action === 'search') {
      const q = String(body.q ?? '').trim().slice(0, 100);
      if (q.length < 2) return json({ albums: [] });
      return json({ albums: await search(q, Math.min(24, Math.max(1, Number(body.limit) || 12))) });
    }
    if (body.action === 'album') {
      const id = String(body.identifier ?? '');
      if (!ID_RE.test(id)) return json({ error: 'invalid identifier' }, 400);
      return json(await album(id));
    }
    if (body.action === 'prepare') return await prepare(req, String(body.track_id ?? ''));
    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
