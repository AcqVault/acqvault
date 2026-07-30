#!/usr/bin/env node
/* Smallest check that fails if the study-state sanitizer breaks: extracts normalize()
   straight out of assets/study.js (it lives in an IIFE) and feeds it the malformed
   imports that used to brick the page. Run: node scripts/test_normalize.js */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'study.js'), 'utf8');
const m = src.match(/function normalize\(s\) \{[\s\S]*?\n {2}\}/);
if (!m) { console.error('FAIL: normalize() not found in study.js'); process.exit(1); }
const normalize = eval('(' + m[0].replace(/^function normalize/, 'function ') + ')');
const assert = require('assert');

// the import that used to throw: primitive where a view writes through an object
let s = normalize({ cards: {}, streak: 'x', intro: 7, bdNotes: true, resume: 'nope' });
assert.strictEqual(s.streak, undefined);
assert.strictEqual(s.intro, undefined);
assert.strictEqual(s.bdNotes, undefined);
assert.strictEqual(s.resume, undefined);

// array branches must be arrays or gone
s = normalize({ cards: {}, ladderMiss: 'abc', ladderBoardRough: [1, 2] });
assert.strictEqual(s.ladderMiss, undefined);
assert.deepStrictEqual(s.ladderBoardRough, [1, 2]);

// required containers always come back object-shaped, track constrained
s = normalize(null);
assert.ok(s.cards && s.scen && s.games && typeof s.sprint.best !== 'undefined');
assert.strictEqual(normalize({ track: 'evil' }).track, null);
assert.strictEqual(normalize({ track: 'basic', cards: {} }).track, 'basic');

// good state passes through untouched
const good = { track: 'advanced', cards: { a: { box: 2 } }, streak: { last: 1, run: 3 } };
s = normalize(good);
assert.strictEqual(s.cards.a.box, 2);
assert.strictEqual(s.streak.run, 3);

console.log('normalize: all checks passed');
