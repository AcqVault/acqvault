#!/usr/bin/env node
'use strict';
/**
 * Drive the REAL renderer functions over the REAL corpus and print one JSON record per
 * document. This script makes NO judgements — scripts/render_health.py owns those, so
 * the thresholds and exemptions live next to corpus_health.py's conventions.
 *
 * assets/app.js is a classic browser script (it touches `document` at top level), so it
 * cannot be require()d. scripts/extract_js_fns.js slices the functions out verbatim
 * and we eval them in a bare context — what runs here is the shipped source, not a
 * reimplementation. A reimplementation would agree with itself while the real renderer
 * stayed broken, which is precisely how the PGI shipped unreadable.
 *
 * If extraction fails, this script THROWS. A gate that cannot find the code it is meant
 * to check must fail loudly, never skip quietly.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { grabFunction, grabConst, grabLine } = require('./extract_js_fns.js');

const BASE = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(BASE, 'assets/app.js'), 'utf8');
const seo = require(path.join(BASE, 'api/_seo.js'));

const sandbox = {
  console,
  esc: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
};
vm.createContext(sandbox);
vm.runInContext([
  grabConst(appSrc, 'SOURCE_SHORT'),
  grabConst(appSrc, 'SOURCE_FULL'),
  grabConst(appSrc, 'SOURCE_URLS'),
  grabConst(appSrc, 'PARTS_BY_SOURCE'),
  grabConst(appSrc, 'PART_200_SOURCES'),
  grabConst(appSrc, 'NON_FAR_LEVEL_SOURCES'),
  grabConst(appSrc, 'PAIR_SOURCE'),
  grabFunction(appSrc, 'partWord'),
  grabFunction(appSrc, 'indexPartForSource'),
  grabFunction(appSrc, 'displayPartForSource'),
  grabFunction(appSrc, 'regOrderKey'),
  grabFunction(appSrc, 'parseBrowseTitle'),
  grabFunction(appSrc, 'generateCitation'),
  grabFunction(appSrc, 'pairKey'),
  // ⚠ A top-level `const` inside a vm.Script lives in THAT script's lexical scope and
  // never appears on the context object — only function declarations hoist onto the
  // global. Without this epilogue every registry read back as undefined while the
  // functions looked fine, which is a very convincing way to write a gate that checks
  // nothing. The epilogue runs in the same scope, so it can see them.
  `;Object.assign(globalThis, { SOURCE_SHORT, SOURCE_FULL, SOURCE_URLS, PARTS_BY_SOURCE,
     PART_200_SOURCES, NON_FAR_LEVEL_SOURCES, PAIR_SOURCE, partWord, indexPartForSource,
     displayPartForSource, regOrderKey, parseBrowseTitle, generateCitation, pairKey });`,
].join('\n\n'), sandbox, { filename: 'app-extracted.js' });

for (const k of ['SOURCE_SHORT', 'PARTS_BY_SOURCE', 'parseBrowseTitle', 'generateCitation', 'regOrderKey']) {
  if (!sandbox[k]) throw new Error(`render_probe: ${k} did not survive extraction — the gate cannot verify anything, fix the extractor`);
}

const docs = JSON.parse(fs.readFileSync(path.join(BASE, 'output/documents.json'), 'utf8'))
  .filter(Boolean);

const out = docs.map(d => {
  const parsed = sandbox.parseBrowseTitle(d, d.source);
  return {
    id: d.id,
    source: d.source,
    part: String(d.part),
    title: d.title,
    num: parsed.num || '',
    type: parsed.type,
    cite: sandbox.generateCitation(d),
    orderKey: sandbox.regOrderKey(d.title),
    partInApp: `${sandbox.partWord(d.source)} ${sandbox.displayPartForSource(d.source, d.part)}`,
    partSsr: seo.partLabel(d.source, String(d.part)),
  };
});

process.stdout.write(JSON.stringify({
  registries: {
    SOURCE_SHORT: Object.keys(sandbox.SOURCE_SHORT),
    SOURCE_FULL: Object.keys(sandbox.SOURCE_FULL),
    SOURCE_URLS: Object.keys(sandbox.SOURCE_URLS),
    PARTS_BY_SOURCE: Object.keys(sandbox.PARTS_BY_SOURCE),
    SEO_SOURCES: Object.keys(seo.SOURCES),
  },
  docs: out,
}));
