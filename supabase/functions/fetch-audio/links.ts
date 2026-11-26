/** Pure link helpers for fetch-audio (unit tested). */

/** Streaming services whose pages aren't audio files (and whose audio only plays in their own players). */
const STREAMING: [RegExp, string][] = [
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)youtube-nocookie\.com$|(^|\.)googlevideo\.com$/, 'YouTube'],
  [/(^|\.)spotify\.com$|(^|\.)spotify\.link$|(^|\.)scdn\.co$/, 'Spotify'],
  [/(^|\.)soundcloud\.com$|(^|\.)snd\.sc$|(^|\.)sndcdn\.com$/, 'SoundCloud'],
  [/^music\.apple\.com$|(^|\.)itunes\.apple\.com$/, 'Apple Music'],
  [/^music\.amazon\.[a-z.]+$/, 'Amazon Music'],
  [/(^|\.)tidal\.com$/, 'TIDAL'],
  [/(^|\.)deezer\.com$|(^|\.)deezer\.page\.link$|(^|\.)dzcdn\.net$/, 'Deezer'],
  [/(^|\.)pandora\.com$/, 'Pandora'],
  [/(^|\.)audiomack\.com$/, 'Audiomack'],
  [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)instagram\.com$/, 'Instagram'],
];
export function blockedHost(hostname: string): string | null {
  const h = hostname.toLowerCase();
  for (const [re, name] of STREAMING) if (re.test(h)) return name;
  return null;
}

/** Share links rewritten to their direct-download form (Dropbox, Google Drive, OneDrive). */
export function directLink(raw: string): string {
  const u = new URL(raw);
  const h = u.hostname.toLowerCase();
  if (h === 'www.dropbox.com' || h === 'dropbox.com') {
    u.searchParams.delete('dl');
    u.searchParams.set('dl', '1');
    return u.toString();
  }
  if (h === 'drive.google.com') {
    const id = u.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] ?? u.searchParams.get('id');
    if (id) return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
  }
  if (h === '1drv.ms' || h.endsWith('onedrive.live.com')) {
    if (!u.searchParams.has('download')) u.searchParams.set('download', '1');
    return u.toString();
  }
  return u.toString();
}

/** True for addresses on the public internet (not loopback, private, link-local, CGNAT, multicast or reserved). */
export function isPublicAddress(ip: string): boolean {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return false;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]!);
    const first = parseInt(v.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return false;   // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return false;   // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return false;   // multicast
    if (v.startsWith('64:ff9b:') || v.startsWith('2001:db8') || v.startsWith('100::')) return false;
    return true;
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  const [a, b] = p as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;   // CGNAT
  if (a === 169 && b === 254) return false;             // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false;               // 192.0.0.0/24, 192.0.2.0/24
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51) return false;
  if (a === 203 && b === 0) return false;
  return true;
}
