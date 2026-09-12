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
        if (s.settle) await s.settle(page);
        await expect(page).toHaveScreenshot(`${s.name}-${w}.png`, {
          // A rulebook part is ~71,000px tall; shooting it whole is both slow and
          // dominated by body text that no CSS change we care about moves. Those states
          // set fullPage:false and are judged on the chrome, the Contents and the first
          // sections — which is where the layout actually lives.
          fullPage: s.fullPage !== false,
          maxDiffPixelRatio: 0.01,
          animations: 'disabled',
        });
      });
    }
  });
}
