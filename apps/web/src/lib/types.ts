import type { QueueTrack } from '@/player/queue';

/** A track as shown in lists and grids across the site. */
export interface TrackItem {
  id: string;
  title: string;
  artist_credit: string;
  album_id: string | null;
  album_title?: string | null;
  duration_ms: number | null;
  release_year?: number | null;
  artwork_url?: string | null;
  artists?: { id: string; name: string; join_phrase: string }[];
}

export function toQueueTrack(t: TrackItem): QueueTrack {
  return {
    id: t.id, title: t.title, artist: t.artist_credit, albumId: t.album_id,
    artworkUrl: t.artwork_url ?? null, durationMs: t.duration_ms,
  };
}
