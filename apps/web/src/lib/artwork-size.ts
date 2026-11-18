/**
 * Ask each artwork host for an image close to the size we draw, instead of resizing through Vercel's image
 * optimizer (which has a monthly quota on the Hobby plan). Unknown hosts are returned unchanged.
 */
export function sizedArtwork(url: string, px: number): string {
  try {
    const u = new URL(url);
    const h = u.hostname;
    if (h === 'coverartarchive.org') {
      // /release/<mbid>/front or /release/<mbid>/<id>.jpg → 250/500/1200 thumbnails
      const size = px <= 250 ? 250 : px <= 500 ? 500 : 1200;
      if (/\/front$/.test(u.pathname)) return `${url}-${size}`;
      return url.replace(/\/(\d+)(?:-(?:250|500|1200))?\.jpg$/, `/$1-${size}.jpg`).replace(/\/front-(?:250|500|1200)$/, `/front-${size}`);
    }
    if (h.endsWith('mzstatic.com')) return url.replace(/\/\d+x\d+(bb|cc|sr)?\.(jpg|png|webp)$/, `/${px}x${px}bb.jpg`);
    if (h.endsWith('dzcdn.net')) return url.replace(/\/\d+x\d+-/, `/${px}x${px}-`);
    if (h.includes('audius')) return url.replace(/\/(150x150|480x480|1000x1000)\.jpg$/, px <= 150 ? '/150x150.jpg' : px <= 480 ? '/480x480.jpg' : '/1000x1000.jpg');
    if (h === 'upload.wikimedia.org' && !u.pathname.includes('/thumb/')) {
      const m = /^\/wikipedia\/commons\/([0-9a-f])\/([0-9a-f]{2})\/([^/]+)$/.exec(u.pathname);
      if (m) {
        const file = m[3]!;
        const suffix = /\.svg$/i.test(file) ? '.png' : '';
        return `https://upload.wikimedia.org/wikipedia/commons/thumb/${m[1]}/${m[2]}/${file}/${px}px-${file}${suffix}`;
      }
    }
    return url;
  } catch {
    return url;
  }
}
