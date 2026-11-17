import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

// TV sign-in with a phone: a "TV" starts the device flow, a signed-in phone approves the code at /activate,
// and the TV's next poll returns a one-time token that signs it in as that user.
test('a phone approves a TV sign-in code', async ({ page }) => {
  const url = process.env.E2E_SB_URL, anon = process.env.E2E_SB_ANON;
  test.skip(!url || !anon, 'set E2E_SB_URL and E2E_SB_ANON (publishable key)');
  const call = async (body: object) => (await fetch(`${url}/functions/v1/device-auth`, {
    method: 'POST', headers: { apikey: anon!, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })).json();

  const start = await call({ action: 'start', platform: 'firetv' });
  expect(start.user_code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  expect((await call({ action: 'poll', device_code: start.device_code })).status).toBe('pending');

  await signUp(page, 'Couch Singer');
  await page.goto(`/activate?code=${start.user_code}`);
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('heading', { name: 'Your Fire TV is signed in' })).toBeVisible();

  const done = await call({ action: 'poll', device_code: start.device_code });
  expect(done.status).toBe('approved');
  // the token signs the TV in as the approving user, exactly once
  const verify = await fetch(`${url}/auth/v1/verify`, {
    method: 'POST', headers: { apikey: anon!, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: done.token_hash }),
  });
  expect(verify.status).toBe(200);
  expect((await verify.json()).user.email).toBe(done.email);
  expect((await call({ action: 'poll', device_code: start.device_code })).status).toBe('expired');
  // a code can't be approved by a guest or approved twice
  await page.goto(`/activate?code=${start.user_code}`);
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
});
