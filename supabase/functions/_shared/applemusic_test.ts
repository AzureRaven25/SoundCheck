import { assert, assertEquals } from 'jsr:@std/assert@1';
import { developerToken } from './applemusic.ts';

Deno.test('signs a verifiable ES256 developer token with origin restriction', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwt = await developerToken({ teamId: 'TEAM123456', keyId: 'KEY1234567', key: pair.privateKey, origins: ['https://soundcheck-gules.vercel.app'], now: 1_800_000_000_000 });
  const [h, p, s] = jwt.split('.');
  const dec = (x: string) => JSON.parse(atob(x.replace(/-/g, '+').replace(/_/g, '/')));
  assertEquals(dec(h!), { alg: 'ES256', kid: 'KEY1234567', typ: 'JWT' });
  const payload = dec(p!);
  assertEquals(payload.iss, 'TEAM123456');
  assertEquals(payload.exp - payload.iat, 12 * 3600);
  assertEquals(payload.origin, ['https://soundcheck-gules.vercel.app']);
  const sig = Uint8Array.from(atob(s!.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  assertEquals(sig.length, 64);
  assert(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, sig, new TextEncoder().encode(`${h}.${p}`)));
});
