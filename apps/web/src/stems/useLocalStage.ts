'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { StageLine } from '@/stage/useStageData';
import type { StageVideo, VideoStageData } from '@/stage/useVideoStageData';
import { StemDeck } from './deck';
import { loadLocalSong } from './store';

export type LocalStageLoad =
  | { kind: 'loading' } | { kind: 'missing' } | { kind: 'error'; message: string }
  | { kind: 'ready'; data: VideoStageData; deck: StemDeck; source: string };

const stem = (id: string, kind: StageVideo['kind'], title: string, seconds: number): StageVideo =>
  ({ id, title, channel: 'This device', durationS: seconds, kind, offset: 0, offsetSource: 'guess', votes: 0, measured: 0 });

/** The Stage for karaoke made on this device: the song's synced lyrics over the stems saved in this browser. */
export function useLocalStage(trackId: string, localId: string): LocalStageLoad {
  const [state, setState] = useState<LocalStageLoad>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    let deck: StemDeck | null = null;
    const sb = supabaseBrowser();
    void (async () => {
      try {
        const [song, { data: { user } }, { data: track }] = await Promise.all([
          loadLocalSong(localId),
          sb.auth.getUser(),
          sb.from('tracks').select('id, title, artist_credit, album_id, duration_ms').eq('id', trackId).maybeSingle(),
        ]);
        if (!song) return live && setState({ kind: 'missing' });
        if (!track) throw new Error('song not found');
        const [lyricsRes, art] = await Promise.all([
          sb.functions.invoke<{ granularity: VideoStageData['lyricsGranularity']; lines: StageLine[] }>('fetch-lyrics', { body: { track_id: trackId } }),
          track.album_id
            ? sb.from('artwork').select('source_url, storage_path').eq('entity_type', 'album').eq('entity_id', track.album_id).eq('is_primary', true).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        if (!live) return;
        deck = new StemDeck(song.stems);
        const id = song.meta.id;
        setState({
          kind: 'ready', deck, source: song.meta.source,
          data: {
            track: { id: track.id, title: track.title, artist: track.artist_credit, durationS: track.duration_ms ? track.duration_ms / 1000 : null,
                     artworkUrl: art.data ? art.data.storage_path ?? art.data.source_url : null },
            lines: lyricsRes.data?.lines ?? [],
            lyricsGranularity: lyricsRes.data?.granularity ?? null,
            originals: [stem(`local-vocals-${id}`, 'original', 'Your recording · vocal', song.meta.seconds)],
            karaoke: [stem(`local-backing-${id}`, 'karaoke', 'Your recording · backing', song.meta.seconds)],
            configured: true, quotaExhausted: false, signedIn: !!user,
          },
        });
      } catch (e) {
        if (live) setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { live = false; deck?.backing.destroy(); };
  }, [trackId, localId]);
  return state;
}
