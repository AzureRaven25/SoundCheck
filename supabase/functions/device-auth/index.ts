/**
 * Sign in on a TV with your phone (OAuth-style device flow).
 *
 *   POST { action: 'start', platform }            → { device_code, user_code, verification_url, expires_in, interval }
 *   POST { action: 'approve', user_code }  (JWT)  → { ok: true, platform }   the signed-in phone approves the code
 *   POST { action: 'poll', device_code }          → { status: 'pending' | 'expired' } | { status: 'approved', email, token_hash }
 *
 * The TV never sees a password: once approved, it gets a one-time magic-link token hash for the approving
 * account and exchanges it with auth.verifyOtp. Codes expire after 10 minutes and are deleted when used.
 * The device code is stored only as a SHA-256 hash.
 */
import { adminClient } from '../_shared/runtime.ts';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PLATFORMS = new Set(['tvos', 'firetv', 'web', 'ios', 'android']);

const sha256 = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, '0')).join('');
const randomCode = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => ALPHABET[b % ALPHABET.length]).join('');
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'invalid JSON' }, 400); }
  const db = adminClient();

  if (body.action === 'start') {
    const platform = String(body.platform ?? '');
    if (!PLATFORMS.has(platform)) return json({ error: 'unknown platform' }, 400);
    await db.from('device_codes').delete().lt('expires_at', new Date().toISOString());   // housekeeping
    const device = base64url(crypto.getRandomValues(new Uint8Array(32)));
    for (let attempt = 0; attempt < 5; attempt++) {
      const user = randomCode(6);
      const { error } = await db.from('device_codes').insert({ device_code: await sha256(device), user_code: user, platform });
      if (!error) {
        const site = Deno.env.get('SITE_URL') ?? 'https://soundcheck-gules.vercel.app';
        return json({ device_code: device, user_code: user, verification_url: `${site}/activate`, expires_in: 600, interval: 3 });
      }
      if (!error.message.includes('duplicate')) return json({ error: 'could not start sign-in' }, 500);
    }
    return json({ error: 'could not start sign-in' }, 503);
  }

  if (body.action === 'approve') {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await db.auth.getUser(token);
    if (!user || user.is_anonymous || !user.email) return json({ error: 'sign in with your SoundCheck account to approve' }, 401);
    const code = String(body.user_code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const { data: row } = await db.from('device_codes').select('device_code, platform, approved_by, expires_at').eq('user_code', code).maybeSingle();
    if (!row || new Date(row.expires_at) < new Date()) return json({ error: 'That code has expired or doesn’t exist. Check the TV.' }, 404);
    if (row.approved_by) return json({ error: 'That code was already used.' }, 409);
    await db.from('device_codes').update({ approved_by: user.id, approved_at: new Date().toISOString() }).eq('device_code', row.device_code);
    return json({ ok: true, platform: row.platform });
  }

  if (body.action === 'poll') {
    const hash = await sha256(String(body.device_code ?? ''));
    const { data: row } = await db.from('device_codes').select('approved_by, expires_at').eq('device_code', hash).maybeSingle();
    if (!row || new Date(row.expires_at) < new Date()) return json({ status: 'expired' });
    if (!row.approved_by) return json({ status: 'pending' });
    await db.from('device_codes').delete().eq('device_code', hash);       // one use only
    const { data: { user } } = await db.auth.admin.getUserById(row.approved_by);
    if (!user?.email) return json({ status: 'expired' });
    const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email: user.email });
    if (error || !data?.properties?.hashed_token) return json({ error: 'could not finish sign-in' }, 500);
    return json({ status: 'approved', email: user.email, token_hash: data.properties.hashed_token });
  }

  return json({ error: 'unknown action' }, 400);
});
