'use client';
import { SingRecorder, voicedSeconds } from './singHistory';

/** Party guests (not logged in) are scored together on the host's account: one combined performance. */
export interface GuestScore { performance_id: string; score: number; grade: string; singers: number; member_ids: (string | null)[] }

/** Put the combined guest take into the host's sing history (time sung = the longest-singing guest), linked to it. */
export async function recordGuestTake(trackId: string, mode: 'melody' | 'lyrics', g: GuestScore | null | undefined,
  framesOf: (memberId: string) => number[], floorOf: (memberId: string) => number | null) {
  if (!g) return;
  const secs = Math.max(0, ...g.member_ids.filter((m): m is string => !!m).map((m) => voicedSeconds(framesOf(m), floorOf(m))));
  const rec = new SingRecorder(trackId, mode, true);
  await rec.report(secs, true);
  await rec.link(g.performance_id);
}
