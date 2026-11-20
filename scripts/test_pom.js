#!/usr/bin/env node
/* Checks the SHIPPED POM logic in assets/widgets.js (extracted, not rewritten): every
   pivot ties to the FPDS total, no unpicked year appears as $0, disagreeing group labels
   read "Varies", phasing adds up, and a single-year pull carries no multi-year columns.
   Run: node scripts/test_pom.js */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'widgets.js'), 'utf8');
function grab(re, label) { const m = src.match(re); if (!m) { console.error('FAIL: ' + label + ' not found'); process.exit(1); } return m[0]; }
const fns = [
  grab(/const OSR_COLS = \[[\s\S]*?\];/, 'OSR_COLS'), grab(/const OSR_FUND_COLS = [^\n]*/, 'OSR_FUND_COLS'),
  grab(/function osrPivot\(rows, keyFn, fys, extra, avgFys\) \{[\s\S]*?\n  \}/, 'osrPivot'),
  grab(/function osrPomSheets\(rows, fysIn, range\) \{[\s\S]*?\n  \}/, 'osrPomSheets'),
  grab(/function osrContracts\(rows\) \{[\s\S]*?\n  \}/, 'osrContracts'),
  grab(/function osrFundOn\(\) \{[^\n]*/, 'osrFundOn')
].join('\n');
// eslint-disable-next-line no-eval
const ctx = eval('(function(){let osrOn={};let osrMulti=false;\n' + fns
  + '\nOSR_COLS.forEach(function(c){osrOn[c[0]]=1;});\nreturn {osrPomSheets:osrPomSheets};})()');

const now = new Date(), curFy = now.getUTCFullYear() + (now.getUTCMonth() >= 9 ? 1 : 0);
const rows = [
  { office: 'FA0021', piid: 'A', fiscalYear: '2024', dateSigned: '2023-11-02', obligated: 100.10, pscCode: 'R425', pscName: 'ENG', category: 'Service', appropriation: 'Not reported', colorOfMoney: 'Not reported', fundSource: 'FPDS funding agency: DEPT OF THE AIR FORCE' },
  { office: 'FA0021', piid: 'A', fiscalYear: '2026', dateSigned: '2026-09-15', obligated: 200.20, pscCode: 'R425', pscName: 'ENG', category: 'Service', appropriation: 'Not reported', colorOfMoney: 'Not reported', fundSource: 'FPDS funding agency: DEPT OF THE AIR FORCE' },
  { office: 'FA0021', piid: 'B', fiscalYear: '2026', dateSigned: '2026-08-10', obligated: 0.30, pscCode: '7030', pscName: 'SW', category: 'Product', appropriation: 'Not reported', colorOfMoney: 'Not reported', fundSource: 'FPDS funding agency: U.S. SPECIAL OPERATIONS COMMAND' },
  { office: 'FA0021', piid: 'C', fiscalYear: '2026', dateSigned: '2026-01-20', obligated: -50, pscCode: 'R425', pscName: 'ENG', category: 'Service', appropriation: '097-0100 O&M', colorOfMoney: 'O&M', fundSource: 'Defense-Wide (097)' }
];
const total = rows.reduce((a, r) => a + r.obligated, 0);
const sheets = ctx.osrPomSheets(rows, ['2024', '2026']);   // FY2025 was NOT pulled
const byName = (n) => sheets.find((s) => s.name === n);
const near = (a, b) => Math.abs(a - b) < 0.005;

sheets.forEach((sh) => {
  assert.ok(sh.name.length <= 31 && !/[:\\/?*[\]]/.test(sh.name), 'legal sheet name: ' + sh.name);
  assert.ok(!sh.columns.some((c) => /FY2025/.test(c[1])), sh.name + ': an unpulled FY must not appear as a column');
  const cells = JSON.stringify(sh.rows);
  assert.ok(!/undefined|NaN|\[object Object\]/.test(cells), sh.name + ': no junk text');
});
assert.deepStrictEqual(sheets.map((s) => s.name), ['POM - Read Me', 'POM - Oblig by Appropriation', 'POM - Oblig by Work Type', 'POM - Quarterly Phasing'], 'only the oversight/planning tabs');
['POM - Oblig by Appropriation', 'POM - Oblig by Work Type'].forEach((n) => {
  const sh = byName(n); assert.ok(sh, n + ' exists');
  const body = sh.rows.filter((r) => !r._total), tot = sh.rows.filter((r) => r._total);
  assert.ok(near(body.reduce((a, r) => a + r.total, 0), total), n + ': totals tie to FPDS');
  assert.strictEqual(tot.length, 1, n + ': one Total row, last');
  assert.ok(sh.rows[sh.rows.length - 1]._total && near(tot[0].total, total) && near(tot[0].fy2024 + tot[0].fy2026, total), n + ': Total row equals the grand total');
  body.forEach((r) => assert.ok(near(r.fy2024 + r.fy2026, r.total), n + ': FY columns sum to Total'));
});
const appr = byName('POM - Oblig by Appropriation').rows.find((r) => r.group === 'Not reported');
assert.strictEqual(appr.source, 'Varies', 'a group whose contracts disagree on funding source reads Varies');
const svc = byName('POM - Oblig by Work Type').rows.find((r) => r.group === 'Service');
assert.ok(!byName('POM - Quarterly Phasing').rows.some((r) => r._total), 'phasing has no totals row (shares do not add)');
assert.ok(near(svc.deob, -50), 'deobligations are the negative actions');
assert.strictEqual(svc.active, 2, 'active years count positive spend only');
assert.ok(near(svc.avg, svc.total / 2), 'average is over the pulled years');
const ph = byName('POM - Quarterly Phasing').rows;
assert.deepStrictEqual(ph.map((r) => r.fy.slice(0, 6)), ['FY2024', 'FY2026'], 'phasing rows are the pulled years');
const p26 = ph[1];
assert.ok(near(p26.q1 + p26.q2 + p26.q3 + p26.q4, p26.total), 'quarters sum to the FY total');
assert.ok(near(p26.q2, -50) && near(p26.q4, 200.5), 'Jan -> Q2, Aug/Sep -> Q4');
assert.strictEqual(p26.sepshare, 0.999, 'September share is of positive dollars (a number, %-formatted in Excel)');
assert.strictEqual(p26.augsep, 1, 'Aug-Sep share');
// a custom date range passes no years: every FY first..last counts
assert.ok(ctx.osrPomSheets(rows, null).find((x) => x.name === 'POM - Oblig by Work Type').columns.some((c) => /FY2025/.test(c[1])), 'date range fills the gap year');
// one fiscal year: no Avg / FYs-with-obligations / Pattern columns (they'd be blank or meaningless)
const one = ctx.osrPomSheets(rows.filter((r) => r.fiscalYear === '2026'), ['2026']).find((x) => x.name === 'POM - Oblig by Work Type');
assert.deepStrictEqual(one.columns.map((c) => c[0]), ['group', 'fy2026', 'total', 'deob'], 'single-year pull drops multi-year columns');
// the in-progress FY is shown but kept out of the average; a custom window flags clipped years
const cur = String(curFy), prev = String(curFy - 1), prev2 = String(curFy - 2);
const rows3 = [prev2, prev, cur].map((y) => ({ office: 'X', piid: 'P' + y, fiscalYear: y, dateSigned: (Number(y) - 1) + '-11-01', obligated: 100, category: 'Service', appropriation: 'Not reported', colorOfMoney: 'Not reported', fundSource: 'x' }));
const wt = ctx.osrPomSheets(rows3, [prev2, prev, cur]).find((x) => x.name === 'POM - Oblig by Work Type');
assert.ok(wt.columns.some((c) => c[0] === 'fy' + cur && /in progress/.test(c[1])), 'current FY column says in progress');
assert.ok(near(wt.rows[0].avg, 100) && wt.rows[0].active === 2, 'average and active years use complete FYs only');
const wtTot = wt.rows.find((r) => r._total);
assert.ok(wtTot && near(wtTot.avg, (wtTot['fy' + prev2] + wtTot['fy' + prev]) / 2), 'Total row average comes from its own complete-FY columns');
const clip = ctx.osrPomSheets(rows3, null, { from: prev2 + '-03-01', to: prev + '-09-30' }).find((x) => x.name === 'POM - Oblig by Work Type');
assert.ok(clip.columns.some((c) => c[0] === 'fy' + prev2 && /partial year/.test(c[1])), 'a clipped first FY is flagged partial');
console.log('POM views: all checks passed (' + sheets.length + ' tabs, totals tie, no phantom years, single-year layout)');
