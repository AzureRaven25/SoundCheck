/**
 * Pure queue logic for the SoundCheck player (no React, no audio): unit-tested in queue.test.ts.
 *
 * The queue keeps the user's order in `items`. Shuffle doesn't reorder `items`; it keeps a separate
 * play `order` (a permutation of indexes) so turning shuffle off returns to the original order at
 * the same song.
 */

export type RepeatMode = 'off' | 'all' | 'one';

export interface QueueTrack {
  id: string;
  title: string;
  artist: string;
  albumId: string | null;
  artworkUrl: string | null;
  durationMs: number | null;
  /** A direct full-length source that isn't in the catalog (e.g. the user's own music server). */
  stream?: { url: string; label: string };
}

export interface QueueState {
  items: QueueTrack[];
  order: number[];      // play order: indexes into items
  pos: number;          // position in `order` of the current song (-1 = nothing)
  shuffle: boolean;
  repeat: RepeatMode;
}

export const emptyQueue: QueueState = { items: [], order: [], pos: -1, shuffle: false, repeat: 'off' };

export function currentTrack(q: QueueState): QueueTrack | null {
  const i = q.order[q.pos];
  return i === undefined ? null : q.items[i] ?? null;
}

function shuffled(n: number, first: number, rand: () => number): number[] {
  const rest = [...Array(n).keys()].filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return first >= 0 ? [first, ...rest] : rest;
}

/** Replace the queue with `tracks` and start at `startIndex` (e.g. "play album from track 3"). */
export function playList(q: QueueState, tracks: QueueTrack[], startIndex = 0, rand = Math.random): QueueState {
  const start = Math.min(Math.max(startIndex, 0), tracks.length - 1);
  const order = q.shuffle ? shuffled(tracks.length, start, rand) : [...tracks.keys()];
  return { ...q, items: tracks, order, pos: tracks.length ? order.indexOf(start) : -1 };
}

/** Insert right after the current song ("Play next"). */
export function playNext(q: QueueState, track: QueueTrack): QueueState {
  const items = [...q.items, track];
  const newIndex = items.length - 1;
  const order = [...q.order];
  order.splice(q.pos + 1, 0, newIndex);
  return { ...q, items, order, pos: q.pos < 0 ? 0 : q.pos };
}

/** Append to the end ("Add to queue"). */
export function addToQueue(q: QueueState, track: QueueTrack): QueueState {
  const items = [...q.items, track];
  return { ...q, items, order: [...q.order, items.length - 1], pos: q.pos < 0 ? 0 : q.pos };
}

/** Advance after a song ends (`auto`) or on the Next button. Returns null pos (-1) when playback should stop. */
export function next(q: QueueState, auto = false): QueueState {
  if (!q.order.length) return q;
  if (auto && q.repeat === 'one') return { ...q };
  if (q.pos + 1 < q.order.length) return { ...q, pos: q.pos + 1 };
  if (q.repeat === 'all' || (!auto && q.repeat === 'one')) return { ...q, pos: 0 };
  return { ...q, pos: auto ? -1 : q.pos }; // end of queue: stop when it played out, stay on manual Next
}

/** Previous button: restart the song if more than 3 s in, otherwise go back one. */
export function previous(q: QueueState, positionSec: number): { state: QueueState; restart: boolean } {
  if (positionSec > 3 || q.pos <= 0) {
    if (q.pos <= 0 && q.repeat === 'all' && positionSec <= 3 && q.order.length > 1) {
      return { state: { ...q, pos: q.order.length - 1 }, restart: false };
    }
    return { state: q, restart: true };
  }
  return { state: { ...q, pos: q.pos - 1 }, restart: false };
}

export function jumpTo(q: QueueState, orderPos: number): QueueState {
  return orderPos >= 0 && orderPos < q.order.length ? { ...q, pos: orderPos } : q;
}

export function setShuffle(q: QueueState, on: boolean, rand = Math.random): QueueState {
  if (on === q.shuffle) return q;
  const current = q.order[q.pos] ?? -1;
  if (on) {
    const order = shuffled(q.items.length, current, rand);
    return { ...q, shuffle: true, order, pos: current >= 0 ? 0 : -1 };
  }
  const order = [...q.items.keys()];
  return { ...q, shuffle: false, order, pos: current >= 0 ? current : -1 };
}

export function cycleRepeat(mode: RepeatMode): RepeatMode {
  return mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off';
}

/** Remove the song at play-order position `orderPos` (not the current one). */
export function removeAt(q: QueueState, orderPos: number): QueueState {
  if (orderPos === q.pos || orderPos < 0 || orderPos >= q.order.length) return q;
  const removed = q.order[orderPos]!;
  const items = q.items.filter((_, i) => i !== removed);
  const order = q.order.filter((_, i) => i !== orderPos).map((i) => (i > removed ? i - 1 : i));
  return { ...q, items, order, pos: orderPos < q.pos ? q.pos - 1 : q.pos };
}

/** Songs still to come, in play order. */
export function upNext(q: QueueState): { track: QueueTrack; orderPos: number }[] {
  return q.order.slice(q.pos + 1).map((i, k) => ({ track: q.items[i]!, orderPos: q.pos + 1 + k }));
}
