import type { Page } from '@playwright/test';

/**
 * macOS gates even Chromium's fake capture device behind OS microphone permission, so the "singer" is
 * injected: getUserMedia returns a stream that plays a WAV (the test song's isolated vocal), started on
 * demand with window.__fakeMicSing(fromSec).
 */
export async function fakeMicrophone(page: Page, wavPath: string) {
  const fs = await import('node:fs');
  await page.route('**/__e2e/fake-mic.wav', (route) => route.fulfill({ body: fs.readFileSync(wavPath), contentType: 'audio/wav' }));
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const buf = await ac.decodeAudioData(await (await fetch('/__e2e/fake-mic.wav')).arrayBuffer());
      const dest = ac.createMediaStreamDestination();
      w.__fakeMicSing = (fromSec: number) => {
        void ac.resume();
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.connect(dest);
        src.start(0, Math.max(0, fromSec));
      };
      return dest.stream;
    };
  });
}

export const FIXTURE_TRACK = '5ca1ab1e-0000-4000-8000-000000000001';
const LINES = [
  { start: 2, end: 8, text: 'Hello from the testing stage' }, { start: 8, end: 14, text: 'Every singer finds a voice' },
  { start: 14, end: 20, text: 'Sing it loud and sing it clear' }, { start: 20, end: 27, text: 'Thank you for listening here' },
];

/** A catalog track whose shared lyrics match the sung test song (services/pipeline/tests/fixtures/make_song.py). */
export async function seedFixtureTrack() {
  const url = process.env.E2E_SB_URL, key = process.env.E2E_SB_SERVICE;
  if (!url || !key) return;
  const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };
  await fetch(`${url}/rest/v1/tracks?on_conflict=id`, { method: 'POST', headers: h, body: JSON.stringify({ id: FIXTURE_TRACK, title: 'Testing Stage', artist_credit: 'Good News', duration_ms: 27000 }) });
  await fetch(`${url}/rest/v1/lyrics?on_conflict=track_id,provider`, { method: 'POST', headers: h, body: JSON.stringify({ track_id: FIXTURE_TRACK, provider: 'lrclib', granularity: 'line', is_primary: true, content: { lines: LINES } }) });
}

export async function signUp(page: Page, name: string) {
  await page.goto('/signup');
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Email').fill(`${name.toLowerCase().replace(/\W/g, '')}-${Date.now()}@soundcheck.test`);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await page.getByRole('button', { name: 'Account menu' }).waitFor();
}

/** Local-stack-only account used when driving the native TV apps against a web phone (see e2e/tv-host.mjs). */
export const TV_TEST_USER = { email: 'tv-host@soundcheck.test', password: 'tv-host-local-only', name: 'TV Host' };

/** Local-only Navidrome used by e2e/personal-server.spec.ts (docker run deluan/navidrome; see the spec header). */
export const NAVIDROME_TEST = { url: 'http://localhost:4533', username: 'singer', password: 'local-navidrome-test' };
/** Local-only Jellyfin used by e2e/personal-server.spec.ts (docker run jellyfin/jellyfin, wizard run via its API). */
export const JELLYFIN_TEST = { url: 'http://localhost:8096', username: 'singer', password: 'local-jellyfin-test' };
