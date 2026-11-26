/**
 * Fetch an audio file from a link the singer gave (for /make-karaoke, which splits the vocal on their device):
 *
 *   POST { url } (signed in) → the file's bytes, or { error } with a message to show.
 *
 * Only direct links to audio files: an .mp3/.m4a/.wav/… URL, or a Dropbox / Google Drive / OneDrive share of one.
 * Streaming services' pages (YouTube, Spotify, SoundCloud, Apple Music…) are refused: their audio is only theirs
 * to play, and copying it out of their players isn't allowed. Nothing is stored here; the bytes pass through.
 *
 * Safety: http(s) on standard ports only; every hop (redirects included) must resolve to a public address (no
 * localhost, private, link-local or metadata addresses); at most 80 MB and 90 s.
 */
import { adminClient, cors, json } from '../_shared/runtime.ts';
import { blockedHost, directLink, isPublicAddress } from './links.ts';

const MAX_BYTES = 80 * 1024 * 1024;
const AUDIO_EXT = /\.(mp3|m4a|aac|mp4|wav|wave|flac|ogg|oga|opus|webm|aif|aiff|alac)$/i;

async function safeTarget(u: URL): Promise<string | null> {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Only http and https links work.';
  if (u.port && u.port !== '80' && u.port !== '443') return 'That link uses an unusual port.';
  if (u.username || u.password) return 'Links with a password in them aren’t supported.';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^[\d.]+$/.test(host) || host.includes(':')) return isPublicAddress(host) ? null : 'That address isn’t reachable from the internet.';
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return 'That address isn’t reachable from the internet.';
  const addrs: string[] = [];
  for (const type of ['A', 'AAAA'] as const) {
    try { addrs.push(...(await Deno.resolveDns(host, type))); } catch { /* none of that type */ }
  }
  if (!addrs.length) return 'Couldn’t find that website.';
  return addrs.every(isPublicAddress) ? null : 'That address isn’t reachable from the internet.';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data } = token ? await adminClient().auth.getUser(token) : { data: { user: null } };
  if (!data.user) return json({ error: 'Log in to use links (or choose a file instead).' }, 401);
  let raw: unknown;
  try { raw = ((await req.json()) as { url?: unknown }).url; } catch { return json({ error: 'invalid JSON body' }, 400); }
  if (typeof raw !== 'string' || raw.length > 2048) return json({ error: 'Paste a link to an audio file.' }, 400);

  let url: URL;
  try { url = new URL(directLink(raw.trim())); } catch { return json({ error: 'That doesn’t look like a link.' }, 400); }
  const blocked = blockedHost(url.hostname);
  if (blocked) return json({ error: `${blocked} links can’t be used: their songs only play in their own app. Use a file you have instead.` }, 422);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90_000);
  try {
    let res: Response | null = null;
    for (let hop = 0; hop < 6; hop++) {
      const bad = await safeTarget(url);
      if (bad) return json({ error: bad }, 422);
      res = await fetch(url, { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': 'SoundCheck/0.2 (audio link fetch)', Accept: 'audio/*,*/*;q=0.5' } });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('Location') : null;
      if (!loc) break;
      await res.body?.cancel();
      url = new URL(loc, url);
      const b = blockedHost(url.hostname);
      if (b) return json({ error: `That link leads to ${b}, whose songs only play in their own app.` }, 422);
      res = null;
    }
    if (!res) return json({ error: 'That link redirects too many times.' }, 422);
    if (!res.ok || !res.body) return json({ error: `The website answered ${res.status}. Is the link shared publicly?` }, 422);
    const type = (res.headers.get('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
    const audioish = type.startsWith('audio/') || type === 'video/mp4' || type === 'video/webm' || type === 'application/ogg'
      || ((type === 'application/octet-stream' || type === 'binary/octet-stream' || type === '') && (AUDIO_EXT.test(url.pathname) || /attachment/i.test(res.headers.get('Content-Disposition') ?? '')));
    if (!audioish) {
      await res.body.cancel();
      return json({ error: type.includes('html') ? 'That link opens a web page, not an audio file. Use a direct download link.' : `That link isn’t an audio file (${type || 'unknown type'}).` }, 422);
    }
    const len = Number(res.headers.get('Content-Length') ?? 0);
    if (len > MAX_BYTES) { await res.body.cancel(); return json({ error: 'That file is over 80 MB.' }, 413); }
    let seen = 0;
    const capped = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, c) {
        seen += chunk.length;
        if (seen > MAX_BYTES) { c.error(new Error('too large')); ctl.abort(); return; }
        c.enqueue(chunk);
      },
      flush() { clearTimeout(timer); },
    }));
    return new Response(capped, { headers: { ...cors, 'Content-Type': type || 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Expose-Headers': 'Content-Length', ...(len ? { 'Content-Length': String(len) } : {}) } });
  } catch (e) {
    clearTimeout(timer);
    return json({ error: ctl.signal.aborted ? 'That download took too long.' : `Couldn’t download that link (${e instanceof Error ? e.message : e}).` }, 502);
  }
});
