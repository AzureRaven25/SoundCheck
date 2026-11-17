import { describe, expect, it } from 'vitest';
import {
  addToQueue, currentTrack, cycleRepeat, emptyQueue, jumpTo, next, playList, playNext, previous, removeAt,
  setShuffle, upNext, type QueueTrack,
} from './queue';

const t = (id: string): QueueTrack => ({ id, title: id, artist: 'a', albumId: null, artworkUrl: null, durationMs: 1000 });
const abc = [t('a'), t('b'), t('c')];
const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]!; };

describe('queue', () => {
  it('plays a list from a start index and advances', () => {
    let q = playList(emptyQueue, abc, 1);
    expect(currentTrack(q)?.id).toBe('b');
    q = next(q, true);
    expect(currentTrack(q)?.id).toBe('c');
    q = next(q, true);
    expect(q.pos).toBe(-1);                       // played out with repeat off -> stop
    expect(currentTrack(q)).toBeNull();
  });

  it('manual Next at the end stays put; repeat all wraps; repeat one repeats on auto only', () => {
    let q = playList(emptyQueue, abc, 2);
    expect(currentTrack(next(q))?.id).toBe('c');
    q = { ...q, repeat: 'all' };
    expect(currentTrack(next(q, true))?.id).toBe('a');
    q = { ...playList(emptyQueue, abc, 0), repeat: 'one' };
    expect(currentTrack(next(q, true))?.id).toBe('a');
    expect(currentTrack(next(q))?.id).toBe('b');
  });

  it('previous restarts after 3 s, otherwise steps back', () => {
    const q = playList(emptyQueue, abc, 1);
    expect(previous(q, 10).restart).toBe(true);
    const r = previous(q, 1);
    expect(r.restart).toBe(false);
    expect(currentTrack(r.state)?.id).toBe('a');
    expect(previous(playList(emptyQueue, abc, 0), 1).restart).toBe(true);
  });

  it('shuffle keeps the current song first and restores original order when turned off', () => {
    let q = playList(emptyQueue, [t('a'), t('b'), t('c'), t('d')], 2);
    q = setShuffle(q, true, seq(0.1, 0.9, 0.5));
    expect(currentTrack(q)?.id).toBe('c');
    expect(q.pos).toBe(0);
    expect([...q.order].sort()).toEqual([0, 1, 2, 3]);
    q = next(q);
    const playing = currentTrack(q)!.id;
    q = setShuffle(q, false);
    expect(currentTrack(q)?.id).toBe(playing);
    expect(q.order).toEqual([0, 1, 2, 3]);
  });

  it('play next / add to queue / remove / jump', () => {
    let q = playList(emptyQueue, abc, 0);
    q = playNext(q, t('x'));
    q = addToQueue(q, t('z'));
    expect(upNext(q).map((u) => u.track.id)).toEqual(['x', 'b', 'c', 'z']);
    q = removeAt(q, 2);                            // remove 'b'
    expect(upNext(q).map((u) => u.track.id)).toEqual(['x', 'c', 'z']);
    expect(currentTrack(q)?.id).toBe('a');
    q = jumpTo(q, 3);
    expect(currentTrack(q)?.id).toBe('z');
    expect(removeAt(q, q.pos)).toBe(q);            // can't remove the current song
  });

  it('adding to an empty queue starts it', () => {
    expect(currentTrack(addToQueue(emptyQueue, t('a')))?.id).toBe('a');
  });

  it('cycles repeat modes', () => {
    expect([cycleRepeat('off'), cycleRepeat('all'), cycleRepeat('one')]).toEqual(['all', 'one', 'off']);
  });
});
