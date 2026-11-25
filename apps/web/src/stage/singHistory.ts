'use client';
/**
 * Sing history: one row per song someone starts singing (sing_sessions), kept up to date with how long the mic heard
 * them sing and, when the take is scored, a link to the performance. Recorded even if they leave early or the song
 * can't be scored, so "songs sung" and the Library's Sung tab match what people actually did.
 */
import { supabaseBrowser } from '@/lib/supabase/client';

export class SingRecorder {
  private id: Promise<string | null>;
  private last = 0;
  constructor(trackId: string, mode: 'melody' | 'lyrics', party: boolean) {
    // query builders only run when awaited/then'd: keep the promise
    this.id = Promise.resolve(supabaseBrowser().from('sing_sessions').insert({ track_id: trackId, mode, party }).select('id').single())
      .then(({ data }) => data?.id ?? null, () => null);
  }
  /** Save the seconds sung so far (throttled to every 5 s unless `force`). */
  async report(seconds: number, force = false) {
    const s = Math.max(0, Math.min(7200, Math.round(seconds)));
    if (!force && s - this.last < 5) return;
    this.last = s;
    const id = await this.id;
    if (id) await supabaseBrowser().from('sing_sessions').update({ sung_seconds: s }).eq('id', id);
  }
  async link(performanceId: string | null | undefined) {
    const id = await this.id;
    if (id && performanceId) await supabaseBrowser().from('sing_sessions').update({ performance_id: performanceId }).eq('id', id);
  }
}

/** Seconds of singing in flat [t, f0, conf, rmsDb] frames (10 ms each). */
export function voicedSeconds(flat: number[], floorDb: number | null): number {
  let n = 0;
  for (let i = 0; i < flat.length; i += 4) {
    if (flat[i + 1]! > 0 && flat[i + 2]! >= 0.6 && (floorDb == null || flat[i + 3]! >= floorDb + 10)) n++;
  }
  return n * 0.01;
}
