import { describe, expect, it } from 'vitest';
import { sizedArtwork } from './artwork-size';

describe('sizedArtwork', () => {
  it('uses host thumbnails', () => {
    expect(sizedArtwork('https://coverartarchive.org/release/abc/27535251441-1200.jpg', 300)).toBe('https://coverartarchive.org/release/abc/27535251441-500.jpg');
    expect(sizedArtwork('https://coverartarchive.org/release/abc/front', 200)).toBe('https://coverartarchive.org/release/abc/front-250');
    expect(sizedArtwork('https://is1-ssl.mzstatic.com/image/thumb/Music/x/1200x1200bb.jpg', 300)).toBe('https://is1-ssl.mzstatic.com/image/thumb/Music/x/300x300bb.jpg');
    expect(sizedArtwork('https://e-cdns-images.dzcdn.net/images/cover/abc/1000x1000-000000-80-0-0.jpg', 300)).toBe('https://e-cdns-images.dzcdn.net/images/cover/abc/300x300-000000-80-0-0.jpg');
    expect(sizedArtwork('https://creatornode2.audius.co/content/Qm/1000x1000.jpg', 300)).toBe('https://creatornode2.audius.co/content/Qm/480x480.jpg');
    expect(sizedArtwork('https://upload.wikimedia.org/wikipedia/commons/a/ab/Radiohead.jpg', 300))
      .toBe('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Radiohead.jpg/300px-Radiohead.jpg');
  });
  it('leaves other hosts alone', () => {
    expect(sizedArtwork('https://archive.org/services/img/foo', 300)).toBe('https://archive.org/services/img/foo');
    expect(sizedArtwork('not a url', 300)).toBe('not a url');
  });
});
