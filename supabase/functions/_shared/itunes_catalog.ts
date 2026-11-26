/**
 * Catalog growth from Apple's iTunes Search API (catalog roughly the size of Spotify's): metadata, artwork and a
 * store link only. Audio from Apple is limited to its 30 s previews (research.md §3), which are labelled as such.
 */
import { norm } from './norm.ts';
import { upscaleArtwork } from './itunes.ts';
import { stableUuid } from './openmusic.ts';
import { toGenres } from './genres.ts';

export interface ItunesSong {
  wrapperType?: string; kind?: string; trackId: number; trackName: string; artistName: string; artistId?: number;
  collectionId?: number; collectionName?: string; trackTimeMillis?: number; releaseDate?: string;
  artworkUrl100?: string; trackViewUrl?: string; isStreamable?: boolean; primaryGenreName?: string;
}

export interface ItunesRows {
  albums: { id: string; title: string; artist_credit: string; primary_type: string; release_year: number | null }[];
  tracks: { id: string; title: string; artist_credit: string; album_id: string | null; duration_ms: number | null; release_year: number | null; popularity: number; genres: string[] }[];
  artwork: { entity_type: 'album'; entity_id: string; provider: 'itunes'; source_url: string; is_primary: boolean }[];
  sources: { track_id: string; provider: 'itunes'; external_id: string; url: string | null; duration_ms: number | null; karaoke_ok: false }[];
  artistNames: Map<string, string>;   // track id → primary artist name (linked to artists by name)
}

/** Songs only (no music videos / karaoke versions), one per artist+title. */
export async function itunesToRows(songs: ItunesSong[]): Promise<ItunesRows> {
  const rows: ItunesRows = { albums: [], tracks: [], artwork: [], sources: [], artistNames: new Map() };
  const seen = new Set<string>();
  for (const [rank, s] of songs.entries()) {
    if (s.kind !== 'song' || !s.trackName || !s.artistName) continue;
    if (/karaoke|instrumental version|originally performed by/i.test(`${s.trackName} ${s.collectionName ?? ''} ${s.artistName}`)) continue;
    const key = `${norm(s.artistName)}|${norm(s.trackName)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const year = s.releaseDate ? Number.parseInt(s.releaseDate.slice(0, 4), 10) : NaN;
    const releaseYear = year >= 1800 && year <= 2200 ? year : null;
    let albumId: string | null = null;
    if (s.collectionId && s.collectionName) {
      albumId = await stableUuid(`itunes:collection:${s.collectionId}`);
      if (!rows.albums.some((a) => a.id === albumId)) {
        rows.albums.push({ id: albumId, title: s.collectionName.slice(0, 500), artist_credit: s.artistName, primary_type: / - (Single|EP)$/i.test(s.collectionName) ? 'single' : 'album', release_year: releaseYear });
        if (s.artworkUrl100) rows.artwork.push({ entity_type: 'album', entity_id: albumId, provider: 'itunes', source_url: upscaleArtwork(s.artworkUrl100, 1200), is_primary: true });
      }
    }
    const id = await stableUuid(`itunes:track:${s.trackId}`);
    rows.tracks.push({ id, title: s.trackName.slice(0, 500), artist_credit: s.artistName, album_id: albumId, duration_ms: s.trackTimeMillis ?? null, release_year: releaseYear, popularity: Math.max(1, 20 - rank), genres: toGenres(s.primaryGenreName) });   // keep Apple's relevance order
    rows.sources.push({ track_id: id, provider: 'itunes', external_id: String(s.trackId), url: s.trackViewUrl ?? null, duration_ms: s.trackTimeMillis ?? null, karaoke_ok: false });
    rows.artistNames.set(id, s.artistName);
  }
  return rows;
}
