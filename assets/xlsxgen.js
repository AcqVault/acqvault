/* AcqVault — minimal hand-rolled .xlsx writer (self-hosted, no dependencies).
   Builds a two-sheet workbook (Summary + Data) with a NATIVE, editable Excel bar
   chart on the Summary sheet. Kept deliberately small: inline strings (no shared
   string table), a handful of cell styles, one barChart. The OOXML part set and
   relationship graph are the fragile part — see scripts/test_xlsx.js, which
   generates a real file and validates the zip, every part's XML, and the rel graph.

   Public API (attached to window):
     acqBuildXlsx({ office, officeName, fyLabel, columns, rows, byFy, byCat, byVen })
       → Uint8Array of a .xlsx file. columns = [[key,label],…]; rows = [{key:val}];
       byFy/byCat/byVen = [{label, value}] (value = dollars).
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
  function row(rIdx, cells) { return '<row r="' + rIdx + '">' + cells.join('') + '</row>'; }

  // ── the parts ───────────────────────────────────────────────────────────────
  function contentTypes() {
    return HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
      + '<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>'
      + '</Types>';
  }
  function rootRels() {
    return HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>';
  }
  function workbook() {
    return HEAD + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Data" sheetId="2" r:id="rId2"/></sheets></workbook>';
  }
  function workbookRels() {
    return HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
      + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>';
  }
  function styles() {
    // numFmt 164 = $#,##0 currency. cellXfs: 0 default, 1 bold, 2 currency, 3 bold+big, 4 bold currency.
    return HEAD + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0"/></numFmts>'
      + '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font>'
      + '<font><b/><sz val="11"/><name val="Calibri"/></font>'
      + '<font><b/><sz val="14"/><name val="Calibri"/></font></fonts>'
      + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="5">'
      + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
      + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
      + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
      + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
      + '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>'
      + '</cellXfs>'
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
      + '</styleSheet>';
  }

  // Summary sheet. Returns { xml, fyDataRange } so the chart can point at the FY table.
  function summarySheet(o) {
    var rows = [], r = 1;
    function put(cells) { rows.push(row(r, cells)); r++; }
    function skip() { r++; }
    put([cell('A' + r, 'AcqVault — Contract Awards (FPDS)', 3)]);
    put([cell('A' + r, 'Office', 1), cell('B' + r, o.office + (o.officeName ? '  ' + o.officeName : ''))]);
    put([cell('A' + r, 'Fiscal years', 1), cell('B' + r, o.fyLabel)]);
    put([cell('A' + r, 'Total awards', 1), cell('B' + r, o.rows.length)]);
    var totObl = o.rows.reduce(function (s, x) { return s + (Number(x.obligated) || 0); }, 0);
    put([cell('A' + r, 'Total obligated', 1), cell('B' + r, totObl, 2)]);
    put([cell('A' + r, 'Source', 1), cell('B' + r, 'SAM.gov Contract Awards API (FPDS)')]);
    skip();
    // ── FY table (the chart's data range) ──
    put([cell('A' + r, 'Obligations by fiscal year', 1)]);
    var fyHeaderRow = r;
    put([cell('A' + r, 'Fiscal Year', 1), cell('B' + r, 'Obligated', 1)]);
    var fyStart = r;
    o.byFy.forEach(function (d) { put([cell('A' + r, d.label), cell('B' + r, Math.round(d.value), 2)]); });
    var fyEnd = r - 1;
    skip();
    // ── Work-type table ──
    put([cell('A' + r, 'Work type (PSC)', 1)]);
    put([cell('A' + r, 'Type', 1), cell('B' + r, 'Obligated', 1)]);
    o.byCat.forEach(function (d) { put([cell('A' + r, d.label), cell('B' + r, Math.round(d.value), 2)]); });
    skip();
    // ── Top vendors table ──
    put([cell('A' + r, 'Top vendors', 1)]);
    put([cell('A' + r, 'Vendor', 1), cell('B' + r, 'Obligated', 1)]);
    o.byVen.forEach(function (d) { put([cell('A' + r, d.label), cell('B' + r, Math.round(d.value), 2)]); });

    var body = HEAD + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<cols><col min="1" max="1" width="26" customWidth="1"/><col min="2" max="2" width="20" customWidth="1"/></cols>'
      + '<sheetData>' + rows.join('') + '</sheetData>'
      + '<drawing r:id="rId1"/></worksheet>';
    return { xml: body, fyHeaderRow: fyHeaderRow + 1, fyStart: fyStart, fyEnd: fyEnd };
  }
  function summaryRels() {
    return HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>'
      + '</Relationships>';
  }

  // Data sheet — header row + every award row, in the CSV column order.
  function dataSheet(columns, data) {
    var out = [], r = 1;
    out.push(row(r, columns.map(function (c, i) { return cell(col(i) + r, c[1], 1); }))); r++;
    var numKeys = { obligated: 2, awardAmount: 2, ceiling: 2 };
    for (var i = 0; i < data.length; i++) {
      var d = data[i], cells = [];
      for (var j = 0; j < columns.length; j++) {
        var key = columns[j][0], v = d[key];
        var st = numKeys[key] || 0;
        cells.push(cell(col(j) + r, (numKeys[key] && v != null && v !== '') ? Number(v) : v, st));
      }
      out.push(row(r, cells)); r++;
    }
    return HEAD + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<sheetData>' + out.join('') + '</sheetData></worksheet>';
  }

  function drawing() {
    // One two-cell anchor from D8 to about M28, holding the chart graphic frame.
    return HEAD + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
      + '<xdr:twoCellAnchor>'
      + '<xdr:from><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>7</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>'
      + '<xdr:to><xdr:col>12</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>27</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>'
      + '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>'
      + '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>'
      + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">'
      + '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>'
      + '</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>';
  }
  function drawingRels() {
    return HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>'
      + '</Relationships>';
  }
  // Bar chart of the Summary FY table (categories col A, values col B).
  function chart(s) {
    var catRef = 'Summary!$A$' + s.fyStart + ':$A$' + s.fyEnd;
    var valRef = 'Summary!$B$' + s.fyStart + ':$B$' + s.fyEnd;
    // Literal title + series name (not cell refs) so a chart refresh can't overwrite
    // them with the numeric cell they'd otherwise point at.
    return HEAD + '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Obligations by fiscal year</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>'
      + '<c:autoTitleDeleted val="0"/>'
      + '<c:plotArea><c:layout/>'
      + '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>'
      + '<c:ser><c:idx val="0"/><c:order val="0"/>'
      + '<c:tx><c:v>Obligated</c:v></c:tx>'
      + '<c:cat><c:strRef><c:f>' + catRef + '</c:f><c:strCache><c:ptCount val="' + s.byFy.length + '"/>'
      + s.byFy.map(function (d, i) { return '<c:pt idx="' + i + '"><c:v>' + xml(d.label) + '</c:v></c:pt>'; }).join('')
      + '</c:strCache></c:strRef></c:cat>'
      + '<c:val><c:numRef><c:f>' + valRef + '</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="' + s.byFy.length + '"/>'
      + s.byFy.map(function (d, i) { return '<c:pt idx="' + i + '"><c:v>' + Math.round(d.value) + '</c:v></c:pt>'; }).join('')
      + '</c:numCache></c:numRef></c:val></c:ser>'
      + '<c:axId val="111111111"/><c:axId val="222222222"/></c:barChart>'
      + '<c:catAx><c:axId val="111111111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="222222222"/></c:catAx>'
      + '<c:valAx><c:axId val="222222222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="111111111"/></c:valAx>'
      + '</c:plotArea><c:plotVisOnly val="1"/></c:chart></c:chartSpace>';
  }

  function bytes(s) { return enc.encode(s); }

  window.acqBuildXlsx = function (opts) {
    var summ = summarySheet(opts);
    summ.byFy = opts.byFy;
    var files = [
      { name: '[Content_Types].xml', data: bytes(contentTypes()) },
      { name: '_rels/.rels', data: bytes(rootRels()) },
      { name: 'xl/workbook.xml', data: bytes(workbook()) },
      { name: 'xl/_rels/workbook.xml.rels', data: bytes(workbookRels()) },
      { name: 'xl/styles.xml', data: bytes(styles()) },
      { name: 'xl/worksheets/sheet1.xml', data: bytes(summ.xml) },
      { name: 'xl/worksheets/_rels/sheet1.xml.rels', data: bytes(summaryRels()) },
      { name: 'xl/worksheets/sheet2.xml', data: bytes(dataSheet(opts.columns, opts.rows)) },
      { name: 'xl/drawings/drawing1.xml', data: bytes(drawing()) },
      { name: 'xl/drawings/_rels/drawing1.xml.rels', data: bytes(drawingRels()) },
      { name: 'xl/charts/chart1.xml', data: bytes(chart(summ)) }
    ];
    return zip(files);
  };
})();
