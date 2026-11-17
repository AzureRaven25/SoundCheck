'use client';
import { create } from 'zustand';
import {
  addToQueue, currentTrack, cycleRepeat, emptyQueue, jumpTo, next, playList, playNext, previous, removeAt, setShuffle,
  type QueueState, type QueueTrack,
} from './queue';

export type LoadState = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

interface PlayerStore {
  queue: QueueState;
  playing: boolean;
  load: LoadState;
  position: number;      // seconds
  duration: number;      // seconds
  volume: number;        // 0..1
  muted: boolean;
  sourceKind: 'original' | 'full' | 'preview' | null;
  attributionUrl: string | null;
  sourceLabel: string | null;
  queueOpen: boolean;
  /** Bumped when the current song should restart (Previous within 3 s, repeat-one). */
  restartToken: number;
  /** Bumped to re-resolve the current track's audio (after a transient failure). */
  reloadToken: number;
  seekRequest: { to: number; token: number } | null;

  playTracks: (tracks: QueueTrack[], start?: number) => void;
  playNext: (t: QueueTrack) => void;
  addToQueue: (t: QueueTrack) => void;
  toggle: () => void;
  setPlaying: (p: boolean) => void;
  nextTrack: (auto?: boolean) => void;
  previousTrack: () => void;
  jump: (orderPos: number) => void;
  remove: (orderPos: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  seek: (to: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleQueue: () => void;
  retry: () => void;
  _report: (p: Partial<Pick<PlayerStore, 'position' | 'duration' | 'load' | 'sourceKind' | 'attributionUrl' | 'sourceLabel' | 'playing'>>) => void;
}

export const usePlayer = create<PlayerStore>((set) => ({
  queue: emptyQueue,
  playing: false,
  load: 'idle',
  position: 0,
  duration: 0,
  volume: 0.8,
  muted: false,
  sourceKind: null,
  attributionUrl: null,
  sourceLabel: null,
  queueOpen: false,
  restartToken: 0,
  reloadToken: 0,
  seekRequest: null,

  playTracks: (tracks, start = 0) => set((s) => ({ queue: playList(s.queue, tracks, start), playing: true, position: 0 })),
  playNext: (t) => set((s) => ({ queue: playNext(s.queue, t), playing: s.playing || s.queue.pos < 0 })),
  addToQueue: (t) => set((s) => ({ queue: addToQueue(s.queue, t), playing: s.playing || s.queue.pos < 0 })),
  toggle: () => set((s) => ({ playing: currentTrack(s.queue) ? !s.playing : false })),
  setPlaying: (p) => set({ playing: p }),
  nextTrack: (auto = false) =>
    set((s) => {
      const q = next(s.queue, auto);
      if (auto && s.queue.repeat === 'one') return { restartToken: s.restartToken + 1 };
      return { queue: q, position: 0, playing: q.pos >= 0 && (s.playing || !auto) };
    }),
  previousTrack: () =>
    set((s) => {
      const { state, restart } = previous(s.queue, s.position);
      return restart ? { restartToken: s.restartToken + 1, position: 0 } : { queue: state, position: 0 };
    }),
  jump: (orderPos) => set((s) => ({ queue: jumpTo(s.queue, orderPos), playing: true, position: 0 })),
  remove: (orderPos) => set((s) => ({ queue: removeAt(s.queue, orderPos) })),
  toggleShuffle: () => set((s) => ({ queue: setShuffle(s.queue, !s.queue.shuffle) })),
  cycleRepeat: () => set((s) => ({ queue: { ...s.queue, repeat: cycleRepeat(s.queue.repeat) } })),
  seek: (to) => set((s) => ({ seekRequest: { to, token: (s.seekRequest?.token ?? 0) + 1 }, position: to })),
  setVolume: (v) => set({ volume: Math.min(1, Math.max(0, v)), muted: false }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  toggleQueue: () => set((s) => ({ queueOpen: !s.queueOpen })),
  retry: () => set((s) => ({ reloadToken: s.reloadToken + 1, playing: true })),
  _report: (p) => set(p),
}));

export const useCurrentTrack = () => usePlayer((s) => currentTrack(s.queue));
export { currentTrack };
export const getPlayer = () => usePlayer.getState();
