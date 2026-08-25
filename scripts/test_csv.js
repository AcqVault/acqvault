#!/usr/bin/env node
/* Smallest check that fails if the Contract Awards CSV export breaks — extracts the
   SHIPPED osrCsvCell / OSR_COLS / osrBuildCsv out of assets/widgets.js and runs them
   over rows with the values that actually corrupt a spreadsheet (commas, quotes,
   newlines). Run: node scripts/test_csv.js */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'widgets.js'), 'utf8');

function grab(re, label) { const m = src.match(re); if (!m) { console.error('FAIL: ' + label + ' not found'); process.exit(1); } return m[0]; }
const colsSrc = grab(/const OSR_COLS = \[[\s\S]*?\];/, 'OSR_COLS');
const cellSrc = grab(/function osrCsvCell\(v\) \{[\s\S]*?\n  \}/, 'osrCsvCell');
const buildSrc = grab(/function osrBuildCsv\(rows\) \{[\s\S]*?\n  \}/, 'osrBuildCsv');
const pickSrc = grab(/function osrPickedCols\(\) \{[\s\S]*?\n  \}/, 'osrPickedCols');
// osrOn is normally seeded from localStorage; stub it so the harness controls it.
// eslint-disable-next-line no-eval
const ctx = eval('(function(){' + colsSrc + '\nlet osrOn = {};OSR_COLS.forEach(function(c){osrOn[c[0]]=1;});\nlet osrMulti=false;\n'
  + cellSrc + '\n' + pickSrc + '\n' + buildSrc
  + '\nreturn {OSR_COLS:OSR_COLS, osrCsvCell:osrCsvCell, osrBuildCsv:osrBuildCsv, osrPickedCols:osrPickedCols,'
  + ' drop:function(k){delete osrOn[k];}, setMulti:function(v){osrMulti=v;},'
  + ' keepAll:function(){osrOn={};OSR_COLS.forEach(function(c){osrOn[c[0]]=1;});}};})()');
const { OSR_COLS, osrCsvCell, osrBuildCsv, osrPickedCols } = ctx;

// escaping rules
assert.strictEqual(osrCsvCell('plain'), 'plain');
assert.strictEqual(osrCsvCell('RCA CONTRACTING, INC.'), '"RCA CONTRACTING, INC."');      // comma → quoted
assert.strictEqual(osrCsvCell('SAY "HI"'), '"SAY ""HI"""');                               // quote → doubled + quoted
assert.strictEqual(osrCsvCell('line1\nline2'), '"line1\nline2"');                         // newline → quoted
assert.strictEqual(osrCsvCell(18750), '18750');
assert.strictEqual(osrCsvCell(null), '');

// a full build with a comma-bearing vendor and a description holding a comma
const rows = [
  { office: 'FA8501', fiscalYear: '2023', piid: 'FA850123F0182', category: 'Service',
    vendor: 'RCA CONTRACTING, INC.', obligated: 10550033, description: 'ROOF, HVAC, AND DOORS',
    dateSigned: '2023-09-29' }
];
const csv = osrBuildCsv(rows);
const lines = csv.split('\r\n');
assert.strictEqual(lines.length, 2, 'header + one row');
// header column count matches OSR_COLS, and each data row has the same field count once parsed
const headerCols = lines[0].split(',').length;
assert.strictEqual(headerCols, OSR_COLS.length, 'header column count = OSR_COLS');
// the comma-bearing vendor and description must be quoted so the row stays one record
assert.ok(csv.includes('"RCA CONTRACTING, INC."'), 'vendor with comma must be quoted');
assert.ok(csv.includes('"ROOF, HVAC, AND DOORS"'), 'description with commas must be quoted');
// naive comma-count would over-count; a real CSV parse must yield exactly OSR_COLS fields
function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}
assert.strictEqual(parseCsvLine(lines[1]).length, OSR_COLS.length, 'data row parses to OSR_COLS fields');

// the column picker must narrow BOTH the header and every data row, in step —
// a header that drops a column while the rows keep it shifts every field after it
ctx.drop('vendor'); ctx.drop('description');
const narrowed = osrBuildCsv(rows).split('\r\n');
assert.strictEqual(osrPickedCols().length, OSR_COLS.length - 2, 'picker drops two columns');
assert.strictEqual(parseCsvLine(narrowed[0]).length, OSR_COLS.length - 2, 'narrowed header');
assert.strictEqual(parseCsvLine(narrowed[1]).length, OSR_COLS.length - 2, 'narrowed data row');
assert.ok(parseCsvLine(narrowed[0]).indexOf('Vendor') < 0, 'dropped column is gone from the header');
assert.ok(parseCsvLine(narrowed[0]).indexOf('Vendor UEI') >= 0, 'a column that merely SHARES a prefix stays');
assert.ok(!narrowed[1].includes('RCA CONTRACTING'), 'dropped column is gone from the row');
// and column ORDER must stay OSR_COLS order, not selection order
assert.deepStrictEqual(parseCsvLine(narrowed[0]),
  OSR_COLS.filter((c) => c[0] !== 'vendor' && c[0] !== 'description').map((c) => c[1]),
  'picked columns keep OSR_COLS order');
ctx.keepAll();

// Several offices in one report make Office load-bearing, so it is forced on — but
// only for the duration, never written into the saved preference, so dropping back to
// one office restores the user's own layout exactly.
ctx.drop('office');
assert.ok(osrPickedCols().every((c) => c[0] !== 'office'), 'single office: Office stays off when unticked');
ctx.setMulti(true);
const multiCols = osrPickedCols();
assert.ok(multiCols.some((c) => c[0] === 'office'), 'multi office: Office is forced on');
assert.deepStrictEqual(multiCols.map((c) => c[0]), OSR_COLS.map((c) => c[0]),
  'forced Office keeps OSR_COLS order and adds nothing else');
const multiCsv = osrBuildCsv(rows).split('\r\n');
assert.strictEqual(parseCsvLine(multiCsv[0]).length, multiCols.length, 'multi header matches');
assert.strictEqual(parseCsvLine(multiCsv[1]).length, multiCols.length, 'multi row matches');
assert.strictEqual(parseCsvLine(multiCsv[0])[0], 'Office', 'Office leads the multi-office export');
ctx.setMulti(false);
assert.ok(osrPickedCols().every((c) => c[0] !== 'office'), 'back to one office: the preference is intact');
ctx.keepAll();

console.log('CSV export: all checks passed (' + OSR_COLS.length + ' columns, picker narrows in step, Office forced for multi-office)');
