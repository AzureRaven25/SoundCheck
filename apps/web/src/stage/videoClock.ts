'use client';
/**
 * Singing along to YouTube: one clock for the lyrics, driven by the visible video the singer chose (a karaoke
 * version, or the original), plus an optional second visible player with the original recording as a guide
 * vocal, kept in step with it. Both are YouTube's own players: their audio is never captured or processed, so the
 * guide level is simply that player's volume. (Auto sync, in autoSync.ts, listens to them through the mic.)
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
  /** While auto sync plays the videos itself: no guide syncing, no state events, no handoff. */
  hold = false;
  private anchor = { yt: 0, at: 0, playing: false };
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSeek = 0;
  /** recent corrective seeks of the guide (ms timestamps): many means this pair of videos doesn't line up */
  private seeks: number[] = [];
  /** guide volume 0–1, owned here so a correction can dip it without fighting the slider */
  private guideVol = 0.25;
  private dipped = false;
  /** Called when the main video starts, pauses or ends (so a party's phones can follow). */
  onState: ((s: 'playing' | 'paused' | 'ended') => void) | null = null;
  /** The backing video ended before the song did (a karaoke cut that drops the outro): the original took over. */
  onHandoff: ((player: YTPlayer) => void) | null = null;
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
    if (this.hold) return;
    const m = this.main;
    if (!m?.getCurrentTime) return;
    let yt: number, state: number;
    try { yt = m.getCurrentTime(); state = m.getPlayerState(); } catch { return; }
    const playing = state === PLAYING;
    const predicted = this.videoTime();
    // re-anchor only on a real jump (seek, buffering, pause); small differences are API granularity
    if (!playing || !this.anchor.playing || Math.abs(predicted - yt) > 0.12) this.anchor = { yt, at: performance.now(), playing };
    if (state === 0 && this.handoff()) return;
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
      // seeking stutters: allow a little drift, don't re-seek while the last seek settles, and fade the guide out
      // across the jump so it's heard as a short gap rather than a glitch
      if (Math.abs(drift) > 0.18 && performance.now() - this.lastSeek > 1500) {
        const now = performance.now();
        this.lastSeek = now;
        this.seeks = [...this.seeks.filter((x) => now - x < 30_000), now];
        if (this.guideVol > 0) { g.mute(); this.dipped = true; }
        g.seekTo(target + 0.12, true);
        setTimeout(() => { if (this.dipped) { this.dipped = false; this.applyGuideVolume(); } }, 450);
      }
    } catch { /* player not ready */ }
  }

  /**
   * When the backing ends but the original (guide) still has song left, keep going on the original so the singer
   * reaches the real end (outros, ad-libs). Returns true when it took over.
   */
  private handoff(): boolean {
    const g = this.guide;
    if (!g?.getDuration) return false;
    try {
      const left = g.getDuration() - g.getCurrentTime();
      if (!(left > 1.5)) return false;
      this.main = g;
      this.mainOffset = this.guideOffset;
      this.guide = null;
      this.anchor = { yt: g.getCurrentTime(), at: performance.now(), playing: true };
      if (g.getPlayerState() !== PLAYING) g.playVideo();
      this.onHandoff?.(g);
      return true;
    } catch { return false; }
  }

  setGuideVolume(v: number) { this.guideVol = v; if (!this.dipped) this.applyGuideVolume(); }
  private applyGuideVolume() {
    const g = this.guide;
    if (!g?.setVolume) return;
    try { if (this.guideVol <= 0) g.mute(); else { g.unMute(); g.setVolume(Math.round(this.guideVol * 100)); } } catch { /* not ready */ }
  }
  /** Corrections in the last 30 s: 3+ means the two videos have different timing (a re-recorded karaoke track). */
  driftCorrections(): number { const now = performance.now(); return this.seeks.filter((x) => now - x < 30_000).length; }
  resetDrift() { this.seeks = []; }

  play() { this.main?.playVideo(); }
  pause() { this.main?.pauseVideo(); this.guide?.pauseVideo(); }
  /** Seek both to a song time (seconds). */
  seekLyric(t: number) {
    this.main?.seekTo(Math.max(0, t + this.mainOffset), true);
    this.anchor = { yt: Math.max(0, t + this.mainOffset), at: performance.now(), playing: this.anchor.playing };
    if (this.guide) this.guide.seekTo(Math.max(0, t + this.guideOffset), true);
  }
}
