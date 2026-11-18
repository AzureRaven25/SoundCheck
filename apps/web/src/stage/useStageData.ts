'use client';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

export interface StageWord { start: number; end: number; text: string }
export interface StageLine { start?: number; end?: number; text: string; words?: StageWord[] }
export interface StageNote { start: number; end: number; pitch: number; conf?: number }
export interface StagePhrase { start: number; end: number; noteIdx: number[] }

export interface StageData {
  track: { id: string; title: string; artist: string; artworkUrl: string | null };
  analysisId: string;
  notes: StageNote[];
  phrases: StagePhrase[];
  musicalKey: string | null;
  vocalRange: { low: number; high: number; min: number; max: number } | null;
  lines: StageLine[];
  lyricsGranularity: 'plain' | 'line' | 'word' | null;
  /** true when the words were transcribed from the vocals (no published lyrics exist) */
  lyricsTranscribed: boolean;
  instrumentalUrl: string;
  vocalsUrl: string;
}

export type StageLoad =
  | { kind: 'loading' }
  | { kind: 'not-ready'; title: string }
  | { kind: 'signed-out' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: StageData };

/** Everything SoundCheck Stage needs for a track, from assets the signed-in user may access. */
export function useStageData(trackId: string): StageLoad {
  const [state, setState] = useState<StageLoad>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    const sb = supabaseBrowser();
    void (async () => {
      try {
        const { data: { user } } = await sb.auth.getUser();
        const { data: track } = await sb.from('tracks').select('id, title, artist_credit, album_id').eq('id', trackId).maybeSingle();
        if (!track) throw new Error('song not found');
        if (!user) return live && setState({ kind: 'signed-out' });
        const { data: analyses } = await sb.from('karaoke_analysis')
          .select('id, source_asset_id, notes, phrases, musical_key, vocal_range, word_lyrics').eq('track_id', trackId)
          .order('created_at', { ascending: false }).limit(1);
        const a = analyses?.[0];
        if (!a) return live && setState({ kind: 'not-ready', title: track.title });
        const [{ data: stems }, lyricsRes, art] = await Promise.all([
          sb.from('audio_assets').select('kind, storage_path').eq('source_asset_id', a.source_asset_id).in('kind', ['instrumental', 'vocals']),
          sb.functions.invoke<{ granularity: StageData['lyricsGranularity']; lines: StageLine[] }>('fetch-lyrics', { body: { track_id: trackId } }),
          track.album_id
            ? sb.from('artwork').select('source_url, storage_path').eq('entity_type', 'album').eq('entity_id', track.album_id).eq('is_primary', true).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        const path = (k: string) => stems?.find((s) => s.kind === k)?.storage_path;
        const ip = path('instrumental'), vp = path('vocals');
        if (!ip || !vp) return live && setState({ kind: 'not-ready', title: track.title });
        const [iu, vu] = await Promise.all([
          sb.storage.from('audio').createSignedUrl(ip, 3600 * 3),
          sb.storage.from('audio').createSignedUrl(vp, 3600 * 3),
        ]);
        if (!iu.data || !vu.data) throw new Error('could not access the karaoke tracks');
        if (!live) return;
        setState({
          kind: 'ready',
          data: {
            track: { id: track.id, title: track.title, artist: track.artist_credit, artworkUrl: art.data ? art.data.storage_path ?? art.data.source_url : null },
            analysisId: a.id,
            notes: a.notes as unknown as StageNote[],
            phrases: (a.phrases as unknown as StagePhrase[]) ?? [],
            musicalKey: a.musical_key,
            vocalRange: a.vocal_range as StageData['vocalRange'],
            // prefer word timing aligned to this exact recording; fall back to the shared synced lyrics
            lines: (a.word_lyrics as { lines: StageLine[] } | null)?.lines ?? lyricsRes.data?.lines ?? [],
            lyricsGranularity: a.word_lyrics ? 'word' : lyricsRes.data?.granularity ?? null,
            lyricsTranscribed: String((a.word_lyrics as { source?: string } | null)?.source ?? '').startsWith('transcribed'),
            instrumentalUrl: iu.data.signedUrl,
            vocalsUrl: vu.data.signedUrl,
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
