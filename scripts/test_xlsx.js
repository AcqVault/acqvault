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
  // 'R&D' and 'AT&T <TEST>' are real FPDS shapes; both must come out escaped
  byCat: [{ label: 'Service', value: 18750.5 }, { label: 'R&D', value: 8354345 }],
  byVen: [{ label: 'RCA CONTRACTING', value: 18750.5 }, { label: 'AT&T <TEST> "X"', value: 4000 }],
  bySet: [{ label: 'No set-aside', value: 8354345 }, { label: 'Small business', value: 18750.5 }],
  byMonth: [{ label: 'Oct 24', value: 100 }, { label: 'Nov 24', value: 8354245 }, { label: 'Dec 24', value: 18650.5 }],
  awards: rows.length, total: 8373095.5
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
const chartNames = Object.keys(parts).filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n)).sort();
assert.strictEqual(chartNames.length, 4, 'the fixture should produce four charts, got ' + chartNames.length);
const expect = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels',
  'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/_rels/sheet1.xml.rels',
  'xl/worksheets/sheet2.xml', 'xl/drawings/drawing1.xml', 'xl/drawings/_rels/drawing1.xml.rels'].concat(chartNames);
expect.forEach((n) => assert.ok(parts[n] != null, 'missing part ' + n));
assert.strictEqual(Object.keys(parts).length, expect.length, 'unexpected part count');

// ── content-types must cover every xml part, AND name no part that is absent ──
// (a chartN.xml with no Override, or an Override for a chart that was not written,
//  are both repair prompts and both were previously invisible here)
const ct = parts['[Content_Types].xml'];
['/xl/workbook.xml', '/xl/styles.xml', '/xl/worksheets/sheet1.xml', '/xl/worksheets/sheet2.xml', '/xl/drawings/drawing1.xml']
  .concat(chartNames.map((n) => '/' + n))
  .forEach((pn) => assert.ok(ct.indexOf('PartName="' + pn + '"') >= 0, 'content-types missing ' + pn));
(ct.match(/PartName="([^"]+)"/g) || []).forEach((m) => {
  const pn = m.slice(10, -1).replace(/^\//, '');
  assert.ok(parts[pn] != null, 'content-types names a part that was never written: ' + pn);
});

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

