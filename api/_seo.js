// Shared helpers for the server-rendered, crawlable SEO pages.
// Underscore-prefixed files under /api are NOT routed by Vercel — this is a
// plain module required by page.js / hub.js / sitemap.js.
const fs = require('fs');
const path = require('path');

const SITE = 'https://www.acqvault.com';

const SOURCES = {
  'rfo':                 { name: 'Revolutionary FAR Overhaul', short: 'RFO',
    desc: 'Full text of the Revolutionary FAR Overhaul (RFO) — the overhauled Federal Acquisition Regulation implemented via DoD class deviations under E.O. 14275.' },
  'r-dfars':             { name: 'R-DFARS Deviations', short: 'R-DFARS',
    desc: 'DoD class deviations implementing the FAR overhaul (the deviation-based DFARS regime).' },
  'far-companion':       { name: 'FAR Companion', short: 'FAR Companion',
    desc: 'Practitioner guidance accompanying the Revolutionary FAR Overhaul.' },
  'compass':             { name: 'DAF Contracting Compass', short: 'Compass',
    desc: 'Department of the Air Force contracting guidance (DAF Contracting Compass).' },
  'afi-63-138':          { name: 'DAFI 63-138', short: 'DAFI 63-138',
    desc: 'Department of the Air Force Instruction 63-138, Acquisition Program Management.' },
  'category-management': { name: 'Category Management Buying Guide', short: 'Cat Mgmt',
    desc: 'Federal category management buying guidance.' }
};
const SOURCE_KEYS = Object.keys(SOURCES);

let docsCache = null;
function loadDocs() {
  if (docsCache) return docsCache;
  docsCache = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'output', 'documents.json'), 'utf8')).filter(Boolean);
  return docsCache;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function partNum(p) {
  const m = String(p || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 9999;
}

// Docs for a source, grouped by part -> sorted parts -> sorted docs.
function partsForSource(source) {
  const groups = new Map();
  for (const d of loadDocs()) {
    if (d.source !== source) continue;
    const p = String(d.part);
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(d);
  }
  const parts = [...groups.keys()].sort((a, b) => partNum(a) - partNum(b) || a.localeCompare(b));
  for (const p of parts) groups.get(p).sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { numeric: true }));
  return { parts, groups };
}

// Render a doc's content into clean paragraphs (strip the "Ln:" level markers
// and a leading line that just repeats the title).
function renderContent(content, title) {
  const lines = String(content || '').split('\n');
  const out = [];
  let first = true;
  for (let line of lines) {
    let s = line.replace(/^L\d+:\s*/, '').trim();
    if (!s) { first = false; continue; }
    if (first && title && s === String(title).trim()) { first = false; continue; }
    first = false;
    out.push('<p>' + esc(s) + '</p>');
  }
  return out.join('\n');
}

function metaDescription(docs) {
  const text = String((docs[0] && docs[0].content) || '').replace(/^L\d+:\s*/gm, '').replace(/\s+/g, ' ').trim();
  return esc(text.slice(0, 155));
}

const STYLE = `:root{--ink:#0d1117;--muted:#656d76;--line:#d0d7de;--accent:#0066CC;--bg:#fff}
*{box-sizing:border-box}body{margin:0;font-family:Inter,-apple-system,system-ui,sans-serif;color:var(--ink);background:var(--bg);line-height:1.6}
.wrap{max-width:820px;margin:0 auto;padding:24px 20px 80px}
header.site{border-bottom:1px solid var(--line);margin-bottom:24px;padding-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
header.site a.brand{font-weight:800;font-size:18px;letter-spacing:-0.03em;color:var(--ink);text-decoration:none}
header.site a.cta{font-weight:600;font-size:14px;color:#fff;background:var(--accent);padding:8px 14px;border-radius:8px;text-decoration:none}
nav.crumbs{font-size:13px;color:var(--muted);margin-bottom:8px}
nav.crumbs a{color:var(--accent);text-decoration:none}nav.crumbs a:hover{text-decoration:underline}
h1{font-size:30px;letter-spacing:-0.03em;margin:.2em 0 .1em}
.lede{color:var(--muted);margin:0 0 26px;font-size:15px}
section.sec{padding:18px 0;border-top:1px solid var(--line)}
section.sec h2{font-size:18px;letter-spacing:-0.02em;margin:0 0 6px;scroll-margin-top:16px}
section.sec h2 a{color:inherit;text-decoration:none}
.srcref{font-size:12.5px;color:var(--muted);margin:0 0 10px}
.srcref a{color:var(--accent);text-decoration:none}
.sec p{margin:.5em 0;font-size:15px}
.parts{columns:2;gap:24px}.parts a{display:block;padding:7px 0;color:var(--accent);text-decoration:none;font-size:15px;break-inside:avoid}
.parts a:hover{text-decoration:underline}
footer{margin-top:40px;border-top:1px solid var(--line);padding-top:18px;font-size:13px;color:var(--muted)}
footer a{color:var(--accent)}
@media(max-width:560px){.parts{columns:1}}`;

