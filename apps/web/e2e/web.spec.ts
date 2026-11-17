import { expect, test } from '@playwright/test';

test('home shows the hero and catalog shelves', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Find the song/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Karaoke classics' })).toBeVisible();
  await expect(page.locator('a[href^="/track/"]').first()).toBeVisible();
});

test('search finds songs and opens a song page with lyrics', async ({ page }) => {
  await page.goto('/search?q=stand%20by%20me');
  const row = page.getByRole('row').filter({ hasText: 'Ben E. King' }).first();
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: 'Stand by Me' }).first().click(); // song link (the album is also titled Stand by Me)
  await expect(page.getByRole('heading', { level: 1, name: 'Stand by Me' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lyrics' })).toBeVisible();
});

test('protected pages redirect to login', async ({ page }) => {
  await page.goto('/library');
  await expect(page).toHaveURL(/\/login\?next=%2Flibrary/);
});

test('sign up, favorite a song, build a playlist', async ({ page }) => {
  const email = `e2e-${Date.now()}@soundcheck.test`;
  await page.goto('/signup');
  await page.getByLabel('Display name').fill('E2E Singer');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();

  // favorite from a song page
  await page.goto('/search?q=i%20will%20survive');
  await page.getByRole('row').filter({ hasText: 'Gloria Gaynor' }).first().getByRole('link', { name: 'I Will Survive' }).click();
  await page.getByRole('button', { name: /Save I Will Survive to favorites/ }).click();
  await page.goto('/library?tab=favorites');
  await expect(page.getByRole('link', { name: 'I Will Survive' })).toBeVisible();

  // create a playlist from the sidebar and add the song via the row menu
  await page.getByRole('button', { name: 'Create playlist' }).click();
  await expect(page).toHaveURL(/\/playlist\//);
  const playlistUrl = page.url();
  await page.goto('/library?tab=favorites');
  const fav = page.getByRole('row').filter({ hasText: 'I Will Survive' }).first();
  await fav.hover();
  await fav.getByRole('button', { name: /More options/ }).click();
  await page.getByRole('menuitem', { name: /My Playlist #1/ }).click();
  await page.goto(playlistUrl);
  await expect(page.getByRole('link', { name: 'I Will Survive' })).toBeVisible();

  // rename + settings persist
  await page.getByLabel('Playlist name').fill('Road Trip');
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Road Trip' })).toBeVisible();
  await page.goto('/settings');
  await page.getByLabel('Username').fill(`e2e_${Date.now() % 1e6}`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
});

test('player queues an album-style list and controls work', async ({ page }) => {
  await page.goto('/');
  const firstCard = page.locator('a[href^="/track/"]').first();
  await firstCard.hover();
  await firstCard.getByRole('button', { name: /^Play / }).click();
  await expect(page.getByRole('contentinfo', { name: 'Player' }).getByRole('link').first()).toBeVisible();
  await page.getByRole('button', { name: 'Queue' }).click();
  await expect(page.getByRole('complementary', { name: 'Queue' })).toContainText('Next up');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Shuffle' }).click();
  await expect(page.getByRole('button', { name: 'Shuffle' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Repeat off/ }).click();
  await expect(page.getByRole('button', { name: 'Repeat all' })).toBeVisible();
});

// Needs a running worker (karaoke-pipeline worker) and E2E_SONG pointing at a sung test track
// (services/pipeline/tests/fixtures/make_song.py). Skipped otherwise.
test('upload your copy → processed into karaoke tracks', async ({ page }) => {
  test.skip(!process.env.E2E_SONG, 'set E2E_SONG to a test audio file and run the worker');
  test.setTimeout(240_000);
  await page.goto('/signup');
  await page.getByLabel('Display name').fill('Uploader');
  await page.getByLabel('Email').fill(`up-${Date.now()}@soundcheck.test`);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
  await page.goto('/search?q=wild%20thing%20troggs');
  await page.getByRole('row').filter({ hasText: 'The Troggs' }).first().getByRole('link', { name: 'Wild Thing' }).first().click();
  await expect(page.getByText(/Make “Wild Thing” karaoke-ready/)).toBeVisible();
  await page.getByLabel('Audio file').setInputFiles(process.env.E2E_SONG!);
  await expect(page.getByRole('status')).toContainText(/Queued|Separating|Mapping|Finding|Timing|Detecting|Saving|Fetching/);
  await expect(page.getByText(/Your copy is ready/)).toBeVisible({ timeout: 200_000 });
});
