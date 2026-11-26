'use client';
/** Turn a song file into karaoke on this device: decode it, split off the vocal (in a worker), backing = mix − vocal. */
import type { FromWorker, ToWorker } from './separate.worker';

export const RATE = 44100;
export interface Stereo { left: Float32Array; right: Float32Array }
export interface Stems { backing: Stereo; vocals: Stereo; rate: number }

export type SplitProgress =
  | { step: 'decoding' }
  | { step: 'downloading'; loaded: number; total: number }
  | { step: 'separating'; done: number; total: number; backend: 'webgpu' | 'wasm' | null };

/** Decode any audio the browser can play, resampled to 44.1 kHz stereo (what the model was trained on). */
export async function decode(bytes: ArrayBuffer): Promise<Stereo> {
  const probe = new OfflineAudioContext(2, 1, RATE);
  const buf = await probe.decodeAudioData(bytes);
  const left = buf.getChannelData(0).slice();
  const right = buf.numberOfChannels > 1 ? buf.getChannelData(1).slice() : left.slice();
  return { left, right };
}

/** The original minus its vocal: what's left is everything else, sample for sample. */
export function subtract(mix: Stereo, vocals: Stereo): Stereo {
  const n = mix.left.length;
  const left = new Float32Array(n), right = new Float32Array(n);
  for (let i = 0; i < n; i++) { left[i] = mix.left[i]! - (vocals.left[i] ?? 0); right[i] = mix.right[i]! - (vocals.right[i] ?? 0); }
  return { left, right };
}

export async function splitVocals(bytes: ArrayBuffer, onProgress: (p: SplitProgress) => void, signal?: AbortSignal): Promise<Stems> {
  onProgress({ step: 'decoding' });
  const mix = await decode(bytes);
  if (mix.left.length < RATE * 5) throw new Error('That recording is shorter than 5 seconds.');
  if (mix.left.length > RATE * 60 * 15) throw new Error('That recording is longer than 15 minutes.');
  const worker = new Worker(new URL('./separate.worker.ts', import.meta.url), { type: 'module' });
  let backend: 'webgpu' | 'wasm' | null = null;
  try {
    const vocals = await new Promise<Stereo>((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
      worker.onerror = (e) => reject(new Error(e.message || 'the separation worker failed'));
      worker.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.type === 'download') onProgress({ step: 'downloading', loaded: m.loaded, total: m.total });
        else if (m.type === 'backend') backend = m.backend;
        else if (m.type === 'progress') onProgress({ step: 'separating', done: m.done, total: m.total, backend });
        else if (m.type === 'done') resolve({ left: m.left, right: m.right });
        else reject(new Error(m.message));
      };
      // copies (the mix is still needed for the backing)
      const msg: ToWorker = { type: 'separate', left: mix.left.slice(), right: mix.right.slice() };
      worker.postMessage(msg, [msg.left.buffer, msg.right.buffer]);
    });
    return { vocals, backing: subtract(mix, vocals), rate: RATE };
  } finally {
    worker.terminate();
  }
}

/** Whether this browser can run the model on the GPU (otherwise it works, but slowly). */
export async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch { return false; }
}
