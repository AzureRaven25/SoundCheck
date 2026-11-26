import { expect, test } from '@playwright/test';

// Forgot password, end to end on the local stack: the reset email lands in Mailpit (http://127.0.0.1:54324).
const MAILPIT = 'http://127.0.0.1:54324';

async function latestLink(to: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=1`)).json() as { messages: { ID: string }[] };
    if (list.messages?.[0]) {
      const msg = await (await fetch(`${MAILPIT}/api/v1/message/${list.messages[0].ID}`)).json() as { Text: string; HTML: string };
      const m = /(https?:\/\/[^\s"<>]+verify[^\s"<>]+)/.exec(msg.Text || msg.HTML);
      if (m) return m[1]!.replace(/&amp;/g, '&');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('no reset email');
}

test('forgot password: email link, new password, log in with it', async ({ page }) => {
  test.skip(!process.env.E2E_SB_URL, 'needs the local stack (Mailpit)');
  test.setTimeout(90_000);
  const email = `forgot-${Date.now()}@soundcheck.test`;
  await page.goto('/signup');
  await page.getByLabel('Display name').fill('Forgetful');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('first-password-1');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();

  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.waitForURL(/forgot-password/);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill(email);
  await expect(page.getByLabel('Email')).toHaveValue(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText('a link to set a new password is on its way');

  await page.goto(await latestLink(email));
  await expect(page).toHaveURL(/\/reset-password/, { timeout: 15_000 });
  await page.getByRole('textbox', { name: /^New password/ }).fill('second-password-2');
  await page.getByLabel('Confirm new password').fill('second-password-2');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByRole('status')).toContainText('Password updated');

  await page.getByRole('button', { name: 'Account menu' }).click({ timeout: 10_000 });
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('first-password-1');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Wrong email or password' })).toBeVisible();
  await page.getByLabel('Password').fill('second-password-2');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible({ timeout: 10_000 });
});

test('a used or missing reset link offers a new one', async ({ page }) => {
  await page.goto('/reset-password');
  await expect(page.getByText('This reset link has expired or was already used.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Send a new link' })).toHaveAttribute('href', '/forgot-password');
});

test('an older-format reset link (session after #) still opens "Choose a new password"', async ({ page }) => {
  const url = process.env.E2E_SB_URL, anon = process.env.E2E_SB_ANON, service = process.env.E2E_SB_SERVICE;
  test.skip(!url || !anon || !service, 'needs the local stack (Mailpit)');
  const email = `implicit-${Date.now()}@soundcheck.test`;
  await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: service!, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'first-password-1', email_confirm: true }) });
  // a direct request without PKCE, as other clients or the dashboard send it
  const r = await fetch(`${url}/auth/v1/recover?redirect_to=${encodeURIComponent('http://localhost:3000/auth/callback')}`, {
    method: 'POST', headers: { apikey: anon!, 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  expect(r.status).toBe(200);
  await page.goto(await latestLink(email));
  await expect(page).toHaveURL(/\/reset-password$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^New password/ })).toBeVisible();
});

test('an expired or used link explains itself instead of dropping you on the login page', async ({ page }) => {
  await page.goto('/auth/callback?code=00000000-0000-4000-8000-000000000000');
  await expect(page.getByRole('heading', { name: 'That link didn’t work' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Send a new reset link' })).toHaveAttribute('href', '/forgot-password');
});
