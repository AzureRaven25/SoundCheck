import { describe, expect, it, vi } from 'vitest';
import type { YTPlayer } from '@/player/youtube';
import { VideoClock } from './videoClock';

/** A fake YouTube player: state 1 = playing, 0 = ended. */
function fake(duration: number, at: number, state: number) {
  const p = {
    t: at, state, vol: 100, muted: false,
    getCurrentTime: () => p.t, getDuration: () => duration, getPlayerState: () => p.state,
    playVideo: vi.fn(() => { p.state = 1; }), pauseVideo: vi.fn(() => { p.state = 2; }), seekTo: vi.fn((s: number) => { p.t = s; }),
    setVolume: vi.fn((v: number) => { p.vol = v; }), mute: vi.fn(() => { p.muted = true; }), unMute: vi.fn(() => { p.muted = false; }),
    getVolume: () => p.vol, isMuted: () => p.muted, loadVideoById: vi.fn(), cueVideoById: vi.fn(), destroy: vi.fn(),
  };
  return p;
}
const tick = (c: VideoClock) => (c as unknown as { tick: () => void }).tick();

describe('VideoClock handoff', () => {
  it('when the karaoke video ends early, the original takes over and the song keeps going', () => {
    const c = new VideoClock();
    const karaoke = fake(170, 170, 0), original = fake(184, 168, 1);     // karaoke cut before the outro
    c.main = karaoke as unknown as YTPlayer; c.guide = original as unknown as YTPlayer;
    c.mainOffset = 2; c.guideOffset = 0;
    const ended = vi.fn(), handoff = vi.fn();
    c.onState = (s) => { if (s === 'ended') ended(); };
    c.onHandoff = handoff;
    tick(c);
    expect(handoff).toHaveBeenCalledOnce();
    expect(ended).not.toHaveBeenCalled();
    expect(c.main).toBe(original);
    expect(c.guide).toBeNull();
    expect(c.lyricTime()).toBeCloseTo(168, 0);       // lyrics continue from the original's position
    original.state = 0; original.t = 184;            // now the real end
    tick(c);
    expect(ended).toHaveBeenCalledOnce();
  });

  it('ends normally when the original has nothing left either', () => {
    const c = new VideoClock();
    c.main = fake(190, 190, 0) as unknown as YTPlayer; c.guide = fake(184, 183.5, 1) as unknown as YTPlayer;
    const ended = vi.fn();
    c.onState = (s) => { if (s === 'ended') ended(); };
    tick(c);
    expect(ended).toHaveBeenCalledOnce();
  });
});
