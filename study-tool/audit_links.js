// Audit: every study-deck link with a #frag must exist as an id on its rendered part page.
// Run: node study-tool/audit_links.js   (exits 1 on any missing anchor)
const { renderPartPage } = require('../api/_seo.js') || require('./api/_seo.js');
const fs = require('fs');
const deck = JSON.parse(fs.readFileSync(__dirname + '/../assets/study-deck.json'));
const links = new Map();
function add(l, who){ if(!links.has(l.u)) links.set(l.u, []); links.get(l.u).push(who); }
for (const pool of ['recall_basic','recall_advanced','thresholds'])
  for (const c of deck[pool]) (c.links||[]).forEach(l => add(l, c.id));
const seen = new Set();
for (const s of deck.scenarios) { const co = s.coach||{}; if (seen.has(co.qtype)) continue; seen.add(co.qtype); (co.links||[]).forEach(l => add(l,'coach')); }
const pages = new Map(); let partLevel = [], hub = 0;
for (const [u] of links) {
  const m = u.match(/^\/(rfo|r-dfars)\/part-([^#]+)(?:#(.+))?$/);
  if (!m) { hub++; continue; }
  if (!m[3]) { partLevel.push(u); continue; }
  const k = m[1]+'|'+m[2];
  if (!pages.has(k)) pages.set(k, new Set());
  pages.get(k).add(m[3]);
}
let missing = [];
for (const [k, frags] of pages) {
  const [src, part] = k.split('|');
  const html = renderPartPage(src, part);
  if (!html) { missing.push('PAGE MISSING: '+k); continue; }
  for (const f of frags) if (!html.includes('id="'+f+'"')) missing.push('/'+src+'/part-'+part+'#'+f+' ← '+links.get('/'+src+'/part-'+part+'#'+f).join(','));
}
console.log(`links ${links.size} · pages ${pages.size} · part-level ${partLevel.length} · hub ${hub} · MISSING ${missing.length}`);
missing.forEach(x => console.log('  MISSING', x));
process.exit(missing.length ? 1 : 0);