function shell({ title, description, canonical, jsonld, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="AcqVault">
<meta name="twitter:card" content="summary">
<link rel="icon" href="/assets/acqvault-favicon-blue.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${STYLE}</style>
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head>
<body>
<div class="wrap">
<header class="site"><a class="brand" href="/">AcqVault</a><a class="cta" href="/?q=${''}">Search all sources →</a></header>
${body}
<footer>AcqVault is an <strong>unofficial research aid</strong> — not legal advice and not an official source. The authoritative sources are the signed DoD class deviations and the official text at <a href="https://www.acquisition.gov/far-overhaul" rel="noopener">acquisition.gov</a>. Always verify before relying on any result in a contract file.</footer>
</div>
</body>
</html>`;
}

function renderPartPage(source, part) {
  const meta = SOURCES[source];
  const { groups } = partsForSource(source);
  const docs = groups.get(String(part));
  if (!meta || !docs || !docs.length) return null;
  const canonical = `${SITE}/${source}/part-${encodeURIComponent(part)}`;
  const title = `${meta.short} Part ${part} — ${meta.name} | AcqVault`;
  const description = metaDescription(docs);

  const sections = docs.map(d => {
    const anchor = esc(d.anchor || d.id);
    const src = d.url ? `<p class="srcref">Source: <a href="${esc(d.url)}" rel="noopener nofollow">${esc(d.url)}</a></p>` : '';
    return `<section class="sec" id="${anchor}">
<h2><a href="#${anchor}">${esc(d.title)}</a></h2>
${src}
${renderContent(d.content, d.title)}
</section>`;
  }).join('\n');

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'Article',
    headline: `${meta.name} — Part ${part}`,
    description: description,
    isPartOf: { '@type': 'WebSite', name: 'AcqVault', url: SITE },
    publisher: { '@type': 'Organization', name: 'AcqVault', url: SITE },
    mainEntityOfPage: canonical
  };

  const body = `<nav class="crumbs"><a href="/">AcqVault</a> › <a href="/${source}">${esc(meta.name)}</a> › Part ${esc(part)}</nav>
<h1>${esc(meta.name)} · Part ${esc(part)}</h1>
<p class="lede">${esc(meta.desc)} Full text of Part ${esc(part)} (${docs.length} section${docs.length !== 1 ? 's' : ''}), searchable at <a href="/?q=part%20${esc(part)}">AcqVault</a>.</p>
${sections}`;

  return shell({ title, description, canonical, jsonld, body });
}

function renderHubPage(source) {
  const meta = SOURCES[source];
  if (!meta) return null;
  const { parts } = partsForSource(source);
  if (!parts.length) return null;
  const canonical = `${SITE}/${source}`;
  const title = `${meta.name} — full text & parts | AcqVault`;
  const description = esc(meta.desc.slice(0, 155));

  const links = parts.map(p =>
    `<a href="/${source}/part-${encodeURIComponent(p)}">Part ${esc(p)}</a>`).join('\n');

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: meta.name, description: meta.desc, url: canonical,
    isPartOf: { '@type': 'WebSite', name: 'AcqVault', url: SITE }
  };

  const body = `<nav class="crumbs"><a href="/">AcqVault</a> › ${esc(meta.name)}</nav>
<h1>${esc(meta.name)}</h1>
<p class="lede">${esc(meta.desc)} Browse all ${parts.length} parts below, or <a href="/">search the full text</a>.</p>
<div class="parts">${links}</div>`;

  return shell({ title, description, canonical, jsonld, body });
}

function renderSitemap() {
  const urls = [`${SITE}/`];
  for (const source of SOURCE_KEYS) {
    const { parts } = partsForSource(source);
    if (!parts.length) continue;
    urls.push(`${SITE}/${source}`);
    for (const p of parts) urls.push(`${SITE}/${source}/part-${encodeURIComponent(p)}`);
  }
  const body = urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;
}

module.exports = { SOURCES, SOURCE_KEYS, renderPartPage, renderHubPage, renderSitemap, SITE };
