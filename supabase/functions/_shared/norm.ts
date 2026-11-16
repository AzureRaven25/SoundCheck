/** Mirrors private.norm() in the database: lowercase, accents stripped, quotes unified, single spaces. */
export function norm(s: string): string {
  return s
    .replace(/[’‘´`]/g, "'")
    .replace(/[“”]/g, '"')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strips store-added noise ("(2011 Remaster)", "- Single Version", "[Deluxe Edition]") for matching. */
export function stripEditionNoise(s: string): string {
  return s
    .replace(/\s*[([][^)\]]*\b(remaster(ed)?|deluxe|expanded|anniversary|edition|version|mono|stereo|bonus)\b[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+[^-]*\b(remaster(ed)?|single version|album version|radio edit|mono|stereo)\b.*$/gi, '')
    .trim();
}

/** Dice coefficient over character bigrams: 1 = identical, 0 = nothing shared. */
export function similarity(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) {
      hits++;
      grams.set(g, n - 1);
    }
  }
  return (2 * hits) / (x.length - 1 + (y.length - 1));
}
