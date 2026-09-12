/* Page-TYPE accessibility sweep.
 *
 * a11y.spec.mjs drives 15 STATES of the interactive pages. This walks one URL per
 * page type instead — every hub source, a part page from a differently-shaped
 * source, and /slip, which had no coverage of any kind. That gap was real: /slip
 * was failing AA twice (a label token tuned against one dark surface but used on
 * two, and the system blue used as text at 3.82:1).
 *
 * No baselines and no screenshots, so it is cheap to run and cannot go flaky.
 *   node a11y-sweep.mjs            (expects tools/serve.cjs on :4322)
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.BASE || 'http://localhost:4322';
const URLS = ['/', '/study', '/48cons', '/source-selection', '/library', '/rfo', '/rfo/part-1',
  '/deviations', '/changes', '/what-is-the-rfo', '/r-dfars', '/r-dfars/part-52', '/far-companion',
  '/ssp', '/ssp/part-A', '/fmr', '/fmr/part-1', '/pgi', '/pgi/part-1', '/afi-63-138',
  '/category-management', '/slip'];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1084, height: 900 } });
let violations = 0, errors = 0, checked = 0;

for (const u of URLS) {
  const p = await ctx.newPage();
  try {
    const r = await p.goto(BASE + u, { waitUntil: 'networkidle', timeout: 30000 });
    if (!r || r.status() !== 200) { console.log(`FAIL ${u} :: status ${r && r.status()}`); errors++; await p.close(); continue; }
    await p.waitForTimeout(400);
    const res = await new AxeBuilder({ page: p })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    checked++;
    const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    if (bad.length) {
      violations += bad.length;
      console.log(`\n${u}`);
      for (const v of bad) console.log(`   ${v.impact} ${v.id} x${v.nodes.length} :: ${JSON.stringify(v.nodes[0].target)}`);
    }
  } catch (e) { errors++; console.log(`ERR  ${u} :: ${e.message.split('\n')[0]}`); }
  await p.close();
}
await b.close();
// An errored page is a failure, not a pass: a sweep that silently checks nothing
// and prints "no violations" is worse than no sweep.
console.log(`\nchecked ${checked}/${URLS.length} · ${errors} errored · ${violations} serious/critical`);
process.exit(violations || errors ? 1 : 0);
