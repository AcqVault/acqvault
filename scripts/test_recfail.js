#!/usr/bin/env node
/* Smallest check that fails if the recorder's failure triage breaks.
   Extracts recFailText() straight out of assets/study.js — the shipped code, not a
   reimplementation. Run: node scripts/test_recfail.js */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'study.js'), 'utf8');

const m = src.match(/function recFailText\(name, detail, hasMic\) \{[\s\S]*?\n  \}/);
if (!m) { console.error('FAIL: recFailText() not found in assets/study.js'); process.exit(1); }
const recFailText = eval('(' + m[0].replace('function recFailText', 'function ') + ')');

const t = (name, detail, hasMic) => recFailText(name, detail, hasMic);

// The government case the field reported: browser permission granted, Windows says no.
// Chromium surfaces the OS-level denial as NotAllowedError + "Permission denied by system".
assert.ok(/operating system refused/.test(t('NotAllowedError', 'Permission denied by system', true)),
  'system-level NotAllowedError must route to the OS advice, not the mic-icon advice');
assert.ok(/denied by system/.test(t('NotAllowedError', 'Permission denied by system', true)));

// A plain browser-level block still gets the mic-icon advice + the policy hint.
const browserBlock = t('NotAllowedError', 'Permission denied', null);
assert.ok(/mic icon/.test(browserBlock));
assert.ok(/IT browser policy/.test(browserBlock));

// The OS holding the device (endpoint security, another app) names the OS layer.
assert.ok(/operating system refused[\s\S]*NotReadableError/.test(t('NotReadableError', '', true)));

// No device — by error name, or by enumerateDevices seeing zero audio inputs.
assert.ok(/No microphone is available/.test(t('NotFoundError', '', null)));
assert.ok(/No microphone is available/.test(t('SomethingOddError', '', false)));

// Unknown failures keep the generic line but carry the raw name for an IT ticket.
assert.ok(/Could not start the microphone \(SomethingOddError\)/.test(t('SomethingOddError', '', true)));
assert.ok(/Could not start the microphone\./.test(t('', '', null)));

// Every branch ends by saying the sim still runs without the recorder.
for (const args of [['NotAllowedError', 'by system', true], ['NotAllowedError', '', null],
  ['NotReadableError', '', true], ['NotFoundError', '', null], ['', '', false], ['XError', '', true]]) {
  assert.ok(/answer out loud and self-grade/.test(t(...args)), 'missing fallback line for ' + args[0]);
}

console.log('recFailText: all checks passed');
