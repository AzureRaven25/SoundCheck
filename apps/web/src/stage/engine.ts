'use client';
/**
 * SoundCheck Stage audio engine (web): instrumental + isolated vocal, each through a Signalsmith
 * Stretch node (MIT, WASM AudioWorklet) so the key can change live without changing tempo, and a
 * gain per stem for the guide-vocal slider. Song position comes from the stretch node's input
 * clock, so lyrics and scoring follow exactly what is heard.
 */
type StretchNode = AudioNode & {
  inputTime: number;
  addBuffers: (chans: Float32Array[]) => Promise<number>;
  schedule: (o: { output?: number; active?: boolean; input?: number; rate?: number; semitones?: number }) => void;
  setUpdateInterval: (s: number, cb?: (t: number) => void) => void;
  latency: () => number;
};

export class StageEngine {
  readonly ctx = new AudioContext({ latencyHint: 'interactive' }); // shared with the mic: one clock for playback and capture
  private inst!: StretchNode;
  private voc!: StretchNode;
  private instGain = this.ctx.createGain();
  private vocGain = this.ctx.createGain();
  private semitones = 0;
  private playing = false;
  private startedAt = 0;      // ctx time when play() last started
  private startedFrom = 0;    // song seconds at that moment
  duration = 0;
  onEnded: (() => void) | null = null;

  async load(instrumentalUrl: string, vocalsUrl: string, onProgress?: (f: number) => void) {
    // Loaded unbundled from /public (see scripts/vendor-stretch.mjs): the library ships its worklet as
    // its own serialised source, which bundler-injected helpers would break.
    const { default: SignalsmithStretch } = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ '/vendor/signalsmith-stretch.mjs' as string)) as {
      default: (ctx: BaseAudioContext, o?: AudioWorkletNodeOptions) => Promise<AudioWorkletNode>;
    };
    let done = 0;
    const fetchDecode = async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`audio ${res.status}`);
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      onProgress?.(++done / 4);
      return buf;
    };
    const [ib, vb] = await Promise.all([fetchDecode(instrumentalUrl), fetchDecode(vocalsUrl)]);
    this.duration = ib.duration;
    const chans = (b: AudioBuffer) => [b.getChannelData(0), b.numberOfChannels > 1 ? b.getChannelData(1) : b.getChannelData(0)];
    this.inst = (await SignalsmithStretch(this.ctx, { numberOfInputs: 0, outputChannelCount: [2] })) as unknown as StretchNode;
    this.voc = (await SignalsmithStretch(this.ctx, { numberOfInputs: 0, outputChannelCount: [2] })) as unknown as StretchNode;
    await Promise.all([this.inst.addBuffers(chans(ib)), this.voc.addBuffers(chans(vb))]);
    onProgress?.(1);
    this.inst.connect(this.instGain).connect(this.ctx.destination);
    this.voc.connect(this.vocGain).connect(this.ctx.destination);
    this.vocGain.gain.value = 0;
  }

  /** Song position in seconds (what is audible now). */
  position(): number {
    if (!this.playing) return this.startedFrom;
    return Math.min(this.duration, this.startedFrom + (this.ctx.currentTime - this.startedAt));
  }

  isPlaying() { return this.playing; }

  async play(from = this.position()) {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const at = this.ctx.currentTime + 0.05;
    const o = { output: at, active: true, input: from, rate: 1, semitones: this.semitones };
    this.inst.schedule(o);
    this.voc.schedule(o);
    this.startedAt = at;
    this.startedFrom = from;
    this.playing = true;
    this.watchEnd();
  }

  pause() {
    const pos = this.position();
    const o = { output: this.ctx.currentTime, active: false };
    this.inst.schedule(o);
    this.voc.schedule(o);
    this.startedFrom = pos;
    this.playing = false;
  }

  seek(to: number) {
    const t = Math.max(0, Math.min(this.duration - 0.05, to));
    if (this.playing) void this.play(t);
    else this.startedFrom = t;
  }

  setKey(semitones: number) {
    this.semitones = semitones;
    if (!this.playing) return;
    const pos = this.position();
    void this.play(pos); // re-schedule from here with the new pitch (keeps both stems aligned)
  }

  /** 0 = pure karaoke, 1 = original vocal level. */
  setGuide(level: number) {
    this.vocGain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)), this.ctx.currentTime, 0.05);
  }

  setVolume(v: number) {
    this.instGain.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.05);
  }

  private endTimer: ReturnType<typeof setInterval> | null = null;
  private watchEnd() {
    if (this.endTimer) clearInterval(this.endTimer);
    this.endTimer = setInterval(() => {
      if (this.playing && this.position() >= this.duration - 0.05) {
        this.pause();
        this.startedFrom = this.duration;
        if (this.endTimer) clearInterval(this.endTimer);
        this.onEnded?.();
      }
    }, 200);
  }

  dispose() {
    if (this.endTimer) clearInterval(this.endTimer);
    void this.ctx.close();
  }
}
