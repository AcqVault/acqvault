#!/usr/bin/env node
/* Face value vs obligated, and active vs inactive — checks the SHIPPED code:
   1. api/market-research.js caRow maps the SAM.gov Contract Awards record (field paths
      from the published OpenAPI spec) to whole-contract values and PoP dates.
   2. assets/widgets.js osrContracts / osrStatus / osrPortfolio: whole-contract figures
      come from each contract's latest action; status from its dates; vehicles (IDVs)
      stay out of face value; a missing value stays null, never $0.
   Run: node scripts/test_portfolio.js */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
function grabFrom(src, re, label) { const m = src.match(re); if (!m) { console.error('FAIL: ' + label + ' not found'); process.exit(1); } return m[0]; }

// ── 1. server mapping ─────────────────────────────────────────────────────────
const api = fs.readFileSync(path.join(root, 'api', 'market-research.js'), 'utf8');
// eslint-disable-next-line no-eval
const srv = eval('(function(){' + [
  grabFrom(api, /function caNumOrNull\([^\n]*/, 'caNumOrNull'),
  grabFrom(api, /function caNum\(x\) \{[^\n]*/, 'caNum'),
  grabFrom(api, /function caPath\(o, path\) \{[\s\S]*?\n\}/, 'caPath'),
  grabFrom(api, /function caCategory\(psc\) \{[\s\S]*?\n\}/, 'caCategory'),
  grabFrom(api, /function caRow\(a, office, fy\) \{[\s\S]*?\n\}/, 'caRow')
].join('\n') + '\nreturn { caRow: caRow };})()');
const rec = {
  contractId: { piid: 'FA485525F0001', modificationNumber: 'P00003', referencedIDVPiid: 'FA485522D0001' },
  coreData: { awardOrIDV: 'AWARD', awardOrIDVType: { name: 'DELIVERY ORDER' }, productOrServiceInformation: { productOrService: { code: 'R425' } } },
  awardDetails: {
    dates: { dateSigned: '2025-03-04T00:00:00Z', fiscalYear: '2025', periodOfPerformanceStartDate: '2025-04-01 00:00:00.000', currentCompletionDate: '2026-03-31 00:00:00.000', ultimateCompletionDate: '2029-03-31 00:00:00.000' },
    dollars: { actionObligation: '125000.50', baseAndExercisedOptionsValue: '125000.50', baseAndAllOptionsValue: '0' },
    totalContractDollars: { totalActionObligation: '1500000.25', totalBaseAndExercisedOptionsValue: '2000000', totalBaseAndAllOptionsValue: '6000000.75' }
  }
};
const row = srv.caRow(rec, 'FA4855', '2025');
assert.strictEqual(row.obligated, 125000.5, 'action obligation');
assert.strictEqual(row.totalObligated, 1500000.25, 'obligated to date (whole contract)');
assert.strictEqual(row.currentValue, 2000000, 'current value (base + exercised)');
assert.strictEqual(row.faceValue, 6000000.75, 'face value (base + all options)');
assert.strictEqual(row.popStart, '2025-04-01');
assert.strictEqual(row.popEnd, '2026-03-31');
assert.strictEqual(row.popUltimate, '2029-03-31');
assert.strictEqual(row.parentIdv, 'FA485522D0001', 'parent vehicle');
const bare = srv.caRow({ contractId: { piid: 'X' }, awardDetails: { dollars: { actionObligation: '10' } } }, 'FA4855', '2025');
assert.strictEqual(bare.faceValue, null, 'a missing total is null, never $0');
assert.strictEqual(bare.popEnd, '', 'a missing date is blank');

// ── 2. client rollup, status, portfolio ───────────────────────────────────────
const w = fs.readFileSync(path.join(root, 'assets', 'widgets.js'), 'utf8');
const grab = (re, l) => grabFrom(w, re, l);
// eslint-disable-next-line no-eval
const ctx = eval('(function(){let osrOn={};\n' + [
  grab(/const OSR_FUND_COLS = [^\n]*/, 'OSR_FUND_COLS'),
  grab(/const OSR_LIFE = [^\n]*/, 'OSR_LIFE'),
  grab(/function osrStatus\(c\) \{[\s\S]*?\n  \}/, 'osrStatus'),
  grab(/function osrCKey\(r\) \{[^\n]*/, 'osrCKey'),
  grab(/function osrLater\(a, b\) \{[^\n]*/, 'osrLater'),
  grab(/function osrKeyer\(rows\) \{[\s\S]*?\n  \}/, 'osrKeyer'),
  grab(/function osrContracts\(rows\) \{[\s\S]*?\n  \}/, 'osrContracts'),
  grab(/function osrStampStatus\(rows\) \{[\s\S]*?\n  \}/, 'osrStampStatus'),
  grab(/function osrPortfolio\(rows, all\) \{[\s\S]*?\n  \}/, 'osrPortfolio'),
  grab(/function osrVendorClean\(v\) \{[\s\S]*?\n  \}/, 'osrVendorClean'),
  grab(/function osrPct\([^\n]*/, 'osrPct'),
  grab(/function osrKpis\(rows\) \{[\s\S]*?\n  \}/, 'osrKpis'),
  grab(/function osrOfficeRollup\(rows\) \{[\s\S]*?\n  \}/, 'osrOfficeRollup'),
  'function osrOfficeName(c) { return { FA0021: "AFICA 765 SCONF" }[c] || ""; }'
].join('\n') + '\nreturn { osrContracts, osrPortfolio, osrStampStatus, osrOfficeRollup };})()');

const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const rows = [
  // A: two actions; the LATER one (same date, higher mod) carries the whole-contract position
  { office: 'X', piid: 'A', mod: 'P00001', dateSigned: '2025-05-01', obligated: 100, awardOrIdv: 'AWARD', totalObligated: 100, currentValue: 500, faceValue: 900, popEnd: day(400) },
  { office: 'X', piid: 'A', mod: 'P00002', dateSigned: '2025-05-01', obligated: 50, awardOrIdv: 'AWARD', totalObligated: 150, currentValue: 600, faceValue: 1000, popEnd: day(90) },
  // B: ended last month, no options left
  { office: 'X', piid: 'B', mod: '0', dateSigned: '2024-01-10', obligated: 200, awardOrIdv: 'AWARD', totalObligated: 200, currentValue: 200, faceValue: 200, popEnd: day(-30), popUltimate: day(-30) },
  // E: current period ended but all-options end still ahead -> options unexercised
  { office: 'X', piid: 'E', mod: '0', dateSigned: '2024-03-10', obligated: 40, awardOrIdv: 'AWARD', totalObligated: 40, currentValue: 40, faceValue: 400, popEnd: day(-10), popUltimate: day(700) },
  // G: active, but a mod left FPDS totals unreconciled (current < obligated to date)
  { office: 'X', piid: 'G', mod: '0', dateSigned: '2025-07-07', obligated: 60, awardOrIdv: 'AWARD', totalObligated: 90, currentValue: 60, faceValue: 50, popEnd: day(300) },
  // C: no end date and no totals reported
  { office: 'X', piid: 'C', mod: '0', dateSigned: '2025-02-02', obligated: 10, awardOrIdv: 'AWARD' },
  // V: a vehicle (IDV), open for orders, with a huge ceiling
  { office: 'X', piid: 'V', mod: '0', dateSigned: '2023-01-01', obligated: 0, awardOrIdv: 'IDV', faceValue: 9e9, lastDateToOrder: day(700), popEnd: day(700) },
  // D: a deobligation only, still active
  { office: 'X', piid: 'D', mod: 'P00004', dateSigned: '2025-06-01', obligated: -25, awardOrIdv: 'AWARD', totalObligated: 75, currentValue: 75, faceValue: 300, popEnd: day(1000) }
];
const cs = ctx.osrContracts(rows);
const get = (p) => cs.find((c) => c.piid === p);
assert.strictEqual(get('A').obligated, 150, 'period obligation sums the actions');
assert.strictEqual(get('A').faceValue, 1000, 'whole-contract values come from the latest action (date, then mod)');
assert.strictEqual(get('A').status, 'Active');
assert.strictEqual(get('A').endsSoon, 'Yes', 'ends within 6 months is flagged');
assert.strictEqual(get('A').remaining, 400, 'remaining options = face - current');
assert.strictEqual(get('A').unobligated, 450, 'unfunded balance = current - obligated to date (active)');
assert.strictEqual(get('B').status, 'Ended');
assert.strictEqual(get('E').status, 'Ended (options unexercised)', 'ended with the all-options end still ahead');
assert.strictEqual(get('E').remaining, null, 'remaining options only for active contracts');
assert.strictEqual(get('G').remaining, 0, 'a negative remaining (FPDS not updated) is shown as $0');
assert.strictEqual(get('G').unobligated, 0, 'a negative unfunded balance is shown as $0');
assert.strictEqual(get('G')._fpdsGap, true, 'and counted as an FPDS gap');
assert.strictEqual(get('D').endsSoon, 'No', 'active but not ending soon reads No (never blank)');
assert.strictEqual(get('B').endsSoon, '\u2014', 'not active reads a dash');
assert.ok(/^Unknown/.test(get('C').status), 'no end date reads Unknown, not Inactive');
assert.strictEqual(get('C').faceValue, undefined, 'no reported face value stays absent');
assert.strictEqual(get('V')._idv, true);
assert.strictEqual(get('V').status, 'Active', 'a vehicle is active while open for orders');
assert.strictEqual(get('D').status, 'Active');

const p = ctx.osrPortfolio(rows);
assert.strictEqual(p.all.n, 6, 'contracts & orders exclude vehicles');
assert.strictEqual(p.vehicles.n, 1);
assert.strictEqual(p.vehicles.maxFace, 9e9, 'vehicles report their largest ceiling (never a sum)');
assert.strictEqual(p.all.face, 1000 + 200 + 400 + 50 + 300, 'face value excludes the vehicle ceiling and skips unreported values');
assert.strictEqual(p.active.n, 3);
assert.strictEqual(p.ended.n, 2);
assert.strictEqual(p.ended.lapsed, 1, 'one ended with options unexercised');
assert.strictEqual(p.unknown.n, 1);
assert.strictEqual(p.active.n + p.ended.n + p.unknown.n, p.all.n, 'statuses partition the contracts');
assert.strictEqual(p.all.period, 150 + 200 + 40 + 60 + 10 - 25, 'period obligations tie to the actions (vehicle excluded)');
assert.strictEqual(p.active.soon, 1);
assert.strictEqual(p.active.remaining, 400 + 0 + 225, 'remaining options sum active contracts only, gaps at $0');
assert.strictEqual(p.active.fpdsGaps, 1);
const none = ctx.osrPortfolio([{ office: 'X', piid: 'Z', mod: '0', dateSigned: '2025-01-01', obligated: 5, awardOrIdv: 'AWARD' }]);
assert.strictEqual(none.all.face, null, 'no reported values -> null (shown as a dash), never $0');

ctx.osrStampStatus(rows);
assert.deepStrictEqual(rows.map((r) => r.contractStatus), ['Active', 'Active', 'Ended', 'Ended (options unexercised)', 'Active', 'Unknown (no end date)', 'Active', 'Active'], 'every row carries its contract status');
// row order must not change the answer; a later action with blank totals doesn't erase them
const A1 = { office: 'X', piid: 'R', mod: '0', dateSigned: '2025-01-05', obligated: 1, awardOrIdv: 'AWARD', faceValue: 900, currentValue: 500, totalObligated: 100, popEnd: day(800) };
const A2 = { office: 'X', piid: 'R', mod: 'P00001', dateSigned: '2025-03-05', obligated: 1, awardOrIdv: 'AWARD', popEnd: '' };
const f1 = ctx.osrContracts([A1, A2])[0], f2 = ctx.osrContracts([A2, A1])[0];
assert.ok(f1.faceValue === 900 && f2.faceValue === 900 && f1.status === 'Active' && f2.status === 'Active', 'same result in any row order');
// mod numbers compare numerically on the same date
const M9 = { office: 'X', piid: 'Q', mod: 'P00009', dateSigned: '2025-05-05', obligated: 1, awardOrIdv: 'AWARD', faceValue: 9 };
const M10 = { office: 'X', piid: 'Q', mod: 'P00010', dateSigned: '2025-05-05', obligated: 1, awardOrIdv: 'AWARD', faceValue: 10 };
assert.strictEqual(ctx.osrContracts([M10, M9])[0].faceValue, 10, 'P00010 is later than P00009');
assert.strictEqual(ctx.osrContracts([{ ...M9, mod: '10' }, { ...M10, mod: '9' }])[0].faceValue, 9, 'unpadded 10 is later than 9');
// one contract under two offices counts once; same short order number under two parents stays two
const O1 = { office: 'FA0021', piid: 'FA002125C0001', mod: '0', dateSigned: '2025-01-01', obligated: 5, awardOrIdv: 'AWARD', faceValue: 1000, popEnd: day(100) };
const O2 = { ...O1, office: 'FA4855', mod: 'P00001', dateSigned: '2025-02-01', obligated: 7 };
const po = ctx.osrPortfolio([O1, O2]);
assert.ok(po.all.n === 1 && po.all.face === 1000 && po.all.period === 12, 'one contract across two offices: counted once, face once, obligations summed');
const S1 = { office: 'N00019', piid: '0018', parentIdv: 'N0001920D0001', mod: '0', dateSigned: '2025-01-01', obligated: 1, awardOrIdv: 'AWARD' };
assert.strictEqual(ctx.osrPortfolio([S1, { ...S1, parentIdv: 'N0001921D0002' }]).all.n, 2, 'same short order number under different parents stays separate');
// a mod missing its parent vehicle borrows it from the order's other mods: still one order
const P1 = { office: 'X', piid: '0042', parentIdv: 'FA485522D0001', mod: '0', dateSigned: '2025-01-01', obligated: 10, awardOrIdv: 'AWARD', faceValue: 50 };
const P2 = { office: 'X', piid: '0042', parentIdv: '', mod: 'P00001', dateSigned: '2025-02-01', obligated: 5, awardOrIdv: 'AWARD' };
assert.strictEqual(ctx.osrPortfolio([P1, P2]).all.n, 1, 'a mod without its parent still joins its order');
// the Office column lists every office a contract appears under
assert.strictEqual(ctx.osrContracts([O1, O2])[0].office, 'FA0021 + FA4855', 'office column names both offices');
assert.strictEqual(p.all.reported, 5, 'face value reported for 5 of 6 contracts (C has none)');
// portfolio by office: office rows tie to their own rows; the total counts a shared contract once
const OF = [
  { office: 'FA0021', piid: 'FA002125C0001', mod: '0', dateSigned: '2025-01-01', obligated: 100, category: 'Service', awardOrIdv: 'AWARD', faceValue: 1000, currentValue: 600, totalObligated: 100, popEnd: day(200), vendor: 'A' },
  { office: 'FA0021', piid: 'FA002125F0009', mod: '0', dateSigned: '2025-02-01', obligated: 50, category: 'R&D', awardOrIdv: 'AWARD', faceValue: 80, currentValue: 50, totalObligated: 50, popEnd: day(-20), vendor: 'B' },
  { office: 'FA4855', piid: 'FA485525P0001', mod: '0', dateSigned: '2025-03-01', obligated: 30, category: 'Product', awardOrIdv: 'AWARD', faceValue: 30, currentValue: 30, totalObligated: 30, popEnd: day(40), vendor: 'C' },
  // the FA0021 contract also has a mod recorded under FA4855
  { office: 'FA4855', piid: 'FA002125C0001', mod: 'P00001', dateSigned: '2025-04-01', obligated: 20, category: 'Service', awardOrIdv: 'AWARD', faceValue: 1000, currentValue: 620, totalObligated: 120, popEnd: day(200), vendor: 'A' }
];
const R = ctx.osrOfficeRollup(OF), tot = R[R.length - 1];
assert.ok(tot._total && tot.office === 'All selected offices', 'the last row is the portfolio total');
assert.strictEqual(R.length, 3, 'one row per office + total');
const f21 = R.find((r) => r.office === 'FA0021'), f48 = R.find((r) => r.office === 'FA4855');
assert.strictEqual(f21.officeName, 'AFICA 765 SCONF');
assert.ok(f21.obligated === 150 && f21.services === 100 && f21.rnd === 50 && f21.products === 0, 'office row ties to its own actions, by work type');
assert.strictEqual(f21.obligated + f48.obligated, tot.obligated, 'obligations add across offices (actions are never shared)');
assert.strictEqual(tot.contracts, 3, 'a contract recorded under two offices counts once in the total');
assert.strictEqual(tot.face, 1000 + 80 + 30, 'total face value counts the shared contract once');
assert.ok(tot.active === 2 && tot.ended === 1, 'status counts in the total');
// a contract shared by two offices: each office row shows its WHOLE-contract status and values
const X1 = { office: 'FA0021', piid: 'FA002120C0007', mod: '0', dateSigned: '2020-01-01', obligated: 100, category: 'Service', awardOrIdv: 'AWARD', faceValue: 900, currentValue: 500, totalObligated: 100, popEnd: day(-30), vendor: 'D' };
const X2 = { ...X1, office: 'FA4855', mod: 'P00009', dateSigned: '2025-06-01', obligated: 300, currentValue: 800, totalObligated: 400, popEnd: day(90) };
const RX = ctx.osrOfficeRollup([X1, X2]), x21 = RX.find((r) => r.office === 'FA0021');
assert.ok(x21.active === 1 && x21.ended === 0 && x21.toDate === 400 && x21.current === 800, 'office row uses the whole-contract status and values (extension filed under the other office)');
assert.strictEqual(x21.obligated, 100, 'but its period dollars are its own actions');
assert.strictEqual(RX[RX.length - 1].officeName, 'Portfolio total (each contract counted once)');
console.log('Portfolio: all checks passed (SAM mapping, latest-action rollup, status, vehicles kept out of face value)');
