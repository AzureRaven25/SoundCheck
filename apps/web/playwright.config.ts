import { defineConfig, devices } from '@playwright/test';

/** E2E against the local Supabase stack (supabase start) and the Next dev server. */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: { command: 'npx next dev --port 3000', url: 'http://localhost:3000', reuseExistingServer: true, timeout: 120_000 },
});
