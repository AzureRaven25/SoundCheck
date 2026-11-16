import { getWebAudioNode, SimpleFilter, SoundTouch } from 'soundtouchjs';

import { api, Stem } from '../api';
import type { KaraokeEngine, PlayMode } from './engine';

const BUFFER_SIZE = 4096;

class WebEngine implements KaraokeEngine {
  readonly supportsKeyShift = true;
  private ctx: AudioContext | null = null;
  private buffers: Partial<Record<Stem, AudioBuffer>> = {};
  private st = new SoundTouch();
  private filter: SimpleFilter | null = null;
  private node: ScriptProcessorNode | null = null;
  private mode: PlayMode = 'karaoke';
  private guide = 0;
  private tempo = 1;
  private playing = false;
  private ended = false;
  private baseFrame = 0;
  private basePos = 0;
  private endedCb: (() => void) | null = null;

  async load(bundleId: string, onProgress?: (fraction: number) => void) {
    this.ctx = new AudioContext();
    const stems: Stem[] = ['instrumental', 'vocals', 'original'];
    let done = 0;
    await Promise.all(
      stems.map(async (stem) => {
        try {
          const res = await fetch(api.audioUrl(bundleId, stem));
          if (!res.ok) throw new Error(String(res.status));
          this.buffers[stem] = await this.ctx!.decodeAudioData(await res.arrayBuffer());
        } catch (e) {
          if (stem === 'instrumental') throw new Error(`could not load instrumental: ${e}`);
        } finally {
          onProgress?.(++done / stems.length);
        }
      }),
    );
    this.filter = new SimpleFilter({ extract: (t, n, p) => this.mix(t, n, p) }, this.st, () => this.handleEnd());
    this.node = getWebAudioNode(this.ctx, this.filter, undefined, BUFFER_SIZE);
  }

  private active(): AudioBuffer {
    return (this.mode === 'original' && this.buffers.original) || this.buffers.instrumental!;
  }

  /** Feeds SoundTouch: interleaved stereo frames from the current mix, starting at `position`. */
  private mix(target: Float32Array, numFrames: number, position: number): number {
    const main = this.active();
    const n = Math.max(0, Math.min(numFrames, main.length - position));
    const l = main.getChannelData(0);
    const r = main.numberOfChannels > 1 ? main.getChannelData(1) : l;
    const voc = this.mode === 'karaoke' && this.guide > 0 ? this.buffers.vocals : undefined;
    const vl = voc?.getChannelData(0);
    const vr = voc && voc.numberOfChannels > 1 ? voc.getChannelData(1) : vl;
    const vlen = voc?.length ?? 0;
    for (let i = 0; i < n; i++) {
      const j = position + i;
      let a = l[j];
      let b = r[j];
      if (vl && vr && j < vlen) {
        a += vl[j] * this.guide;
        b += vr[j] * this.guide;
      }
      target[i * 2] = a;
      target[i * 2 + 1] = b;
    }
    return n;
  }

  private handleEnd() {
    if (this.ended) return;
    this.ended = true;
    this.pause();
    this.endedCb?.();
  }

  play() {
    if (!this.ctx || !this.node || this.playing) return;
    if (this.ended) this.seek(0);
    void this.ctx.resume();
    this.node.connect(this.ctx.destination);
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.node?.disconnect();
    this.playing = false;
  }

  isPlaying() {
    return this.playing;
  }

  private sampleRate() {
    return this.ctx?.sampleRate ?? 44100;
  }

  private sourceFrame(): number {
    if (!this.filter) return 0;
    return this.baseFrame + (this.filter.position - this.basePos) * this.tempo;
  }

  currentTime() {
    if (!this.filter || !this.ctx) return 0;
    const sr = this.sampleRate();
    const latency = this.playing ? BUFFER_SIZE / sr + (this.ctx.outputLatency || this.ctx.baseLatency || 0) : 0;
    return Math.max(0, Math.min(this.duration(), this.sourceFrame() / sr - latency * this.tempo));
  }

  duration() {
    const b = this.buffers.instrumental;
    return b ? b.length / b.sampleRate : 0;
  }

  seek(seconds: number) {
    if (!this.filter) return;
    const frame = Math.max(0, Math.min(Math.floor(seconds * this.sampleRate()), this.active().length - 1));
    this.filter.sourcePosition = frame; // also flushes SoundTouch buffers
    this.baseFrame = frame;
    this.basePos = this.filter.position;
    this.ended = false;
  }

  setMode(mode: PlayMode) {
    if (mode === this.mode) return;
    const t = this.currentTime();
    this.mode = mode;
    this.seek(t);
  }

  setGuide(level: number) {
    this.guide = Math.max(0, Math.min(1, level));
  }

  setKeyShift(semitones: number) {
    this.st.pitchSemitones = semitones;
  }

  setTempo(rate: number) {
    const frame = this.sourceFrame();
    this.tempo = rate;
    this.st.tempo = rate;
    this.baseFrame = frame;
    this.basePos = this.filter?.position ?? 0;
  }

  onEnded(cb: () => void) {
    this.endedCb = cb;
  }

  dispose() {
    this.pause();
    this.node = null;
    this.filter = null;
    void this.ctx?.close();
    this.ctx = null;
    this.buffers = {};
  }
}

export function createEngine(): KaraokeEngine {
  return new WebEngine();
}
