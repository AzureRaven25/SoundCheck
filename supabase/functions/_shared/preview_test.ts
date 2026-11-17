import { assertEquals } from 'jsr:@std/assert@1';
import { pickPreview } from './preview.ts';

const base = { previewUrl: 'p', trackViewUrl: 'v', kind: 'song' };
Deno.test('pickPreview prefers matching title/artist within 15 s', () => {
  const r = pickPreview([
    { ...base, trackName: 'Stand by Me', artistName: 'Ben E. King', trackTimeMillis: 400000, previewUrl: 'too-long' },
    { ...base, trackName: 'Stand By Me (2008 Remaster)', artistName: 'Ben E. King', trackTimeMillis: 178000, previewUrl: 'good' },
    { ...base, trackName: 'Stand by Me', artistName: 'Some Cover Band', trackTimeMillis: 180000, previewUrl: 'cover' },
  ], 'Stand by Me', 'Ben E. King', 180000);
  assertEquals(r?.previewUrl, 'good');
});
Deno.test('pickPreview returns null without a confident match', () => {
  assertEquals(pickPreview([{ ...base, trackName: 'Other', artistName: 'Ben E. King' }], 'Stand by Me', 'Ben E. King', null), null);
  assertEquals(pickPreview([{ trackName: 'Stand by Me', artistName: 'Ben E. King', kind: 'song' }], 'Stand by Me', 'Ben E. King', null), null);
});
