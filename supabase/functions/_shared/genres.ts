/** Canonical genre slugs for discovery, and a mapper from sources' free-form tags ("Hip-Hop/Rap", "lo-fi"…). */
export const GENRES = [
  'pop', 'rock', 'hip-hop', 'electronic', 'dance', 'r-and-b', 'soul', 'jazz', 'blues', 'folk', 'country', 'acoustic',
  'classical', 'reggae', 'latin', 'metal', 'punk', 'ambient', 'lofi', 'world', 'gospel', 'funk', 'indie', 'soundtrack',
] as const;
export type Genre = (typeof GENRES)[number];

const RULES: [RegExp, Genre][] = [
  [/hip[\s-]?hop|\brap\b|trap\b|boom ?bap|grime/i, 'hip-hop'],
  [/\br\s*&?\s*b\b|rnb|rhythm and blues/i, 'r-and-b'],
  [/\bsoul\b|motown|neo-soul/i, 'soul'],
  [/lo-?fi|chillhop/i, 'lofi'],
  [/\bhouse\b|techno|trance|edm|dubstep|drum ?(and|&|n) ?bass|\bdnb\b|electro|synth|idm|breakbeat|future bass/i, 'electronic'],
  [/(?<!folk )\bdance\b|disco|club/i, 'dance'],
  [/\bjazz|swing|bebop|big band/i, 'jazz'],
  [/\bblues/i, 'blues'],
  [/\bfolk|celtic|bluegrass|singer[\s-]?songwriter/i, 'folk'],
  [/country|americana/i, 'country'],
  [/acoustic|unplugged/i, 'acoustic'],
  [/classical|symphon|orchestr|sonata|concerto|baroque|opera|piano solo|chamber/i, 'classical'],
  [/reggae|dub\b|ska\b|dancehall/i, 'reggae'],
  [/latin|salsa|bossa|samba|reggaeton|cumbia|tango|flamenco|bachata/i, 'latin'],
  [/metal|hardcore|grindcore|doom/i, 'metal'],
  [/\bpunk|emo\b|post-punk/i, 'punk'],
  [/ambient|drone|new age|meditation|downtempo|chillout|\bchill\b/i, 'ambient'],
  [/\bworld\b|afro|african|indian|k-?pop|j-?pop|balkan|arabic|folk dance/i, 'world'],
  [/gospel|christian|worship|spiritual/i, 'gospel'],
  [/\bfunk/i, 'funk'],
  [/\bindie|alternative|alt-rock|shoegaze|dream pop/i, 'indie'],
  [/soundtrack|cinematic|film score|score\b|trailer|video game/i, 'soundtrack'],
  [/\brock|grunge|garage|psychedelic|prog/i, 'rock'],
  [/\bpop\b|synthpop|electropop|k-pop/i, 'pop'],
];

/** Map any number of tag strings to canonical genres (deduplicated, at most 3, most specific first). */
export function toGenres(...tags: (string | string[] | null | undefined)[]): Genre[] {
  const text = tags.flat().filter((t): t is string => typeof t === 'string' && !!t).map((t) => t.toLowerCase());
  const out: Genre[] = [];
  for (const t of text) for (const [re, g] of RULES) if (re.test(t) && !out.includes(g)) out.push(g);
  return out.slice(0, 3);
}
