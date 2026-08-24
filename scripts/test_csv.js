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
// eslint-disable-next-line no-eval
const ctx = eval('(function(){' + colsSrc + '\n' + cellSrc + '\n' + buildSrc + '\nreturn {OSR_COLS:OSR_COLS, osrCsvCell:osrCsvCell, osrBuildCsv:osrBuildCsv};})()');
const { OSR_COLS, osrCsvCell, osrBuildCsv } = ctx;

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

console.log('CSV export: all checks passed (' + OSR_COLS.length + ' columns)');
