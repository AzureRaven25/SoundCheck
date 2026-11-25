/** Redesigned home, Sing hub, recommendations, library "Your music" and availability tags. */
import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

test('home: actions, genres and shelves', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sing anything.');
  await expect(page.getByRole('link', { name: /Start a party/ })).toHaveAttribute('href', '/sing');
  await expect(page.getByRole('navigation', { name: 'Genres' }).getByRole('link', { name: 'Jazz' })).toHaveAttribute('href', '/genre/jazz');
  await expect(page.getByRole('heading', { name: 'Karaoke classics' })).toBeVisible();
  // the hero search goes straight to results; cards have a one-tap Sing button
  await page.getByLabel('What do you want to sing?').fill('stand by me');
  await page.getByRole('button', { name: 'Let’s sing' }).click();
  await expect(page).toHaveURL(/\/search\?q=stand%20by%20me/);
});

test('song cards open Stage with one tap', async ({ page }) => {
  await page.goto('/');
  const sing = page.getByRole('button', { name: /^Sing / }).first();
  await sing.focus();
  await sing.click();
  await expect(page).toHaveURL(/\/stage\//);
});

test('sing hub: host and join', async ({ page }) => {
  await page.goto('/sing');
  await expect(page.getByRole('heading', { name: 'Host a party' })).toBeVisible();
  const code = page.getByLabel('Party code');
  await code.fill('abc23!4');
  await expect(code).toHaveValue('ABC234');
  await page.getByRole('button', { name: 'Join' }).click();
  await expect(page).toHaveURL(/\/join\/ABC234$/);
});

test('favorites drive "Picked for you"; library lists your music', async ({ page }) => {
  await signUp(page, 'Recommender');
  await page.goto('/search?q=i%20will%20survive');
  await page.getByRole('row').filter({ hasText: 'Gloria Gaynor' }).first().getByRole('link', { name: 'I Will Survive' }).click();
  await page.getByRole('button', { name: /Save I Will Survive to favorites/ }).click();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Picked for you' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Because you've been listening to Gloria Gaynor")).toBeVisible();
  await page.goto('/library?tab=music');
  await expect(page.getByText(/Songs you upload or import show up here/)).toBeVisible();
});

test('keyboard: space toggles playback, not while typing', async ({ page }) => {
  await page.goto('/');
  const firstCard = page.locator('a[href^="/track/"]').first();
  await firstCard.hover();
  await firstCard.getByRole('button', { name: /^Play / }).click();
  const player = page.getByRole('contentinfo', { name: 'Player' });
  await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.getByRole('heading', { level: 1 }).click(); // move focus off the buttons
  await page.keyboard.press('Space');
  await expect(player.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await page.getByRole('searchbox').or(page.getByPlaceholder('What do you want to sing?')).first().click();
  await page.keyboard.press('Space');
  await expect(player.getByRole('button', { name: 'Play', exact: true })).toBeVisible(); // typing a space didn't play
});

test('autoplay continues with similar songs when the queue ends', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/search?q=love');
  const row = page.getByTestId('source-results').locator('li').filter({ hasText: ' · Openverse' }).first();
  await expect(row).toBeVisible({ timeout: 45_000 });
  await row.getByRole('button', { name: /^Play / }).click();
  const audio = page.getByTestId('player-audio');
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.duration), { timeout: 30_000 }).toBeGreaterThan(60);
  const player = page.getByRole('contentinfo', { name: 'Player' });
  const first = await player.getByRole('link').first().textContent();
  await audio.evaluate((a: HTMLAudioElement) => { a.currentTime = a.duration - 1.5; });
  await expect(player.getByRole('link').first()).not.toHaveText(first!, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Queue' }).click();
  await expect(page.getByRole('switch')).toBeChecked();
  await expect(page.getByRole('complementary', { name: 'Queue' }).getByRole('button', { name: /^Play / }).first()).toBeVisible();
});

