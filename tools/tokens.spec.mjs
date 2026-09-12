import { test, expect } from '@playwright/test';
import { STATES, prep } from './states.mjs';

/* Every custom property a page REFERENCES must be DEFINED by a stylesheet that page loads.
 *
 * This exists because tokenising colours and radii pointed five `var(--x)` uses on the home
 * page at :root definitions that live in api/_seo.js — and index.html is a static file with
 * no server-rendered STYLE block, so assets/app.css is the only stylesheet it has. The
 * tokens resolved to nothing, the page lost its surfaces and its pills, and the screenshot
 * suite could not reliably tell me: a 2px corner and a 1px border both fall under the
 * maxDiffPixelRatio. An undefined token is not a visual judgement call, it is a fact, so
 * check it as one.
 *
 * A name defined by ANY rule counts, not just :root — some tokens are deliberately scoped
 * to a component or a media query, and those are correct.
 */
test.beforeEach(async ({ page }) => { await prep(page); });

for (const s of STATES) {
  test(`tokens resolve · ${s.name}`, async ({ page }) => {
    await s.setup(page);
    const missing = await page.evaluate(() => {
      const defined = new Set(), used = new Set();
      /* A var() WITH a fallback is a deliberate optional — var(--ui,inherit) is meant to
         be undefined most of the time. Only a bare var(--x) is a promise the page has to
         keep, so only those are collected. */
      const BARE = /var\(\s*(--[a-z0-9-]+)\s*\)/gi;
      const walk = (rules) => {
        for (const r of rules) {
          if (r.cssRules) walk(r.cssRules);
          if (!r.style) continue;
          for (const p of r.style) if (p.startsWith('--')) defined.add(p);
          for (const m of (r.cssText || '').matchAll(BARE)) used.add(m[1]);
        }
      };
      for (const ss of document.styleSheets) {
        try { walk(ss.cssRules); } catch (e) { /* cross-origin; none here */ }
      }
      document.querySelectorAll('[style]').forEach((el) => {
        const t = el.getAttribute('style');
        for (const m of t.matchAll(BARE)) used.add(m[1]);
        // properties JS writes onto an element are defined too, just not by a stylesheet
        for (const m of t.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
      });
      return [...used].filter((n) => !defined.has(n)).sort();
    });
    expect(missing, `custom properties used on ${s.name} but defined by no stylesheet it loads`).toEqual([]);
  });
}
