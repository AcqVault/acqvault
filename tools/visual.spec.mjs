import { test, expect } from '@playwright/test';
import { STATES, prep } from './states.mjs';

// 1084 = the owner's measured Chrome width, 1320 = the three-column breakpoint, 375 = phone.
const WIDTHS = [1084, 1320, 375];

test.beforeEach(async ({ page }) => { await prep(page); });

for (const w of WIDTHS) {
  test.describe(`${w}px`, () => {
    test.use({ viewport: { width: w, height: 900 } });
    for (const s of STATES) {
      test(s.name, async ({ page }) => {
        await s.setup(page);
        await expect(page).toHaveScreenshot(`${s.name}-${w}.png`, {
          fullPage: true,
          maxDiffPixelRatio: 0.01,
          animations: 'disabled',
        });
      });
    }
  });
}
