import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

// M8 social: two singers find each other, become friends (both earn "Duet Partner"), and see each other on
// the friends side of the leaderboards page.
test('friends: request, accept, badges and leaderboards', async ({ browser }) => {
  test.setTimeout(120_000);
  const stamp = Date.now().toString(36);
  const [a, b] = await Promise.all([browser.newPage(), browser.newPage()]);
  await signUp(a, `Avery ${stamp}`);
  await signUp(b, `Blake ${stamp}`);

  await a.goto('/achievements');
  await expect(a.getByText(/^0 of \d+ earned$/)).toBeVisible();

  await a.goto('/friends');
  await a.getByPlaceholder('Find people by name or username').fill(`Blake ${stamp}`);
  await a.getByRole('button', { name: 'Add' }).click();
  await expect(a.getByText('Request sent')).toBeVisible();

  await b.goto('/friends');
  const requests = b.getByRole('region', { name: 'Friend requests' });
  await expect(requests.getByText(`Avery ${stamp}`)).toBeVisible();
  await requests.getByRole('button', { name: 'Accept' }).click();
  await expect(b.getByRole('region', { name: 'Your friends' }).getByText(`Avery ${stamp}`)).toBeVisible();

  await a.goto('/friends');
  await expect(a.getByRole('region', { name: 'Your friends' }).getByText(`Blake ${stamp}`)).toBeVisible();
  for (const p of [a, b]) {
    await p.goto('/achievements');
    await expect(p.getByText(/^1 of \d+ earned$/)).toBeVisible();
    await expect(p.getByText('Duet Partner')).toBeVisible();
  }

  await a.goto('/leaderboards');
  await expect(a.getByRole('region', { name: 'Your stats' })).toBeVisible();
  await a.getByRole('tab', { name: 'friends' }).click();
  await expect(a.getByRole('region', { name: 'friends leaderboard' })).toBeVisible();
});

test('invite link: share it, a friend opens it, adds you, you accept', async ({ page, browser }) => {
  test.setTimeout(90_000);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await signUp(page, 'Inviter Ivy');
  await page.goto('/friends');
  await page.getByRole('button', { name: 'Share invite link' }).click();
  await expect(page.getByRole('button', { name: 'Link copied!' })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/friends\?invite=[0-9a-f-]{36}$/);

  const ctx = await browser.newContext();
  const guest = await ctx.newPage();
  await guest.goto(link);
  await expect(guest.getByText('Someone invited you to be friends')).toBeVisible();   // logged out: the invite survives login
  await signUp(guest, 'Invitee Ian');
  await guest.goto(link);
  const invite = guest.getByRole('region', { name: 'Invitation' });
  await expect(invite).toContainText('Inviter Ivy invited you');
  await invite.getByRole('button', { name: 'Add friend' }).click();
  await expect(invite).toContainText('Request sent');

  await page.reload();
  await page.getByRole('region', { name: 'Friend requests' }).getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByRole('region', { name: 'Your friends' })).toContainText('Invitee Ian');
  await ctx.close();
});
