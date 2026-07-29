/* Diff two computed-style snapshot dirs. Exits 1 on any drift.
   usage: node diff_snap.js <beforeDir> <afterDir> */
const fs = require('fs'), path = require('path');
const [, , A, B] = process.argv;

const PROPS = ['color','background-color','background-image','border-top-color','border-right-color',
 'border-bottom-color','border-left-color','border-top-width','border-right-width','border-bottom-width',
 'border-left-width','border-top-left-radius','border-top-right-radius','border-bottom-left-radius',
 'border-bottom-right-radius','box-shadow','outline-color','outline-width','font-size','font-weight',
 'letter-spacing','line-height','text-transform','font-family','padding-top','padding-right','padding-bottom',
 'padding-left','margin-top','margin-right','margin-bottom','margin-left','width','height','display','opacity',
 'transform','transition-property','transition-duration','transition-timing-function','backdrop-filter','fill','stroke'];

const files = fs.readdirSync(A).filter(f => f.endsWith('.json')).sort();
let totalDrift = 0, checked = 0;
const report = [];

for (const f of files) {
  const pa = path.join(A, f), pb = path.join(B, f);
  if (!fs.existsSync(pb)) { report.push(`MISSING in after: ${f}`); totalDrift++; continue; }
  const a = JSON.parse(fs.readFileSync(pa, 'utf8')), b = JSON.parse(fs.readFileSync(pb, 'utf8'));
  if (a.count !== b.count) { report.push(`${f}: ELEMENT COUNT ${a.count} -> ${b.count}`); totalDrift++; }

  const drift = [];
  const n = Math.min(a.rows.length, b.rows.length);
  for (let i = 0; i < n; i++) {
    checked++;
    if (a.rows[i] === b.rows[i]) continue;
    const [pathA, valsA] = splitRow(a.rows[i]), [, valsB] = splitRow(b.rows[i]);
    const changed = [];
    for (let k = 0; k < PROPS.length; k++) if (valsA[k] !== valsB[k]) changed.push(`${PROPS[k]}: ${valsA[k]} -> ${valsB[k]}`);
    if (changed.length) drift.push(`    ${pathA}\n      ` + changed.join('\n      '));
  }
  // pseudo-elements
  const pn = Math.min(a.pseudo.length, b.pseudo.length);
  for (let i = 0; i < pn; i++) {
    checked++;
    if (a.pseudo[i] === b.pseudo[i]) continue;
    const [pathA, valsA] = splitRow(a.pseudo[i]), [, valsB] = splitRow(b.pseudo[i]);
    const changed = [];
    for (let k = 0; k < PROPS.length; k++) if (valsA[k] !== valsB[k]) changed.push(`${PROPS[k]}: ${valsA[k]} -> ${valsB[k]}`);
    if (changed.length) drift.push(`    [pseudo] ${pathA}\n      ` + changed.join('\n      '));
  }
  if (a.pseudo.length !== b.pseudo.length) { report.push(`${f}: PSEUDO COUNT ${a.pseudo.length} -> ${b.pseudo.length}`); totalDrift++; }

  if (drift.length) {
    totalDrift += drift.length;
    report.push(`${f}: ${drift.length} element(s) drifted`);
    report.push(drift.slice(0, 12).join('\n'));
    if (drift.length > 12) report.push(`    …and ${drift.length - 12} more`);
  }
}

function splitRow(row) {
  const i = row.indexOf('|');
  return [row.slice(0, i), row.slice(i + 1).split('\u0001')];
}

console.log(report.join('\n'));
console.log(`\n${files.length} snapshots · ${checked} element-states compared · ${totalDrift} drift`);
process.exit(totalDrift ? 1 : 0);
