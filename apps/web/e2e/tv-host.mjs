// Drive a native TV host (Apple TV / Fire TV simulator) with web "phones".
//   node e2e/tv-host.mjs prepare            → sign up TV_TEST_USER (local stack) and make the fixture song karaoke-ready
//   node e2e/tv-host.mjs phone CODE NAME    → join CODE as a phone with a fake mic singing the test vocal; prints the score
// Needs: npm run dev, supabase start, the worker, E2E_SONG + E2E_FAKE_MIC.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const BASE = 'http://localhost:3000';
const USER = { email: 'tv-host@soundcheck.test', password: 'tv-host-local-only', name: 'TV Host' };
const TRACK = '5ca1ab1e-0000-4000-8000-000000000001';
const [, , cmd, code, name = 'Phone'] = process.argv;
const browser = await chromium.launch();
const ctx = await browser.newContext({ permissions: ['microphone'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

if (cmd === 'prepare') {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill(USER.email);
  await page.getByLabel('Password').fill(USER.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  const ok = await page.getByRole('button', { name: 'Account menu' }).waitFor({ timeout: 8000 }).then(() => true, () => false);
  if (!ok) {
    await page.goto(`${BASE}/signup`);
    await page.getByLabel('Display name').fill(USER.name);
    await page.getByLabel('Email').fill(USER.email);
    await page.getByLabel('Password').fill(USER.password);
    await page.getByRole('button', { name: 'Sign up' }).click();
    await page.getByRole('button', { name: 'Account menu' }).waitFor();
  }
  await page.goto(`${BASE}/track/${TRACK}`);
  const ready = await page.getByRole('link', { name: 'Sing on Stage' }).waitFor({ timeout: 5000 }).then(() => true, () => false);
  if (!ready) {
    await page.getByLabel('Audio file').setInputFiles(process.env.E2E_SONG);
    await page.getByRole('link', { name: 'Sing on Stage' }).waitFor({ timeout: 200_000 });
  }
  console.log('ready: TV_TEST_USER owns a karaoke-ready copy of the fixture song');
} else if (cmd === 'phone') {
  await page.route('**/__e2e/fake-mic.wav', (r) => r.fulfill({ body: fs.readFileSync(process.env.E2E_FAKE_MIC), contentType: 'audio/wav' }));
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const buf = await ac.decodeAudioData(await (await fetch('/__e2e/fake-mic.wav')).arrayBuffer());
      const dest = ac.createMediaStreamDestination();
      window.__fakeMicSing = (from) => { void ac.resume(); const s = ac.createBufferSource(); s.buffer = buf; s.connect(dest); s.start(0, Math.max(0, from)); };
      return dest.stream;
    };
  });
  await page.goto(`${BASE}/join/${code}`);
  await page.getByLabel('Stage name').fill(name);
  await page.getByRole('button', { name: 'Join' }).click();
  await page.getByRole('button', { name: 'Turn on my microphone' }).click();
  await page.getByText('Waiting for the song').waitFor({ timeout: 20_000 });
  console.log('phone ready; start the song on the TV');
  await page.waitForFunction(() => window.__soundcheckJoin?.playing(), null, { timeout: 600_000 });
  await page.evaluate(() => window.__fakeMicSing(window.__soundcheckJoin.position()));
  console.log('singing from', await page.evaluate(() => window.__soundcheckJoin.position().toFixed(2)));
  const live = await page.getByText(/On pitch \d+%/).textContent({ timeout: 30_000 }).catch(() => 'no live score');
  console.log('live:', live);
  const card = page.getByRole('dialog', { name: 'Your score' });
  await card.waitFor({ timeout: 120_000 });
  console.log('SCORE', await card.locator('.text-8xl').textContent());
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/tv-phone-result.png` });
}
await browser.close();
