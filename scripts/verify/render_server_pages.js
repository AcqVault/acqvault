// Render every server-side page to static HTML so a local static server can serve
// them. Lets the visual-regression snapshot cover /study, /48cons, /library and a
// crawlable part page, not just the static index.html.
const fs = require('fs');
const path = require('path');

const REPO = '/Users/iz/Documents/Projects/acqvault';
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node render_pages.js <outdir>'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const seo = require(path.join(REPO, 'api/_seo.js'));

const pages = [
  ['study.html',   () => seo.renderStudyPage()],
  ['48cons.html',  () => seo.render48ConsPage()],
  ['srcsel.html',  () => seo.renderSourceSelectionPage()],
  ['slip.html',    () => seo.renderSlipPage()],
];

// /library and a part page go through their own handlers (they read the corpus)
function viaHandler(file, mod, query) {
  return [file, () => {
    let html = null;
    const req = { query: query || {}, url: '/' };
    const res = {
      setHeader(){}, status(){ return this; },
      send(body){ html = body; return this; },
    };
    require(path.join(REPO, mod))(req, res);
    return html;
  }];
}
pages.push(viaHandler('library.html', 'api/library.js', {}));
pages.push(viaHandler('part19.html',  'api/page.js',    { source: 'rfo', part: '19' }));

let ok = 0;
for (const [file, fn] of pages) {
  try {
    const html = fn();
    if (!html) { console.log(`SKIP ${file} (renderer returned empty)`); continue; }
    fs.writeFileSync(path.join(OUT, file), html);
    console.log(`ok   ${file}  ${html.length} bytes`);
    ok++;
  } catch (e) {
    console.log(`FAIL ${file}: ${e.message}`);
  }
}
console.log(`\n${ok}/${pages.length} pages rendered into ${OUT}`);
