/**
 * Acquisition: search every registered source, import a result into the catalog, and prepare karaoke from it.
 *
 *   POST { action: 'sources' }                                → { sources: [{ id, label, configured, missing }] }
 *   POST { action: 'search', q, providers?, limit? }          → { results: Candidate & { track_id? }[], sources: status[] }
 *   POST { action: 'import', provider, external_id }          → { track_id, created, candidate }
 *   POST { action: 'import_many', items: [{provider, external_id}] } (≤ 50) → { imported: [...], failed: [...] }
 *   POST { action: 'prepare', track_id }  (JWT)               → { job_id, status, analysis_id }
 *
 * Imports are idempotent (provider + external_id) and de-duplicated against the catalog (same normalized title and
 * artist, duration within 4 s): a second source for a song we already have is attached to the existing row.
 * Every import/prepare outcome is written to acquisition_log.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { adminClient, cacheGet, cachePut, cors, DAY, json } from '../_shared/runtime.ts';
import { stableUuid } from '../_shared/openmusic.ts';
import { ADAPTERS, type AcqProvider, type Candidate } from '../_shared/acquisition.ts';

/** providers whose track_sources.stream_url is a complete recording the worker may fetch for karaoke */
const KARAOKE_SOURCES = ['internet_archive', 'audius', 'jamendo', 'openverse'];

async function userFrom(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return { token, user: null };
  const { data } = await adminClient().auth.getUser(token);
  return { token, user: data.user };
}

async function log(entry: { user_id: string | null; provider: string; action: string; external_id?: string | null; track_id?: string | null; ok: boolean; error?: string | null }) {
  await adminClient().from('acquisition_log').insert(entry).then(() => {}, () => {});
}

function isProvider(p: unknown): p is AcqProvider {
  return typeof p === 'string' && p in ADAPTERS;
}

const PROVIDER_TIMEOUT_MS = 8000;
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timed out')), ms))]);
}

async function search(q: string, providers: AcqProvider[], limit: number) {
  const db = adminClient();
  const statuses: { id: string; label: string; ok: boolean; count: number; missing: string[]; error?: string }[] = [];
  const results: (Candidate & { track_id?: string | null })[] = [];
  await Promise.all(providers.map(async (id) => {
    const a = ADAPTERS[id];
    const missing = a.missing();
    if (missing.length) return statuses.push({ id, label: a.label, ok: false, count: 0, missing, error: 'not configured' });
    // whole result lists are cached per query for 6 h (Openverse alone takes 4–8 s)
    const ck = `search:${id}:${limit}:${q.toLowerCase()}`;
    try {
      const hit = await cacheGet('acquire', ck).catch(() => null);
      const found = hit?.status === 'hit' ? hit.value as Candidate[] : await withTimeout(a.search(q, limit), PROVIDER_TIMEOUT_MS);
      if (hit?.status !== 'hit') {
        await Promise.all([
          cachePut('acquire', ck, 'hit', found, 6 * 3600).catch(() => {}),
          // each result individually too, so importing one never asks the provider again
          db.rpc('provider_cache_put_many', {
            p_provider: 'acquire', p_ttl_seconds: DAY,
            p_items: found.map((c) => ({ key: `${c.provider}:${c.external_id}`, value: c })),
          }).then(() => {}, () => {}),
        ]);
      }
      results.push(...found);
      statuses.push({ id, label: a.label, ok: true, count: found.length, missing: [] });
    } catch (e) {
      statuses.push({ id, label: a.label, ok: false, count: 0, missing: [], error: e instanceof Error ? e.message : String(e) });
    }
  }));
  // already imported? (so the client can play without importing again)
  for (const id of providers) {
    const ext = results.filter((r) => r.provider === id).map((r) => r.external_id);
    if (!ext.length) continue;
    const { data } = await db.from('track_sources').select('external_id, track_id').eq('provider', id).in('external_id', ext);
    const map = new Map((data ?? []).map((r) => [r.external_id, r.track_id]));
    for (const r of results) if (r.provider === id) r.track_id = map.get(r.external_id) ?? null;
  }
  // full-length first, then karaoke-ready, then provider order
  const order = (c: Candidate) => (c.availability === 'full' ? 0 : c.availability === 'preview' ? 1 : 2) * 2 + (c.karaoke_ok ? 0 : 1);
  results.sort((a, b) => order(a) - order(b));
  return { results, sources: statuses.sort((a, b) => providers.indexOf(a.id as AcqProvider) - providers.indexOf(b.id as AcqProvider)) };
}

