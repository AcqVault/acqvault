#!/usr/bin/env node
/* Regression check for the hand-rolled .xlsx writer (assets/xlsxgen.js). Dependency
   free: it loads the shipped generator, builds a workbook, then parses the produced
   zip with Node built-ins and asserts (a) every stored entry's CRC-32 matches — proving
   the zip writer — and (b) the OOXML package graph is self-consistent (content-types
   covers every part; every r:id resolves in its .rels). Deep schema validity is covered
   separately (a SheetJS read + a 5-way OOXML spec audit at build time). Run:
     node scripts/test_xlsx.js */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// load the browser-targeted generator under a minimal shim
global.window = {};
global.TextEncoder = TextEncoder;
require(path.join(__dirname, '..', 'assets', 'xlsxgen.js'));
const build = global.window.acqBuildXlsx;
assert.strictEqual(typeof build, 'function', 'acqBuildXlsx not exported');

const columns = [['office', 'Office'], ['fiscalYear', 'FY'], ['piid', 'Contract (PIID)'], ['obligated', 'Obligated'], ['awardAmount', 'Award Amount'], ['vendor', 'Vendor']];
const rows = [
  { office: 'FA8501', fiscalYear: '2025', piid: 'FA850125P0018', obligated: 18750.5, awardAmount: 18750.5, vendor: 'RCA CONTRACTING, INC.' },
  { office: 'FA8501', fiscalYear: '2024', piid: 'FA850124F0025', obligated: 8354345, awardAmount: 8354345, vendor: 'MALONE OFFICE EQUIPMENT, INC.' }
];
const opts = {
  office: 'FA8501', officeName: 'FA8501  OPL CONTRACTING AFSC/PZIO', fyLabel: 'FY2024–2025',
  columns, rows,
  byFy: [{ label: 'FY 2024', value: 8354345 }, { label: 'FY 2025', value: 18750.5 }],
  byCat: [{ label: 'Service', value: 18750.5 }, { label: 'Product', value: 8354345 }],
  byVen: [{ label: 'RCA CONTRACTING', value: 18750.5 }]
};
const u8 = build(opts);
assert.ok(u8 && u8.length > 100, 'no output');
assert.strictEqual(u8[0], 0x50, 'not a zip (PK)'); assert.strictEqual(u8[1], 0x4B);

// ── CRC-32 (same polynomial as the writer) ──
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

// ── walk local file headers (stored, no data descriptor) ──
function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
const parts = {}; let off = 0;
while (off + 4 <= u8.length && u32(u8, off) === 0x04034b50) {
  const crc = u32(u8, off + 14), size = u32(u8, off + 18), nlen = u16(u8, off + 26), elen = u16(u8, off + 28);
  const name = Buffer.from(u8.slice(off + 30, off + 30 + nlen)).toString('utf8');
  const dstart = off + 30 + nlen + elen, data = u8.slice(dstart, dstart + size);
  assert.strictEqual(crc32(data), crc, 'CRC mismatch for ' + name);   // proves the zip writer
  parts[name] = Buffer.from(data).toString('utf8');
  off = dstart + size;
}
const expect = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels',
  'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/_rels/sheet1.xml.rels',
  'xl/worksheets/sheet2.xml', 'xl/drawings/drawing1.xml', 'xl/drawings/_rels/drawing1.xml.rels', 'xl/charts/chart1.xml'];
expect.forEach((n) => assert.ok(parts[n] != null, 'missing part ' + n));
assert.strictEqual(Object.keys(parts).length, expect.length, 'unexpected part count');

// ── content-types covers every xml part ──
const ct = parts['[Content_Types].xml'];
['/xl/workbook.xml', '/xl/styles.xml', '/xl/worksheets/sheet1.xml', '/xl/worksheets/sheet2.xml', '/xl/drawings/drawing1.xml', '/xl/charts/chart1.xml']
  .forEach((pn) => assert.ok(ct.indexOf('PartName="' + pn + '"') >= 0, 'content-types missing ' + pn));

// ── every r:id used resolves in the matching .rels ──
function ids(rels) { const s = new Set(); (rels.match(/Id="([^"]+)"/g) || []).forEach((m) => s.add(m.slice(4, -1))); return s; }
function refsResolve(part, rels) {
  const have = ids(parts[rels] || ''); const used = new Set();
  (parts[part].match(/r:id="([^"]+)"/g) || []).forEach((m) => used.add(m.slice(6, -1)));
  used.forEach((id) => assert.ok(have.has(id), 'dangling r:id ' + id + ' in ' + part));
  return used.size;
}
refsResolve('xl/workbook.xml', 'xl/_rels/workbook.xml.rels');
assert.ok(refsResolve('xl/worksheets/sheet1.xml', 'xl/worksheets/_rels/sheet1.xml.rels') >= 1, 'summary must reference a drawing');
assert.ok(refsResolve('xl/drawings/drawing1.xml', 'xl/drawings/_rels/drawing1.xml.rels') >= 1, 'drawing must reference a chart');

// ── data sheet: header + row count matches input, and the chart points at the FY table ──
const data = parts['xl/worksheets/sheet2.xml'];
const rowCount = (data.match(/<row /g) || []).length;
assert.strictEqual(rowCount, rows.length + 1, 'data rows = header + ' + rows.length);
assert.ok(data.indexOf('FA850125P0018') >= 0, 'a known PIID is present');
const chart = parts['xl/charts/chart1.xml'];
assert.ok(/Summary!\$B\$\d+:\$B\$\d+/.test(chart), 'chart references a Summary value range');
assert.ok(chart.indexOf('<c:barChart>') >= 0 && chart.indexOf('<c:barDir val="col"/>') >= 0, 'chart is a column bar chart');

console.log('xlsx generator: all checks passed (' + expect.length + ' parts, CRC + graph verified)');