// ═══ schema-order battery ═══
// Excel repairs a file whose chart children sit outside their ECMA-376 CT_ sequence,
// and NOTHING else in this toolchain notices: openpyxl loads a reordered chart, a
// deleted required child and an invented element without complaint (measured). Order
// is the single most likely repair cause, so it gets its own check.
const ORDER = {
  chartSpace: ['date1904', 'lang', 'roundedCorners', 'style', 'clrMapOvr', 'pivotSource', 'protection', 'chart', 'spPr', 'txPr', 'externalData', 'printSettings', 'userShapes', 'extLst'],
  chart: ['title', 'autoTitleDeleted', 'pivotFmts', 'view3D', 'floor', 'sideWall', 'backWall', 'plotArea', 'legend', 'plotVisOnly', 'dispBlanksAs', 'showDLblsOverMax', 'extLst'],
  barChart: ['barDir', 'grouping', 'varyColors', 'ser', 'dLbls', 'gapWidth', 'overlap', 'serLines', 'axId', 'extLst'],
  lineChart: ['grouping', 'varyColors', 'ser', 'dLbls', 'dropLines', 'hiLowLines', 'upDownBars', 'marker', 'smooth', 'axId', 'extLst'],
  doughnutChart: ['varyColors', 'ser', 'dLbls', 'firstSliceAng', 'holeSize', 'extLst'],
  catAx: ['axId', 'scaling', 'delete', 'axPos', 'majorGridlines', 'minorGridlines', 'title', 'numFmt', 'majorTickMark', 'minorTickMark', 'tickLblPos', 'spPr', 'txPr', 'crossAx', 'crosses', 'crossesAt', 'auto', 'lblAlgn', 'lblOffset', 'tickLblSkip', 'tickMarkSkip', 'noMultiLvlLbl', 'extLst'],
  valAx: ['axId', 'scaling', 'delete', 'axPos', 'majorGridlines', 'minorGridlines', 'title', 'numFmt', 'majorTickMark', 'minorTickMark', 'tickLblPos', 'spPr', 'txPr', 'crossAx', 'crosses', 'crossesAt', 'crossBetween', 'majorUnit', 'minorUnit', 'dispUnits', 'extLst'],
  dLbls: ['dLbl', 'delete', 'numFmt', 'spPr', 'txPr', 'dLblPos', 'showLegendKey', 'showVal', 'showCatName', 'showSerName', 'showPercent', 'showBubbleSize', 'separator', 'showLeaderLines', 'leaderLines', 'extLst'],
  dPt: ['idx', 'invertIfNegative', 'marker', 'bubble3D', 'explosion', 'spPr', 'pictureOptions', 'extLst'],
  legend: ['legendPos', 'legendEntry', 'layout', 'overlay', 'spPr', 'txPr', 'extLst'],
  title: ['tx', 'layout', 'overlay', 'spPr', 'txPr', 'extLst']
};
// series order differs per chart group, so key it by the parent chart type
const SER_ORDER = {
  barChart: ['idx', 'order', 'tx', 'spPr', 'invertIfNegative', 'pictureOptions', 'dPt', 'dLbls', 'trendline', 'errBars', 'cat', 'val', 'shape', 'extLst'],
  lineChart: ['idx', 'order', 'tx', 'spPr', 'marker', 'dPt', 'dLbls', 'trendline', 'errBars', 'cat', 'val', 'smooth', 'extLst'],
  doughnutChart: ['idx', 'order', 'tx', 'spPr', 'explosion', 'dPt', 'dLbls', 'cat', 'val', 'extLst']
};
// Walk c:-namespaced tags, tracking depth, and check each parent's direct children
// appear in non-decreasing sequence position.
function checkOrder(xmlStr, label) {
  const stack = [];
  const re = /<(\/?)c:([A-Za-z0-9]+)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(xmlStr))) {
    const closing = m[1] === '/', tag = m[2], selfClose = m[4] === '/';
    if (closing) { stack.pop(); continue; }
    const parent = stack[stack.length - 1];
    if (parent) {
      let seq = ORDER[parent.tag];
      if (parent.tag === 'ser') seq = SER_ORDER[parent.inChart] || null;
      if (seq) {
        const pos = seq.indexOf(tag);
        assert.ok(pos >= 0, label + ': <c:' + tag + '> is not a known child of <c:' + parent.tag + '>');
        assert.ok(pos >= parent.last, label + ': <c:' + tag + '> out of schema order inside <c:' + parent.tag + '>');
        parent.last = pos;
      }
    }
    if (!selfClose) {
      const inChart = /Chart$/.test(tag) ? tag : (parent && parent.inChart);
      stack.push({ tag, last: -1, inChart });
    }
  }
  assert.strictEqual(stack.length, 0, label + ': unbalanced c: tags');
}
const seenTypes = [];
chartNames.forEach((name, i) => {
  const c = parts[name];
  checkOrder(c, name);
  assert.ok(/Summary!\$B\$\d+:\$B\$\d+/.test(c), name + ' must reference a Summary value range');
  assert.ok(/Summary!\$A\$\d+:\$A\$\d+/.test(c), name + ' must reference a Summary category range');

  const type = (c.match(/<c:(barChart|lineChart|doughnutChart|pieChart)>/) || [])[1];
  assert.ok(type, name + ' has no chart group');
  seenTypes.push(type + (/<c:barDir val="bar"\/>/.test(c) ? ':h' : ''));

  // axis-id cardinality and pairing: two for bar/line, none for a doughnut, and every
  // id must appear exactly twice (once in the group, once as the axis's own axId)
  const axIds = (c.match(/<c:axId val="(\d+)"\/>/g) || []).map((x) => x.match(/\d+/)[0]);
  if (type === 'doughnutChart' || type === 'pieChart') {
    assert.strictEqual(axIds.length, 0, name + ': a doughnut/pie must carry no axId');
    assert.ok(c.indexOf('<c:catAx>') < 0 && c.indexOf('<c:valAx>') < 0, name + ': no axes on a doughnut/pie');
    assert.ok(c.indexOf('<c:dLblPos') < 0, name + ': dLblPos is illegal on a doughnut and repairs the file');
    assert.ok((c.match(/<c:dPt>/g) || []).length > 0, name + ': doughnut should colour its slices');
  } else {
    assert.strictEqual(axIds.length, 4, name + ': expected 2 axId in the group + 2 on the axes');
    const uniq = [...new Set(axIds)];
    assert.strictEqual(uniq.length, 2, name + ': expected exactly two distinct axis ids');
    uniq.forEach((id) => {
      assert.strictEqual(axIds.filter((x) => x === id).length, 2, name + ': axis id ' + id + ' must appear twice');
      assert.ok(c.indexOf('<c:crossAx val="' + id + '"/>') >= 0, name + ': axis id ' + id + ' is never crossed');
    });
  }
  // every dPt idx must be unique and inside the point count
  const ptCount = Number((c.match(/<c:ptCount val="(\d+)"\/>/) || [])[1] || 0);
  const dptIdx = (c.match(/<c:dPt><c:idx val="(\d+)"\/>/g) || []).map((x) => Number(x.match(/\d+/)[0]));
  assert.strictEqual(new Set(dptIdx).size, dptIdx.length, name + ': duplicate dPt idx');
  dptIdx.forEach((n) => assert.ok(n < ptCount, name + ': dPt idx ' + n + ' is past ptCount ' + ptCount));
  // a:CT_TextBody needs a:bodyPr first and at least one a:p
  (c.match(/<c:(txPr|rich)>[\s\S]*?<\/c:\1>/g) || []).forEach((blk) => {
    assert.ok(blk.indexOf('<a:bodyPr') >= 0, name + ': a text body without a:bodyPr');
    assert.ok(blk.indexOf('<a:bodyPr') < blk.indexOf('<a:p>'), name + ': a:bodyPr must precede a:p');
  });
});
assert.ok(seenTypes.indexOf('barChart') >= 0, 'expected a column bar chart');
assert.ok(seenTypes.indexOf('barChart:h') >= 0, 'expected a horizontal bar chart');
assert.ok(seenTypes.indexOf('doughnutChart') >= 0, 'expected a doughnut chart');
assert.ok(seenTypes.indexOf('lineChart') >= 0, 'expected a line chart');

