import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/realtime/clock_sync.json';
import { channelName, clockOffset, isSessionEvent, songPositionAt, type ClockPongEvent, type TransportEvent } from '../src/realtime';

describe('realtime protocol', () => {
  it('derives clock offset and RTT (golden fixture)', () => {
    const r = clockOffset(fixture.pong as ClockPongEvent, fixture.t3);
    expect(r.offsetMs).toBeCloseTo(fixture.expected.offsetMs, 6);
    expect(r.rttMs).toBeCloseTo(fixture.expected.rttMs, 6);
  });

  it('projects song position on the phone (golden fixture)', () => {
    const { offsetMs } = clockOffset(fixture.pong as ClockPongEvent, fixture.t3);
    expect(songPositionAt(fixture.transport as TransportEvent, fixture.phoneNowMs, offsetMs)).toBeCloseTo(fixture.expectedSongPos, 6);
  });

  it('holds position when not playing', () => {
    const paused = { ...(fixture.transport as TransportEvent), state: 'paused' as const };
    expect(songPositionAt(paused, fixture.phoneNowMs + 99999, 0)).toBe(12.5);
  });

  it('names channels and validates events', () => {
    expect(channelName('abc')).toBe('session:abc');
    expect(isSessionEvent(fixture.transport)).toBe(true);
    expect(isSessionEvent({ type: 'transport', v: 2 })).toBe(false);
    expect(isSessionEvent(null)).toBe(false);
  });
});
