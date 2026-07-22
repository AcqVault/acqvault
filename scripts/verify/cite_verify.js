// Verify every citation fix against the REAL corpus using the REAL shipped function.
const fs = require('fs'), path = require('path');
// Resolve from THIS file, not $HOME: hard-coding the owner's path made these
// unrunnable from any other clone — and therefore impossible to wire into a gate.
const BASE = path.resolve(__dirname, '..', '..');
const { grabFunction, grabConst } = require(path.join(BASE, 'scripts', 'extract_js_fns.js'));
const src = fs.readFileSync(path.join(BASE, 'assets/app.js'), 'utf8');
const vm = require('vm');

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext([
  grabConst(src, 'SOURCE_SHORT'), grabConst(src, 'SOURCE_FULL'),
  grabConst(src, 'PART_200_SOURCES'), grabConst(src, 'NON_FAR_LEVEL_SOURCES'),
  grabFunction(src, 'partWord'), grabFunction(src, 'displayPartForSource'),
  grabFunction(src, 'generateCitation'),
].join('\n\n'), sandbox);
const { generateCitation } = sandbox;

const docs = JSON.parse(fs.readFileSync(path.join(BASE, 'output/documents.json'), 'utf8'));
const cites = docs.map(d => [d, generateCitation(d)]);
let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  ✗ ' + m); fail++; } else console.log('  ✓ ' + m); };

console.log('CITATION SCHEMA VERIFICATION\n');

const dd = cites.filter(([, c]) => / — —| — -|— - /.test(c));
ok(dd.length === 0, `doubled-dash citations: ${dd.length} (was 46)` + (dd.length ? ` e.g. ${dd[0][1]}` : ''));

const pgi = cites.filter(([d]) => d.source === 'pgi');
ok(pgi.every(([, c]) => /^PGI \d/.test(c)), `all ${pgi.length} PGI cites use the bare "PGI n" form — e.g. ${pgi[0][1].slice(0, 52)}`);
ok(!pgi.some(([, c]) => /DFARS PGI/.test(c)), 'no PGI citation double-prefixes with "DFARS"');

const sspLetter = cites.filter(([d]) => d.source === 'ssp' && /^[A-E]\.\d/.test(d.title));
ok(sspLetter.every(([, c]) => /\b[A-E]\.\d/.test(c)),
   `all ${sspLetter.length} SSP appendix sections carry their number — e.g. ${sspLetter[0] && sspLetter[0][1].slice(0, 46)}`);

const badSub = cites.filter(([d, c]) => (d.source === 'ssp' || d.source === 'afi-63-138') && /\bSubpart\b/.test(c));
ok(badSub.length === 0, `"Subpart" invented for SSP/DAFI: ${badSub.length} (was 63)`);

const dbl = cites.find(([d]) => /^232\.502-4-70/.test(d.title));
ok(dbl && /232\.502-4-70/.test(dbl[1]), `double-suffix section cites its number: ${dbl && dbl[1].slice(0, 50)}`);

const comp = cites.filter(([d]) => d.source === 'compass');
ok(!comp.some(([, c]) => /^COMPASS/.test(c)), `compass no longer shouts its id — e.g. ${comp[0] && comp[0][1].slice(0, 48)}`);

// uniqueness within a part (the P0 invariant)
const byPart = new Map();
for (const [d, c] of cites) {
  if (d.source === 'compass') continue;
  const k = d.source + '|' + d.part;
  if (!byPart.has(k)) byPart.set(k, new Map());
  const m = byPart.get(k);
  m.set(c, (m.get(c) || 0) + 1);
}
let collisions = 0, worst = null;
for (const [k, m] of byPart) for (const [c, n] of m) if (n > 1) {
  collisions += n;
  if (!worst || n > worst[2]) worst = [k, c, n];
}
console.log(`\n  citation collisions within a part: ${collisions} doc(s)` +
  (worst ? `\n     worst: ${worst[2]}x "${worst[1].slice(0, 62)}" in ${worst[0]}` : ''));
// This printed the P0 invariant and passed regardless, so "ALL CITATION CHECKS
// PASSED" was printed over a live count of 2 — the signature bug this suite
// exists to catch. render_health.py owns the invariant FATALLY and holds the
// allow-list (CITE_DUP_OK: the 205.302 / 205.302-2 pair, both genuinely titled
// "205.302 Public Announcement"). Duplicating that list here would create the
// second source of truth this repo keeps getting caught by, so this is a
// REGRESSION guard: the count may not grow past what render_health sanctions.
const ALLOWED_COLLISIONS = 2;  // one allow-listed pair = 2 docs
ok(collisions <= ALLOWED_COLLISIONS,
   `citation collisions within a part: ${collisions} (allowed ${ALLOWED_COLLISIONS}, ` +
   `see CITE_DUP_OK in scripts/render_health.py) — a new one means a parse fell through`);

// global regression: no source may fall through to a bare part cite when it has a number
// A fall-through cite is the bare part fallback: "<label> Part 8" with NO section and
// no title. Requiring the absence of " — " avoids flagging a real cite whose TITLE
// happens to end in "Part 52" (e.g. "RFO 52.101 — Using Part 52").
const fellThrough = cites.filter(([d, c]) =>
  /^(?:PGI\s+|FC\s+)?[A-E0-9]\d*\.\d/.test(d.title.trim()) &&
  !c.includes(' — ') && /\b(Part|Volume) [\w-]+$/.test(c));
ok(fellThrough.length === 0,
   `numbered docs degrading to a bare part cite: ${fellThrough.length}` +
   (fellThrough.length ? ` e.g. "${fellThrough[0][0].title.slice(0,40)}" -> ${fellThrough[0][1]}` : ''));

console.log('\n  samples:');
for (const s of ['rfo', 'r-dfars', 'pgi', 'ssp', 'afi-63-138', 'fmr', 'far-companion']) {
  const row = cites.find(([d]) => d.source === s && /\d/.test(d.title));
  if (row) console.log(`    ${s.padEnd(15)} ${row[1].slice(0, 72)}`);
}
console.log(fail ? `\n${fail} CHECK(S) FAILED` : '\nALL CITATION CHECKS PASSED');
process.exit(fail ? 1 : 0);
