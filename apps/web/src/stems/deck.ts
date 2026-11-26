'use client';
/**
 * Playback of karaoke made on this device: the backing and the vocal from one recording, started together on one
 * Web Audio clock, so they can never drift apart. It speaks the YouTube player API (main = backing, guide = vocal)
 * so the video Stage (lyrics, scoring, mix sliders, party mode) runs on it unchanged.
 */
import type { YTPlayer } from '@/player/youtube';
import type { Stems } from './separate';

const ENDED = 0, PLAYING = 1, PAUSED = 2, CUED = 5;

export class StemDeck {
  readonly ctx: AudioContext;
  private buffers: { backing: AudioBuffer; vocals: AudioBuffer };
  private gains: { backing: GainNode; vocals: GainNode };
  private vol = { backing: 1, vocals: 1 };
  private muted = { backing: false, vocals: false };
  private sources: AudioBufferSourceNode[] = [];
  private playing = false;
  private started = false;
  private startedAt = 0;     // ctx time when play last started
  private from = 0;          // song seconds at that moment
  readonly duration: number;
  readonly backing: YTPlayer;
  readonly vocals: YTPlayer;

  constructor(stems: Stems) {
    this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: stems.rate });
    const make = (s: Stems['backing']) => {
      const b = this.ctx.createBuffer(2, s.left.length, stems.rate);
      b.copyToChannel(s.left as Float32Array<ArrayBuffer>, 0);
      b.copyToChannel(s.right as Float32Array<ArrayBuffer>, 1);
      return b;
    };
    this.buffers = { backing: make(stems.backing), vocals: make(stems.vocals) };
    this.gains = { backing: this.ctx.createGain(), vocals: this.ctx.createGain() };
    this.gains.backing.connect(this.ctx.destination);
    this.gains.vocals.connect(this.ctx.destination);
    this.duration = this.buffers.backing.duration;
    this.backing = this.facade('backing');
    this.vocals = this.facade('vocals');
  }

  position(): number {
    const t = this.playing ? this.from + (this.ctx.currentTime - this.startedAt) : this.from;
    return Math.min(t, this.duration);
  }
  private state(): number {
    if (this.playing) return this.position() >= this.duration ? ENDED : PLAYING;
    if (this.from >= this.duration - 0.01 && this.started) return ENDED;
    return this.started ? PAUSED : CUED;
  }

  play() {
    if (this.playing) return;
    void this.ctx.resume();
    if (this.from >= this.duration - 0.01) this.from = 0;
    const at = this.ctx.currentTime + 0.03;
    this.sources = (['backing', 'vocals'] as const).map((k) => {
      const s = this.ctx.createBufferSource();
      s.buffer = this.buffers[k];
      s.connect(this.gains[k]);
      s.start(at, this.from);
      return s;
    });
    this.sources[0]!.onended = () => { if (this.playing && this.position() >= this.duration - 0.05) { this.from = this.duration; this.playing = false; } };
    this.startedAt = at;
    this.playing = true;
    this.started = true;
  }
  pause() {
    if (!this.playing) return;
    this.from = this.position();
    this.playing = false;
    for (const s of this.sources) { s.onended = null; try { s.stop(); } catch { /* not started */ } }
    this.sources = [];
  }
  seek(t: number) {
    const was = this.playing;
    this.pause();
    this.from = Math.max(0, Math.min(t, this.duration));
    if (was) this.play();
  }
  private apply(k: 'backing' | 'vocals') { this.gains[k].gain.setTargetAtTime(this.muted[k] ? 0 : this.vol[k], this.ctx.currentTime, 0.02); }

  /** A YouTube-player face for one stem. Transport goes through the backing; the vocal just follows it. */
  private facade(k: 'backing' | 'vocals'): YTPlayer {
    const main = k === 'backing';
    return {
      playVideo: () => { if (main) this.play(); },
      pauseVideo: () => { if (main) this.pause(); },
      seekTo: (s: number) => { if (main) this.seek(s); },
      getCurrentTime: () => this.position(),
      getDuration: () => this.duration,
      getPlayerState: () => this.state(),
      setVolume: (v: number) => { this.vol[k] = Math.max(0, Math.min(100, v)) / 100; this.apply(k); },
      getVolume: () => Math.round(this.vol[k] * 100),
      mute: () => { this.muted[k] = true; this.apply(k); },
      unMute: () => { this.muted[k] = false; this.apply(k); },
      isMuted: () => this.muted[k],
      loadVideoById: () => {}, cueVideoById: () => {},
      destroy: () => { if (main) { this.pause(); void this.ctx.close(); } },
    };
  }
}
