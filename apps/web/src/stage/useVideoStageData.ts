'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { StageLine } from './useStageData';

export interface StageVideo {
  id: string; title: string; channel: string; durationS: number | null;
  kind: 'original' | 'karaoke';
  /** seconds: video time = lyrics time + offset */
  offset: number;
  /** where the offset came from: other singers' corrections, your own, or a guess from the video's length */
  offsetSource: 'shared' | 'guess';
  votes: number;
  /** how many of those were measured by auto sync (0: it still needs measuring) */
  measured: number;
  /** an official instrumental of the studio recording: in step with the lyrics from the start, nothing to line up */
  sameMaster?: boolean;
}

export interface VideoStageData {
  track: { id: string; title: string; artist: string; artworkUrl: string | null; durationS: number | null };
  lines: StageLine[];
  lyricsGranularity: 'plain' | 'line' | 'word' | null;
  originals: StageVideo[];
  karaoke: StageVideo[];
  /** false when the server has no YouTube key (people can still paste links) */
  configured: boolean;
  /** today's YouTube search quota is used up and nobody has stored videos for this song yet */
  quotaExhausted: boolean;
  signedIn: boolean;
}

export type VideoStageLoad = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: VideoStageData };

interface Ranked { id: string; title: string; channel: string; durationS: number | null; kind: 'original' | 'karaoke'; offsetGuessMs: number; sameMaster?: boolean }

/** Everything the YouTube sing-along Stage needs: synced lyrics, candidate videos and their lyrics offsets. */
export function useVideoStageData(trackId: string): VideoStageLoad {
  const [state, setState] = useState<VideoStageLoad>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    const sb = supabaseBrowser();
    void (async () => {
      try {
        const [{ data: { user } }, { data: track }] = await Promise.all([
          sb.auth.getUser(),
          sb.from('tracks').select('id, title, artist_credit, album_id, duration_ms').eq('id', trackId).maybeSingle(),
        ]);
        if (!track) throw new Error('song not found');
        const [lyricsRes, vids, offs, art] = await Promise.all([
          sb.functions.invoke<{ granularity: VideoStageData['lyricsGranularity']; lines: StageLine[] }>('fetch-lyrics', { body: { track_id: trackId } }),
          sb.functions.invoke<{ configured: boolean; originals?: Ranked[]; karaoke?: Ranked[]; quotaExhausted?: boolean }>('youtube', { body: { track_id: trackId, action: 'stage' } }),
          sb.rpc('video_offsets', { p_track_id: trackId }),
          track.album_id
            ? sb.from('artwork').select('source_url, storage_path').eq('entity_type', 'album').eq('entity_id', track.album_id).eq('is_primary', true).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        const shared = new Map(((offs.data ?? []) as { video_id: string; offset_ms: number; votes: number; measured: number }[]).map((o) => [o.video_id, o]));
        const toVideo = (v: Ranked): StageVideo => {
          const s = shared.get(v.id);
          return { id: v.id, title: v.title, channel: v.channel, durationS: v.durationS, kind: v.kind,
                   offset: (s ? s.offset_ms : v.offsetGuessMs) / 1000, offsetSource: s ? 'shared' : 'guess', votes: s?.votes ?? 0, measured: s?.measured ?? 0, sameMaster: !!v.sameMaster };
        };
        if (!live) return;
        setState({
          kind: 'ready',
          data: {
            track: { id: track.id, title: track.title, artist: track.artist_credit, durationS: track.duration_ms ? track.duration_ms / 1000 : null,
                     artworkUrl: art.data ? art.data.storage_path ?? art.data.source_url : null },
            lines: lyricsRes.data?.lines ?? [],
            lyricsGranularity: lyricsRes.data?.granularity ?? null,
            originals: (vids.data?.originals ?? []).map(toVideo),
            karaoke: (vids.data?.karaoke ?? []).map(toVideo),
            configured: vids.data?.configured ?? false,
            quotaExhausted: !!vids.data?.quotaExhausted,
            signedIn: !!user,
          },
        });
      } catch (e) {
        if (live) setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { live = false; };
  }, [trackId]);
  return state;
}

/** Remember a video's offset (shared as a median with other singers); `measured`: by auto sync, not a nudge. */
export async function saveVideoOffset(trackId: string, videoId: string, offsetS: number, measured = false) {
  await supabaseBrowser().rpc('set_video_offset', { p_track_id: trackId, p_video_id: videoId, p_offset_ms: Math.round(offsetS * 1000), p_measured: measured });
}
