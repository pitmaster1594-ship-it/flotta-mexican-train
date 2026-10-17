import { defineConfig } from '@playwright/test';

const deployed = process.env.FLOTTA_BROWSER_URL;
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: 'list',
  use: {
    browserName: 'chromium',
    headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
  },
  webServer: deployed ? undefined : {
    command: 'npm run build && wrangler dev --ip 127.0.0.1 --port 8788 --persist-to .wrangler/browser-tests',
    url: 'http://127.0.0.1:8788/api/info',
    reuseExistingServer: false,
    timeout: 60000,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
});
