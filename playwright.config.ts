import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Submissions go into a private review queue, so the tests never touch the real one:
// Playwright wipes a local state folder, creates the table from schema.sql in a local D1,
// and starts `wrangler dev` on that. Published cases are faked per test with page.route.
const PORT = 8793;
const BASE_URL = `http://127.0.0.1:${PORT}`;
export const STATE = '.wrangler/test-state';
// The whole folder is the website and `wrangler dev` restarts on every change in it, so test output
// (screenshots, traces, the report) is written outside the folder, or the server restarts mid-test.
const OUT = join(tmpdir(), 'maskountability-playwright');

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  outputDir: join(OUT, 'test-results'),
  reporter: [['list'], ['html', { open: 'never', outputFolder: join(OUT, 'report') }]],
  use: { baseURL: BASE_URL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'api', testDir: './tests/api' },
    { name: 'chromium', testDir: './tests/ui', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', testDir: './tests/ui', grep: /@mobile/, use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command:
      `node -e "require('fs').rmSync('${STATE}',{recursive:true,force:true})"` +
      ` && npx wrangler d1 execute maskountability-submissions --local --persist-to ${STATE} --file schema.sql` +
      ` && npx wrangler dev --port ${PORT} --ip 127.0.0.1 --persist-to ${STATE}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