// ── drawing: one part, one anchor per chart, unique non-zero shape ids ──
const draw = parts['xl/drawings/drawing1.xml'];
assert.strictEqual((draw.match(/<xdr:twoCellAnchor/g) || []).length, chartNames.length, 'one anchor per chart');
assert.strictEqual((parts['xl/worksheets/sheet1.xml'].match(/<drawing /g) || []).length, 1, 'a worksheet may carry exactly one <drawing>');
const shapeIds = (draw.match(/<xdr:cNvPr id="(\d+)"/g) || []).map((x) => Number(x.match(/\d+/)[0]));
assert.strictEqual(new Set(shapeIds).size, shapeIds.length, 'duplicate xdr:cNvPr id');
shapeIds.forEach((n) => assert.ok(n > 1, 'xdr:cNvPr id must be >1 (1 is reserved)'));

// ── styles: declared counts must match reality, and no cell may point past cellXfs ──
const st = parts['xl/styles.xml'];
['numFmts', 'fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs', 'cellStyles'].forEach((tag) => {
  const declared = Number((st.match(new RegExp('<' + tag + ' count="(\\d+)"')) || [])[1]);
  const child = { numFmts: 'numFmt', fonts: 'font', fills: 'fill', borders: 'border', cellStyleXfs: 'xf', cellXfs: 'xf', cellStyles: 'cellStyle' }[tag];
  const block = (st.match(new RegExp('<' + tag + '[^>]*>[\\s\\S]*?</' + tag + '>')) || [''])[0];
  const actual = (block.match(new RegExp('<' + child + '[ />]', 'g')) || []).length;
  assert.strictEqual(declared, actual, tag + ' count="' + declared + '" but holds ' + actual);
});
// Excel hard-assumes these two fills exist at these indexes
const fillsBlock = (st.match(/<fills[^>]*>[\s\S]*?<\/fills>/) || [''])[0];
assert.ok(/<fills[^>]*><fill><patternFill patternType="none"\/><\/fill><fill><patternFill patternType="gray125"\/><\/fill>/.test(fillsBlock), 'fill 0 must be none and fill 1 gray125');
const xfCount = Number((st.match(/<cellXfs count="(\d+)"/) || [])[1]);
['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'].forEach((sheet) => {
  (parts[sheet].match(/ s="(\d+)"/g) || []).forEach((m) => {
    const n = Number(m.match(/\d+/)[0]);
    assert.ok(n < xfCount, sheet + ' uses style ' + n + ' but cellXfs holds ' + xfCount);
  });
});
// hex conventions: DrawingML wants 6 digits and no '#'; styles.xml wants 8 (ARGB)
Object.keys(parts).forEach((n) => {
  assert.ok(!/srgbClr val="#/.test(parts[n]), n + ': a:srgbClr must not carry a leading #');
});
(st.match(/<color rgb="([0-9A-Fa-f]+)"/g) || []).forEach((m) => {
  assert.strictEqual(m.match(/"([0-9A-Fa-f]+)"/)[1].length, 8, 'styles.xml color rgb must be 8-digit ARGB: ' + m);
});

// ── every part is well-formed enough that no bare & or < leaked from the data ──
// R&D, AT&T and <TEST> are in the fixture precisely to force this path
Object.keys(parts).forEach((n) => {
  if (!/\.xml$/.test(n) && !/\.rels$/.test(n)) return;
  const bare = parts[n].match(/&(?!amp;|lt;|gt;|quot;|apos;|#)/);
  assert.ok(!bare, n + ' contains an unescaped & near: ' + (bare ? parts[n].slice(Math.max(0, bare.index - 40), bare.index + 40) : ''));
});
// KNOWN GAP: chart TITLES are literals in xlsxgen.js today, never data, so no
// fixture can drive an '&' through title(). If a title ever interpolates a vendor,
// an office name or any other value, add one here that carries an ampersand.
const summaryXml = parts['xl/worksheets/sheet1.xml'];
assert.ok(summaryXml.indexOf('R&amp;D') >= 0, 'ampersand data must reach the sheet escaped');
assert.ok(parts[chartNames[1]].indexOf('R&amp;D') >= 0 || chartNames.some((n) => parts[n].indexOf('R&amp;D') >= 0), 'ampersand data must reach a chart cache escaped');

// ── sheet polish actually shipped ──
assert.ok(/showGridLines="0"/.test(summaryXml), 'Summary hides gridlines');
assert.ok(/<pane ySplit="1"/.test(data), 'Data freezes its header row');
assert.ok(/<autoFilter ref="A1:/.test(data), 'Data carries an autofilter');
assert.ok(/<mergeCells count="1">/.test(summaryXml), 'Summary merges its title band');
assert.ok(/_xlnm\.Print_Area/.test(parts['xl/workbook.xml']), 'a print area is defined');
// worksheet child order: <drawing> is near the end of CT_Worksheet
assert.ok(summaryXml.indexOf('<sheetData>') < summaryXml.indexOf('<mergeCells'), 'mergeCells must follow sheetData');
assert.ok(summaryXml.indexOf('<pageMargins') < summaryXml.indexOf('<drawing '), 'drawing must come last');
assert.ok(data.indexOf('<sheetData>') < data.indexOf('<autoFilter'), 'autoFilter must follow sheetData');
assert.ok(data.indexOf('<cols>') < data.indexOf('<sheetData>'), 'cols must precede sheetData');

// ── the chart set adapts: a one-point series is not worth a quadrant ──
// (a single fiscal year would otherwise render as a lone bar labelled with its own total)
const thin = build(Object.assign({}, opts, {
  byFy: [{ label: 'FY 2024', value: 8354345 }],   // one point
  byMonth: [], bySet: [{ label: 'No set-aside', value: 1 }, { label: 'SB', value: 2 }]
}));
const thinParts = {}; let toff = 0;
while (toff + 4 <= thin.length && u32(thin, toff) === 0x04034b50) {
  const size = u32(thin, toff + 18), nlen = u16(thin, toff + 26), elen = u16(thin, toff + 28);
  const name = Buffer.from(thin.slice(toff + 30, toff + 30 + nlen)).toString('utf8');
  const dstart = toff + 30 + nlen + elen;
  thinParts[name] = Buffer.from(thin.slice(dstart, dstart + size)).toString('utf8');
  toff = dstart + size;
}
const thinCharts = Object.keys(thinParts).filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n));
assert.ok(thinCharts.length >= 1, 'a thin dataset still charts what it can');
thinCharts.forEach((n) => {
  checkOrder(thinParts[n], 'thin/' + n);
  assert.ok(thinParts[n].indexOf('Obligations by fiscal year') < 0, 'a single-point fiscal-year series must not be charted');
});
assert.strictEqual((thinParts['xl/drawings/drawing1.xml'].match(/<xdr:twoCellAnchor/g) || []).length, thinCharts.length,
  'anchors must track the adapted chart count');
Object.keys(thinParts).forEach((n) => {
  if (!/^xl\/charts\//.test(n)) return;
  assert.ok(thinParts['[Content_Types].xml'].indexOf('PartName="/' + n + '"') >= 0, 'thin build: content-types missing ' + n);
});

console.log('xlsx generator: all checks passed (' + expect.length + ' parts, ' + chartNames.length
  + ' charts [' + seenTypes.join(', ') + '], CRC + graph + schema order verified)');
