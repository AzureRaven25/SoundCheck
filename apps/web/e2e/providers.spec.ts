import { expect, test } from '@playwright/test';

// Official providers that need SoundCheck credentials degrade honestly when those aren't configured:
// YouTube still works by pasted link (official embedded player), Apple Music stays hidden.
test('YouTube plays through its official embed from a pasted link; Apple Music hidden until configured', async ({ page }) => {
  await page.goto('/search?q=Stand%20by%20Me');
  await page.getByRole('link', { name: 'Stand by Me', exact: true }).first().click();
  await page.getByRole('button', { name: 'Watch on YouTube' }).click();
  await expect(page.getByText('Paste a YouTube or YouTube Music link')).toBeVisible();   // no YOUTUBE_API_KEY locally
  await page.getByLabel('YouTube link').fill('https://example.com/watch?v=hwZNL7QVJjE');
  await page.getByRole('region', { name: 'Listen elsewhere' }).getByRole('button', { name: /^(Play|Use this link)$/ }).click();
  await expect(page.getByRole('region', { name: 'Listen elsewhere' }).getByRole('alert')).toContainText('isn’t a YouTube link');
  await page.getByLabel('YouTube link').fill('https://music.youtube.com/watch?v=hwZNL7QVJjE&list=x');
  await page.getByRole('region', { name: 'Listen elsewhere' }).getByRole('button', { name: /^(Play|Use this link)$/ }).click();
  await expect(page.getByTitle('YouTube video player')).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/hwZNL7QVJjE/);
  await expect(page.getByRole('button', { name: 'Play on Apple Music' })).toHaveCount(0);       // no MusicKit key locally
});

test('artist pages show the artist’s photo (Wikimedia Commons via Wikidata)', async ({ page }) => {
  await page.goto('/search?q=Radiohead');
  await page.getByRole('link', { name: /^Radiohead/ }).first().click();
  await expect(page).toHaveURL(/\/artist\//);
  await expect(page.locator('header img[src*="wikimedia"]').first()).toBeVisible({ timeout: 20_000 });
});

test('a song with a chosen YouTube video plays in full through the site player', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/search?q=Stand%20by%20Me');
  await page.getByRole('link', { name: 'Stand by Me', exact: true }).first().click();
  await expect(page).toHaveURL(/\/track\//);
  const url = page.url();
  await page.getByRole('button', { name: 'Watch on YouTube' }).click();
  await page.getByLabel('YouTube link').fill('https://www.youtube.com/watch?v=hwZNL7QVJjE');
  await page.getByRole('region', { name: 'Listen elsewhere' }).getByRole('button', { name: /^(Play|Use this link)$/ }).click();
  await page.goto(url);                                                     // fresh page: only the site player
  await page.getByRole('button', { name: /^Play Stand by Me$/ }).first().click();
  await expect(page.getByTestId('source-label')).toContainText('YouTube');
  await expect(page.getByRole('region', { name: 'YouTube player' }).locator('iframe')).toHaveAttribute('src', /hwZNL7QVJjE/, { timeout: 20_000 });
  const bar = page.getByRole('contentinfo');
  await expect(bar.getByText(/^0:0[3-9]$|^0:[1-5]\d$/).first()).toBeVisible({ timeout: 40_000 });   // elapsed time is moving
});