test('covers load straight from their hosts (no image optimizer)', async ({ page }) => {
  await page.goto('/search?q=queen');
  const rows = page.getByRole('row');
  await expect(rows.nth(3)).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => page.locator('main img').evaluateAll((imgs) =>
    (imgs as HTMLImageElement[]).filter((i) => i.complete && i.naturalWidth > 0).length), { timeout: 30_000 }).toBeGreaterThan(5);
  const srcs = await page.locator('main img').evaluateAll((imgs) => (imgs as HTMLImageElement[]).map((i) => i.src));
  expect(srcs.some((s) => s.includes('/_next/image'))).toBe(false);
});

test('genres: index with counts, genre page lists full songs', async ({ page }) => {
  await page.goto('/genre');
  await expect(page.getByRole('heading', { name: 'Browse by genre' })).toBeVisible();
  const first = page.getByRole('main').getByRole('list').getByRole('link').first();
  await expect(first).toContainText(/\d+ songs/);
  await first.click();
  await expect(page).toHaveURL(/\/genre\/[a-z-]+$/);
  await expect(page.getByText(/[\d,]+ full songs, free to play/)).toBeVisible();
});

test('song list from another app becomes a playlist', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Playlist Mover');
  await page.goto('/import');
  await page.getByLabel('Song list', { exact: true }).fill('Gloria Gaynor - I Will Survive\nStand by Me by Ben E. King\nZzqx Nonexistent Song Qqq');
  await page.getByLabel('Playlist name').fill('Moved over');
  await page.getByRole('button', { name: 'Make playlist' }).click();
  const status = page.getByTestId('songlist-status');
  await expect(status).toContainText('3 of 3 checked', { timeout: 60_000 });
  await expect(status).toContainText('2 found');
  await status.getByRole('link', { name: 'Open playlist' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Moved over' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'I Will Survive' })).toBeVisible();
});

test('empty search shows recent searches and genres', async ({ page }) => {
  await signUp(page, 'Searcher');
  await page.goto('/search?q=queen');
  await expect(page.getByRole('heading', { name: 'Songs' })).toBeVisible({ timeout: 30_000 });
  await page.goto('/search');
  await expect(page.getByRole('region', { name: 'Recent searches' }).getByRole('link', { name: 'queen' })).toBeVisible();
  await page.getByRole('region', { name: 'Browse genres' }).getByRole('link', { name: 'Jazz' }).click();
  await expect(page).toHaveURL(/\/genre\/jazz$/);
});

test('listening history is recorded and shows as Recently played', async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, 'Listener');
  await page.goto('/search?q=love');
  const row = page.getByTestId('source-results').locator('li').filter({ hasText: ' · Openverse' }).first();
  await expect(row).toBeVisible({ timeout: 45_000 });
  const title = (await row.locator('p').first().textContent())!.trim();
  await row.getByRole('button', { name: /^Play / }).click();
  const audio = page.getByTestId('player-audio');
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime), { timeout: 60_000, intervals: [2000] }).toBeGreaterThan(32);
  await page.waitForTimeout(1500); // the entry is written once 30 s have been heard
  await page.goto('/');
  const recent = page.getByRole('region', { name: 'Recently played' });
  await expect(recent).toBeVisible({ timeout: 20_000 });
  await expect(recent).toContainText(title.slice(0, 15));
});

test('a song can be added to a playlist only once', async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, 'Playlist Keeper');
  await page.goto('/library?tab=playlists');
  await page.getByRole('button', { name: 'New playlist' }).click();
  await expect(page).toHaveURL(/\/playlist\//);
  await page.goto('/search?q=stand%20by%20me');
  const row = page.getByRole('row').filter({ hasText: 'Ben E. King' }).first();
  for (const expected of ['Added to My Playlist #1', 'Already in My Playlist #1']) {
    await row.hover();
    await row.getByRole('button', { name: /More options for/ }).click();
    await page.getByRole('menuitem', { name: 'My Playlist #1' }).click();
    await expect(page.getByRole('status').filter({ hasText: expected })).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 5_000 });
  }
  await page.goto('/library?tab=playlists');
  await page.getByRole('link', { name: /My Playlist #1/ }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Ben E. King' })).toHaveCount(1);
});
