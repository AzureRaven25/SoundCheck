import { describe, expect, it } from 'vitest';
import { classify, guessFromPath, mimeFor, parsePlaylist, parseRipLog, provenanceLabel, resolveEntry } from './parse';

describe('classify', () => {
  it('sorts files', () => {
    expect(classify('A/B/01 x.FLAC')).toBe('audio');
    expect(classify('album.zip')).toBe('zip');
    expect(classify('mix.m3u8')).toBe('playlist');
    expect(classify('rip.log')).toBe('riplog');
    expect(classify('cover.jpg')).toBe('other');
    expect(classify('__MACOSX/._01 x.mp3')).toBe('other');
  });
  it('fills in missing MIME types', () => {
    expect(mimeFor('x.flac', '')).toBe('audio/flac');
    expect(mimeFor('x.m4a', 'audio/x-m4a')).toBe('audio/x-m4a');
  });
});

describe('guessFromPath', () => {
  it('reads Bandcamp zip names', () => {
    expect(guessFromPath('Artist - Album - 03 Song Name.flac')).toEqual({ artist: 'Artist', album: 'Album', trackNo: 3, title: 'Song Name' });
  });
  it('reads Artist/Album/NN - Title', () => {
    expect(guessFromPath('Queen/News of the World/02 - We Are the Champions.mp3'))
      .toEqual({ title: 'We Are the Champions', artist: 'Queen', album: 'News of the World', trackNo: 2 });
  });
  it('reads NN. Artist - Title', () => {
    expect(guessFromPath('mix/07. Ben E. King - Stand by Me.m4a')).toMatchObject({ artist: 'Ben E. King', title: 'Stand by Me', trackNo: 7 });
  });
});

describe('playlists', () => {
  it('parses M3U with EXTINF and Windows paths', () => {
    const p = parsePlaylist('Road trip.m3u8', '#EXTM3U\n#EXTINF:123,Artist - One\nMusic\\A\\01 One.mp3\n\nfile:///x/Two%20Song.flac\n');
    expect(p.name).toBe('Road trip');
    expect(p.entries).toEqual([{ path: 'Music/A/01 One.mp3', title: 'Artist - One' }, { path: '/x/Two Song.flac', title: null }]);
  });
  it('parses PLS', () => {
    const p = parsePlaylist('x.pls', '[playlist]\nFile2=b.mp3\nFile1=a.mp3\nTitle1=A\nNumberOfEntries=2');
    expect(p.entries.map((e) => e.path)).toEqual(['a.mp3', 'b.mp3']);
  });
  it('resolves entries by relative path or file name', () => {
    const files = ['Lib/A/01 One.mp3', 'Lib/B/Two Song.flac'];
    expect(resolveEntry('A/01 One.mp3', 'Lib', files)).toBe('Lib/A/01 One.mp3');
    expect(resolveEntry('/x/Two Song.flac', 'Lib', files)).toBe('Lib/B/Two Song.flac');
    expect(resolveEntry('missing.mp3', 'Lib', files)).toBeNull();
  });
});

describe('rip logs', () => {
  it('reads Exact Audio Copy AccurateRip results', () => {
    const log = `Exact Audio Copy V1.6 from 23. October 2020\n\nTrack  1\n\n     Copy CRC 1234\n     Accurately ripped (confidence 5)  [ABCDEF01]  (AR v2)\n\nTrack  2\n\n     Copy CRC 9999\n     Track not present in AccurateRip database\n`;
    const r = parseRipLog(log)!;
    expect(r.ripper).toBe('eac');
    expect(r.tracks.get(1)).toEqual({ accurate: true, confidence: 5 });
    expect(r.tracks.get(2)).toEqual({ accurate: false, confidence: null });
    expect(provenanceLabel('CD rip', r.tracks.get(1))).toBe('CD rip · AccurateRip verified (confidence 5)');
  });
  it('reads whipper logs', () => {
    const log = `Log created by: whipper 0.10.0\nTracks:\n  1:\n    Filename: ./01.flac\n    AccurateRip v2:\n      Result: Found, exact match\n      Remote confidence: 12\n  2:\n    AccurateRip v2:\n      Result: Not found\n`;
    const r = parseRipLog(log)!;
    expect(r.ripper).toBe('whipper');
    expect(r.tracks.get(1)).toEqual({ accurate: true, confidence: 12 });
    expect(r.tracks.get(2)?.accurate).toBe(false);
  });
  it('ignores other logs', () => {
    expect(parseRipLog('some app log')).toBeNull();
  });
});
