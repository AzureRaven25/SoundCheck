import { defineConfig, devices } from '@playwright/test';

/** Smoke tests against the deployed site (no local stack): `npx playwright test -c playwright.prod.config.ts`. */
export default defineConfig({
  testDir: './e2e',
  testMatch: ['acquisition.spec.ts'],
  grep: /open sources/,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: [['list']],
  use: { baseURL: process.env.PROD_URL ?? 'https://soundcheck-gules.vercel.app' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
