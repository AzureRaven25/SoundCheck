import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_TRACK, JELLYFIN_TEST, NAVIDROME_TEST, seedFixtureTrack, signUp } from './helpers';

// Personal music server (Subsonic API) end to end, against a local Navidrome:
//   docker run -d --name sc-navidrome -p 4533:4533 -v <library>:/music:ro -v <data>:/data deluan/navidrome
// with a 75 s "Testing Stage" by "Good News" in the library and NAVIDROME_TEST's admin account.
const audio = (page: Page) => page.evaluate(() => { const a = document.querySelector('audio')!; return { t: a.currentTime, d: a.duration }; });

test.beforeAll(seedFixtureTrack);

test('connect a Navidrome server, play a song in full, and make a catalog song karaoke-ready from it', async ({ page }) => {
  test.skip(!process.env.E2E_NAVIDROME, 'set E2E_NAVIDROME=1 with the local Navidrome running (and the worker for the karaoke step)');
  test.setTimeout(300_000);
  await signUp(page, 'Server Singer');
  await page.goto('/settings');
  await expect(page.getByLabel('Display name')).toHaveValue('Server Singer');   // the page has finished loading
  const box = page.getByRole('region', { name: 'Your music server' });
  await box.getByLabel('Server address').fill(NAVIDROME_TEST.url);
  await box.getByLabel('Server username').fill(NAVIDROME_TEST.username);
  await box.getByLabel('Server password').fill(NAVIDROME_TEST.password);
  await box.getByRole('button', { name: 'Connect server' }).click();
  await expect(box.getByRole('status')).toContainText('Connected to Navidrome');
  // the password itself is never stored
  expect(await page.evaluate(() => localStorage.getItem('soundcheck.servers.v1'))).not.toContain(NAVIDROME_TEST.password);

  await page.goto('/search?q=Testing%20Stage');
  const fromServer = page.getByRole('region', { name: 'From your music server' });
  await fromServer.getByRole('button', { name: 'Play Testing Stage' }).click();
  await expect(page.getByTestId('source-label')).toContainText('Navidrome');
  await expect.poll(async () => (await audio(page)).d, { timeout: 20_000 }).toBeGreaterThan(70);
  expect(Math.abs((await audio(page)).d - 75)).toBeLessThan(1);
  await expect.poll(async () => (await audio(page)).t, { timeout: 45_000, intervals: [2000] }).toBeGreaterThan(31);
  await page.getByRole('contentinfo').getByRole('button', { name: 'Pause', exact: true }).click();

  // karaoke from the user's own copy: picked from their server, uploaded privately, processed by the worker
  await page.goto(`/track/${FIXTURE_TRACK}`);
  await page.getByRole('button', { name: 'Use my music server’s copy' }).click();
  await page.getByRole('list', { name: 'Matches on your music server' }).getByRole('button', { name: /Testing Stage/ }).click();
  await expect(page.getByText(/Karaoke-ready: full-length playback/)).toBeVisible({ timeout: 240_000 });
});

test('connect a Jellyfin server and play a song in full', async ({ page }) => {
  test.skip(!process.env.E2E_JELLYFIN, 'set E2E_JELLYFIN=1 with the local Jellyfin running');
  test.setTimeout(120_000);
  await signUp(page, 'Jelly Singer');
  await page.goto('/settings');
  await expect(page.getByLabel('Display name')).toHaveValue('Jelly Singer');
  const box = page.getByRole('region', { name: 'Your music server' });
  await box.getByLabel('Server type').selectOption('jellyfin');
  await box.getByLabel('Server address').fill(JELLYFIN_TEST.url);
  await box.getByLabel('Server username').fill(JELLYFIN_TEST.username);
  await box.getByLabel('Server password').fill(JELLYFIN_TEST.password);
  await box.getByRole('button', { name: 'Connect server' }).click();
  await expect(box.getByRole('status')).toContainText('Connected to Jellyfin');
  expect(await page.evaluate(() => localStorage.getItem('soundcheck.servers.v1'))).not.toContain(JELLYFIN_TEST.password);

  await page.goto('/search?q=Testing%20Stage');
  await page.getByRole('region', { name: 'From your music server' }).getByRole('button', { name: 'Play Testing Stage' }).click();
  await expect(page.getByTestId('source-label')).toContainText('Jellyfin');
  await expect.poll(async () => (await audio(page)).d, { timeout: 30_000 }).toBeGreaterThan(70);
  expect(Math.abs((await audio(page)).d - 75)).toBeLessThan(1.5);
  await expect.poll(async () => (await audio(page)).t, { timeout: 20_000 }).toBeGreaterThan(3);
});

test('import a whole music server library (Navidrome)', async ({ page }) => {
  test.skip(!process.env.E2E_NAVIDROME, 'set E2E_NAVIDROME=1 with the local Navidrome running');
  test.setTimeout(180_000);
  await signUp(page, 'Library Mover');
  await page.goto('/settings');
  await expect(page.getByLabel('Display name')).toHaveValue('Library Mover');
  const box = page.getByRole('region', { name: 'Your music server' });
  await box.getByLabel('Server address').fill(NAVIDROME_TEST.url);
  await box.getByLabel('Server username').fill(NAVIDROME_TEST.username);
  await box.getByLabel('Server password').fill(NAVIDROME_TEST.password);
  await box.getByRole('button', { name: 'Connect server' }).click();
  await expect(box.getByRole('status')).toContainText('Connected to Navidrome');

  await page.goto('/import');
  await page.getByRole('button', { name: 'Import from Navidrome' }).click();
  const start = page.getByRole('button', { name: /^Import \d+ songs?$/ });
  await expect(start).toBeVisible({ timeout: 60_000 });
  const n = Number((await start.textContent())!.match(/\d+/)![0]);
  await page.getByLabel('Make karaoke versions').uncheck();
  await start.click();
  await expect(page.getByTestId('import-summary')).toContainText(`${n} of ${n}`, { timeout: 120_000 });
  await expect(page.getByTestId('import-summary')).toContainText('0 failed');
  await page.goto('/library?tab=music');
  await expect(page.getByRole('row').nth(1)).toBeVisible();
});
