/* Every route, locally, for the visual + a11y harness.
   .local/serve.js covers the three study routes and is gitignored, so it cannot be the
   thing a committed test suite depends on — and it does not serve the rulebook readers,
   the hub, the library or the home page. Those are exactly the pages assets/app.css
   styles, which is 8,443 of the project's 13,742 CSS declarations. Migrating that file
   without regression coverage would be migrating blind.

   Routes mirror vercel.json. _seo.js is re-required per request so an edit is one reload
   away, the same property .local/serve.js has. */
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const PART_SOURCES = ['rfo', 'r-dfars', 'far-companion', 'afi-63-138', 'category-management', 'fmr', 'ssp', 'pgi'];

function seo() {
  delete require.cache[require.resolve('../api/_seo.js')];
  return require('../api/_seo.js');
}
function html(res, body) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let S;
  try { S = seo(); } catch (e) { res.writeHead(500); return res.end('render error: ' + e.message); }

  const SIMPLE = {
    '/study': 'renderStudyPage', '/48cons': 'render48ConsPage',
    '/source-selection': 'renderSourceSelectionPage', '/slip': 'renderSlipPage',
    '/library': 'renderLibraryPage', '/deviations': 'renderDeviationsPage',
    '/changes': 'renderChangesPage', '/what-is-the-rfo': 'renderExplainerPage',
  };
  try {
    if (SIMPLE[u] && S[SIMPLE[u]]) return html(res, S[SIMPLE[u]]());
    const part = u.match(/^\/([a-z0-9-]+)\/part-(.+)$/);
    if (part && PART_SOURCES.includes(part[1])) return html(res, S.renderPartPage(part[1], part[2]));
    const hub = u.match(/^\/([a-z0-9-]+)$/);
    if (hub && PART_SOURCES.includes(hub[1])) return html(res, S.renderHubPage(hub[1]));
  } catch (e) {
    res.writeHead(500);
    return res.end('render error on ' + u + ': ' + e.message);
  }

  const f = path.join(ROOT, u === '/' ? 'index.html' : u.replace(/^\/+/, ''));
  if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile()) {
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'text/plain', 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(f));
  }
  res.writeHead(404).end('no route: ' + u);
}).listen(process.env.PORT || 4322, function () {
  console.log('acqvault full-route preview on ' + (process.env.PORT || 4322));
});
