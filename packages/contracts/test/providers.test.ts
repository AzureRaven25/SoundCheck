import { describe, expect, it } from 'vitest';
import { PROVIDERS, licenseAllowsKaraoke, licenseLabel } from '../src/providers';

describe('providers', () => {
  it('only permits karaoke from sources we may process', () => {
    expect(PROVIDERS.upload.karaoke).toBe(true);
    expect(PROVIDERS.personal_server.karaoke).toBe(true);
    for (const p of ['apple_music', 'youtube', 'spotify', 'itunes_preview'] as const) expect(PROVIDERS[p].karaoke).toBe(false);
    expect(PROVIDERS.itunes_preview.playback).toBe('preview');
    expect(PROVIDERS.spotify.playback).toBe('none');
  });
  it('reads Creative Commons licenses', () => {
    expect(licenseAllowsKaraoke('http://creativecommons.org/licenses/by-nc-sa/3.0/')).toBe(true);
    expect(licenseAllowsKaraoke('http://creativecommons.org/licenses/by-nc-nd/3.0/')).toBe(false);
    expect(licenseAllowsKaraoke('https://creativecommons.org/publicdomain/zero/1.0/')).toBe(true);
    expect(licenseAllowsKaraoke(null)).toBe(false);
    expect(licenseAllowsKaraoke('https://example.com/all-rights-reserved')).toBe(false);
    expect(licenseLabel('http://creativecommons.org/licenses/by-nc-sa/4.0/')).toBe('CC BY-NC-SA 4.0');
    expect(licenseLabel('https://creativecommons.org/publicdomain/mark/1.0/')).toBe('Public domain');
  });
});
