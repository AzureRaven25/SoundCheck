import { expect, test, type Page } from '@playwright/test';

// Full-length playback acceptance (research.md §5): a complete open-licensed recording from the Internet
// Archive must play past 30 s, report its real duration (not 30 s), pause/resume and seek, and reach its end.
const audio = (page: Page) => page.evaluate(() => {
  const a = document.querySelector('audio')!;
  return { t: a.currentTime, d: a.duration, paused: a.paused, ended: a.ended };
});

test('a full-length open recording plays past 30 s to its real end', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/open/badpanda018');                         // imports the album, then shows the album page
  await expect(page).toHaveURL(/\/album\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await page.getByRole('row').filter({ hasText: 'Satellite' }).hover();
  await page.getByRole('button', { name: 'Play Satellite' }).click();
  await expect(page.getByTestId('source-label')).toContainText('Internet Archive');
  await expect(page.getByTestId('source-label')).not.toContainText('preview');

  await expect.poll(async () => (await audio(page)).d, { timeout: 30_000 }).toBeGreaterThan(150);
  const { d } = await audio(page);
  // 156.87 s measured by decoding the whole file with ffmpeg. (The archive's metadata says 165.1 s: its
  // lengths for VBR MP3s can be several seconds off, so durations are taken from the decoded audio.)
  expect(Math.abs(d - 156.87)).toBeLessThan(1);

  await expect.poll(async () => (await audio(page)).t, { timeout: 60_000, intervals: [2000] }).toBeGreaterThan(31);   // past preview length, in real time

  const bar = page.getByRole('contentinfo');
  await bar.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = (await audio(page)).t;
  await page.waitForTimeout(1500);
  expect((await audio(page)).paused).toBe(true);
  expect(Math.abs((await audio(page)).t - paused)).toBeLessThan(0.3);
  await bar.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(async () => (await audio(page)).t, { timeout: 10_000 }).toBeGreaterThan(paused + 0.5);

  await page.getByLabel('Seek').fill(String(Math.floor(d - 4)));  // near the real end
  await expect.poll(async () => (await audio(page)).t, { timeout: 10_000 }).toBeGreaterThan(d - 6);
  // it plays out to the true end (then the queue moves on or stops)
  await expect.poll(async () => { const a = await audio(page); return a.ended || a.t < 5 || a.t >= d - 0.5; }, { timeout: 20_000 }).toBe(true);
});
