#!/usr/bin/env node
'use strict';
/**
 * Emit output/part-labels.json from PARTS_BY_SOURCE in assets/app.js.
 *
 * The crawlable hub pages listed 49 links all reading "Part 1 … Part 53", while the
 * in-app grid showed "Federal Acquisition Regulations System", "Ethics", "Small Bus"
 * for the same parts — the names existed, the server just could not see them. Rather
 * than duplicate the table into api/_seo.js and let the two drift, extract the ONE
 * definition and ship it as data.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { grabConst } = require('./extract_js_fns.js');

const BASE = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(BASE, 'assets/app.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(grabConst(src, 'PARTS_BY_SOURCE') + '\n;globalThis.OUT = PARTS_BY_SOURCE;',
                sandbox, { filename: 'parts.js' });
if (!sandbox.OUT) throw new Error('gen_part_labels: PARTS_BY_SOURCE did not survive extraction');

const out = {};
for (const [source, rows] of Object.entries(sandbox.OUT)) {
  out[source] = {};
  for (const [num, label] of rows) out[source][String(num)] = String(label);
}
const p = path.join(BASE, 'output', 'part-labels.json');
fs.writeFileSync(p, JSON.stringify(out));
console.log(`wrote output/part-labels.json: ` +
  Object.keys(out).map(s => `${s} ${Object.keys(out[s]).length}`).join(', '));
