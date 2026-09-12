/* Every token pairing the site actually uses, against WCAG 2.1 AA.
   No dependency: colour.js computes APCA too, but APCA is NOT the AA criterion, and the
   WCAG 2 relative-luminance formula is fifteen lines. A dependency here would be a
   node_modules tree to answer a question arithmetic answers.

   Pairings are hand-listed rather than inferred, because "which text sits on which
   surface" is a fact about the design, not something a parser can know. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const seo = readFileSync(join(ROOT, 'api/_seo.js'), 'utf8');

// tokens out of :root
const root = seo.match(/:root\{([^}]*)\}/)[1];
const T = {};
for (const m of root.matchAll(/--([a-z0-9-]+):\s*([^;]+)/gi)) T[m[1]] = m[2].trim();
const tok = n => T[n] || n;

function rgb(c) {
  c = c.trim();
  if (c.startsWith('var(')) return rgb(tok(c.slice(6, -1)));
  if (c.startsWith('#')) {
    let h = c.slice(1);
    if (h.length === 3) h = [...h].map(x => x + x).join('');
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  }
  const m = c.match(/-?[\d.]+/g);
  if (!m) throw new Error('cannot parse colour: ' + c);
  return [+m[0], +m[1], +m[2]];
}
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = c => { const [r, g, b] = rgb(c).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const OFF = '#f7f6f2';           // the study card / walk surface
const PAIRS = [
  ['body text on white',            tok('ink'),      '#ffffff', 'normal'],
  ['muted on white',                tok('muted'),    '#ffffff', 'normal'],
  ['muted2 on white',               tok('muted2'),   '#ffffff', 'normal'],
  ['ink3 on white',                 tok('ink3'),     '#ffffff', 'normal'],
  ['muted on off-white card',       tok('muted'),    OFF,       'normal'],
  ['muted2 on off-white card',      tok('muted2'),   OFF,       'normal'],
  ['brass on white',                tok('brass'),    '#ffffff', 'normal'],
  ['brass-ink on white',            tok('brass-ink'),'#ffffff', 'normal'],
  ['brass-ink on off-white card',   tok('brass-ink'),OFF,       'normal'],
  // NOT listed: --brass as text on navy. It measures 2.88:1, but scanning every rule that
  // sets both a navy background and brass text returns zero hits — the covers use
  // --brass-bright (9.17:1). Listing it would be inventing a failure.
  ['brass-bright on navy cover',    tok('brass-bright'), tok('ink-mid'), 'normal'],
  ['cover body copy on navy',       '#f4f8fc',       tok('ink-mid'), 'normal'],
  ['cover muted copy on navy',      'rgb(221,233,246)', tok('ink-mid'), 'normal'],
  ['white on navy button',          '#ffffff',       tok('ink-mid'), 'normal'],
  ['ok on its tint',                tok('ok-ink'),   tok('ok-bg'),   'normal'],
  ['bad on its tint',               tok('bad-ink'),  tok('bad-bg'),  'normal'],
  // --line2 is BOTH a decorative divider and the border of interactive controls
  // (.st-btn-hint, .st-btn-opts, .st-opt, .st-track-chip, .rz-btn-ghost, .st-pick-b,
  // .rz-lesson). WCAG 1.4.11 exempts a purely decorative line but not the visual
  // information that identifies a control, so the second use is a real failure.
  // --line (#948b7c) already measures 3.36:1 — the palette has the answer in it.
  // --line2 is now decoration ONLY — dividers, card edges, the hairline under a heading.
  // WCAG 1.4.11 exempts those, so it is not tested as a control border. Interactive
  // controls moved to --line-ctl, which is what the row below checks. If a control ever
  // goes back to --line2, that is the regression this comment exists to explain.
  ['control border (--line-ctl) on white', tok('line-ctl'), '#ffffff', 'ui'],
  ['line hairline on white',        tok('line'),     '#ffffff', 'ui'],
  ['brass-line on white',           'rgb(154,115,32)', '#ffffff', 'ui'],
];
const need = k => (k === 'ui' ? 3 : 4.5);
let fails = 0;
console.log('\n  pairing                              ratio   need   verdict');
console.log('  ' + '-'.repeat(60));
for (const [name, fg, bg, kind] of PAIRS) {
  const r = ratio(fg, bg), n = need(kind);
  const ok = r >= n;
  if (!ok) fails++;
  console.log(`  ${name.padEnd(34)} ${r.toFixed(2).padStart(6)}  ${n.toFixed(1).padStart(4)}   ${ok ? 'pass' : 'FAIL'}`);
}
console.log('  ' + '-'.repeat(60));
console.log(`  ${fails} failing pairing(s). 'ui' rows are non-text contrast (3:1); the rest are AA normal text (4.5:1).\n`);
process.exit(fails ? 1 : 0);
