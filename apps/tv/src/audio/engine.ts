/**
 * Playback engine for a song bundle.
 *
 * Karaoke mode plays the instrumental with the isolated vocal mixed back in at
 * `guide` level (0 = full karaoke, 1 = original vocal level). Original mode
 * plays the untouched original file.
 *
 * Implementations: engine.web.ts (Web Audio + SoundTouch, real-time key change)
 * and engine.native.ts (expo-audio; key change arrives with the native C++ engine).
 */
export type PlayMode = 'karaoke' | 'original';

export interface KaraokeEngine {
  readonly supportsKeyShift: boolean;
  load(bundleId: string, onProgress?: (fraction: number) => void): Promise<void>;
  play(): void;
  pause(): void;
  isPlaying(): boolean;
  seek(seconds: number): void;
  /** Seconds into the song that are audible right now (output latency compensated). */
  currentTime(): number;
  duration(): number;
  setMode(mode: PlayMode): void;
  setGuide(level: number): void;
  setKeyShift(semitones: number): void;
  setTempo(rate: number): void;
  onEnded(cb: () => void): void;
  dispose(): void;
}

export { createEngine } from './createEngine';
