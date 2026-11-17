'use client';
/**
 * Microphone capture → pitch frames (shared by solo Stage on the host and the phone /join page).
 * Uses the browser's echo cancellation / noise suppression (docs/RESEARCH.md §7) and the YIN worklet.
 */

export interface PitchFrame { f0: number; conf: number; rmsDb: number; at: number /* performance.now() ms */ }

export interface MicHandle {
  stop: () => void;
  /** Measure the room for `ms` (user silent). Returns the noise floor in dBFS. */
  calibrate: (ms?: number) => Promise<number>;
  context: AudioContext;
  /** Output latency estimate of this device's audio stack (ms), for clock alignment. */
  inputLatencyMs: number;
  /** The processed mic stream (echo cancellation, noise suppression): also sent to the TV for voice monitoring. */
  stream: MediaStream;
}

/**
 * `shared`: pass the page's existing AudioContext (created and resumed inside the user's click).
 * A context created later, after awaits, has lost the click's user activation and its resume()
 * can hang until the next gesture.
 */
export async function startMic(onFrame: (f: PitchFrame) => void, shared?: AudioContext): Promise<MicHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const ctx = shared ?? new AudioContext({ latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule('/worklets/pitch-processor.js');
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'soundcheck-pitch', { numberOfInputs: 1, numberOfOutputs: 0 });
  let listeners: ((f: PitchFrame) => void)[] = [onFrame];
  node.port.onmessage = (e: MessageEvent<[number, number, number, number]>) => {
    const [, f0, conf, rmsDb] = e.data;
    const frame = { f0, conf, rmsDb, at: performance.now() };
    for (const l of listeners) l(frame);
  };
  src.connect(node);
  if (ctx.state === 'suspended') await ctx.resume();
  const settings = stream.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number };
  return {
    stream,
    context: ctx,
    inputLatencyMs: Math.round(((settings?.latency ?? 0) + ctx.baseLatency) * 1000),
    stop: () => {
      listeners = [];
      src.disconnect();
      node.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      if (!shared) void ctx.close();
    },
    calibrate: (ms = 2000) =>
      new Promise((resolve) => {
        const levels: number[] = [];
        const l = (f: PitchFrame) => levels.push(f.rmsDb);
        listeners.push(l);
        setTimeout(() => {
          listeners = listeners.filter((x) => x !== l);
          levels.sort((a, b) => a - b);
          // 80th percentile of the room: robust to a cough, ignores silent gaps
          resolve(levels.length ? levels[Math.floor(levels.length * 0.8)]! : -60);
        }, ms);
      }),
  };
}
