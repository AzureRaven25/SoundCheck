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
      // Like a person listening to the TV, the simulated singer follows the shared song clock: if the
      // recording drifts from it by > 60 ms (e.g. a TV whose audio runs slightly slow), it re-cues.
      let src = null, startedAt = 0, startedFrom = 0;
      window.__fakeCtxState = () => ac.state;
      const cue = (from) => {
        if (src) { try { src.stop(); } catch {} }
        src = ac.createBufferSource(); src.buffer = buf; src.connect(dest);
        startedAt = ac.currentTime; startedFrom = Math.max(0, from); src.start(0, startedFrom);
      };
      window.__fakeMicSing = (from) => {
        void ac.resume(); cue(from);
        setInterval(() => {
          const j = window.__soundcheckJoin; if (!j?.playing()) return;
          const want = j.position(), have = startedFrom + (ac.currentTime - startedAt);
          if (Math.abs(want - have) > 0.06) { window.__recues = (window.__recues ?? 0) + 1; cue(want); }
        }, 250);
      };
      return dest.stream;
    };
  });
  await page.goto(`${BASE}/join/${code}`);
  await page.getByLabel('Stage name').fill(name);
  await page.getByRole('button', { name: 'Join' }).click();
  await page.getByRole('button', { name: 'Turn on my microphone' }).click();
  await page.getByText(/^(Waiting for the song|Live)$/).waitFor({ timeout: 20_000 });
  if (process.env.REQUEST) {   // ask the TV for a song (party queue)
    await page.getByRole('button', { name: /Request a song/ }).click();
    await page.getByPlaceholder('Search songs').fill(process.env.REQUEST);
    await page.getByRole('button', { name: new RegExp(process.env.REQUEST, 'i') }).first().click();
    await page.getByText('Added to the queue').waitFor();
    console.log('requested', process.env.REQUEST);
  }
  console.log('phone ready; start the song on the TV');
  await page.waitForFunction(() => window.__soundcheckJoin?.playing(), null, { timeout: 600_000 });
  await page.evaluate(() => window.__fakeMicSing(window.__soundcheckJoin.position()));
  console.log('singing from', await page.evaluate(() => window.__soundcheckJoin.position().toFixed(2)));
  const live = await page.getByText(/On pitch \d+%/).textContent({ timeout: 30_000 }).catch(() => 'no live score');
  console.log('live:', live);
  console.log('re-cues so far:', await page.evaluate(() => window.__recues ?? 0));
  const card = page.getByRole('dialog', { name: 'Your score' });
  const songs = Number(process.env.SONGS ?? 1);
  for (let n = 1; n <= songs; n++) {
    await card.waitFor({ timeout: 120_000 });
    console.log(`SCORE song ${n}:`, await card.locator('.text-8xl').textContent());
    if (n < songs) {
      await card.waitFor({ state: 'detached', timeout: 120_000 });   // the TV moved on to the next song
      for (let k = 0; k < 4; k++) {
        await page.waitForTimeout(3000);
        console.log('song', n + 1, await page.evaluate(() => JSON.stringify({ pos: window.__soundcheckJoin.position().toFixed(2), playing: window.__soundcheckJoin.playing(), recues: window.__recues ?? 0, ctx: window.__fakeCtxState?.() })));
      }
    }
  }
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/tv-phone-result.png` });
}
await browser.close();
