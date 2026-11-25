import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { FIXTURE_TRACK, fakeMicrophone, seedFixtureTrack, signUp } from './helpers';

// A phone as the mic for a YouTube sing-along: lyrics with the word wipe on the phone, a tuner showing the sung
// note, voice through the TV with the singer's own level, and the lyrics score on TV and phone.
// Headless Chromium can't play YouTube's video, so the host's song clock is driven through the dev-only hook.
test.use({ permissions: ['microphone'] });
test.beforeAll(seedFixtureTrack);

/** 30 s mono WAV: a voice-like tone moving between A3 and E4 every half second. */
function singingWav(): string {
  const sr = 16000, n = sr * 30;
  const data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(sr, 24);
  data.writeUInt32LE(sr * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const f = Math.floor(i / (sr / 2)) % 2 ? 329.63 : 220;
    ph += (2 * Math.PI * f) / sr;
    const v = 0.4 * Math.sin(ph) + 0.15 * Math.sin(2 * ph) + 0.08 * Math.sin(3 * ph);
    data.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  const p = path.join(os.tmpdir(), `soundcheck-e2e-sing-${process.pid}.wav`);
  fs.writeFileSync(p, data);
  return p;
}

type HostW = { __soundcheckStage: { clock: { videoTime: () => number; onState: ((s: string) => void) | null } } };

test('a phone sings along to a YouTube song: lyrics, tuner, voice on the TV, and a score', async ({ page, browser }) => {
  test.skip(!process.env.E2E_SB_URL, 'set E2E_SB_URL / E2E_SB_SERVICE');
  test.setTimeout(180_000);
  const wav = singingWav();
  await signUp(page, 'Video Host');
  await page.goto(`/stage/${FIXTURE_TRACK}?video=1`);
  await page.getByLabel('Kind of video').selectOption('original');
  await page.getByLabel('YouTube link').fill('pKtLNYNWbBw');
  await page.getByRole('button', { name: 'Use video' }).click();
  await expect(page.getByTestId('main-video').locator('iframe')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('radio', { name: /Phones as mics/ }).click();
  await page.getByRole('button', { name: 'Open the party' }).click();
  const code = (await page.getByTestId('pairing-code').textContent({ timeout: 15_000 }))!.trim();

  const ctx = await browser.newContext({ permissions: ['microphone'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await ctx.newPage();
  await fakeMicrophone(phone, wav);
  await phone.goto(`/join/${code}`);
  await phone.getByLabel('Stage name').fill('Cleo');
  await phone.getByRole('button', { name: 'Join' }).click();
  await phone.getByRole('button', { name: 'Turn on my microphone' }).click();
  await expect(phone.getByText('Waiting for the song')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('list', { name: 'Singers' }).getByText('mic ready')).toBeVisible({ timeout: 15_000 });

  // voices through the TV, with the karaoke echo; the phone gets its own level control
  await page.getByLabel('Hear singers through the speakers').check();
  await expect(page.getByLabel('Echo')).toBeVisible();
  await expect(phone.getByText('Your voice is on the TV')).toBeVisible({ timeout: 20_000 });
  await phone.getByLabel('My voice volume on the TV').fill('1.5');

  await page.getByRole('button', { name: 'Start singing' }).click();
  await page.evaluate(() => {
    const c = (window as unknown as HostW).__soundcheckStage.clock;
    const t0 = performance.now();
    c.videoTime = () => 1.5 + (performance.now() - t0) / 1000;
    c.onState?.('playing');
  });
  await expect(phone.getByText('● Live')).toBeVisible({ timeout: 10_000 });
  await phone.evaluate(() => (window as unknown as { __fakeMicSing: (s: number) => void }).__fakeMicSing(0));
  await expect(phone.locator('[data-line="cur"]')).toHaveText('Hello from the testing stage', { timeout: 10_000 });
  await expect(phone.getByText(/^(A3|E4)$/)).toBeVisible({ timeout: 10_000 });   // the tuner hears the fake singer

  // line 1 (2–8 s) was sung through: the TV cheers when line 2 starts
  await expect(page.getByText(/^(Perfect|Great|Nice)!$/)).toBeAttached({ timeout: 15_000 });
  await page.waitForTimeout(2_000);
  if (process.env.E2E_SHOTS) {
    await phone.screenshot({ path: `${process.env.E2E_SHOTS}/video-party-phone.png` });
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/video-party-host.png` });
  }
  await page.getByRole('button', { name: 'Finish and score' }).click();
  await expect(page.getByText('Cleo').first()).toBeVisible({ timeout: 30_000 });
  await expect(phone.getByRole('dialog', { name: 'Your score' })).toBeVisible({ timeout: 30_000 });
  await ctx.close();
  fs.rmSync(wav, { force: true });
});

test('sing history: a take is recorded even when you leave without finishing, and counts as a song sung', async ({ page }) => {
  test.skip(!process.env.E2E_SB_URL, 'set E2E_SB_URL / E2E_SB_SERVICE');
  test.setTimeout(120_000);
  const wav = singingWav();
  await fakeMicrophone(page, wav);
  await signUp(page, 'History Singer');
  await page.goto(`/stage/${FIXTURE_TRACK}?video=1`);
  await page.getByLabel('Kind of video').selectOption('original');
  await page.getByLabel('YouTube link').fill('pKtLNYNWbBw');
  await page.getByRole('button', { name: 'Use video' }).click();
  await expect(page.getByTestId('main-video').locator('iframe')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Start singing' }).click();
  await page.waitForTimeout(1500);   // mic calibration
  await page.evaluate(() => {
    const c = (window as unknown as HostW).__soundcheckStage.clock as unknown as { videoTime: () => number; isPlaying: () => boolean };
    const t0 = performance.now();
    c.videoTime = () => 1 + (performance.now() - t0) / 1000;
    c.isPlaying = () => true;
    (window as unknown as { __fakeMicSing: (s: number) => void }).__fakeMicSing(0);
  });
  await page.waitForTimeout(24_000);
  await page.getByRole('link', { name: 'Leave Stage' }).click();          // no Finish: still recorded
  await page.waitForURL(/\/track\//);
  await page.waitForTimeout(1_000);
  await page.goto('/library?tab=sung');
  const row = page.getByRole('list', { name: 'Songs you sang' }).getByRole('listitem').first();
  await expect(row).toContainText('Testing Stage', { timeout: 15_000 });
  await expect(row).toContainText('not scored');
  await page.goto('/leaderboards');
  await expect(page.getByRole('region', { name: 'Your stats' })).toContainText(/Songs sung\s*1/);
  fs.rmSync(wav, { force: true });
});
