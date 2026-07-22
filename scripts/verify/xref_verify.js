// Verify the cross-reference engine against the REAL corpus, using the REAL shipped code.
const fs = require('fs'), path = require('path'), vm = require('vm');
// Resolve from THIS file, not $HOME: hard-coding the owner's path made these
// unrunnable from any other clone — and therefore impossible to wire into a gate.
const BASE = path.resolve(__dirname, '..', '..');
const { grabFunction, grabConst, grabLine } = require(path.join(BASE, 'scripts', 'extract_js_fns.js'));
const src = fs.readFileSync(path.join(BASE, 'assets/app.js'), 'utf8');

const docs = JSON.parse(fs.readFileSync(path.join(BASE, 'output/documents.json'), 'utf8'));
const sandbox = {
  console,
  ACQ_INDEX: docs.filter(d => d.source !== 'compass').map(doc => ({ doc })),
  esc: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
};
vm.createContext(sandbox);
vm.runInContext([
  'let XREF_MAP = null;',
  grabConst(src, 'XREF_SOURCES'), grabLine(src, 'XREF_LEAD'),
  grabConst(src, 'XREF_BARE_ORDER'), grabLine(src, 'XREF_FOREIGN'),
  grabFunction(src, 'buildXrefMap'), grabFunction(src, 'linkifyXrefs'),
].join('\n\n'), sandbox);
const { linkifyXrefs } = sandbox;

const byId = new Map(docs.map(d => [String(d.id), d]));
const find = (source, re) => docs.find(d => d.source === source && re.test(d.title));
let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  ✗ ' + m); fail++; } else console.log('  ✓ ' + m); };
const linkedIds = html => [...html.matchAll(/data-xref="([^"]+)"/g)].map(m => m[1]);
const target = (text, hit) => { const ids = linkedIds(linkifyXrefs(text, hit)); return ids.length ? byId.get(ids[0]) : null; };

console.log('CROSS-REFERENCE VERIFICATION\n');

// D1 — "PGI n" must resolve to the PGI, never to the rule
const rd = find('r-dfars', /^209\.406-3/);
const t1 = target('Use the procedures at PGI 209.470 when referring a potential debarment.', rd);
ok(t1 && t1.source === 'pgi', `"PGI 209.470" resolves to ${t1 ? t1.source + ' — ' + t1.title.slice(0, 42) : 'NOTHING'} (was r-dfars "[Reserved]")`);

const rd2 = find('r-dfars', /^204\.201 /);
const t2 = target('(b) See PGI 204.201 for use of unique procurement instrument identifiers.', rd2);
ok(t2 && t2.source === 'pgi' && /^PGI 204\.201/.test(t2.title), `"PGI 204.201" -> ${t2 ? t2.source + ' ' + t2.title.slice(0, 30) : 'NOTHING'}`);

// a BARE number must NEVER reach the PGI, even from inside a PGI document
const pgiDoc = find('pgi', /^PGI 204\.202-70/);
const t3 = target('Follow the procedures in 204.201 before issuing the order.', pgiDoc);
ok(t3 && t3.source !== 'pgi', `bare "204.201" from inside a PGI doc -> ${t3 ? t3.source : 'nothing'} (must never be pgi)`);

// D2 — foreign citation systems
for (const [txt, why] of [
  ['research that meets exemption criteria under 32 CFR 219.101(b)', 'CFR'],
  ['as required by 10 U.S.C. 3453 the contracting officer', 'U.S.C.'],
  ['established by Public Law 115-232 section 889', 'Public Law'],
  ['in accordance with DoDI 5000.79 procedures', 'DoDI'],
]) {
  const out = linkifyXrefs(txt, rd);
  ok(linkedIds(out).length === 0, `${why} citation not linkified: "${txt.slice(0, 46)}…"`);
}

// D3 — a number split across a PDF line break must not link to the parent
const rd3 = find('r-dfars', /^227\.7103-6/) || rd;
ok(linkedIds(linkifyXrefs('(see 227.7102- 4), existing works', rd3)).length === 0,
   '"227.7102- 4" (PDF line-split) is not linked to the parent 227.7102');

// D4 — duplicate clause numbers must resolve to the SUBSTANTIVE copy
const t4 = target('as prescribed in 252.215-7010 the offeror shall', rd);
ok(t4 && String(t4.content || '').length > 1000,
   `"252.215-7010" -> ${t4 ? t4.content.length : 0} chars (was a 117-char stub)`);

// D7 — cross-source fallback: "FAR n" in R-DFARS text should reach the RFO
const t5 = target('that is not imposed by statute (see FAR 1.106 and DFARS 201.106)', rd);
ok(t5 && t5.source === 'rfo', `"FAR 1.106" in R-DFARS text -> ${t5 ? t5.source : 'NOTHING'} (was dead)`);

// self-link guard still holds
ok(linkedIds(linkifyXrefs('This section 204.201 governs.', rd2)).length === 0,
   "a section's own number is still not self-linked");

// scale: corpus-wide, how many PGI references now resolve into the PGI
let pgiRefs = 0, pgiLinked = 0, wrongDest = 0;
for (const d of docs) {
  if (d.source !== 'r-dfars') continue;
  const text = String(d.content || '');
  const hits = text.match(/PGI\s+\d{1,3}\.\d[\d.\-]*/g);
  if (!hits) continue;
  pgiRefs += hits.length;
  for (const id of linkedIds(linkifyXrefs(text, d))) {
    const t = byId.get(id);
    if (!t) continue;
  }
  const out = linkifyXrefs(text, d);
  for (const m of out.matchAll(/PGI\s+<a[^>]*data-xref="([^"]+)"|<a[^>]*data-xref="([^"]+)"[^>]*>/g)) {}
  // count links whose visible label starts with PGI
  for (const m of out.matchAll(/<a class="dc-xref"[^>]*data-xref="([^"]+)"[^>]*>(PGI\s+)?[\d.\-]+<\/a>/g)) {
    const t = byId.get(m[1]);
    if (m[2]) { pgiLinked++; if (!t || t.source !== 'pgi') wrongDest++; }
  }
}
console.log(`\n  R-DFARS text: ${pgiRefs} "PGI n" references, ${pgiLinked} now linked, ${wrongDest} to a wrong source`);
ok(wrongDest === 0, 'no "PGI n" reference resolves outside the PGI');
ok(pgiLinked > 300, `PGI references linked corpus-wide: ${pgiLinked} (was 0, with 68 pointing at the rule)`);

console.log(fail ? `\n${fail} CHECK(S) FAILED` : '\nALL CROSS-REFERENCE CHECKS PASSED');
process.exit(fail ? 1 : 0);
