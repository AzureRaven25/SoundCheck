'use client';
/**
 * Remember the player between visits (this browser only): the queue and where you are in it, volume, mute and
 * autoplay. Restored paused, so a reload never starts music by itself. A per-device convenience, so it lives in
 * localStorage; anything that matters across devices (history, playlists) is on your account.
 */
import { emptyQueue, type QueueState } from './queue';
import { usePlayer } from './store';

const KEY = 'soundcheck.player.v1';
interface Saved { queue: QueueState; volume: number; muted: boolean; autoplay: boolean }

function valid(q: unknown): q is QueueState {
  const v = q as QueueState;
  return !!v && Array.isArray(v.items) && Array.isArray(v.order) && typeof v.pos === 'number' && v.order.length === v.items.length
    && v.pos < v.order.length && v.items.every((t) => t && typeof t.id === 'string' && typeof t.title === 'string');
}

let started = false;
/** Restore once, then save on every change (cheap: only when these fields change). */
export function persistPlayer() {
  if (started || typeof window === 'undefined') return;
  started = true;
  try {
    const raw = localStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as Partial<Saved>) : null;
    if (s && valid(s.queue) && usePlayer.getState().queue.pos < 0) {
      usePlayer.setState({
        queue: { ...emptyQueue, ...s.queue, items: s.queue.items.slice(0, 500), order: s.queue.order.slice(0, 500) },
        playing: false,
        volume: typeof s.volume === 'number' ? Math.min(1, Math.max(0, s.volume)) : 0.8,
        muted: !!s.muted,
        autoplay: s.autoplay !== false,
      });
    }
  } catch { /* storage unavailable or corrupt: start fresh */ }
  usePlayer.subscribe((st, prev) => {
    // position ticks several times a second: only write when something we keep actually changed
    if (st.queue === prev.queue && st.volume === prev.volume && st.muted === prev.muted && st.autoplay === prev.autoplay) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ queue: st.queue, volume: st.volume, muted: st.muted, autoplay: st.autoplay } satisfies Saved));
    } catch { /* full or blocked */ }
  });
}
