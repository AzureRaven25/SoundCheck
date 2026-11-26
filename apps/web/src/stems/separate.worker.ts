/// <reference lib="webworker" />
/**
 * Vocal separation in a Web Worker: HTDemucs v4 (Meta, MIT) as ONNX via demucs-web's STFT helpers (MIT) and
 * onnxruntime-web (MIT, WebGPU with a WASM fallback). Only the vocal stem is built; the page makes the backing
 * track as the original minus the vocal, so it keeps the recording's full quality.
 *
 * Everything runs on the visitor's device: the audio never leaves it. The model (~180 MB) is downloaded once and
 * kept in Cache Storage.
 */
import { CONSTANTS, prepareModelInput, standaloneIspec } from 'demucs-web';
import type * as Ort from 'onnxruntime-web';

export type ToWorker = { type: 'separate'; left: Float32Array; right: Float32Array };
export type FromWorker =
  | { type: 'download'; loaded: number; total: number }
  | { type: 'backend'; backend: 'webgpu' | 'wasm' }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; left: Float32Array; right: Float32Array }
  | { type: 'error'; message: string };

const ORT_VERSION = '1.31.1';
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
export const MODEL_URL = CONSTANTS.DEFAULT_MODEL_URL;
const CACHE = 'soundcheck-models-v1';
const { TRAINING_SAMPLES: SEG, MODEL_SPEC_BINS: BINS, MODEL_SPEC_FRAMES: FRAMES, SEGMENT_OVERLAP } = CONSTANTS;
const VOCALS = 3;

const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

async function modelBytes(): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try { cache = await caches.open(CACHE); } catch { /* no Cache Storage (private window) */ }
  const hit = await cache?.match(MODEL_URL);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`couldn’t download the vocal model (${res.status})`);
  const total = Number(res.headers.get('Content-Length')) || 180_534_758;
  const reader = res.body.getReader();
  const buf = new Uint8Array(total);
  let loaded = 0, last = 0;
  const extra: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.length <= total) buf.set(value, loaded); else extra.push(value);
    loaded += value.length;
    if (performance.now() - last > 200) { last = performance.now(); post({ type: 'download', loaded, total }); }
  }
  let bytes = buf.subarray(0, Math.min(loaded, total));
  if (extra.length) {   // Content-Length was wrong: stitch
    const all = new Uint8Array(loaded);
    all.set(bytes, 0);
    let o = bytes.length;
    for (const x of extra) { all.set(x, o); o += x.length; }
    bytes = all;
  }
  post({ type: 'download', loaded, total: loaded });
  const out = bytes.slice().buffer;
  try { await cache?.put(MODEL_URL, new Response(out.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } })); } catch { /* quota: download again next time */ }
  return out;
}

async function session(): Promise<Ort.InferenceSession> {
  const ort = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${ORT_BASE}ort.webgpu.min.mjs` as string)) as typeof Ort;
  ort.env.wasm.wasmPaths = ORT_BASE;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;
  const gpu = 'gpu' in navigator && !!(await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
  post({ type: 'backend', backend: gpu ? 'webgpu' : 'wasm' });
  const bytes = await modelBytes();
  return ort.InferenceSession.create(bytes, { executionProviders: gpu ? ['webgpu', 'wasm'] : ['wasm'], graphOptimizationLevel: 'basic' })
    .then((s) => Object.assign(s, { ort }));
}

/** The vocal stem of a 44.1 kHz stereo song, segment by segment with overlap-added crossfades. */
async function vocals(left: Float32Array, right: Float32Array): Promise<{ left: Float32Array; right: Float32Array }> {
  const s = (await session()) as Ort.InferenceSession & { ort: typeof Ort };
  const n = left.length;
  const stride = Math.floor(SEG * (1 - SEGMENT_OVERLAP));
  const segments = Math.max(1, Math.ceil((n - SEG) / stride) + 1);
  const outL = new Float32Array(n), outR = new Float32Array(n), w = new Float32Array(n);
  let done = 0;
  post({ type: 'progress', done, total: segments });
  for (let start = 0; start < n; start += stride) {
    const len = Math.min(SEG, n - start);
    const segL = new Float32Array(SEG), segR = new Float32Array(SEG);
    segL.set(left.subarray(start, start + len));
    segR.set(right.subarray(start, start + len));
    const input = prepareModelInput(segL, segR);
    const feeds: Record<string, Ort.Tensor> = { [s.inputNames[0]!]: new s.ort.Tensor('float32', input.waveform, [1, 2, SEG]) };
    if (s.inputNames.length > 1) feeds[s.inputNames[1]!] = new s.ort.Tensor('float32', input.magSpec, [1, 4, BINS, FRAMES]);
    const res = await s.run(feeds);
    let time: Float32Array | null = null, dims: readonly number[] = [], freq: Float32Array | null = null;
    for (const name of s.outputNames) {
      const t = res[name]!;
      if (t.dims.length === 4 && t.dims[2] === 2) { time = t.data as Float32Array; dims = t.dims; }
      else if (t.dims.length === 5 && t.dims[2] === 4) freq = t.data as Float32Array;
    }
    if (!time) throw new Error('unexpected model output');
    const samples = dims[3]!, chans = dims[2]!;
    // the frequency branch's vocal spectrogram, back to audio (HTDemucs sums both branches)
    let fL: Float32Array | null = null, fR: Float32Array | null = null;
    if (freq) {
      const plane = BINS * FRAMES, base = VOCALS * 4 * plane;
      const spec = {
        leftReal: freq.subarray(base, base + plane), leftImag: freq.subarray(base + plane, base + 2 * plane),
        rightReal: freq.subarray(base + 2 * plane, base + 3 * plane), rightImag: freq.subarray(base + 3 * plane, base + 4 * plane),
      };
      const f = standaloneIspec(spec, SEG);
      fL = f.left; fR = f.right;
    }
    const tb = VOCALS * chans * samples;
    const half = stride * 0.5;
    for (let i = 0; i < len; i++) {
      // crossfade where segments overlap (the very edges of the song keep a small, nonzero weight)
      const win = Math.max(1e-3, Math.min(1, i / half, (len - i) / half));
      outL[start + i]! += (time[tb + i]! + (fL?.[i] ?? 0)) * win;
      outR[start + i]! += (time[tb + samples + i]! + (fR?.[i] ?? 0)) * win;
      w[start + i]! += win;
    }
    post({ type: 'progress', done: ++done, total: segments });
    if (start + SEG >= n) break;
  }
  for (let i = 0; i < n; i++) if (w[i]! > 0) { outL[i]! /= w[i]!; outR[i]! /= w[i]!; }
  return { left: outL, right: outR };
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  if (e.data.type !== 'separate') return;
  try {
    const v = await vocals(e.data.left, e.data.right);
    post({ type: 'done', left: v.left, right: v.right }, [v.left.buffer, v.right.buffer]);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
