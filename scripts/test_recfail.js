#!/usr/bin/env node
/* Smallest check that fails if the recorder's failure note breaks.
   Extracts recFailText() straight out of assets/study.js — the shipped code, not a
   reimplementation. Run: node scripts/test_recfail.js */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'study.js'), 'utf8');

const m = src.match(/function recFailText\(name, detail\) \{[\s\S]*?\n  \}/);
if (!m) { console.error('FAIL: recFailText() not found in assets/study.js'); process.exit(1); }
const recFailText = eval('(' + m[0].replace('function recFailText', 'function ') + ')');
const t = (name, detail) => recFailText(name, detail);

// The government case — every capture failure gets the one plain note.
for (const args of [['NotSupportedError', ''], ['NotReadableError', ''],
  ['NotAllowedError', 'Permission denied by system'], ['NotFoundError', ''], ['', '']]) {
  assert.ok(/not available on government-issued computers/.test(t(...args)),
    'expected the gov note for ' + (args[0] || '(empty)'));
}

// The one exception: a plain browser-level block on a personal machine IS the user's to
// fix, so it still points at the address-bar icon instead of the gov note.
const block = t('NotAllowedError', 'Permission denied');
assert.ok(/mic icon/.test(block) && !/government-issued/.test(block));
assert.ok(/mic icon/.test(t('SecurityError', '')));

// Every message ends by saying the sim still runs without the recorder.
for (const args of [['NotSupportedError', ''], ['NotAllowedError', 'Permission denied'], ['', '']]) {
  assert.ok(/answer out loud and self-grade/.test(t(...args)), 'missing fallback line for ' + args[0]);
}

console.log('recFailText: all checks passed');
