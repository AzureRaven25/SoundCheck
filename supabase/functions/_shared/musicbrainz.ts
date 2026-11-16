/**
 * MusicBrainz live lookup → SoundCheck catalog rows.
 *
 * Applies the same eligibility rules as the bulk import (services/catalog ranked_subset.sql):
 * official Album/Single/EP releases, no live/remix/demo/etc. release groups, no videos,
 * no live/instrumental/karaoke/demo recordings. Catalog ids are the MusicBrainz ids
 * (artists.id = artist MBID, albums.id = release-group MBID, tracks.id = recording MBID),
 * matching the bulk sync, so live and bulk rows never duplicate each other.
 */
import { norm } from './norm.ts';

export const MB_BASE = 'https://musicbrainz.org/ws/2';

const EXCLUDED_SECONDARY = new Set(['Live', 'Remix', 'DJ-mix', 'Interview', 'Spokenword', 'Audiobook', 'Audio drama', 'Demo', 'Field recording']);
const NO_VOCALS = /\b(live|instrumental|karaoke|demo|a cappella|acapella)\b/i;
const NO_VOCALS_TITLE = /[([][^)\]]*\b(live|instrumental|karaoke|demo)\b[^)\]]*[)\]]/i;

export interface MbArtistCredit {
  name: string;
  joinphrase?: string;
  artist: { id: string; name: string; 'sort-name'?: string; disambiguation?: string };
}
export interface MbRelease {
  id: string;
  title: string;
  status?: string;
  date?: string;
  'release-group'?: { id: string; title?: string; 'primary-type'?: string; 'secondary-types'?: string[] };
}
export interface MbRecording {
  id: string;
  title: string;
  length?: number | null;
  video?: boolean;
  disambiguation?: string;
  score?: number;
  isrcs?: string[];
  'artist-credit'?: MbArtistCredit[];
  releases?: MbRelease[];
}

export interface CatalogRows {
  artists: { id: string; mbid: string; name: string; sort_name: string | null; disambiguation: string | null }[];
  albums: { id: string; mbid: string; title: string; artist_credit: string; primary_type: string; release_year: number | null }[];
  tracks: {
    id: string; mbid: string; title: string; artist_credit: string; album_id: string | null;
    duration_ms: number | null; release_year: number | null; isrcs: string[]; popularity: number;
  }[];
  track_artists: { track_id: string; position: number; artist_id: string; join_phrase: string }[];
  track_recordings: { recording_mbid: string; track_id: string }[];
}

export function creditString(credit: MbArtistCredit[] | undefined): string {
  return (credit ?? []).map((c) => c.name + (c.joinphrase ?? '')).join('').trim();
}

function eligibleReleases(rec: MbRecording): MbRelease[] {
  return (rec.releases ?? []).filter((r) => {
    const rg = r['release-group'];
    if (r.status !== 'Official' || !rg) return false;
    if (!['Album', 'Single', 'EP'].includes(rg['primary-type'] ?? '')) return false;
    return !(rg['secondary-types'] ?? []).some((t) => EXCLUDED_SECONDARY.has(t));
  });
}

const year = (date?: string) => (date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null);

/** Map a /ws/2/recording search response to catalog rows (deduplicated by artist credit + title). */
export function mapRecordingSearch(recordings: MbRecording[], minScore = 70): CatalogRows {
  const out: CatalogRows = { artists: [], albums: [], tracks: [], track_artists: [], track_recordings: [] };
  const seenArtists = new Set<string>();
  const seenAlbums = new Set<string>();
  const songs = new Map<string, number>(); // norm key -> index into out.tracks

  for (const rec of recordings) {
    if ((rec.score ?? 100) < minScore || rec.video) continue;
    if (NO_VOCALS.test(rec.disambiguation ?? '') || NO_VOCALS_TITLE.test(rec.title)) continue;
    const eligible = eligibleReleases(rec);
    if (!eligible.length || !rec['artist-credit']?.length) continue;

    const credit = creditString(rec['artist-credit']);
    const key = `${norm(credit)}\u0000${norm(rec.title)}`;
    const existing = songs.get(key);
    if (existing !== undefined) {
      // Same song, another recording (remaster/reissue): map it to the first one and add its releases.
      const t = out.tracks[existing]!;
      t.popularity += eligible.length;
      out.track_recordings.push({ recording_mbid: rec.id, track_id: t.id });
      continue;
    }

    eligible.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
    const first = eligible[0]!;
    const rg = first['release-group']!;
    if (!seenAlbums.has(rg.id)) {
      seenAlbums.add(rg.id);
      out.albums.push({
        id: rg.id, mbid: rg.id, title: rg.title ?? first.title, artist_credit: credit,
        primary_type: (rg['primary-type'] ?? 'Album').toLowerCase(), release_year: year(first.date),
      });
    }
    rec['artist-credit'].forEach((c, position) => {
      if (!seenArtists.has(c.artist.id)) {
        seenArtists.add(c.artist.id);
        out.artists.push({
          id: c.artist.id, mbid: c.artist.id, name: c.artist.name,
          sort_name: c.artist['sort-name'] ?? null, disambiguation: c.artist.disambiguation || null,
        });
      }
      out.track_artists.push({ track_id: rec.id, position, artist_id: c.artist.id, join_phrase: c.joinphrase ?? '' });
    });
    songs.set(key, out.tracks.length);
    out.tracks.push({
      id: rec.id, mbid: rec.id, title: rec.title, artist_credit: credit, album_id: rg.id,
      duration_ms: rec.length && rec.length > 0 ? rec.length : null, release_year: year(first.date),
      isrcs: (rec.isrcs ?? []).map((i) => i.replace(/-/g, '').toUpperCase()), popularity: eligible.length,
    });
    out.track_recordings.push({ recording_mbid: rec.id, track_id: rec.id });
  }
  return out;
}

/** Lucene query for the recording search: title/artist words, typo-tolerant on the last word. */
export function recordingQuery(q: string): string {
  // Lowercased: Lucene only treats uppercase AND/OR/NOT as operators, so user words can't inject syntax.
  const words = q.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 8);
  if (!words.length) return '';
  return words.map((w, i) => (i === words.length - 1 && w.length >= 3 ? `(${w} OR ${w}*)` : w)).join(' AND ');
}
