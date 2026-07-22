// Audit: every study-deck link with a #frag must exist as an id on its rendered part page.
// Run: node study-tool/audit_links.js   (exits 1 on any missing anchor)
//
// ⚠ PARTIAL COVERAGE — scripts/deck_health.py supersedes this for link checking
// and is the one refresh.py actually runs. This file reads only the `links`
// arrays on recall_basic / recall_advanced / thresholds plus one scenario per
// qtype, and the regex below silently drops any URL that is not rfo or r-dfars:
// 143 URLs against roughly 1,000 in the deck. It never sees the ladder, the
// board sims or the games. DO NOT read a green run here as "the deck's links
// are fine" — that is the same trap check_ladder_file.py set before it was
// rewritten to invoke the real gate instead of restating it.
//
// It is kept because it checks anchors the expensive, honest way — by rendering
// the real part page and looking for the id — where deck_health compares against
// the corpus `anchor`/`id` field. Those two were verified equivalent (200
// anchors across all 8 sources, 0 mismatches), so this stands as a cross-check
// of that assumption, not as a substitute for the gate.
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
