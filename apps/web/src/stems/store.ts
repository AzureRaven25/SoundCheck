'use client';
/**
 * Karaoke made on this device, kept in this browser (IndexedDB) and never uploaded: separated audio is a copy of
 * the singer's own recording, so it stays theirs. 16-bit PCM keeps a 4-minute song at about 85 MB.
 */
import type { Stems, Stereo } from './separate';

export interface LocalSongMeta {
  id: string; trackId: string; title: string; artist: string;
  /** where the recording came from: a file name or the link's host */
  source: string;
  createdAt: number; rate: number; seconds: number;
}
interface AudioRow { id: string; backing: [ArrayBuffer, ArrayBuffer]; vocals: [ArrayBuffer, ArrayBuffer] }

const DB = 'soundcheck-karaoke';
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('meta', { keyPath: 'id' });
      r.result.createObjectStore('audio', { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('this browser won’t store files (private window?)'));
  });
}
function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

export function toInt16(x: Float32Array): ArrayBuffer {
  const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) { const v = Math.max(-1, Math.min(1, x[i]!)); out[i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
  return out.buffer;
}
export function fromInt16(b: ArrayBuffer): Float32Array {
  const x = new Int16Array(b), out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i]! / (x[i]! < 0 ? 0x8000 : 0x7fff);
  return out;
}
const pack = (s: Stereo): [ArrayBuffer, ArrayBuffer] => [toInt16(s.left), toInt16(s.right)];
const unpack = ([l, r]: [ArrayBuffer, ArrayBuffer]): Stereo => ({ left: fromInt16(l), right: fromInt16(r) });

export async function saveLocalSong(meta: Omit<LocalSongMeta, 'id' | 'createdAt' | 'rate' | 'seconds'>, stems: Stems): Promise<LocalSongMeta> {
  const db = await open();
  const full: LocalSongMeta = { ...meta, id: crypto.randomUUID(), createdAt: Date.now(), rate: stems.rate, seconds: stems.backing.left.length / stems.rate };
  const row: AudioRow = { id: full.id, backing: pack(stems.backing), vocals: pack(stems.vocals) };
  const tx = db.transaction(['meta', 'audio'], 'readwrite');
  tx.objectStore('meta').put(full);
  tx.objectStore('audio').put(row);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('not enough storage space on this device'));
  });
  db.close();
  return full;
}

export async function listLocalSongs(): Promise<LocalSongMeta[]> {
  try {
    const db = await open();
    const all = await req(db.transaction('meta').objectStore('meta').getAll() as IDBRequest<LocalSongMeta[]>);
    db.close();
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } catch { return []; }
}

export async function loadLocalSong(id: string): Promise<{ meta: LocalSongMeta; stems: Stems } | null> {
  const db = await open();
  const tx = db.transaction(['meta', 'audio']);
  const [meta, audio] = await Promise.all([
    req(tx.objectStore('meta').get(id) as IDBRequest<LocalSongMeta | undefined>),
    req(tx.objectStore('audio').get(id) as IDBRequest<AudioRow | undefined>),
  ]);
  db.close();
  if (!meta || !audio) return null;
  return { meta, stems: { backing: unpack(audio.backing), vocals: unpack(audio.vocals), rate: meta.rate } };
}

export async function deleteLocalSong(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction(['meta', 'audio'], 'readwrite');
  tx.objectStore('meta').delete(id);
  tx.objectStore('audio').delete(id);
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  db.close();
}
