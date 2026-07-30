#!/usr/bin/env node
/* Smallest check that fails if the Introduction Builder's text helpers break.
   Extracts the pure helpers straight out of assets/study.js. Run: node scripts/test_intro.js */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'study.js'), 'utf8');
const assert = require('assert');
function grab(name) {
  // one-liner bodies (introCap/introLow) end on the same line; block bodies end at "\n  }"
  const m = src.match(new RegExp('function ' + name + '\\(s\\) \\{(?:[^\\n]*\\}|[\\s\\S]*?\\n  \\})'));
  if (!m) { console.error('FAIL: ' + name + '() not found'); process.exit(1); }
  return eval('(' + m[0].replace('function ' + name, 'function ') + ')');
}
const clean = grab('introClean'), list = grab('introList'), low = grab('introLow');

// cleanup: trailing punctuation and doubled spaces go
assert.strictEqual(clean('  six years,  the last four at 48 CONS. '), 'six years, the last four at 48 CONS');
assert.strictEqual(clean(''), '');

// Oxford join for spoken lists
assert.strictEqual(list('commercial services, construction, A-E, IDIQ task orders'),
  'commercial services, construction, A-E, and IDIQ task orders');
assert.strictEqual(list('services and construction'), 'services and construction'); // has "and": untouched
assert.strictEqual(list('a, b and c'), 'a, b and c');                               // already joined
assert.strictEqual(list('one item'), 'one item');
assert.strictEqual(list('a, b'), 'a and b');                                        // pair: no comma

// lowercase only sentence-case leads — acronyms keep their caps
assert.strictEqual(low('The squadron needs a second signature'), 'the squadron needs a second signature');
assert.strictEqual(low('DAWIA Contracting Practitioner'), 'DAWIA Contracting Practitioner');
assert.strictEqual(low('commercial services'), 'commercial services');

console.log('intro helpers: all checks passed');
