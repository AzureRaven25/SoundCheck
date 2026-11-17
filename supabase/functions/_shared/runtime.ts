/** Edge Function runtime helpers: admin client, CORS/JSON responses, throttled + cached provider fetches. */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';

export type Provider = 'musicbrainz' | 'coverartarchive' | 'itunes' | 'lrclib';

/** Identifies SoundCheck to providers (MusicBrainz requires a descriptive User-Agent). Contact is configurable. */
export const USER_AGENT = `SoundCheck/0.2 ( ${Deno.env.get('PROVIDER_CONTACT') ?? 'soundcheck-app'} )`;

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

/** Secret key for server-side writes. Hosted functions get SUPABASE_SECRET_KEYS (new keys) or SUPABASE_SERVICE_ROLE_KEY (legacy). */
function serviceKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, string>;
      const first = parsed.default ?? Object.values(parsed)[0];
      if (first) return first;
    } catch { /* fall through */ }
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SOUNDCHECK_SECRET_KEY');
  if (!legacy) throw new Error('no service key in environment');
  return legacy;
}

let admin: SupabaseClient | null = null;
export function adminClient(): SupabaseClient {
  admin ??= createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

export async function handle(req: Request, fn: (body: Record<string, unknown>) => Promise<Response>): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  try {
    return await fn(body);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ProviderBusyError extends Error {}

/** Fetch from a provider, waiting for a globally reserved slot so rate limits hold across instances. */

/**
 * maxWaitMs: how long this caller may wait for a slot. User-initiated lookups (a preview someone just
 * clicked) can wait; background backfill (artwork for a grid) should give up fast and retry later.
 */
export async function providerFetch(
  provider: Provider, url: string, init: RequestInit = {}, timeoutMs = 8000, maxWaitMs = 5000,
): Promise<Response> {
  const { data: wait, error } = await adminClient().rpc('provider_reserve_slot', { p_provider: provider, p_max_wait_ms: maxWaitMs });
  if (error) throw error;
  if (wait === -1) throw new ProviderBusyError(`${provider} is busy, try again shortly`); // no slot reserved
  if (typeof wait === 'number' && wait > 0) await sleep(wait);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(init.headers ?? {}) } });
  } finally {
    clearTimeout(timer);
  }
}

export async function cacheGet(provider: Provider, key: string): Promise<{ status: string; value: unknown } | null> {
  const { data, error } = await adminClient().rpc('provider_cache_get', { p_provider: provider, p_key: key });
  if (error) throw error;
  return (data as { status: string; value: unknown }[] | null)?.[0] ?? null;
}

export async function cachePut(provider: Provider, key: string, status: 'hit' | 'miss' | 'error', value: unknown, ttlSeconds: number) {
  const { error } = await adminClient().rpc('provider_cache_put', {
    p_provider: provider, p_key: key, p_status: status, p_value: value ?? null, p_ttl_seconds: ttlSeconds,
  });
  if (error) throw error;
}

export const DAY = 86400;
