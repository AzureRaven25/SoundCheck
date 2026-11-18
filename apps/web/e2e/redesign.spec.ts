/** Redesigned home, Sing hub, recommendations, library "Your music" and availability tags. */
import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

test('home: actions, genres and shelves', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Find the song.');
  await expect(page.getByRole('link', { name: /Start a party/ })).toHaveAttribute('href', '/sing');
  await expect(page.getByRole('navigation', { name: 'Genres' }).getByRole('link', { name: 'Jazz' })).toHaveAttribute('href', '/search?q=jazz');
  await expect(page.getByRole('heading', { name: 'Karaoke classics' })).toBeVisible();
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
  const shelf = page.getByRole('region').filter({ has: page.getByRole('heading', { name: 'Picked for you' }) });
  await expect(page.getByRole('heading', { name: 'Picked for you' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Because you've been listening to Gloria Gaynor")).toBeVisible();
  await expect(shelf.getByRole('link', { name: 'I Will Survive' })).toHaveCount(0); // already yours
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
