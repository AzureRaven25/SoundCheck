import { AudioPlayer, AudioStatus, createAudioPlayer, setAudioModeAsync } from 'expo-audio';

import { api } from '../api';
import type { KaraokeEngine, PlayMode } from './engine';

type Listenable = { addListener(event: 'playbackStatusUpdate', cb: (s: AudioStatus) => void): { remove(): void } };

/**
 * Interim TV engine on expo-audio: two synced players (instrumental + vocals)
 * for karaoke mode, one for original mode. No key change yet; that needs the
 * native C++ engine (Oboe + Signalsmith Stretch) from docs/PLAN.md §5.3.
 */
class NativeEngine implements KaraokeEngine {
  readonly supportsKeyShift = false;
  private inst: AudioPlayer | null = null;
  private vocals: AudioPlayer | null = null;
  private original: AudioPlayer | null = null;
  private mode: PlayMode = 'karaoke';
  private guide = 0;
  private playing = false;
  private endedCb: (() => void) | null = null;

  async load(bundleId: string, onProgress?: (fraction: number) => void) {
    await setAudioModeAsync({ playsInSilentMode: true });
    this.inst = createAudioPlayer({ uri: api.audioUrl(bundleId, 'instrumental') });
    this.vocals = createAudioPlayer({ uri: api.audioUrl(bundleId, 'vocals') });
    this.original = createAudioPlayer({ uri: api.audioUrl(bundleId, 'original') });
    for (const p of [this.inst, this.original]) {
      // AudioPlayer is a SharedObject; its event typings don't surface addListener here.
      (p as unknown as Listenable).addListener('playbackStatusUpdate', (s) => {
        if (s.didJustFinish && this.main() === p) {
          this.playing = false;
          this.endedCb?.();
        }
      });
    }
    // Wait until the instrumental knows its duration (i.e. is loaded).
    const start = Date.now();
    while (!(this.inst.duration > 0) && Date.now() - start < 15000) {
      onProgress?.(Math.min(0.9, (Date.now() - start) / 4000));
      await new Promise((r) => setTimeout(r, 100));
    }
    onProgress?.(1);
    this.applyVolumes();
  }

  private main(): AudioPlayer | null {
    return this.mode === 'original' ? this.original : this.inst;
  }

  private applyVolumes() {
    if (this.vocals) this.vocals.volume = this.mode === 'karaoke' ? this.guide : 0;
  }

  play() {
    if (this.mode === 'original') this.original?.play();
    else {
      this.inst?.play();
      this.vocals?.play();
    }
    this.playing = true;
  }

  pause() {
    this.inst?.pause();
    this.vocals?.pause();
    this.original?.pause();
    this.playing = false;
  }

  isPlaying() {
    return this.playing;
  }

  seek(seconds: number) {
    for (const p of [this.inst, this.vocals, this.original]) void p?.seekTo(seconds);
  }

  currentTime() {
    return this.main()?.currentTime ?? 0;
  }

  duration() {
    return this.inst?.duration ?? 0;
  }

  setMode(mode: PlayMode) {
    if (mode === this.mode) return;
    const t = this.currentTime();
    const wasPlaying = this.playing;
    this.pause();
    this.mode = mode;
    this.seek(t);
    this.applyVolumes();
    if (wasPlaying) this.play();
  }

  setGuide(level: number) {
    this.guide = Math.max(0, Math.min(1, level));
    this.applyVolumes();
  }

  setKeyShift() {
    /* not supported until the native engine lands */
  }

  setTempo(rate: number) {
    for (const p of [this.inst, this.vocals, this.original]) p?.setPlaybackRate(rate, 'high');
  }

  onEnded(cb: () => void) {
    this.endedCb = cb;
  }

  dispose() {
    for (const p of [this.inst, this.vocals, this.original]) p?.remove();
    this.inst = this.vocals = this.original = null;
  }
}

export function createEngine(): KaraokeEngine {
  return new NativeEngine();
}
