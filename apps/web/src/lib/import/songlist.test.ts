import { describe, expect, it } from 'vitest';
import { parseSongList } from './songlist';

describe('parseSongList', () => {
  it('reads pasted lines', () => {
    expect(parseSongList('Queen - Bohemian Rhapsody\n2. Stand by Me by Ben E. King\nHallelujah\n')).toEqual([
      { artist: 'Queen', title: 'Bohemian Rhapsody' },
      { title: 'Stand by Me', artist: 'Ben E. King' },
      { title: 'Hallelujah', artist: null },
    ]);
  });
  it('reads an Exportify CSV (quoted, multiple artists)', () => {
    const csv = '"Track URI","Track Name","Artist Name(s)","Album Name"\n"spotify:track:1","Under Pressure","Queen, David Bowie","Hot Space"\n"spotify:track:2","Say ""Hi""","Someone","X"';
    expect(parseSongList(csv)).toEqual([{ title: 'Under Pressure', artist: 'Queen' }, { title: 'Say "Hi"', artist: 'Someone' }]);
  });
  it('reads a simple Title,Artist CSV', () => {
    expect(parseSongList('Title,Artist\nCreep,Radiohead')).toEqual([{ title: 'Creep', artist: 'Radiohead' }]);
  });
});
