'use client';
import { useCallback, useEffect, useState } from 'react';
import { PROTOCOL_VERSION } from '@soundcheck/contracts';
import { supabaseBrowser } from '@/lib/supabase/client';

export interface QueueItem {
  id: string; track_id: string; title: string; artist_credit: string; requested_by: string; requester_name: string | null;
  status: 'queued' | 'playing'; queue_position: number;
}

/** The party's song queue (session_queue via RLS); `version` bumps when a queue_changed event arrives. */
export function useSessionQueue(sessionId: string | null | undefined, version: number) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const reload = useCallback(async () => {
    if (!sessionId) return;
    const { data } = await supabaseBrowser().rpc('session_queue_list', { p_session_id: sessionId });
    setItems((data as QueueItem[] | null) ?? []);
  }, [sessionId]);
  useEffect(() => { void reload(); }, [reload, version]);
  return { items, reload };
}

export const queueChanged = { type: 'queue_changed', v: PROTOCOL_VERSION } as const;

export async function enqueue(sessionId: string, trackId: string) {
  const { error } = await supabaseBrowser().rpc('enqueue_song', { p_session_id: sessionId, p_track_id: trackId });
  if (error) throw error;
}
