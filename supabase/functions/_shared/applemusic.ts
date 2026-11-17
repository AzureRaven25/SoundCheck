/** Apple Music developer token (MusicKit): an ES256 JWT signed with the team's MusicKit private key. */

const b64url = (b: Uint8Array | string) =>
  btoa(typeof b === 'string' ? b : String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** PEM "-----BEGIN PRIVATE KEY-----" (PKCS#8, as downloaded from Apple as a .p8) → CryptoKey. */
export async function importP8(pem: string): Promise<CryptoKey> {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

export async function developerToken(opts: { teamId: string; keyId: string; key: CryptoKey; origins?: string[]; ttlSeconds?: number; now?: number }) {
  const iat = Math.floor((opts.now ?? Date.now()) / 1000);
  const header = { alg: 'ES256', kid: opts.keyId, typ: 'JWT' };
  const payload: Record<string, unknown> = { iss: opts.teamId, iat, exp: iat + (opts.ttlSeconds ?? 12 * 3600) };
  if (opts.origins?.length) payload.origin = opts.origins;   // MusicKit JS only accepts the token on these sites
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, opts.key, new TextEncoder().encode(input)));
  return `${input}.${b64url(sig)}`;   // WebCrypto ECDSA signatures are already JOSE (r||s) format
}
