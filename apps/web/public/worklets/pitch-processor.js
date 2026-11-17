/**
 * SoundCheck pitch detector (AudioWorklet): YIN on a 16 kHz downsampled mono signal.
 * Every 10 ms posts [frameIndex, f0Hz (0 = unvoiced), confidence 0–1, rmsDb] to the main thread.
 * Window 1024 samples @16 kHz (64 ms) resolves down to ~60 Hz; lags cover 60–1000 Hz.
 * Kept dependency-free so the same file serves the TV/host page and the phone /join page.
 */
class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.decim = Math.max(1, Math.round(sampleRate / 16000));
    this.sr = sampleRate / this.decim;
    this.win = 1024;
    this.hop = Math.round(this.sr * 0.01);
    this.minLag = Math.floor(this.sr / 1000);
    this.maxLag = Math.min(this.win - 2, Math.ceil(this.sr / 60));
    this.buf = new Float32Array(this.win * 2);
    this.len = 0;
    this.sinceHop = 0;
    this.frame = 0;
    this.acc = 0; this.accN = 0; this.lp = 0;          // decimation (boxcar + one-pole low-pass)
    this.diff = new Float32Array(this.maxLag + 1);
  }

  push(x) {
    if (this.len === this.buf.length) {               // keep the latest window
      this.buf.copyWithin(0, this.buf.length - this.win);
      this.len = this.win;
    }
    this.buf[this.len++] = x;
    if (++this.sinceHop >= this.hop && this.len >= this.win) {
      this.sinceHop = 0;
      this.analyse(this.buf.subarray(this.len - this.win, this.len));
    }
  }

  analyse(x) {
    const W = this.win, d = this.diff;
    let energy = 0;
    for (let i = 0; i < W; i++) energy += x[i] * x[i];
    const rmsDb = 10 * Math.log10(energy / W + 1e-12);
    // YIN difference + cumulative mean normalised difference
    const half = W - this.maxLag;
    d[0] = 1;
    let running = 0;
    let tau = -1;
    for (let lag = 1; lag <= this.maxLag; lag++) {
      let s = 0;
      for (let i = 0; i < half; i++) { const v = x[i] - x[i + lag]; s += v * v; }
      running += s;
      d[lag] = running > 0 ? (s * lag) / running : 1;
    }
    for (let lag = this.minLag; lag < this.maxLag; lag++) {
      if (d[lag] < 0.15) {
        while (lag + 1 < this.maxLag && d[lag + 1] < d[lag]) lag++;
        tau = lag;
        break;
      }
    }
    let f0 = 0, conf = 0;
    if (tau > 0 && rmsDb > -70) {
      const a = d[tau - 1], b = d[tau], c = d[tau + 1];
      const den = a + c - 2 * b;
      const t = den !== 0 ? tau + (a - c) / (2 * den) : tau;   // parabolic interpolation
      f0 = this.sr / t;
      conf = Math.max(0, Math.min(1, 1 - b));
    }
    this.port.postMessage([this.frame++, f0, conf, rmsDb]);
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.lp += 0.35 * (ch[i] - this.lp);
        this.acc += this.lp;
        if (++this.accN === this.decim) { this.push(this.acc / this.decim); this.acc = 0; this.accN = 0; }
      }
    }
    return true;
  }
}
registerProcessor('soundcheck-pitch', PitchProcessor);
