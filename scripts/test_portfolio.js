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
  grabFrom(api, /function caRow\(a, office, fy\) \{[\s\S]*?\n\}/, 'caRow'),
  grabFrom(api, /function caActiveCheck\([^\n]*/, 'caActiveCheck')
].join('\n') + '\nreturn { caRow: caRow, caActiveCheck: caActiveCheck };})()');
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
const ctx = eval('(function(){let osrOn={};let osrActive=[],osrAsOf="",osrActiveMiss=[],osrActiveTrunc=[];\n' + [
  grab(/function osrUnion\(rows\) \{[^\n]*/, 'osrUnion'),
  grab(/function osrActiveOnly\(rows\) \{[^\n]*/, 'osrActiveOnly'),
  grab(/function osrContractList\(rows\) \{[\s\S]*?\n  \}/, 'osrContractList'),
  grab(/const OSR_FUND_COLS = [^\n]*/, 'OSR_FUND_COLS'),
  grab(/const OSR_LIFE = [^\n]*/, 'OSR_LIFE'),
  grab(/function osrStatus\(c\) \{[\s\S]*?\n  \}/, 'osrStatus'),
  grab(/function osrCKey\(r\) \{[^\n]*/, 'osrCKey'),
  grab(/function osrLater\(a, b\) \{[^\n]*/, 'osrLater'),
  grab(/function osrKeyer\(rows\) \{[\s\S]*?\n  \}/, 'osrKeyer'),
  grab(/function osrContracts\(rows\) \{[\s\S]*?\n  \}/, 'osrContracts'),
  grab(/function osrStampStatus\(rows, base\) \{[\s\S]*?\n  \}/, 'osrStampStatus'),
  grab(/function osrPortfolio\(rows, all, office\) \{[\s\S]*?\n  \}/, 'osrPortfolio'),
  grab(/function osrVendorClean\(v\) \{[\s\S]*?\n  \}/, 'osrVendorClean'),
  grab(/function osrPct\([^\n]*/, 'osrPct'),
  grab(/function osrKpis\(rows\) \{[\s\S]*?\n  \}/, 'osrKpis'),
  grab(/function osrOfficeRollup\(rows\) \{[\s\S]*?\n  \}/, 'osrOfficeRollup'),
  'function osrOfficeName(c) { return { FA0021: "AFICA 765 SCONF" }[c] || ""; }'
].join('\n') + '\nreturn { osrContracts, osrPortfolio, osrStampStatus, osrOfficeRollup, osrContractList, setActive: function (r, a) { osrActive = r; osrAsOf = a; } };})()');

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
// ── current portfolio: contracts running today count as Active even with no action in the period ──
assert.ok(srv.caActiveCheck([{ popEnd: '2026-12-01' }, { popEnd: '2026-11-20' }], '2026-11-20'), 'every row ends on/after as-of: filter applied');
assert.ok(!srv.caActiveCheck([{ popEnd: '2026-12-01' }, { popEnd: '2025-01-01' }], '2026-11-20'), 'a row that already ended means SAM ignored the filter');
assert.ok(!srv.caActiveCheck([{ popEnd: '' }], '2026-11-20'), 'a row with no end date means SAM ignored the filter');
{
  const base = { awardOrIdv: 'AWARD', category: 'Service', vendor: 'V' };
  // period (FY) rows: A active, C ended, E looks ended in the period but SAM shows a later extension
  const PA = { ...base, office: 'FA0021', piid: 'FA002125C0101', mod: '0', dateSigned: '2025-01-10', obligated: 100, faceValue: 500, currentValue: 300, totalObligated: 100, popEnd: day(100) };
  const PC = { ...base, office: 'FA0021', piid: 'FA002122C0102', mod: 'P00004', dateSigned: '2025-02-10', obligated: 40, faceValue: 90, currentValue: 90, totalObligated: 90, popEnd: day(-10) };
  const PE = { ...base, office: 'FA0021', piid: 'FA002123C0103', mod: 'P00002', dateSigned: '2025-03-10', obligated: 10, faceValue: 70, currentValue: 50, totalObligated: 40, popEnd: day(-5) };
  const period = [PA, PC, PE];
  // active-today pull: A again (same action), B signed years ago with no action in the period,
  // D running per its old mod but terminated later, E's later extension, and an FA4417 contract
  const LB = { ...base, office: 'FA0021', piid: 'FA002121C0104', mod: 'P00007', dateSigned: '2023-06-01', obligated: 0, faceValue: 2000, currentValue: 1200, totalObligated: 1000, popEnd: day(300) };
  const LD1 = { ...base, office: 'FA0021', piid: 'FA002120C0105', mod: 'P00002', dateSigned: '2022-01-01', obligated: 0, faceValue: 800, currentValue: 800, totalObligated: 600, popEnd: day(400) };
  const LD2 = { ...LD1, mod: 'P00003', dateSigned: '2024-05-01', obligated: -200, totalObligated: 400, popEnd: day(-200) };   // termination mod
  const LE = { ...PE, mod: 'P00003', dateSigned: '2026-10-15', obligated: 0, currentValue: 70, totalObligated: 40, popEnd: day(200) };
  const LF = { ...base, office: 'FA4417', piid: 'FA441724C0001', mod: 'P00001', dateSigned: '2024-04-01', obligated: 0, faceValue: 300, currentValue: 300, totalObligated: 300, popEnd: day(60) };
  const live = [{ ...PA }, LB, LD1, LD2, LE, LF];
  ctx.setActive([], '');
  const before = ctx.osrPortfolio(period);
  assert.ok(before.active.n === 1 && before.all.n === 3, 'without the current-portfolio pull: period contracts only');
  ctx.setActive(live, '2026-11-20');
  const pp = ctx.osrPortfolio(period);
  assert.strictEqual(pp.all.n, 3, 'All stays the period contracts');
  assert.strictEqual(pp.active.n, 4, 'Active today: A, B (no period action), E (extended after the period) and the FA4417 contract; D terminated');
  assert.strictEqual(pp.active.outside, 2, 'two active contracts had no action in the period');
  assert.strictEqual(pp.active.face, 500 + 2000 + 70 + 300, 'active face value includes contracts signed in earlier years');
  assert.strictEqual(pp.active.period, 100 + 10, 'period dollars for active contracts come from the period rows only');
  assert.strictEqual(pp.ended.n, 1, 'E is no longer Ended once SAM shows its extension');
  ctx.osrStampStatus(period);
  assert.strictEqual(PE.contractStatus, 'Active', 'Data tab status uses the latest SAM action, not just the period');
  const cl = ctx.osrContractList(period);
  const clB = cl.find((c) => c.piid === LB.piid);
  assert.ok(clB && clB.inPeriod === 'No (active today)' && clB.actions === 0 && clB.obligated === 0 && clB.first === '', 'By Contract lists an active contract with no period action, with zero period dollars');
  assert.ok(!cl.some((c) => c.piid === LD1.piid), 'a terminated contract with no period action is not listed');
  assert.strictEqual(cl.find((c) => c.piid === PA.piid).actions, 1, 'an action in both pulls counts once');
  const RO = ctx.osrOfficeRollup(period), f17 = RO.find((r) => r.office === 'FA4417'), t = RO[RO.length - 1];
  assert.ok(f17 && f17.actions === 0 && f17.obligated === 0 && f17.active === 1 && f17.activeFace === 300, 'an office with active contracts but no period actions still gets a row');
  assert.strictEqual(RO.find((r) => r.office === 'FA0021').active, 3, 'each office row counts only its own active contracts');
  assert.strictEqual(t.active, 4, 'the total counts every active contract once');
  // a current-portfolio row naming a second vehicle with the same order number must not
  // split an order the period rows already resolve
  const K1 = { ...base, office: 'FA0021', piid: '0001', parentIdv: 'V1', mod: '0', dateSigned: '2025-01-01', obligated: 5, faceValue: 5, currentValue: 5, totalObligated: 5, popEnd: day(50) };
  const K2 = { ...K1, parentIdv: '', mod: 'P00001', dateSigned: '2025-02-01', obligated: 1 };
  const K3 = { ...K1, parentIdv: 'V2', dateSigned: '2024-01-01', obligated: 0 };
  ctx.setActive([{ ...K1 }, K3], '2026-11-20');
  const pk = ctx.osrPortfolio([K1, K2]);
  assert.ok(pk.all.n === 1 && pk.active.n === 2, 'period order stays one contract; the other vehicle\u2019s order is its own');
  ctx.setActive([], '');
}
// ── server: the current-portfolio pull, against a stubbed SAM.gov ──
(async () => {
  const fns = ['isoDay', 'mdy', 'caNum', 'caNumOrNull', 'caPath', 'caCategory', 'caRow', 'caActiveCheck', 'caAddDays', 'caDayBefore'].map((n) => {
    const m = api.match(new RegExp('\\nfunction ' + n + '\\([^)]*\\) \\{[^\\n]*\\}(?=\\n)')) || api.match(new RegExp('\\nfunction ' + n + '\\([^)]*\\) \\{\\n[\\s\\S]*?\\n\\}(?=\\n)'));
    if (!m) throw new Error('missing ' + n); return m[0];
  }).join('\n') + '\n' + api.match(/\nconst CA_ACTIVE_PAGES[^\n]*/)[0] + '\n' + api.match(/\nasync function activeContractRows\([\s\S]*?\n\}(?=\n)/)[0];
  const mk = (piid, mod, signed, end, parent) => ({ contractId: { piid, modificationNumber: mod, referencedIDVPiid: parent || '' }, coreData: { awardOrIDV: 'AWARD' },
    awardDetails: { dates: { dateSigned: signed, currentCompletionDate: end }, dollars: { actionObligation: '1' }, totalContractDollars: { totalBaseAndAllOptionsValue: '10' } } });
  function run(answer) {
    const calls = [];
    // eslint-disable-next-line no-eval
    const f = eval('(function(fetchContractAwards){const CA_PAGE=100;' + fns + '\nreturn activeContractRows;})')(async (qs) => { calls.push(qs); return answer(qs); });
    return new Promise((resolve) => {
      const res = { h: {}, setHeader(k, v) { this.h[k] = v; }, status() { return this; }, json(o) { resolve({ o, calls, h: this.h }); return this; } };
      f(res, 'KEY', 'FA4417', '2026-11-20');
    });
  }
  // SAM ignored the filter: refused after ONE page, cached briefly, marked final (no client retry)
  const ign = await run(() => ({ ok: true, data: { totalRecords: 5000, awardSummary: [mk('A', '0', '2020-01-01', '2021-01-01')] } }));
  assert.ok(ign.o.limited && ign.o.final && ign.calls.length === 1 && /600/.test(ign.h['Cache-Control']), 'ignored filter: refused after one page');
  // an unreadable answer is a failure, not an empty portfolio
  const bad = await run(() => ({ ok: true, data: { weird: true } }));
  assert.ok(bad.o.limited && !bad.o.rows.length && bad.h['Cache-Control'] === 'no-store', 'unreadable answer is a failure');
  // stub SAM: filters the early-end query by its dateSigned window, like SAM does
  const iso = (m) => m.slice(6, 10) + '-' + m.slice(0, 2) + '-' + m.slice(3, 5);
  const win = (qs) => { const m = /\[(.{10}),(.{10})\]/.exec(qs.dateSigned); return [iso(m[1]), iso(m[2])]; };
  function sam(mainRecs, endedRecs, opts) {
    opts = opts || {};
    return (qs) => {
      if (/12\/31\/2099/.test(qs.currentCompletionDate)) return { ok: true, data: { totalRecords: mainRecs.length, awardSummary: mainRecs } };
      if (opts.endedFails) return { ok: false, status: 503, data: {} };
      const [lo, hi] = win(qs), hit = endedRecs.filter((x) => x.awardDetails.dates.dateSigned >= lo && x.awardDetails.dates.dateSigned <= hi);
      if (!hit.length && opts.emptyAsString) return { ok: true, data: { totalRecords: '0' } };
      return { ok: true, data: { totalRecords: hit.length, awardSummary: hit.slice(qs.offset * 100, qs.offset * 100 + 100) } };
    };
  }
  const T = new Date().toISOString().slice(0, 10), yr = (n) => String(Number(T.slice(0, 4)) + n) + T.slice(4);
  // a later mod that moved the end date into the past rides along; older or unrelated ones do not
  const ok = await run(sam(
    [mk('FA441723C0001', 'P00002', yr(-1), '2099-12-31'), mk('FA441724F0009', 'P00001', yr(-1), '2027-01-31', 'FA441722D0001'), mk('FA441725C0002', 'P00001', yr(-1), '2028-01-31')],
    [mk('FA441723C0001', 'P00003', T, '2024-06-30'), mk('FA441723C0001', 'P00001', yr(-3), '2024-06-30'), mk('FA441799C0001', 'P00001', T, '2025-01-01'),
      mk('FA441724F0009', 'P00002', T, '2025-07-01'), mk('FA441725C0002', 'P00002', T, '2025-01-31', 'FA441720D0007')]));
  assert.deepStrictEqual(ok.o.rows.map((r) => r.piid + ' ' + r.mod).slice(3).sort(), ['FA441723C0001 P00003', 'FA441724F0009 P00002', 'FA441725C0002 P00002'],
    'later early-end mods kept (either side missing its parent), older and unrelated dropped');
  assert.ok(ok.o.endUnchecked === 0 && ok.o.endCheckedFrom === yr(-1), 'checked back to the oldest latest-active action: nothing unchecked');
  assert.ok(ok.calls.slice(1).every((c) => c.currentCompletionDate === '[01/01/1990,' + (function (d) { return d.slice(5, 7) + '/' + d.slice(8, 10) + '/' + d.slice(0, 4); })(new Date(Date.parse('2026-11-20T00:00:00Z') - 864e5).toISOString().slice(0, 10)) + ']'), 'early-end check asks for end dates before as-of');
  // one contract last touched 18 years ago: walked newest-first a year at a time until the page budget runs out
  const many = Array.from({ length: 1200 }, (_, i) => mk('FA4417X' + i, 'P00001', yr(-(i % 12)), '2025-01-01'));   // ~100 a year
  const old = await run(sam([mk('FA441708C0001', 'P00009', yr(-18), '2030-01-01'), mk('FA441726C0001', 'P00001', T, '2027-01-01')], many));
  assert.ok(old.o.endUnchecked === 1 && old.o.endNote === 'pages' && !old.o.limited, 'budget spent: the one old contract is reported unchecked, main rows kept');
  assert.ok(old.calls.length <= 1 + 10, 'early-end check stays inside its page budget (' + (old.calls.length - 1) + ' calls)');
  const idv = await run(sam([mk('FA441726C0001', 'P00001', T, '2027-01-01'), Object.assign(mk('FA441708D0001', 'P00001', yr(-18), '2030-01-01'), { coreData: { awardOrIDV: 'IDV' } })], []));
  assert.ok(idv.calls.length === 2 && idv.o.endUnchecked === 0, 'a vehicle does not stretch the early-end window');
  // the early-end query failing keeps the active list (flagged), it does not throw it away
  const fail = await run(sam([mk('FA441726C0001', 'P00001', yr(-1), '2027-01-01')], [], { endedFails: true }));
  assert.ok(!fail.o.limited && fail.o.rows.length === 1 && fail.o.endNote === 'failed' && fail.o.endUnchecked === 1, 'early-end failure: rows kept, contract flagged unchecked');
  assert.ok(/600/.test(fail.h['Cache-Control']), 'a transient early-end failure is cached briefly, not for hours');
  // SAM ignoring the dateSigned window: stop, keep nothing from it, never count a mod twice
  const ign2 = await run((qs) => /2099/.test(qs.currentCompletionDate)
    ? { ok: true, data: { totalRecords: 1, awardSummary: [mk('FA441723C0001', 'P00002', yr(-3), '2099-12-31')] } }
    : { ok: true, data: { totalRecords: 1, awardSummary: [mk('FA441723C0001', 'P00003', yr(-2), '2024-06-30')] } });
  assert.ok(ign2.o.endNote === 'filter' && ign2.o.endedEarly === 0 && ign2.o.endUnchecked === 1 && /600/.test(ign2.h['Cache-Control']), 'ignored date window: nothing kept, contract flagged unchecked');
  // a contract whose early end was found is settled, even when the walk ran out of budget
  const settled = await run(sam([mk('FA441708C0001', 'P00009', yr(-18), '2030-01-01')], many.concat([mk('FA441708C0001', 'P00010', T, '2020-01-01')])));
  assert.ok(settled.o.endedEarly === 1 && settled.o.endUnchecked === 0, 'found early end: not counted as unchecked');
  // SAM's empty answer as a string total is still "nothing found", not a failure
  const empty = await run(sam([mk('FA441726C0001', 'P00001', T, '2027-01-01')], [], { emptyAsString: true }));
  assert.ok(!empty.o.limited && !empty.o.endNote && empty.o.endUnchecked === 0, 'totalRecords "0" with no array is empty, not unreadable');
  // no total reported and every page full: truncated, never silently complete
  const nototal = await run((qs) => /2099/.test(qs.currentCompletionDate)
    ? { ok: true, data: { awardSummary: Array.from({ length: 100 }, (_, i) => mk('FA4417N' + qs.offset + '_' + i, '0', T, '2027-01-01')) } } : { ok: true, data: { totalRecords: 0, awardSummary: [] } });
  assert.ok(nototal.o.truncated === true && nototal.o.count === 2000, 'no total + full pages up to the cap = truncated');
  console.log('Current-portfolio server: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
console.log('Portfolio: all checks passed (SAM mapping, latest-action rollup, status, vehicles kept out of face value)');
