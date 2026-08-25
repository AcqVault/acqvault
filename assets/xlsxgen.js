/* AcqVault — hand-rolled .xlsx writer (self-hosted, no dependencies).

   Two sheets: a Summary dashboard (KPI band, source tables, and FOUR native,
   editable Excel charts) and a Data sheet carrying every award row. Inline
   strings, no shared string table, zip STORE.

   The OOXML part set, the relationship graph and CHILD ELEMENT ORDER are the
   fragile parts: Excel repairs a file whose chart children are out of their
   schema sequence, and nothing else in the toolchain notices. scripts/test_xlsx.js
   walks the emitted XML against the CT_ sequences from ECMA-376 and checks the
   package graph, the axis-id pairing and every count= attribute. Run it after any
   edit here — a green run is the only evidence available without Excel itself.

   Two hex conventions live side by side, and mixing them is silent: DrawingML
   a:srgbClr takes 6 digits ("87651C"); styles.xml color rgb takes 8, ARGB
   ("FF87651C").

   Public API (attached to window):
     acqBuildXlsx({ office, officeName, fyLabel, columns, rows,
                    byFy, byCat, byVen, bySet, byMonth, awards, total })
       → Uint8Array of a .xlsx file. columns = [[key,label],…]; rows = [{key:val}];
       by* = [{label, value}] where value is dollars.
*/
(function () {
  'use strict';

  // ── CRC-32 (for the zip local/central records) ────────────────────────────
  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  var enc = new TextEncoder();

  // ── ZIP writer (STORE / no compression — Excel accepts stored parts) ───────
  // Central-directory + local-header layout, little-endian throughout.
  function zip(files) {
    var parts = [], central = [], offset = 0;
    function u16(n) { return [n & 0xFF, (n >>> 8) & 0xFF]; }
    function u32(n) { return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }
    files.forEach(function (f) {
      var name = enc.encode(f.name);
      var data = f.data;
      var crc = crc32(data);
      var local = [].concat(
        u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length),
        u16(name.length), u16(0));
      parts.push(new Uint8Array(local), name, data);
      central.push([].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length),
        u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset)));
      central.push(name);
      offset += local.length + name.length + data.length;
    });
    var cdStart = offset, cdBytes = [];
    central.forEach(function (c) { cdBytes = cdBytes.concat(Array.isArray(c) ? c : Array.from(c)); });
    var cd = new Uint8Array(cdBytes);
    var eocd = new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(cd.length), u32(cdStart), u16(0)));
    var total = 0, all = parts.concat([cd, eocd]);
    all.forEach(function (p) { total += p.length; });
    var out = new Uint8Array(total), pos = 0;
    all.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  function xml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  var HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  // A1-style column letters.
  function col(n) { var s = ''; n++; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }
  // One cell. style index s; numeric when typeof val === 'number'.
  function cell(ref, val, s) {
    var st = s ? ' s="' + s + '"' : '';
    if (typeof val === 'number' && isFinite(val)) return '<c r="' + ref + '"' + st + '><v>' + val + '</v></c>';
    if (val === '' || val == null) return '<c r="' + ref + '"' + st + '/>';
    return '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' + xml(val) + '</t></is></c>';
  }
  function row(rIdx, cells, ht) { return '<row r="' + rIdx + '"' + (ht ? ' ht="' + ht + '" customHeight="1"' : '') + '>' + cells.join('') + '</row>'; }

  // AcqVault palette, DrawingML form (6 hex digits, no '#').
  var INK = '0F2540', BRASS = '87651C', BRASSL = 'E4C477', RULE = 'D9D4C7', GRID = 'EDEAE1', WARM = '8A8578', PAPER = 'F7F6F2';
  var SLICE = [BRASS, INK, BRASSL, WARM, 'B08D3F', '4A6B8A'];
  var CURFMT = '&quot;$&quot;#,##0';

  // ── the parts ───────────────────────────────────────────────────────────────
  function contentTypes(nCharts) {
    var o = '';
    for (var i = 1; i <= nCharts; i++) o += '<Override PartName="/xl/charts/chart' + i + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>';
    return HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
      + o + '</Types>';
  }
  function rootRels() {
    return HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>';
  }
  function workbook(s) {
    // localSheetId is the 0-based index into <sheets>, not sheetId.
    return HEAD + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Data" sheetId="2" r:id="rId2"/></sheets>'
      + '<definedNames>'
        + '<definedName name="_xlnm.Print_Area" localSheetId="0">Summary!$A$1:$U$' + s.printRows + '</definedName>'
        + '<definedName name="_xlnm.Print_Titles" localSheetId="1">Data!$1:$1</definedName>'
      + '</definedNames></workbook>';
  }
  function workbookRels() {
    return HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
      + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>';
  }
  // styles.xml is APPEND-ONLY: indexes 0-4 predate this dashboard and are referenced
  // by cells written elsewhere, so new entries go at the tail and every count= must
  // match its real child count (a wrong count is itself a repair trigger).
  // fills 0 (none) and 1 (gray125) are assumed by Excel and must never move.
  function styles() {
    return HEAD + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<numFmts count="3">'
        + '<numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0"/>'
        + '<numFmt numFmtId="165" formatCode="#,##0"/>'
        + '<numFmt numFmtId="166" formatCode="0.0%"/>'
      + '</numFmts>'
      + '<fonts count="8">'
        + '<font><sz val="11"/><name val="Calibri"/></font>'
        + '<font><b/><sz val="11"/><name val="Calibri"/></font>'
        + '<font><b/><sz val="14"/><name val="Calibri"/></font>'
        + '<font><b/><sz val="20"/><color rgb="FF0F2540"/><name val="Calibri"/></font>'
        + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
        + '<font><sz val="9"/><color rgb="FF6B6558"/><name val="Calibri"/></font>'
        + '<font><b/><sz val="11"/><color rgb="FF87651C"/><name val="Calibri"/></font>'
        + '<font><b/><sz val="18"/><color rgb="FF0F2540"/><name val="Calibri"/></font>'
      + '</fonts>'
      + '<fills count="5">'
        + '<fill><patternFill patternType="none"/></fill>'
        + '<fill><patternFill patternType="gray125"/></fill>'
        + '<fill><patternFill patternType="solid"><fgColor rgb="FF0F2540"/><bgColor indexed="64"/></patternFill></fill>'
        + '<fill><patternFill patternType="solid"><fgColor rgb="FFF7F6F2"/><bgColor indexed="64"/></patternFill></fill>'
        + '<fill><patternFill patternType="solid"><fgColor rgb="FFE4C477"/><bgColor indexed="64"/></patternFill></fill>'
      + '</fills>'
      + '<borders count="3">'
        + '<border><left/><right/><top/><bottom/><diagonal/></border>'
        + '<border><left/><right/><top/><bottom style="thin"><color rgb="FFD9D4C7"/></bottom><diagonal/></border>'
        + '<border><left/><right/><top/><bottom style="medium"><color rgb="FF87651C"/></bottom><diagonal/></border>'
      + '</borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="13">'
        + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
        + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
        + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
        + '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>'
        + '<xf numFmtId="0" fontId="3" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="4" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="4" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>'
        + '<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
        + '<xf numFmtId="0" fontId="6" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>'
        + '<xf numFmtId="164" fontId="7" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>'
        + '<xf numFmtId="165" fontId="7" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>'
        + '<xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>'
      + '</cellXfs>'
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
      + '<dxfs count="0"/>'
      + '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>'
      + '</styleSheet>';
  }

  // ── Summary sheet ──────────────────────────────────────────────────────────
  // Column A/B hold the headline band and every chart's source table; the charts
  // are anchored from column D rightwards so the two never collide.
  function summarySheet(o, series) {
    var rows = [], r = 1, merges = [];
    function put(cells, ht) { rows.push(row(r, cells, ht)); r++; }
    function skip() { r++; }
    function sect(title) { put([cell('A' + r, title, 9), cell('B' + r, '', 9)]); }
    // a labelled table whose rows the charts point at
    function table(title, data, fmt) {
      sect(title);
      var head = r;
      put([cell('A' + r, 'Item', 6), cell('B' + r, 'Obligated', 7)]);
      var start = r;
      data.forEach(function (d) { put([cell('A' + r, d.label), cell('B' + r, Math.round(d.value), fmt || 2)]); });
      return { head: head, start: start, end: r - 1, n: data.length };
    }

    put([cell('A' + r, 'Contract Awards · ' + o.office, 5), cell('B' + r, '', 5)], 30);
    merges.push('A1:B1');
    put([cell('A' + r, o.officeName || '', 8), cell('B' + r, '', 8)]);
    put([cell('A' + r, o.fyLabel, 8), cell('B' + r, '', 8)]);
    // Whatever could not be retrieved travels with the file — a workbook that gets
    // forwarded is the last place a missing period should become invisible.
    if (o.caveat) put([cell('A' + r, o.caveat, 8), cell('B' + r, '', 8)]);
    skip();
    sect('At a glance');
    put([cell('A' + r, 'Award actions', 1), cell('B' + r, o.awards || o.rows.length, 11)]);
    put([cell('A' + r, 'Total obligated', 1), cell('B' + r, Math.round(o.total || 0), 10)]);
    var vendors = {}; o.rows.forEach(function (x) { if (x.vendor) vendors[x.vendor] = 1; });
    put([cell('A' + r, 'Distinct vendors', 1), cell('B' + r, Object.keys(vendors).length, 11)]);
    var big = 0; o.rows.forEach(function (x) { var v = Number(x.obligated) || 0; if (v > big) big = v; });
    put([cell('A' + r, 'Largest single action', 1), cell('B' + r, Math.round(big), 12)]);
    skip();

    var t = series.map(function (sp, i) {
      var range = table(sp.title, sp.data);
      if (i < series.length - 1) skip();
      return { key: sp.key, title: sp.title, type: sp.type, data: sp.data, range: range };
    });
    skip();
    put([cell('A' + r, 'Source: SAM.gov Contract Awards API (FPDS). Dollars are the obligation on each action. Generated by AcqVault — acqvault.com', 8)]);
    var lastRow = r;

    var body = HEAD + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheetPr><tabColor rgb="FF87651C"/></sheetPr>'
      + '<sheetViews><sheetView showGridLines="0" tabSelected="1" workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>'
      + '<sheetFormatPr defaultRowHeight="15"/>'
      + '<cols><col min="1" max="1" width="34" customWidth="1"/><col min="2" max="2" width="20" customWidth="1"/><col min="3" max="3" width="2.5" customWidth="1"/></cols>'
      + '<sheetData>' + rows.join('') + '</sheetData>'
      + '<mergeCells count="' + merges.length + '">' + merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>'
      + '<printOptions horizontalCentered="1"/>'
      + '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>'
      + '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="1"/>'
      + '<drawing r:id="rId1"/></worksheet>';
    return { xml: body, tables: t, printRows: Math.max(lastRow, 38) };
  }
  function summaryRels() {
    return HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>'
      + '</Relationships>';
  }

  // ── Data sheet ─────────────────────────────────────────────────────────────
  var WIDE = { description: 52, pscName: 30, naicsName: 30, vendor: 34, officeName: 28, awardType: 26, setAside: 26, extentCompeted: 26, pricingType: 24 };
  function dataSheet(columns, data) {
    var out = [], r = 1;
    out.push(row(r, columns.map(function (c, i) { return cell(col(i) + r, c[1], OSRNUM[c[0]] ? 7 : 6); }), 22)); r++;
    for (var i = 0; i < data.length; i++) {
      var d = data[i], cells = [];
      for (var j = 0; j < columns.length; j++) {
        var key = columns[j][0], v = d[key];
        var st = OSRNUM[key] ? 2 : 0;
        cells.push(cell(col(j) + r, (OSRNUM[key] && v != null && v !== '') ? Number(v) : v, st));
      }
      out.push(row(r, cells)); r++;
    }
    var last = col(Math.max(0, columns.length - 1));
    var cols = columns.map(function (c, i) {
      var w = WIDE[c[0]] || Math.max(11, Math.min(24, String(c[1]).length + 4));
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
    }).join('');
    return HEAD + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<sheetViews><sheetView showGridLines="0" workbookViewId="0">'
        + '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
        + '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
      + '<sheetFormatPr defaultRowHeight="15"/>'
      + (cols ? '<cols>' + cols + '</cols>' : '')
      + '<sheetData>' + out.join('') + '</sheetData>'
      + (columns.length ? '<autoFilter ref="A1:' + last + Math.max(1, data.length + 1) + '"/>' : '')
      + '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>'
      + '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="1"/>'
      // FY, Mod, PSC, NAICS and UEI are identifiers, not quantities \u2014 they stay text so a
      // leading zero survives. Excel flags every one of them "number stored as text",
      // which on a few thousand rows is a green triangle in every cell. Say it is
      // intentional instead. (CT_Worksheet order: after pageSetup, before drawing.)
      + (columns.length && data.length
          ? '<ignoredErrors><ignoredError sqref="A2:' + last + (data.length + 1) + '" numberStoredAsText="1"/></ignoredErrors>'
          : '')
      + '</worksheet>';
  }
  var OSRNUM = { obligated: 1, awardAmount: 1, ceiling: 1 };

  // ── drawing: ONE part, one twoCellAnchor per chart ─────────────────────────
  // CT_Worksheet allows a single <drawing>, so N charts must share this part.
  // xdr:col/row are 0-based; cNvPr id must be unique and non-zero (1 is reserved).
  var SLOTS = [[3, 1, 11, 17], [3, 18, 11, 34], [12, 1, 20, 17], [12, 18, 20, 34]];
  function drawing(n) {
    var out = '';
    for (var i = 0; i < n; i++) {
      var s = SLOTS[i] || [3 + (i * 9), 1, 11 + (i * 9), 17];
      out += '<xdr:twoCellAnchor editAs="oneCell">'
        + '<xdr:from><xdr:col>' + s[0] + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + s[1] + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>'
        + '<xdr:to><xdr:col>' + s[2] + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + s[3] + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>'
        + '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="' + (i + 2) + '" name="Chart ' + (i + 1) + '"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>'
        + '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>'
        + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">'
        + '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId' + (i + 1) + '"/>'
        + '</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>';
    }
    return HEAD + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
      + out + '</xdr:wsDr>';
  }
  function drawingRels(n) {
    var out = '';
    for (var i = 1; i <= n; i++) out += '<Relationship Id="rId' + i + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart' + i + '.xml"/>';
    return HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + out + '</Relationships>';
  }

  // ── charts ─────────────────────────────────────────────────────────────────
  // Child order below follows the ECMA-376 CT_ sequences exactly. Excel silently
  // repairs a file whose children are reordered, so treat every block here as
  // ordered, not as a bag of options.
  function txPr(sz, bold, color) {
    return '<a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="' + sz + '"' + (bold ? ' b="1"' : '') + '>'
      + '<a:solidFill><a:srgbClr val="' + (color || INK) + '"/></a:solidFill><a:latin typeface="Calibri"/></a:defRPr></a:pPr>'
      + '<a:endParaRPr lang="en-US"/></a:p>';
  }
  function title(text) {
    return '<c:title><c:tx><c:rich><a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" vert="horz" wrap="square" anchor="ctr" anchorCtr="1"/><a:lstStyle/>'
      + '<a:p><a:pPr><a:defRPr sz="1200" b="1"><a:solidFill><a:srgbClr val="' + INK + '"/></a:solidFill><a:latin typeface="Calibri"/></a:defRPr></a:pPr>'
      + '<a:r><a:rPr lang="en-US" sz="1200" b="1"><a:solidFill><a:srgbClr val="' + INK + '"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr>'
      + '<a:t>' + xml(text) + '</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/>'
      + '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:title><c:autoTitleDeleted val="0"/>';
  }
  // CT_DLbls: dLbl* first, then EITHER delete OR the property group — never both.
  function dLbls(fmt, pos, percent) {
    return '<c:dLbls>'
      + '<c:numFmt formatCode="' + fmt + '" sourceLinked="0"/>'
      + '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>'
      + '<c:txPr>' + txPr(900, percent ? 1 : 0, percent ? 'FFFFFF' : INK) + '</c:txPr>'
      + (pos ? '<c:dLblPos val="' + pos + '"/>' : '')
      + '<c:showLegendKey val="0"/><c:showVal val="' + (percent ? 0 : 1) + '"/><c:showCatName val="0"/>'
      + '<c:showSerName val="0"/><c:showPercent val="' + (percent ? 1 : 0) + '"/><c:showBubbleSize val="0"/>'
      + '</c:dLbls>';
  }
  function catRef(sheetRef, items) {
    return '<c:cat><c:strRef><c:f>' + sheetRef + '</c:f><c:strCache><c:ptCount val="' + items.length + '"/>'
      + items.map(function (d, i) { return '<c:pt idx="' + i + '"><c:v>' + xml(d.label) + '</c:v></c:pt>'; }).join('')
      + '</c:strCache></c:strRef></c:cat>';
  }
  function valRef(sheetRef, items) {
    return '<c:val><c:numRef><c:f>' + sheetRef + '</c:f><c:numCache><c:formatCode>' + CURFMT + '</c:formatCode><c:ptCount val="' + items.length + '"/>'
      + items.map(function (d, i) { return '<c:pt idx="' + i + '"><c:v>' + Math.round(d.value) + '</c:v></c:pt>'; }).join('')
      + '</c:numCache></c:numRef></c:val>';
  }
  function axes(idA, idB, catPos, valPos) {
    return '<c:catAx><c:axId val="' + idA + '"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="' + catPos + '"/>'
      + '<c:numFmt formatCode="General" sourceLinked="0"/>'
      + '<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>'
      + '<c:spPr><a:noFill/><a:ln w="9525" cap="flat"><a:solidFill><a:srgbClr val="' + RULE + '"/></a:solidFill><a:round/></a:ln></c:spPr>'
      + '<c:txPr>' + txPr(900) + '</c:txPr>'
      + '<c:crossAx val="' + idB + '"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>'
      + '<c:valAx><c:axId val="' + idB + '"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="' + valPos + '"/>'
      + '<c:majorGridlines><c:spPr><a:ln w="9525" cap="flat"><a:solidFill><a:srgbClr val="' + GRID + '"/></a:solidFill><a:round/></a:ln></c:spPr></c:majorGridlines>'
      + '<c:numFmt formatCode="' + CURFMT + '" sourceLinked="0"/>'
      + '<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>'
      + '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>'
      + '<c:txPr>' + txPr(900) + '</c:txPr>'
      + '<c:crossAx val="' + idA + '"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>';
  }
  function frame(inner, legend) {
    return HEAD + '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<c:lang val="en-US"/><c:roundedCorners val="0"/>'
      + '<c:chart>' + inner
      + (legend ? '<c:legend><c:legendPos val="' + legend + '"/><c:overlay val="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:txPr>' + txPr(900) + '</c:txPr></c:legend>' : '')
      + '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>'
      + '<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525" cap="flat"><a:solidFill><a:srgbClr val="' + BRASSL + '"/></a:solidFill><a:round/></a:ln></c:spPr>'
      + '<c:txPr>' + txPr(900) + '</c:txPr></c:chartSpace>';
  }
  // cfg: { type:'bar'|'barh'|'doughnut'|'line', title, cats, vals, items, idx }
  function chartXml(cfg) {
    var items = cfg.items, idA = 111000000 + cfg.idx * 2, idB = idA + 1;
    if (cfg.type === 'doughnut') {
      // CT_PieSer order: idx, order, tx, spPr?, explosion?, dPt*, dLbls?, cat, val.
      // dPt BEFORE dLbls, dLbls BEFORE cat/val — and no axId anywhere in a doughnut.
      var dpts = items.map(function (d, i) {
        return '<c:dPt><c:idx val="' + i + '"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="' + SLICE[i % SLICE.length] + '"/></a:solidFill>'
          + '<a:ln w="19050"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>';
      }).join('');
      return frame(title(cfg.title)
        + '<c:plotArea><c:layout/><c:doughnutChart><c:varyColors val="1"/>'
        + '<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>' + xml(cfg.series || 'Obligated') + '</c:v></c:tx>'
        + dpts
        // no dLblPos on a doughnut: Excel has no label position for one and repairs the file
        + dLbls('0%', '', 1)
        + catRef(cfg.cats, items) + valRef(cfg.vals, items)
        + '</c:ser><c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>'
        + '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>', 'r');
    }
    if (cfg.type === 'line') {
      // grouping is REQUIRED on a lineChart. <c:marker val="1"/> at chart level is a
      // boolean; <c:marker> inside the series is a CT_Marker — same tag, different type.
      return frame(title(cfg.title)
        + '<c:plotArea><c:layout/><c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>'
        + '<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>' + xml(cfg.series || 'Obligated') + '</c:v></c:tx>'
        + '<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="' + BRASS + '"/></a:solidFill><a:round/></a:ln><a:effectLst/></c:spPr>'
        + '<c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr><a:solidFill><a:srgbClr val="' + INK + '"/></a:solidFill>'
          + '<a:ln w="12700"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:marker>'
        + catRef(cfg.cats, items) + valRef(cfg.vals, items) + '<c:smooth val="0"/>'
        + '</c:ser><c:marker val="1"/>'
        + '<c:axId val="' + idA + '"/><c:axId val="' + idB + '"/></c:lineChart>'
        + axes(idA, idB, 'b', 'l')
        + '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>');
    }
    var horiz = cfg.type === 'barh';
    // CT_BarSer order: idx, order, tx, spPr, invertIfNegative, dPt*, dLbls, cat, val.
    return frame(title(cfg.title)
      + '<c:plotArea><c:layout/><c:barChart><c:barDir val="' + (horiz ? 'bar' : 'col') + '"/><c:grouping val="clustered"/><c:varyColors val="0"/>'
      + '<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>' + xml(cfg.series || 'Obligated') + '</c:v></c:tx>'
      + '<c:spPr><a:solidFill><a:srgbClr val="' + (cfg.color || BRASS) + '"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>'
      + '<c:invertIfNegative val="0"/>'
      + dLbls(CURFMT, 'outEnd')
      + catRef(cfg.cats, items) + valRef(cfg.vals, items)
      + '</c:ser><c:gapWidth val="' + (horiz ? 50 : 60) + '"/><c:overlap val="-27"/>'
      + '<c:axId val="' + idA + '"/><c:axId val="' + idB + '"/></c:barChart>'
      + axes(idA, idB, horiz ? 'l' : 'b', horiz ? 'b' : 'l')
      + '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>');
  }

  function bytes(s) { return enc.encode(s); }

  window.acqBuildXlsx = function (opts) {
    var o = {
      office: opts.office || '', officeName: opts.officeName || '', fyLabel: opts.fyLabel || '',
      columns: opts.columns || [], rows: opts.rows || [],
      byFy: opts.byFy || [], byCat: opts.byCat || [], byVen: opts.byVen || [],
      bySet: opts.bySet || [], byMonth: opts.byMonth || [], byOffice: opts.byOffice || [],
      caveat: opts.caveat || '',
      awards: opts.awards, total: opts.total
    };
    // Which four charts earn a quadrant depends on the data: a single fiscal year is
    // one bar, a wholly-Service office is one doughnut slice. Anything below its
    // minimum is dropped and the next candidate takes the slot.
    var series = [
      // Offices first: when several are in play, how they compare IS the report.
      { key: 'off', title: 'Obligations by contracting office', data: o.byOffice, type: 'barh', min: 2 },
      { key: 'fy', title: 'Obligations by fiscal year', data: o.byFy, type: 'bar', min: 2 },
      { key: 'cat', title: 'Work type (PSC)', data: o.byCat, type: 'doughnut', min: 2 },
      { key: 'ven', title: 'Top vendors', data: o.byVen, type: 'barh', min: 2 },
      { key: 'mon', title: 'Obligations by month signed', data: o.byMonth, type: 'line', min: 3 },
      { key: 'set', title: 'Set-aside', data: o.bySet, type: 'barh', min: 2 }
    ].filter(function (sp) { return sp.data && sp.data.length >= sp.min; }).slice(0, 4);
    var summ = summarySheet(o, series);
    var charts = summ.tables.map(function (t, i) {
      return chartXml({
        idx: i, type: t.type, title: t.title,
        cats: 'Summary!$A$' + t.range.start + ':$A$' + t.range.end,
        vals: 'Summary!$B$' + t.range.start + ':$B$' + t.range.end,
        items: t.data
      });
    });
    var files = [
      { name: '[Content_Types].xml', data: bytes(contentTypes(charts.length)) },
      { name: '_rels/.rels', data: bytes(rootRels()) },
      { name: 'xl/workbook.xml', data: bytes(workbook(summ)) },
      { name: 'xl/_rels/workbook.xml.rels', data: bytes(workbookRels()) },
      { name: 'xl/styles.xml', data: bytes(styles()) },
      { name: 'xl/worksheets/sheet1.xml', data: bytes(summ.xml) },
      { name: 'xl/worksheets/_rels/sheet1.xml.rels', data: bytes(summaryRels()) },
      { name: 'xl/worksheets/sheet2.xml', data: bytes(dataSheet(o.columns, o.rows)) },
      { name: 'xl/drawings/drawing1.xml', data: bytes(drawing(charts.length)) },
      { name: 'xl/drawings/_rels/drawing1.xml.rels', data: bytes(drawingRels(charts.length)) }
    ];
    charts.forEach(function (c, i) { files.push({ name: 'xl/charts/chart' + (i + 1) + '.xml', data: bytes(c) }); });
    return zip(files);
  };
})();
