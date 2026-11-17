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