async function importOne(provider: AcqProvider, externalId: string, userId: string | null) {
  const db = adminClient();
  const { data: existing } = await db.from('track_sources').select('track_id').eq('provider', provider).eq('external_id', externalId).maybeSingle();
  if (existing) return { track_id: existing.track_id as string, created: false, candidate: null };

  const hit = await cacheGet('acquire', `${provider}:${externalId}`).catch(() => null);
  const c = (hit?.status === 'hit' ? hit.value as Candidate : null) ?? await ADAPTERS[provider].get(externalId);
  if (!c) throw new Error('not found at the source, or not playable there');

  // same recording already in the catalog? attach this source to it
  const { data: match } = await db.rpc('acquire_match_track', { p_title: c.title, p_artist: c.artist, p_duration_ms: c.duration_ms });
  let trackId = match as string | null;
  let created = false;
  if (!trackId) {
    trackId = await stableUuid(`${provider}:${externalId}`);
    const albumId = await stableUuid(`${provider}:album:${c.album ?? externalId}:${c.artist}`);
    const { error: ae } = await db.from('albums').upsert({
      id: albumId, title: (c.album ?? c.title).slice(0, 500), artist_credit: c.artist.slice(0, 500),
      primary_type: c.album ? 'album' : 'single', release_year: c.year,
    }, { ignoreDuplicates: true });
    if (ae) throw ae;
    if (c.artwork) {
      await db.from('artwork').upsert({ entity_type: 'album', entity_id: albumId, provider, source_url: c.artwork, is_primary: true },
        { onConflict: 'entity_type,entity_id,provider,source_url', ignoreDuplicates: true });
    }
    const { error: te } = await db.from('tracks').upsert({
      id: trackId, title: c.title.slice(0, 500), artist_credit: c.artist.slice(0, 500), album_id: albumId,
      duration_ms: c.duration_ms, release_year: c.year, isrcs: c.isrc ? [c.isrc] : [], created_by: userId,
    }, { ignoreDuplicates: true });
    if (te) throw te;
    created = true;
  }
  const { error: se } = await db.from('track_sources').upsert({
    track_id: trackId, provider, external_id: externalId, url: c.page_url, stream_url: c.stream_url, duration_ms: c.duration_ms,
    license_url: c.license_url, attribution: c.attribution, karaoke_ok: c.karaoke_ok, format: c.format,
    bitrate_kbps: c.bitrate_kbps, imported_by: userId,
  }, { onConflict: 'provider,external_id', ignoreDuplicates: true });
  if (se) throw se;
  return { track_id: trackId, created, candidate: c };
}

async function prepare(req: Request, trackId: string) {
  const { token, user } = await userFrom(req);
  if (!user) return json({ error: 'sign in required' }, 401);
  const db = adminClient();
  const { data: sources } = await db.from('track_sources').select('provider, stream_url, license_url, karaoke_ok, duration_ms, format')
    .eq('track_id', trackId).in('provider', KARAOKE_SOURCES).not('stream_url', 'is', null);
  const src = (sources ?? []).find((s) => s.karaoke_ok);
  if (!src) {
    await log({ user_id: user.id, provider: sources?.[0]?.provider ?? 'none', action: 'prepare', track_id: trackId, ok: false, error: 'no karaoke-eligible source' });
    return json({ error: sources?.length
      ? 'this recording’s license doesn’t allow derivatives, so it can’t be made into karaoke'
      : 'no open-licensed recording of this song' }, sources?.length ? 403 : 404);
  }
  let { data: asset } = await db.from('audio_assets').select('id').eq('track_id', trackId).eq('kind', 'original')
    .eq('provider', src.provider).is('owner_id', null).maybeSingle();
  if (!asset) {
    const ins = await db.from('audio_assets').insert({
      track_id: trackId, owner_id: null, kind: 'original', provider: src.provider, external_url: src.stream_url,
      license_url: src.license_url, duration_ms: src.duration_ms,
      mime_type: src.format === 'flac' ? 'audio/flac' : src.format === 'ogg' ? 'audio/ogg' : 'audio/mpeg',
    }).select('id').single();
    if (ins.error) throw ins.error;
    asset = ins.data;
  }
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  });
  const { data, error } = await asUser.rpc('request_processing', { p_asset_id: asset!.id });
  await log({ user_id: user.id, provider: src.provider, action: 'prepare', track_id: trackId, ok: !error, error: error?.message ?? null });
  if (error) throw error;
  return json(data?.[0] ?? {});
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
  try {
    switch (body.action) {
      case 'sources':
        return json({ sources: Object.values(ADAPTERS).map((a) => ({ id: a.id, label: a.label, configured: !a.missing().length, missing: a.missing() })) });
      case 'search': {
        const q = String(body.q ?? '').trim().slice(0, 100);
        if (q.length < 2) return json({ results: [], sources: [] });
        const wanted = Array.isArray(body.providers) ? body.providers.filter(isProvider) : (Object.keys(ADAPTERS) as AcqProvider[]);
        return json(await search(q, wanted, Math.min(25, Math.max(1, Number(body.limit) || 10))));
      }
      case 'import': {
        if (!isProvider(body.provider)) return json({ error: 'unknown provider' }, 400);
        const ext = String(body.external_id ?? '').slice(0, 200);
        const { user } = await userFrom(req);
        try {
          const r = await importOne(body.provider, ext, user?.id ?? null);
          await log({ user_id: user?.id ?? null, provider: body.provider, action: 'import', external_id: ext, track_id: r.track_id, ok: true });
          return json(r);
        } catch (e) {
          await log({ user_id: user?.id ?? null, provider: body.provider, action: 'import', external_id: ext, ok: false, error: String(e) });
          throw e;
        }
      }
      case 'import_many': {
        const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
        const { user } = await userFrom(req);
        const imported: unknown[] = [], failed: unknown[] = [];
        for (const it of items as { provider?: unknown; external_id?: unknown }[]) {
          if (!isProvider(it.provider)) { failed.push({ ...it, error: 'unknown provider' }); continue; }
          const ext = String(it.external_id ?? '').slice(0, 200);
          try {
            const r = await importOne(it.provider, ext, user?.id ?? null);
            imported.push({ provider: it.provider, external_id: ext, track_id: r.track_id, created: r.created });
            await log({ user_id: user?.id ?? null, provider: it.provider, action: 'import', external_id: ext, track_id: r.track_id, ok: true });
          } catch (e) {
            failed.push({ provider: it.provider, external_id: ext, error: e instanceof Error ? e.message : String(e) });
            await log({ user_id: user?.id ?? null, provider: it.provider, action: 'import', external_id: ext, ok: false, error: String(e) });
          }
        }
        return json({ imported, failed });
      }
      case 'prepare':
        return await prepare(req, String(body.track_id ?? ''));
      default:
        return json({ error: 'unknown action' }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
