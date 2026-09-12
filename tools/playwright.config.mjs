import { defineConfig } from '@playwright/test';

// Local-only. Nothing here ships; the repo root stays buildless on purpose.
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs/,
  snapshotDir: 'snapshots',
  outputDir: 'report/artifacts',
  reporter: [['list'], ['html', { outputFolder: 'report/html', open: 'never' }]],
  fullyParallel: true,
  use: { baseURL: 'http://localhost:4322' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  /* tools/serve.cjs, not .local/serve.js: .local is gitignored and serves only the three
     study routes, so a committed suite cannot depend on it and could never reach the
     rulebook readers, the hub, the library or the home page — the pages assets/app.css
     styles, which is 8,443 of the project's 13,742 CSS declarations. */
  webServer: {
    command: 'node tools/serve.cjs',
    cwd: '..',                       // must start from the repo root
    url: 'http://localhost:4322/study',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
