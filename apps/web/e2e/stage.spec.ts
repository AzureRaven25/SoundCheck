import { expect, test } from '@playwright/test';

// Full SoundCheck Stage run: upload → processed → Stage with a fake microphone that "sings" the test
// song's vocal (Chromium flag) → official score. Needs E2E_SONG + E2E_FAKE_MIC (16-bit WAV) and a worker.
// macOS gates even Chromium's fake capture device behind OS microphone permission, so the "singer" is
// injected instead: getUserMedia returns a stream that plays the test song's isolated vocal, started at
// the Stage's current song position (window.__soundcheckStage, dev builds only).
test.use({ permissions: ['microphone'] });

async function fakeMicrophone(page: import('@playwright/test').Page, wavPath: string) {
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

const FIXTURE_TRACK = '5ca1ab1e-0000-4000-8000-000000000001';
const LINES = [
  { start: 2, end: 8, text: 'Hello from the testing stage' }, { start: 8, end: 14, text: 'Every singer finds a voice' },
  { start: 14, end: 20, text: 'Sing it loud and sing it clear' }, { start: 20, end: 27, text: 'Thank you for listening here' },
];

// A catalog track whose shared lyrics match the sung test song (services/pipeline/tests/fixtures/make_song.py).
test.beforeAll(async () => {
  const url = process.env.E2E_SB_URL, key = process.env.E2E_SB_SERVICE;
  if (!url || !key) return;
  const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };
  await fetch(`${url}/rest/v1/tracks?on_conflict=id`, { method: 'POST', headers: h, body: JSON.stringify({ id: FIXTURE_TRACK, title: 'Testing Stage', artist_credit: 'Good News', duration_ms: 27000 }) });
  await fetch(`${url}/rest/v1/lyrics?on_conflict=track_id,provider`, { method: 'POST', headers: h, body: JSON.stringify({ track_id: FIXTURE_TRACK, provider: 'lrclib', granularity: 'line', is_primary: true, content: { lines: LINES } }) });
});

test('sing on Stage and get a SoundCheck Score', async ({ page }) => {
  test.skip(!process.env.E2E_SONG || !process.env.E2E_FAKE_MIC || !process.env.E2E_SB_URL, 'set E2E_SONG, E2E_FAKE_MIC, E2E_SB_URL/SERVICE and run the worker');
  test.setTimeout(300_000);
  page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[stage]')) console.log('BROWSER', m.type(), m.text().slice(0, 300)); });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 300)));
  await fakeMicrophone(page, process.env.E2E_FAKE_MIC!);
  await page.goto('/signup');
  await page.getByLabel('Display name').fill('Stage Singer');
  await page.getByLabel('Email').fill(`stage-${Date.now()}@soundcheck.test`);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();

  await page.goto(`/track/${FIXTURE_TRACK}`);
  await page.getByLabel('Audio file').setInputFiles(process.env.E2E_SONG!);
  await page.getByRole('link', { name: 'Sing on Stage' }).click({ timeout: 200_000 });

  await expect(page.getByRole('heading', { name: 'Ready to sing?' })).toBeVisible();
  await page.getByRole('button', { name: 'Start singing' }).click();
  await expect(page.getByText(/Stay quiet/)).toBeVisible();
  // once the song is playing, the simulated singer starts in sync with the song clock
  await page.waitForFunction(() => (window as unknown as { __soundcheckStage?: { playing: () => boolean } }).__soundcheckStage?.playing());
  await page.evaluate(() => {
    const w = window as unknown as { __soundcheckStage: { position: () => number }; __fakeMicSing: (s: number) => void };
    w.__fakeMicSing(w.__soundcheckStage.position());
  });
  // the test song's first line starts at 2 s; lyrics are word-timed by the worker
  await expect(page.getByText('Hello')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('img', { name: 'Melody guide' })).toBeVisible();
  await expect(page.getByText(/On pitch \d+%/)).toBeVisible({ timeout: 15_000 });   // live HUD from the mic
  await page.waitForTimeout(4_000);
  console.log('E2E wipe', await page.evaluate(() => {
    const w = [...document.querySelectorAll<HTMLElement>('[data-line="cur"] [data-w]')];
    const st = (window as unknown as { __soundcheckStage: { position: () => number } }).__soundcheckStage.position();
    return JSON.stringify({ t: st.toFixed(2), n: w.length, p: w.map((x) => x.style.getPropertyValue('--p')), bg: w[0] && getComputedStyle(w[0]).backgroundSize });
  }));
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/stage-singing.png` });
  await page.waitForTimeout(10_000);           // sing through line 3
  await page.getByRole('button', { name: 'Finish and score' }).click();
  await expect(page.getByRole('dialog', { name: 'Results' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Pitch')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sing again' })).toBeVisible();
  // the "singer" is the original vocal, so the official score must be strong
  const score = Number(await page.locator('.text-8xl').first().textContent({ timeout: 10_000 }));
  await page.waitForTimeout(1600); // count-up animation
  const final = Number(await page.locator('.text-8xl').first().textContent());
  console.log('E2E SoundCheck Score', final);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/stage-results.png`, fullPage: true });
  expect(Math.max(score, final)).toBeGreaterThanOrEqual(60);
});
