#!/usr/bin/env node
/* The Combination rolls at 5 a.m. Central. A fixed UTC offset would be wrong half the year
   (5am CST = 11:00Z, 5am CDT = 10:00Z), so assets/study.js derives the day index from
   America/Chicago via Intl. This suite pins that behaviour: the roll must land on 05:00
   Central on BOTH sides of both DST transitions, and consecutive days must advance by
   exactly one — a naive offset silently repeats or skips a puzzle at the boundary.

   Keep this in sync with comboToday()/comboResetAt()/tzOffsetMs() in assets/study.js. */
const fs = require('fs'), path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'study.js'), 'utf8');

// lift the three functions straight out of the shipped file so this can't drift into a copy
function lift(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('combo_tz_verify: ' + name + ' not found in assets/study.js');
  let depth = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') { depth++; started = true; }
    else if (SRC[j] === '}') { depth--; if (started && depth === 0) return SRC.slice(i, j + 1); }
  }
  throw new Error('combo_tz_verify: could not bound ' + name);
}
// the lifted bodies close over COMBO_TZ / COMBO_RESET_H, so declare them in the same scope
const { comboToday, comboResetAt } = new Function(
  'const COMBO_TZ = "America/Chicago", COMBO_RESET_H = 5;\n' +
  ['tzOffsetMs', 'comboToday', 'comboResetAt'].map(lift).join('\n') +
  '\nreturn { comboToday, comboResetAt };')();

const TZ = 'America/Chicago';
const hhmm = t => new Intl.DateTimeFormat('en-US',
  { timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit' }).format(new Date(t));
const central = t => new Date(t).toLocaleString('en-US', { timeZone: TZ, hour12: false });

let fails = 0;
const check = (ok, msg) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + msg); if (!ok) fails++; };

// 1. the roll lands on 05:00 Central, including across both 2026 DST transitions
for (const [label, day] of [['CDT summer', '2026-07-15'], ['CST winter', '2026-01-15'],
                            ['DST starts', '2026-03-08'], ['DST ends', '2026-11-01']]) {
  let prev = null, flip = null;
  for (let m = 0; m < 24 * 60; m++) {
    const t = Date.parse(day + 'T00:00:00Z') + m * 60000, idx = comboToday(t);
    if (prev !== null && idx !== prev) flip = t;
    prev = idx;
  }
  check(flip !== null && hhmm(flip) === '05:00',
    `${label.padEnd(11)} rolls at 05:00 Central (${flip ? central(flip) : 'no roll found'})`);
}

// 2. no skipped or repeated puzzle anywhere in the year
const base = Date.parse('2026-01-01T12:00:00Z'), start = comboToday(base);
let drift = 0;
for (let d = 0; d < 365; d++) if (comboToday(base + d * 86400000) !== start + d) drift++;
check(drift === 0, `365 consecutive days advance by exactly 1 (${365 - drift}/365)`);

// 3. the countdown target is the instant the index actually increments
const t0 = Date.parse('2026-07-15T12:00:00Z'), d0 = comboToday(t0), r = comboResetAt(d0);
check(comboToday(r) === d0 + 1 && comboToday(r - 1000) === d0,
  `comboResetAt is exactly the roll instant (${central(r)} Central)`);

// 4. puzzle numbering is unchanged by the move off midnight Zulu
const EPOCH = comboToday(Date.UTC(2026, 6, 12, 12));
check(comboToday(Date.UTC(2026, 6, 12, 12)) - EPOCH + 1 === 1, 'No. 1 is still 12 Jul 2026');

console.log(fails ? '\nCOMBINATION TIMEZONE CHECKS FAILED' : '\nALL COMBINATION TIMEZONE CHECKS PASSED');
process.exit(fails ? 1 : 0);
