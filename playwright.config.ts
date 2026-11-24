import { defineConfig, devices } from '@playwright/test';

const baseURL = new URL(process.env.BROWSER_TEST_BASE_URL ?? 'http://127.0.0.1:18080');
if (
  baseURL.protocol !== 'http:' ||
  baseURL.hostname !== '127.0.0.1' ||
  baseURL.href !== `${baseURL.origin}/`
) {
  throw new Error('BROWSER_TEST_BASE_URL must be a disposable stack origin on 127.0.0.1.');
}

export default defineConfig({
  testDir: './tests/browser',
  forbidOnly: Boolean(process.env.CI),
  use: { baseURL: baseURL.origin },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
