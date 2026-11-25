'use client';
/**
 * Singing along to YouTube: one clock for the lyrics, driven by the visible video the singer chose (a karaoke
 * version, or the original), plus an optional second visible player with the original recording as a guide
 * vocal, kept in step with it. Both are YouTube's own players: their audio is never captured or processed, so the
 * guide level is simply that player's volume.
 *
 * Offsets (seconds): video time = lyrics time + offset. A video with a 7 s title card has offset 7.
 */
import type { YTPlayer } from '@/player/youtube';

const PLAYING = 1, BUFFERING = 3;

export class VideoClock {
  main: YTPlayer | null = null;
  guide: YTPlayer | null = null;
  mainOffset = 0;
  guideOffset = 0;
  private anchor = { yt: 0, at: 0, playing: false };
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSeek = 0;
  /** Called when the main video starts, pauses or ends (so a party's phones can follow). */
  onState: ((s: 'playing' | 'paused' | 'ended') => void) | null = null;
  private lastState: number | null = null;

  start() {
    this.stop();
    this.timer = setInterval(() => this.tick(), 200);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Video seconds of the main player, smoothed between the API's coarse updates. */
  videoTime(): number {
    const a = this.anchor;
    return a.playing ? a.yt + (performance.now() - a.at) / 1000 : a.yt;
  }
  /** Song (lyrics) seconds. */
  lyricTime(): number { return this.videoTime() - this.mainOffset; }
  isPlaying(): boolean { return this.anchor.playing; }

  private tick() {
    const m = this.main;
    if (!m?.getCurrentTime) return;
    let yt: number, state: number;
    try { yt = m.getCurrentTime(); state = m.getPlayerState(); } catch { return; }
    const playing = state === PLAYING;
    const predicted = this.videoTime();
    // re-anchor only on a real jump (seek, buffering, pause); small differences are API granularity
    if (!playing || !this.anchor.playing || Math.abs(predicted - yt) > 0.12) this.anchor = { yt, at: performance.now(), playing };
    if (state !== this.lastState) {
      this.lastState = state;
      if (state === PLAYING) this.onState?.('playing');
      else if (state === 2) this.onState?.('paused');
      else if (state === 0) this.onState?.('ended');
    }
    this.syncGuide(playing, state === BUFFERING);
  }

  private syncGuide(playing: boolean, buffering: boolean) {
    const g = this.guide;
    if (!g?.getCurrentTime) return;
    try {
      const gs = g.getPlayerState();
      if (!playing) {
        if (gs === PLAYING && !buffering) g.pauseVideo();
        return;
      }
      const target = this.lyricTime() + this.guideOffset;
      if (target < 0) { if (gs === PLAYING) g.pauseVideo(); return; }
      if (gs !== PLAYING && gs !== BUFFERING) g.playVideo();
      const drift = g.getCurrentTime() - target;
      // seeking stutters, so allow a little drift and don't re-seek while the last seek is still settling
      if (Math.abs(drift) > 0.2 && performance.now() - this.lastSeek > 1500) {
        this.lastSeek = performance.now();
        g.seekTo(target + 0.15, true);
      }
    } catch { /* player not ready */ }
  }

  play() { this.main?.playVideo(); }
  pause() { this.main?.pauseVideo(); this.guide?.pauseVideo(); }
  /** Seek both to a song time (seconds). */
  seekLyric(t: number) {
    this.main?.seekTo(Math.max(0, t + this.mainOffset), true);
    this.anchor = { yt: Math.max(0, t + this.mainOffset), at: performance.now(), playing: this.anchor.playing };
    if (this.guide) this.guide.seekTo(Math.max(0, t + this.guideOffset), true);
  }
}
