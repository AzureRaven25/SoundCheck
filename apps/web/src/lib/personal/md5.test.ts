import { describe, expect, it } from 'vitest';
import { md5 } from './md5';

describe('md5 (Subsonic token auth)', () => {
  it('matches RFC 1321 test vectors', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5('The quick brown fox jumps over the lazy dog')).toBe('9e107d9d372bb6826bd81d3542a419d6');
    expect(md5('a'.repeat(100))).toBe('36a92cc94a9e0fa21f625f8bfb007adf');
  });
  it('builds the Subsonic token the same way the server does', () => {
    expect(md5('local-navidrome-test' + 'abc123')).toBe('bcb397845f86e132c98815b57d3fe1bf'); // macOS `md5`
  });
});
