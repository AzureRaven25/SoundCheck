import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  audiusLicenseUrl, audiusToCandidate, ccmixterToCandidate, clockToMs, commonsMp3, deezerToCandidate, jamendoToCandidate,
  openverseToCandidate,
} from './acquisition.ts';

Deno.test('clock lengths', () => {
  assertEquals(clockToMs('4:54'), 294_000);
  assertEquals(clockToMs('1:02:03'), 3_723_000);
  assertEquals(clockToMs('abc'), null);
});

Deno.test('Audius licenses map to CC deeds; all rights reserved means no karaoke', () => {
  assertEquals(audiusLicenseUrl('Attribution CC BY'), 'https://creativecommons.org/licenses/by/4.0/');
  assertEquals(audiusLicenseUrl('Attribution-NonCommercial-NoDerivatives CC BY-NC-ND'), 'https://creativecommons.org/licenses/by-nc-nd/4.0/');
  assertEquals(audiusLicenseUrl('All rights reserved'), null);
  const base = { id: 'abc', title: 'T', duration: 200, user: { name: 'A', handle: 'a' }, permalink: '/a/t' };
  const arr = audiusToCandidate({ ...base, license: 'All rights reserved' })!;
  assertEquals(arr.availability, 'full');
  assertEquals(arr.karaoke_ok, false);
  assertEquals(arr.duration_ms, 200_000);
  assert(audiusToCandidate({ ...base, license: 'Attribution CC BY' })!.karaoke_ok);
  assertEquals(audiusToCandidate({ ...base, license: 'Attribution-NoDerivatives CC BY-ND' })!.karaoke_ok, false);
  // gated (premium / follow-to-unlock) tracks are skipped
  assertEquals(audiusToCandidate({ ...base, is_stream_gated: true }), null);
});

Deno.test('ccMixter is listed with its CC license, link-only', () => {
  const c = ccmixterToCandidate({
    upload_id: 7, upload_name: 'Song', user_name: 'u', license_url: 'http://creativecommons.org/licenses/by-nc/3.0/',
    files: [
      { file_name: 'u_-_Song.flac', download_url: 'https://ccmixter.org/content/u/u_-_Song.flac', file_format_info: { 'default-ext': 'flac', ps: '3:00' } },
      { file_name: 'u_-_Song.mp3', download_url: 'https://ccmixter.org/content/u/u_-_Song.mp3', file_format_info: { 'default-ext': 'mp3', ps: '3:01' } },
    ],
  })!;
  assertEquals(c.format, 'mp3');
  assertEquals(c.duration_ms, 181_000);
  assertEquals(c.license_url, 'https://creativecommons.org/licenses/by-nc/3.0/');
  // ccmixter.org refuses downloads from other sites: discovery and links only
  assertEquals(c.availability, 'metadata');
  assertEquals(c.stream_url, null);
  assertEquals(c.karaoke_ok, false);
  // never a file hosted elsewhere
  assertEquals(ccmixterToCandidate({ upload_id: 8, upload_name: 'x', user_name: 'u', files: [{ file_name: 'a.mp3', download_url: 'https://evil.example/a.mp3' }] }), null);
});

Deno.test('Jamendo: karaoke needs both a derivative-friendly license and downloads allowed', () => {
  const t = { id: '1', name: 'S', artist_name: 'A', duration: 100, audio: 'https://prod-1.storage.jamendo.com/?trackid=1&format=mp31', license_ccurl: 'http://creativecommons.org/licenses/by-sa/3.0/' };
  assertEquals(jamendoToCandidate({ ...t, audiodownload_allowed: true })!.karaoke_ok, true);
  assertEquals(jamendoToCandidate({ ...t, audiodownload_allowed: false })!.karaoke_ok, false);
});

Deno.test('Openverse: songs only, Commons served as MP3 transcodes', () => {
  assertEquals(
    commonsMp3('https://upload.wikimedia.org/wikipedia/commons/a/ab/Brahms_3.ogg'),
    'https://upload.wikimedia.org/wikipedia/commons/transcoded/a/ab/Brahms_3.ogg/Brahms_3.ogg.mp3',
  );
  const w = openverseToCandidate({
    id: '00000000-0000-0000-0000-000000000000', title: 'Brahms_3.ogg', creator: 'Musopen', source: 'wikimedia_audio', license: 'cc0',
    license_url: 'https://creativecommons.org/publicdomain/zero/1.0/', duration: 369_998, url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Brahms_3.ogg',
  })!;
  assertEquals(w.title, 'Brahms 3');
  assert(w.stream_url!.endsWith('.ogg.mp3'));
  assert(w.karaoke_ok);
  // short clips and Freesound effects are not songs
  assertEquals(openverseToCandidate({ id: 'x', source: 'wikimedia_audio', license: 'by', duration: 3000, url: 'https://upload.wikimedia.org/a.ogg' }), null);
  assertEquals(openverseToCandidate({ id: 'x', source: 'freesound', license: 'by', duration: 300_000, url: 'https://freesound.org/a.mp3' }), null);
});

Deno.test('Deezer is metadata only', () => {
  const d = deezerToCandidate({ id: 1, title: 'Stand By Me', duration: 174, isrc: 'USAT21205862', artist: { name: 'Ben E. King' }, album: { title: 'X', release_date: '1961-01-01' } });
  assertEquals(d.availability, 'metadata');
  assertEquals(d.stream_url, null);
  assertEquals(d.isrc, 'USAT21205862');
  assertEquals(d.year, 1961);
});
