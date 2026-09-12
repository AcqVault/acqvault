import { defineConfig } from '@playwright/test';

// Local-only. Nothing here ships; the repo root stays buildless on purpose.
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs/,
  snapshotDir: 'snapshots',
  outputDir: 'report/artifacts',
  reporter: [['list'], ['html', { outputFolder: 'report/html', open: 'never' }]],
  fullyParallel: true,
  use: { baseURL: 'http://localhost:4321' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'node .local/serve.js',
    cwd: '..',                       // must start from the repo root
    url: 'http://localhost:4321/study',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
