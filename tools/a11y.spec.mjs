import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { STATES, prep } from './states.mjs';

// Known violations, checked in so new ones fail and old ones stay visible.
// Shape: { "<state>": ["<rule id>|<selector>", ...] }. Regenerate deliberately:
//   A11Y_WRITE_BASELINE=1 npx playwright test a11y.spec.mjs --workers=1
const BASELINE_PATH = new URL('./a11y-baseline.json', import.meta.url);
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));

test.use({ viewport: { width: 1084, height: 900 } });
test.beforeEach(async ({ page }) => { await prep(page); });

for (const s of STATES) {
  test(`a11y ${s.name}`, async ({ page }) => {
    await s.setup(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const keys = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .flatMap((v) => v.nodes.map((n) => `${v.id}|${n.target.join(' ')}`))
      .sort();
    if (process.env.A11Y_WRITE_BASELINE) {
      // Written per test, not in afterAll: a failing test restarts the worker and loses
      // module state, so the accumulate-then-dump version silently wrote a partial file.
      const { writeFileSync } = await import('node:fs');
      const cur = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
      cur[s.name] = keys;
      writeFileSync(BASELINE_PATH, JSON.stringify(cur, Object.keys(cur).sort(), 2) + '\n');
      return;
    }
    const known = new Set(baseline[s.name] || []);
    expect(keys.filter((k) => !known.has(k)), 'new serious/critical a11y violations').toEqual([]);
  });
}
