/* Count what the stylesheets actually contain. The owner's complaint is that the site
   feels incoherent; this turns that into numbers, so the sweep has a brief and a way to
   know it landed. No dependency: this is a counting job, and css-analyzer would be a
   node_modules tree to answer a question a regex answers.

   Reads the three places CSS actually lives:
     api/_seo.js   -> STYLE (every page) + STUDY_CSS (/study, /48cons) + SRCSEL_CSS
     assets/app.css-> the reading and tool pages
*/
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const seo = readFileSync(join(ROOT, 'api/_seo.js'), 'utf8');
const appcss = readFileSync(join(ROOT, 'assets/app.css'), 'utf8');

// Pull each template literal by its declaration, up to the closing backtick+semicolon.
function literal(name) {
  const m = seo.match(new RegExp('const ' + name + ' = `([\\s\\S]*?)`;'));
  return m ? m[1] : '';
}
const sources = {
  'STYLE (all pages)': literal('STYLE'),
  'STUDY_CSS (/study, /48cons)': literal('STUDY_CSS'),
  'SRCSEL_CSS (/source-selection)': literal('SRCSEL_CSS'),
  'assets/app.css': appcss,
};

const DECL = /([a-z-]+)\s*:\s*([^;{}]+)[;}]/gi;
const SPACING = /^(margin|padding|gap|row-gap|column-gap|top|right|bottom|left|inset)/i;

function analyse(css) {
  const fontSize = new Set(), colour = new Set(), space = new Set(), radius = new Set();
  let decls = 0;
  for (const [, prop, rawVal] of css.matchAll(DECL)) {
    decls++;
    const val = rawVal.trim();
    if (prop.toLowerCase() === 'font-size') val.split(/\s+/).forEach(v => fontSize.add(v));
    if (/^(color|background|background-color|border-color|fill|stroke)$/i.test(prop)) {
      for (const c of val.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi)) colour.add(c[0].toLowerCase());
    }
    if (SPACING.test(prop)) {
      for (const n of val.matchAll(/-?\d*\.?\d+(px|rem|em)/g)) space.add(n[0]);
    }
    if (/^border-radius$/i.test(prop)) val.split(/\s+/).forEach(v => radius.add(v));
  }
  return { decls, fontSize, colour, space, radius };
}

const totals = { fontSize: new Set(), colour: new Set(), space: new Set(), radius: new Set() };
let allDecls = 0;
console.log('\n  source                            decls  font-sizes  colours  spacing  radii');
console.log('  ' + '-'.repeat(76));
for (const [name, css] of Object.entries(sources)) {
  if (!css) { console.log(`  ${name.padEnd(33)} (not found)`); continue; }
  const a = analyse(css);
  allDecls += a.decls;
  for (const k of ['fontSize', 'colour', 'space', 'radius']) for (const v of a[k]) totals[k].add(v);
  console.log(`  ${name.padEnd(33)} ${String(a.decls).padStart(5)}  ${String(a.fontSize.size).padStart(10)}  ${String(a.colour.size).padStart(7)}  ${String(a.space.size).padStart(7)}  ${String(a.radius.size).padStart(5)}`);
}
console.log('  ' + '-'.repeat(76));
console.log(`  ${'ALL (deduped across files)'.padEnd(33)} ${String(allDecls).padStart(5)}  ${String(totals.fontSize.size).padStart(10)}  ${String(totals.colour.size).padStart(7)}  ${String(totals.space.size).padStart(7)}  ${String(totals.radius.size).padStart(5)}`);

const raw = [...totals.space].filter(v => /px$/.test(v) && !/^0px$/.test(v))
  .map(v => parseFloat(v)).filter(v => v > 0).sort((a, b) => a - b);
console.log(`\n  Distinct positive px spacing values (${raw.length}):`);
console.log('   ', raw.join(' '));
const literalFs = [...totals.fontSize].filter(v => /^\d/.test(v)).sort((a,b)=>parseFloat(a)-parseFloat(b));
console.log(`\n  font-size values written as literals rather than a token (${literalFs.length}):`);
console.log('   ', literalFs.join(' ') || '(none)');
