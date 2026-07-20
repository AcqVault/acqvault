// Shared helpers for the server-rendered, crawlable SEO pages.
// Underscore-prefixed files under /api are NOT routed by Vercel — this is a
// plain module required by page.js / hub.js / sitemap.js.
const fs = require('fs');
const path = require('path');

const SITE = 'https://www.acqvault.com';

const SOURCES = {
  'rfo':                 { name: 'Revolutionary FAR Overhaul', short: 'RFO',
    desc: 'Full text of the Revolutionary FAR Overhaul (RFO) — the overhauled acquisition rulebook agencies cite for new awards, implemented for DoD via class deviations under E.O. 14275.' },
  'r-dfars':             { name: 'R-DFARS Deviations', short: 'R-DFARS',
    desc: 'DoD class deviations implementing the RFO for the Department of Defense — the deviation set you cite in place of the legacy supplement.' },
  'far-companion':       { name: 'FAR Companion', short: 'FAR Companion',
    desc: 'Practitioner guidance accompanying the Revolutionary FAR Overhaul.' },
  'afi-63-138':          { name: 'DAFI 63-138', short: 'DAFI 63-138',
    desc: 'Department of the Air Force Instruction 63-138, Acquisition Program Management.' },
  'category-management': { name: 'Category Management Buying Guide', short: 'Cat Mgmt',
    desc: 'Federal category management buying guidance.' },
  'fmr':                 { name: 'DoD Financial Management Regulation', short: 'DoD FMR',
    desc: 'DoD 7000.14-R Financial Management Regulation — the full text of all 16 volumes (budget, accounting, disbursing, pay, contract payment, and more), by volume and chapter.' }
};
const SOURCE_KEYS = Object.keys(SOURCES);

let docsCache = null;
function loadDocs() {
  if (docsCache) return docsCache;
  docsCache = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'output', 'documents.json'), 'utf8')).filter(Boolean);
  return docsCache;
}

let devsCache = null;
function loadDeviations() {
  if (devsCache) return devsCache;
  try { devsCache = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'output', 'deviations.json'), 'utf8')); }
  catch (e) { devsCache = []; }
  return devsCache;
}

let changesCache = null;
function loadChangesLog() {
  if (changesCache) return changesCache;
  try { changesCache = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'output', 'changes-log.json'), 'utf8')); }
  catch (e) { changesCache = []; }
  return changesCache;
}

let libraryCache = null;
function loadLibrary() {
  if (libraryCache) return libraryCache;
  try { libraryCache = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'output', 'library.json'), 'utf8')); }
  catch (e) { libraryCache = { categories: [] }; }
  return libraryCache;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function partNum(p) {
  const m = String(p || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 9999;
}

// Subpart headings interleave before their sections — KEEP IDENTICAL to
// api/search.js and app.js regTitleCmp so the SSR page and the in-app reader
// present a part in the same order.
function regOrderKey(title) {
  const t = String(title || '').trim();
  const sub = t.match(/^Subpart\s+(\d+)\.(\d+)/i);
  if (sub) return [parseInt(sub[1], 10), parseInt(sub[2], 10), 0, 0, 0, 0];
  const sec = t.match(/^(\d+)\.(\d+)(?:-(\d+))?(?:-(\d+))?/);
  if (sec) return [parseInt(sec[1], 10), Math.floor(parseInt(sec[2], 10) / 100), 1, parseInt(sec[2], 10), sec[3] ? parseInt(sec[3], 10) : 0, sec[4] ? parseInt(sec[4], 10) : 0];
  const partOnly = t.match(/^(?:Part\s+)?(\d+)\b/i);
  if (partOnly) return [parseInt(partOnly[1], 10), -1, 0, 0, 0, 0];
  return null;
}
function regTitleCmp(a, b) {
  const ka = regOrderKey(a), kb = regOrderKey(b);
  if (ka && kb) { for (let i = 0; i < ka.length; i++) { if (ka[i] !== kb[i]) return ka[i] - kb[i]; } return 0; }
  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true });
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
  for (const p of parts) groups.get(p).sort((a, b) => regTitleCmp(a.title, b.title));
  return { parts, groups };
}

// A clause published with variants opens each one with "Basic." or "Alternate N."
// followed by its prescription ("As prescribed in 225.601…") or "[Reserved]".
// Anchored so 252.225-7036 — twelve near-identical variants, 160K of text — can be
// navigated instead of scrolled. Kept strict on purpose: prose cross-references
// ("as in Alternate I of the clause") must NOT match, so the prescription verb or
// [Reserved] is required. Mirrored in assets/app.js — edit both.
const ALT_BOUNDARY = /(?=(?:Basic|Alternate [IVXL]+)\.\s*(?:\[Reserved\.?\]|As prescribed))/;
const ALT_HEAD = /^(Basic|Alternate [IVXL]+)\.\s*(?=\[Reserved\.?\]|As prescribed)/;

function altSlug(label) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

// Most docs open with a line echoing their own title, which the page already shows
// as the section heading. Two ways that echo hides from an exact match: it often
// carries a trailing period ("…Payments Program." vs the bare title), and in the
// PDF-derived sources the heading WRAPS across two stored lines ("…acquired by
// educational" / "institutions.") so no single line ever equals the title.
// titleEchoLines() walks the leading lines, accumulating while they stay a prefix
// of the title, and reports how many to drop. Mirrored in assets/app.js — edit both.
function normEcho(s) {
  return String(s || '').replace(/^L\d+:\s*/, '').replace(/\s+/g, ' ').trim()
    .replace(/[.\s]+$/, '').toLowerCase();
}

function titleEchoLines(lines, title) {
  const want = normEcho(title);
  if (!want) return 0;
  let acc = '';
  // A wrapped heading is 1-3 stored lines; past that we are into body text.
  for (let i = 0; i < lines.length && i < 4; i++) {
    const s = normEcho(lines[i]);
    if (!s) return 0;
    acc = acc ? acc + ' ' + s : s;
    if (acc === want) return i + 1;
    if (!want.startsWith(acc + ' ')) return 0;
  }
  return 0;
}

// Render a doc's content into clean paragraphs (strip the "Ln:" level markers
// and a leading line that just repeats the title).
function renderContent(content, title, anchorBase) {
  const lines = String(content || '').split('\n');
  const out = [];
  const blocks = [];
  const skip = titleEchoLines(lines, title);
  for (let li = skip; li < lines.length; li++) {
    const line = lines[li];
    const isTop = /^L0:/.test(line);
    let s = line.replace(/^L\d+:\s*/, '').trim();
    if (!s) continue;

    // The source PDFs run reserved variants together on one line
    // ("Alternate II. [Reserved] Alternate III. [Reserved] Alternate IV. As
    // prescribed…"); give each its own heading rather than burying two of them.
    const segments = isTop ? s.split(ALT_BOUNDARY).filter(x => x.trim()) : [s];
    for (const seg of segments) {
      const t = seg.trim();
      const m = isTop ? t.match(ALT_HEAD) : null;
      if (m) {
        const label = m[1];
        const id = `${anchorBase || 'doc'}-${altSlug(label)}`;
        blocks.push({ label, id });
        // Heading keeps the trailing period so the rendered page is character-for-
        // character the source text — no punctuation quietly dropped.
        out.push(`<h3 class="alt-head" id="${esc(id)}"><a href="#${esc(id)}">${esc(label)}.</a></h3>`);
        const rest = t.slice(m[0].length).trim();
        if (rest) out.push('<p>' + esc(rest) + '</p>');
      } else {
        out.push('<p>' + esc(t) + '</p>');
      }
    }
  }

  // One variant is just a clause; two or more is a document you have to navigate.
  if (blocks.length >= 2) {
    // A <div role="navigation">, NOT <nav> — kept identical to the client renderer,
    // where app.css styles bare `nav` as the fixed site header.
    const nav = `<div class="alt-nav" role="navigation" aria-label="Clause variants"><span class="alt-nav-lbl">Variants</span>${
      blocks.map(b => `<a href="#${esc(b.id)}">${esc(b.label)}</a>`).join('')
    }</div>`;
    return nav + '\n' + out.join('\n');
  }
  return out.join('\n');
}

function metaDescription(docs) {
  const text = String((docs[0] && docs[0].content) || '').replace(/^L\d+:\s*/gm, '').replace(/\s+/g, ' ').trim();
  return esc(text.slice(0, 155));
}

const STYLE = `@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;src:url(/assets/fonts/inter-latin.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;}
@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;src:url(/assets/fonts/inter-latin-ext.woff2) format('woff2');unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF;}
@font-face{font-family:'Source Serif 4';font-style:normal;font-weight:200 900;font-display:swap;src:url(/assets/fonts/source-serif4-latin.woff2) format('woff2');}
:root{--ink:#13151b;--muted:#5e5d66;--line:#948b7c;--line2:#e8e5de;--accent:#87651c;--bg:#fff;--brass:#87651c;--brass-ink:#5e4715;--brass-bright:#e4c477;--brass-deep:#6f521a;--brass-line:rgba(154,115,32,0.40);--ink-from:#173a60;--ink-mid:#0f2540;--ink-to:#0a1c33;--serif:'Source Serif 4',Georgia,'Times New Roman',serif}
*{box-sizing:border-box}body{margin:0;font-family:'Inter',-apple-system,system-ui,sans-serif;color:var(--ink);background:var(--bg);line-height:1.6;-webkit-font-smoothing:antialiased}
::selection{background:rgba(135,101,28,0.16);color:var(--ink)}
mark{background:rgba(135,101,28,0.20);color:var(--ink);border-radius:2px;padding:0 1px}
h1,h2,h3{text-wrap:balance}
html{-webkit-tap-highlight-color:transparent}
:root{accent-color:var(--accent)}
:where(button,a,input,select):focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.wrap{max-width:820px;margin:0 auto;padding:22px 20px 80px}
.wrap--wide{max-width:1060px}
header.site{border-bottom:1px solid var(--line);margin-bottom:26px;padding-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
header.site a.brand{display:inline-flex;align-items:center;gap:9px;font-weight:800;font-size:18px;letter-spacing:-0.03em;color:var(--ink);text-decoration:none}
header.site a.brand svg{display:block;width:27px;height:27px;flex-shrink:0}
header.site a.cta{font-weight:650;font-size:14px;color:#fff;background:linear-gradient(160deg,var(--ink-from),var(--ink-mid));border:1px solid var(--brass-line);padding:8px 15px;border-radius:999px;text-decoration:none;transition:border-color .15s}
header.site a.cta:hover{border-color:rgba(228,196,119,.55)}
.hdr-links{display:inline-flex;align-items:center;gap:16px}
.hlink{font-weight:650;font-size:14px;color:var(--muted);text-decoration:none}
.hlink:hover{color:var(--accent);text-decoration:underline}
/* federal-ink masthead — frames the page in the homepage's visual language */
.lib-mast{position:relative;overflow:hidden;border-radius:18px;margin:0 0 34px;padding:42px 40px 36px;background:linear-gradient(158deg,var(--ink-from),var(--ink-mid) 56%,var(--ink-to));color:#eaf1f8;box-shadow:inset 0 0 0 1px var(--brass-line),0 26px 54px -30px rgba(10,28,51,.62)}
.lib-mast::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--brass-deep),var(--brass-bright) 50%,var(--brass-deep))}
.lib-mast::after{content:"";position:absolute;right:-60px;bottom:-80px;width:320px;height:320px;opacity:.14;background:repeating-radial-gradient(circle at 50% 50%,rgba(228,196,119,.6) 0 1px,transparent 1px 11px);pointer-events:none}
.lib-mast .eyebrow{position:relative;font-size:11px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:var(--brass-bright);margin:0 0 13px}
.lib-mast h1{position:relative;font-family:var(--serif);font-weight:700;font-size:42px;letter-spacing:-0.01em;line-height:1.05;margin:0 0 13px;color:#f4f8fc;max-width:14ch}
.lib-mast .lede{position:relative;color:rgba(221,233,246,.85);font-size:15.5px;max-width:640px;margin:0 0 22px;line-height:1.6}
.lib-mast .stats{position:relative;display:flex;flex-wrap:wrap;gap:9px}
.lib-mast .stat{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:#eaf1f8;background:rgba(255,255,255,.06);border:1px solid rgba(228,196,119,.3);border-radius:999px;padding:6px 13px}
.lib-mast .stat b{color:var(--brass-bright);font-variant-numeric:tabular-nums}
.lib-seal{position:absolute;right:46px;top:50%;transform:translateY(-50%);width:112px;height:112px;z-index:1;filter:drop-shadow(0 8px 16px rgba(0,0,0,.42));}
@media(max-width:760px){.lib-seal{display:none}}
nav.crumbs{font-size:13px;color:var(--muted);margin-bottom:8px}
nav.crumbs a{color:var(--accent);text-decoration:none}nav.crumbs a:hover{text-decoration:underline}
h1{font-family:var(--serif);font-weight:700;font-size:30px;letter-spacing:-0.02em;margin:.2em 0 .1em}
.lede{color:var(--muted);margin:0 0 26px;font-size:15px}
.lede a{color:var(--accent);text-decoration:underline;text-underline-offset:2px}
section.sec{padding:18px 0;border-top:1px solid var(--line);scroll-margin-top:14px}
section.sec h2{font-size:18px;letter-spacing:-0.02em;margin:0 0 6px;scroll-margin-top:16px}
section.sec h2 a{color:inherit;text-decoration:none}
/* Landing from a deep link (study chips, TOC, copied anchors): bathe the exact section
   in the house brass so the reader spots it without sweeping the page. The :target wash
   stays as a resting emphasis; the stronger flash settles after a moment. */
section.sec:target{background:linear-gradient(90deg,rgba(135,101,28,.07),rgba(135,101,28,.02) 62%,transparent);border-left:3px solid var(--accent);border-radius:0 10px 10px 0;padding-left:16px;margin-left:-19px;animation:sec-found 2.8s ease-out 1}
section.sec:target>h2{color:var(--accent)}
@keyframes sec-found{0%,30%{background-color:rgba(228,196,119,.32)}100%{background-color:rgba(228,196,119,0)}}
@media(prefers-reduced-motion:reduce){section.sec:target{animation:none}}
.srcref{font-size:12.5px;color:var(--muted);margin:0 0 10px}
.srcref a{color:var(--accent);text-decoration:none}
/* Clause variants (Basic / Alternate N) — jump strip + anchored headings */
.alt-nav{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin:0 0 20px;padding:12px 14px;border:1px solid var(--line2);border-left:3px solid var(--brass);border-radius:10px;background:rgba(135,101,28,.04)}
.alt-nav-lbl{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-right:3px}
.alt-nav a{font-size:12.5px;font-weight:650;color:var(--brass-ink);text-decoration:none;border:1px solid var(--brass-line);border-radius:999px;padding:3px 11px;white-space:nowrap}
.alt-nav a:hover{background:rgba(135,101,28,.10)}
.alt-head{scroll-margin-top:18px;font-family:var(--serif);font-size:20px;font-weight:700;margin:34px 0 10px;padding-top:14px;border-top:1px solid var(--line2)}
.alt-head a{color:var(--ink);text-decoration:none}
.alt-head a:hover{color:var(--accent)}
.sec p{margin:.5em 0;font-size:15px}
.sec p a{color:var(--accent);text-decoration:underline;text-underline-offset:2px}.sec p a:hover{color:var(--brass-ink)}
.parts{columns:2;gap:24px}.parts a{display:block;padding:7px 0;color:var(--accent);text-decoration:none;font-size:15px;break-inside:avoid}
.parts a:hover{text-decoration:underline}
footer{margin-top:40px;border-top:1px solid var(--line);padding-top:18px;font-size:13px;color:var(--muted)}
footer a{color:var(--accent)}
table.devtable{width:100%;border-collapse:collapse;font-size:14px;margin-top:10px}
table.devtable th,table.devtable td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
table.devtable th{font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);border-bottom:2px solid var(--line)}
table.devtable tr:hover td{background:#f7f6f2}
table.devtable td a{color:var(--accent);text-decoration:none}table.devtable td a:hover{text-decoration:underline}
table.devtable .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;white-space:nowrap}
@media(max-width:560px){.parts{columns:1}table.devtable{font-size:12.5px}table.devtable th,table.devtable td{padding:7px 6px}}
.libcat{padding:30px 0 8px;border-top:none}
.libcat+.libcat{border-top:1px solid var(--line);padding-top:32px}
.libcat .eyebrow{display:flex;align-items:center;gap:9px;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--brass);margin:0 0 6px}
.libcat .eyebrow::before{content:"";width:18px;height:2px;background:var(--brass);border-radius:2px}
.libcat h2{font-size:22px;letter-spacing:-0.02em;margin:0 0 5px}
.libcat .catblurb{color:var(--muted);font-size:14px;margin:0 0 18px;max-width:660px;line-height:1.55}
/* feature "report cover" cards — matte federal-ink + brass seal + engraved vault emblem */
.libgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:14px}
.libfeat{display:flex;flex-direction:column;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;text-decoration:none;color:inherit;box-shadow:0 1px 2px rgba(13,17,23,.04);transition:box-shadow .2s,transform .18s,border-color .18s}
.libfeat:hover{border-color:rgba(135,101,28,.35);box-shadow:0 16px 34px -16px rgba(15,37,64,.34);transform:translateY(-3px)}
.libcover{position:relative;height:120px;padding:14px 16px;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;background:linear-gradient(158deg,#173a60,#0f2540 56%,#0a1c33)}
.libcover::before{content:"";position:absolute;inset:0;opacity:.5;background:repeating-radial-gradient(circle at 84% 128%,rgba(202,168,95,.05) 0 1px,transparent 1px 9px)}
.libcover::after{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,#8a641d,#e4c477 50%,#8a641d)}
.libcover svg{position:absolute;right:-18px;bottom:-22px;width:120px;height:120px;opacity:.22}
.libcover .kind{position:relative;font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#dcc081}
.libcover .vol{position:relative;font-family:var(--serif);font-weight:700;font-size:30px;color:#f3f6fa;line-height:1}
.libcover .vol small{display:block;font-family:Inter,system-ui,sans-serif;font-size:10px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:rgba(214,226,240,.62);margin-bottom:5px}
.libfeat-body{display:flex;flex-direction:column;gap:5px;padding:14px 16px;flex:1}
.libfeat-body h3{font-size:16px;font-weight:800;letter-spacing:-0.02em;margin:0;line-height:1.25;color:var(--ink)}
.libfeat-body .desc{font-size:13px;color:#3d444d;line-height:1.5;margin:0;flex:1;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.libfeat-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px}
.libfeat-foot .m{font-size:12px;color:var(--muted);font-weight:600;font-variant-numeric:tabular-nums}
.libfeat-foot .dl{font-size:13px;font-weight:700;color:var(--accent);background:rgba(135,101,28,.07);border:1px solid rgba(135,101,28,.18);border-radius:999px;padding:5px 12px}
.libfeat:hover .libfeat-foot .dl{background:var(--accent);color:#fff}
/* source-document cards, color-coded to the search UI */
.libsrc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:12px}
.libsrc{position:relative;display:flex;flex-direction:column;gap:3px;background:#fff;border:1px solid var(--line);border-left:3px solid var(--src,#94a3b8);border-radius:10px;padding:13px 14px;text-decoration:none;color:inherit;transition:box-shadow .15s,transform .15s}
.libsrc:hover{box-shadow:0 8px 18px -8px rgba(15,37,64,.24);transform:translateY(-2px)}
.libsrc .nm{font-size:14.5px;font-weight:800;letter-spacing:-0.01em;color:var(--ink);padding-right:20px;line-height:1.25}
.libsrc .sb{font-size:12px;color:var(--muted);font-weight:600}
.libsrc .mt{font-size:11px;color:var(--muted);margin-top:2px}
.libsrc .dl{position:absolute;top:12px;right:13px;font-size:14px;font-weight:800;color:var(--src,#94a3b8)}
.libsrc[data-src="rfo"]{--src:#2f5aa6}.libsrc[data-src="r-dfars"]{--src:#2c6a44}.libsrc[data-src="far-companion"]{--src:#67508f}.libsrc[data-src="category-management"]{--src:#1c6377}.libsrc[data-src="dafi-63-138"]{--src:#87651c}.libsrc[data-src="fmr"]{--src:#976420}
.libnote{font-size:12.5px;color:var(--muted);margin:8px 0 0;line-height:1.55}
@media(max-width:560px){.libgrid,.libsrc-grid{grid-template-columns:1fr}}
/* ── Library themed full-bleed bands (homepage rhythm: navy hero / white / beige) ── */
:root{--off:#f7f6f2}
.lnav{background:#fff;border-bottom:1px solid var(--line2)}
.lnav-inner{max-width:1060px;margin:0 auto;padding:15px 24px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.lnav .brand{display:inline-flex;align-items:center;gap:9px;font-weight:800;font-size:18px;letter-spacing:-0.03em;color:var(--ink);text-decoration:none}
.lnav .brand svg{display:block;width:27px;height:27px;flex-shrink:0}
.lnav .cta{font-weight:650;font-size:14px;color:#fff;background:linear-gradient(160deg,var(--ink-from),var(--ink-mid));border:1px solid var(--brass-line);padding:8px 15px;border-radius:999px;text-decoration:none;transition:border-color .15s}
.lnav .cta:hover{border-color:rgba(228,196,119,.55)}
.lband{width:100%}
.lband-inner{max-width:1060px;margin:0 auto;padding:54px 24px}
.lband--white{background:#fff}
.lband--off{background:var(--off)}
.lband--white+.lband--white{border-top:1px solid var(--line2)}
.lband .libcat{padding:0;border:none}
.lband .libcat+.libcat{padding:0;border:none}
.lhero{position:relative;overflow:hidden;background:linear-gradient(158deg,var(--ink-from),var(--ink-mid) 56%,var(--ink-to));color:#eaf1f8}
.lhero::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--brass-deep),var(--brass-bright) 50%,var(--brass-deep));z-index:2}
.lhero::after{content:"";position:absolute;right:-40px;bottom:-130px;width:440px;height:440px;opacity:.12;background:repeating-radial-gradient(circle at 50% 50%,rgba(228,196,119,.6) 0 1px,transparent 1px 12px);pointer-events:none}
.lhero .lband-inner{position:relative;padding:54px 24px 52px}
.lhero .crumbs{font-size:13px;margin:0 0 14px;color:rgba(214,226,240,.72)}
.lhero .crumbs a{color:rgba(228,196,119,.9);text-decoration:none}
.lhero .eyebrow{display:flex;align-items:center;gap:9px;font-size:11px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:var(--brass-bright);margin:0 0 13px}
.lhero .eyebrow::before{content:"";width:18px;height:2px;background:var(--brass-bright);border-radius:2px}
.lhero h1{font-family:var(--serif);font-weight:700;font-size:44px;letter-spacing:-0.01em;line-height:1.04;margin:0 0 14px;color:#f4f8fc;max-width:15ch}
.lhero .lede{color:rgba(221,233,246,.85);font-size:16px;max-width:640px;margin:0 0 22px;line-height:1.6}
.lhero .stats{display:flex;flex-wrap:wrap;gap:9px}
.lhero .stat{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:#eaf1f8;background:rgba(255,255,255,.06);border:1px solid rgba(228,196,119,.3);border-radius:999px;padding:6px 13px}
.lhero .stat b{color:var(--brass-bright);font-variant-numeric:tabular-nums}
.lhero .lib-seal{position:absolute;right:24px;top:50%;transform:translateY(-50%);width:120px;height:120px;z-index:1;filter:drop-shadow(0 8px 16px rgba(0,0,0,.42))}
@media(max-width:820px){.lhero .lib-seal{display:none}.lhero h1{font-size:34px}}
.lband--foot{background:var(--off);border-top:1px solid var(--line2)}
.lband--foot .lband-inner{padding:30px 24px 42px}
.lfoot-note{font-size:12.5px;color:var(--muted);margin:0 0 14px;line-height:1.55;max-width:840px}
.lfoot-legal{font-size:12.5px;color:var(--muted);line-height:1.55;margin:0;max-width:840px}
.lfoot-legal a{color:var(--accent)}
@media(max-width:560px){.lband-inner{padding:40px 18px}.lhero .lband-inner{padding:40px 18px 38px}.lhero h1{font-size:30px}}`;

function shell({ title, description, canonical, jsonld, body, wide, bleed, ogImage }) {
  const og = ogImage || 'og-home-v2.png';
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
<meta property="og:image" content="${SITE}/assets/${og}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${SITE}/assets/${og}">
<link rel="icon" href="/assets/favicon-vault.svg" type="image/svg+xml">
<style>${STYLE}</style>
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head>
<body>
${bleed ? body : `<div class="wrap${wide ? ' wrap--wide' : ''}">
<header class="site"><a class="brand" href="/?home=1"><svg viewBox="0 0 100 100" aria-hidden="true"><rect x="6" y="6" width="88" height="88" rx="16" fill="#0f2540"/><rect x="13" y="13" width="74" height="74" rx="11" fill="none" stroke="rgba(228,196,119,.5)" stroke-width="1.5"/><circle cx="50" cy="50" r="22" fill="none" stroke="#e4c477" stroke-width="3"/><g stroke="#e4c477" stroke-width="3.4" stroke-linecap="round"><line x1="50" y1="32" x2="50" y2="40"/><line x1="50" y1="68" x2="50" y2="60"/><line x1="32" y1="50" x2="40" y2="50"/><line x1="68" y1="50" x2="60" y2="50"/></g><circle cx="50" cy="50" r="5" fill="#e4c477"/></svg>AcqVault</a><span class="hdr-links"><a class="hlink" href="/?home=1">Home</a><a class="cta" href="/?q=">Search all sources →</a></span></header>
${body}
<footer>AcqVault is an <strong>unofficial research aid</strong> — not legal advice and not an official source. The authoritative sources are the signed DoD class deviations and the official text at <a href="https://www.acquisition.gov/far-overhaul" rel="noopener">acquisition.gov</a>. Always verify before relying on any result in a contract file.</footer>
</div>`}
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
    const src = d.url
      ? (/dps\.mil/i.test(d.url)
          ? `<p class="srcref">Reproduced from the DAF Contracting Compass (the official DAF source is CAC-gated).</p>`
          : `<p class="srcref">Source: <a href="${esc(d.url)}" rel="noopener nofollow">${esc(d.url)}</a></p>`)
      : '';
    return `<section class="sec" id="${anchor}">
<h2><a href="#${anchor}">${esc(d.title)}</a></h2>
${src}
${renderContent(d.content, d.title, anchor)}
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

  const body = `<nav class="crumbs"><a href="/?home=1">AcqVault</a> › <a href="/${source}">${esc(meta.name)}</a> › Part ${esc(part)}</nav>
<h1>${esc(meta.name)} · Part ${esc(part)}</h1>
<p class="lede">${esc(meta.desc)} Full text of Part ${esc(part)} (${docs.length} section${docs.length !== 1 ? 's' : ''}), searchable at <a href="/?q=part%20${esc(part)}">AcqVault</a>.</p>
${sections}`;

  return shell({ title, description, canonical, jsonld, body, ogImage: `og-src-${source}-v2.png` });
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

  const devLink = source === 'r-dfars'
    ? `<p class="lede" style="margin-top:-12px"><strong><a href="/deviations">→ R-DFARS Deviations Index</a></strong> — every deviation with effective date &amp; DARS tracking number.</p>`
    : '';
  const body = `<nav class="crumbs"><a href="/?home=1">AcqVault</a> › ${esc(meta.name)}</nav>
<h1>${esc(meta.name)}</h1>
<p class="lede">${esc(meta.desc)} Browse all ${parts.length} parts below, or <a href="/?home=1">search the full text</a>.</p>
${devLink}
<div class="parts">${links}</div>`;

  return shell({ title, description, canonical, jsonld, body, ogImage: `og-src-${source}-v2.png` });
}

function renderDeviationsPage() {
  const rows = loadDeviations();
  if (!rows.length) return null;
  const canonical = `${SITE}/deviations`;
  const title = `R-DFARS Deviations Index — DoD class deviations for the FAR Overhaul | AcqVault`;
  const description = esc(`All ${rows.length} DoD R-DFARS class deviations implementing the Revolutionary FAR Overhaul — RFO part, legacy DFARS reference, effective date, DARS tracking number, and full text.`);

  const tr = rows.map(r => `<tr>
<td><a href="/r-dfars/part-${esc(r.rfo_part)}">Part ${esc(r.rfo_part)}</a></td>
<td>${r.dfars_part ? 'DFARS ' + esc(r.dfars_part) : '—'}</td>
<td>${esc(r.effective || '—')}</td>
<td class="mono">${esc(r.dars || '—')}</td>
<td>${r.pdf_url ? `<a href="${esc(r.pdf_url)}" rel="noopener nofollow">Signed memo&nbsp;↗</a> · ` : ''}<a href="/r-dfars/part-${esc(r.rfo_part)}">Full text</a></td>
</tr>`).join('\n');

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: 'R-DFARS Deviations Index', description: description, url: canonical,
    isPartOf: { '@type': 'WebSite', name: 'AcqVault', url: SITE }
  };

  const body = `<nav class="crumbs"><a href="/?home=1">AcqVault</a> › <a href="/r-dfars">R-DFARS Deviations</a> › Index</nav>
<h1>R-DFARS Deviations Index</h1>
<p class="lede">Every DoD class deviation implementing the Revolutionary FAR Overhaul (${rows.length} parts), with its RFO part, legacy DFARS reference, effective date, and DARS tracking number. Click a part for the full text on AcqVault, or the signed memo for the authoritative source.</p>
<table class="devtable">
<thead><tr><th>RFO Part</th><th>Legacy DFARS ref</th><th>Effective</th><th>DARS Tracking #</th><th>Read</th></tr></thead>
<tbody>
${tr}
</tbody></table>`;

  return shell({ title, description, canonical, jsonld, body });
}

function renderLibraryPage() {
  const lib = loadLibrary();
  const cats = (lib.categories || []).filter(c => c.items && c.items.length);
  if (!cats.length) return null;
  const canonical = `${SITE}/library`;
  const title = `AcqVault Library — field guides, templates & source PDFs | AcqVault`;
  const totalItems = cats.reduce((n, c) => n + c.items.length, 0);
  const description = esc(`Free downloadable AcqVault field guides and templates for the DoD acquisition community, plus the full text of every indexed source (RFO, R-DFARS, FAR Companion, Category Management, DAFI 63-138, and the DoD FMR) as one clean PDF each. ${totalItems} resources, no account required.`);

  // engraved brass vault emblem (line-art, no glow) — matches the homepage covers
  const EMBLEM = '<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="#cdb277" stroke-width="1.6"><circle cx="47" cy="50" r="33"/><circle cx="47" cy="50" r="26"/><circle cx="47" cy="50" r="9"/></g><g stroke="#cdb277" stroke-width="3" stroke-linecap="round"><line x1="47" y1="24" x2="47" y2="37"/><line x1="47" y1="76" x2="47" y2="63"/><line x1="21" y1="50" x2="34" y2="50"/><line x1="73" y1="50" x2="60" y2="50"/></g><g stroke="#cdb277" stroke-width="2.6" stroke-linecap="round"><line x1="28" y1="31" x2="37" y2="40"/><line x1="66" y1="31" x2="57" y2="40"/><line x1="28" y1="69" x2="37" y2="60"/><line x1="66" y1="69" x2="57" y2="60"/></g><circle cx="47" cy="50" r="3.4" fill="#cdb277"/></svg>';
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  const CAT_EYEBROW = { 'field-guides': 'Written by AcqVault', 'templates': 'Adapt & reuse', 'source-documents': 'Official text · one clean PDF each' };
  // Alternate the band backgrounds like the homepage: white / beige / white.
  const bandFor = (key) => (key === 'templates' ? 'off' : 'white');
  const coverParts = (it, catKey) => {
    const m = String(`${it.title} ${it.subtitle || ''}`).match(/Vol\.?\s*(\d+)/i);
    if (catKey === 'field-guides' && m) return { kind: 'Field Guide', small: 'Volume', big: ROMAN[+m[1]] || m[1] };
    if (catKey === 'templates') {
      const ac = String(it.title || '').match(/\b[A-Z]{2,}\b/g) || [];
      const big = ac.length ? ac[ac.length - 1] : String(it.title || '').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
      return { kind: 'Template', small: /interactive/i.test(it.type || '') ? 'Interactive' : 'Template', big };
    }
    return { kind: esc(it.origin || 'Resource'), small: '', big: '' };
  };

  const catHtml = cats.map(cat => {
    if (cat.key === 'source-documents') {
      const cards = cat.items.map(it => {
        const srcKey = String(it.id || '').replace(/^src-/, '');
        const ext = /^https?:\/\//i.test(it.file || '');
        const attrs = ext ? 'target="_blank" rel="noopener"' : `download="${esc(it.download || '')}" rel="noopener"`;
        return `<a class="libsrc" data-src="${esc(srcKey)}" href="${esc(it.file)}" ${attrs}>
<span class="dl" aria-hidden="true">${ext ? '↗' : '↓'}</span>
<span class="nm">${esc(it.title)}</span>
${it.subtitle ? `<span class="sb">${esc(it.subtitle)}</span>` : ''}
${it.meta ? `<span class="mt">${esc(it.meta)}</span>` : ''}
</a>`;
      }).join('\n');
      return `<section class="lband lband--${bandFor(cat.key)}"><div class="lband-inner"><section class="libcat">
${CAT_EYEBROW[cat.key] ? `<div class="eyebrow">${esc(CAT_EYEBROW[cat.key])}</div>` : ''}
<h2>${esc(cat.name)}</h2>
${cat.blurb ? `<p class="catblurb">${esc(cat.blurb)}</p>` : ''}
<div class="libsrc-grid">${cards}</div>
</section></div></section>`;
    }
    const cards = cat.items.map(it => {
      const cp = coverParts(it, cat.key);
      const name = (cat.key === 'field-guides' && it.subtitle) ? it.subtitle : it.title;
      const meta = [it.type, it.pages ? `${it.pages} pp` : null].filter(Boolean).join(' · ');
      return `<a class="libfeat" href="${esc(it.file)}" download="${esc(it.download || '')}" rel="noopener">
<div class="libcover"><span class="kind">${esc(cp.kind)}</span><span class="vol">${cp.small ? `<small>${esc(cp.small)}</small>` : ''}${esc(cp.big)}</span>${EMBLEM}</div>
<div class="libfeat-body"><h3>${esc(name)}</h3>${it.desc ? `<p class="desc">${esc(it.desc)}</p>` : ''}<div class="libfeat-foot"><span class="m">${esc(meta)}</span><span class="dl">Download ↓</span></div></div>
</a>`;
    }).join('\n');
    return `<section class="lband lband--${bandFor(cat.key)}"><div class="lband-inner"><section class="libcat">
${CAT_EYEBROW[cat.key] ? `<div class="eyebrow">${esc(CAT_EYEBROW[cat.key])}</div>` : ''}
<h2>${esc(cat.name)}</h2>
${cat.blurb ? `<p class="catblurb">${esc(cat.blurb)}</p>` : ''}
<div class="libgrid">${cards}</div>
</section></div></section>`;
  }).join('\n');

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: 'AcqVault Library', description, url: canonical,
    isPartOf: { '@type': 'WebSite', name: 'AcqVault', url: SITE },
    hasPart: cats.flatMap(c => c.items.map(it => ({
      '@type': 'DigitalDocument', name: it.title, url: `${SITE}${it.file}`,
      encodingFormat: 'application/pdf'
    })))
  };

  const BRAND_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="6" y="6" width="88" height="88" rx="16" fill="#0f2540"/><rect x="13" y="13" width="74" height="74" rx="11" fill="none" stroke="rgba(228,196,119,.5)" stroke-width="1.5"/><circle cx="50" cy="50" r="22" fill="none" stroke="#e4c477" stroke-width="3"/><g stroke="#e4c477" stroke-width="3.4" stroke-linecap="round"><line x1="50" y1="32" x2="50" y2="40"/><line x1="50" y1="68" x2="50" y2="60"/><line x1="32" y1="50" x2="40" y2="50"/><line x1="68" y1="50" x2="60" y2="50"/></g><circle cx="50" cy="50" r="5" fill="#e4c477"/></svg>';

  const body = `<header class="lnav"><div class="lnav-inner"><a class="brand" href="/?home=1">${BRAND_SVG}AcqVault</a><span class="hdr-links"><a class="hlink" href="/?home=1">Home</a><a class="cta" href="/?q=">Search all sources →</a></span></div></header>
<section class="lband lhero"><div class="lband-inner">
<nav class="crumbs"><a href="/?home=1">AcqVault</a> › Library</nav>
<div class="eyebrow">AcqVault · Library</div>
<h1>The reference shelf for federal&nbsp;acquisition</h1>
<p class="lede">Field guides, templates, and the full text of every indexed source — one place to pull what you need.</p>
<div class="stats"><span class="stat"><b>${totalItems}</b> resources</span><span class="stat">Free · no account</span><span class="stat">Source text re-indexed monthly</span></div>
<svg class="lib-seal" viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="ls-g" cx="36%" cy="30%" r="80%"><stop offset="0" stop-color="#f2d89a"/><stop offset="48%" stop-color="#cda857"/><stop offset="100%" stop-color="#876514"/></radialGradient></defs><circle cx="50" cy="50" r="47" fill="url(#ls-g)" stroke="#6f521a" stroke-width="1.5"/><circle cx="50" cy="50" r="42" fill="none" stroke="#6f521a" stroke-width="1" stroke-dasharray="1.2 2.6" opacity="0.55"/><circle cx="50" cy="50" r="22" fill="none" stroke="#16263f" stroke-width="2.4" opacity="0.9"/><g stroke="#16263f" stroke-width="3" stroke-linecap="round" opacity="0.9"><line x1="50" y1="33" x2="50" y2="41"/><line x1="50" y1="67" x2="50" y2="59"/><line x1="33" y1="50" x2="41" y2="50"/><line x1="67" y1="50" x2="59" y2="50"/></g><circle cx="50" cy="50" r="5.5" fill="#16263f" opacity="0.9"/></svg>
</div></section>
${catHtml}
<footer class="lband lband--foot"><div class="lband-inner">
<p class="lfoot-note"><strong>Originals</strong> are written by AcqVault as research aids. <strong>Source documents</strong> are compiled from official material and regenerated monthly — always verify against the signed DoD class deviations and <a href="https://www.acquisition.gov/far-overhaul" rel="noopener">acquisition.gov</a> before relying on any result in a contract file.</p>
<p class="lfoot-legal">AcqVault is an <strong>unofficial research aid</strong> — not legal advice and not an official source. The authoritative sources are the signed DoD class deviations and the official text at <a href="https://www.acquisition.gov/far-overhaul" rel="noopener">acquisition.gov</a>. Always verify before relying on any result in a contract file.</p>
</div></footer>`;

  return shell({ title, description, canonical, jsonld, body, bleed: true, ogImage: 'og-library-v2.png' });
}

// ── /changes — the corpus-refresh ledger, rendered as a citable change record ──
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function fmtRunDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return esc(String(iso || ''));
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function renderChangesPage() {
  const runs = loadChangesLog();
  if (!Array.isArray(runs) || !runs.length) return null;
  const canonical = `${SITE}/changes`;
  const title = 'What changed — corpus refresh log | AcqVault';
  const latest = runs[runs.length - 1];
  const description = esc(`Every AcqVault re-index of the Revolutionary FAR Overhaul and its companion sources, with the exact sections that changed. Latest refresh: ${fmtRunDate(latest.run_at)}.`);

  // Newest run first.
  const runHtml = [...runs].reverse().map(run => {
    const rfo = run.rfo || {};
    const added = rfo.added || [];
    const modified = rfo.modified || [];
    const removed = rfo.removed || [];
    const runDate = fmtRunDate(run.run_at);

    // Group changed sections by part for scannability.
    const byPart = new Map();
    const put = (list, kind) => {
      for (const s of list) {
        const p = String(s.part || '?');
        if (!byPart.has(p)) byPart.set(p, []);
        byPart.get(p).push({ ...s, kind });
      }
    };
    put(added, 'added'); put(removed, 'removed'); put(modified, 'modified');
    const parts = [...byPart.keys()].sort((a, b) => partNum(a) - partNum(b) || a.localeCompare(b));

    const partBlocks = parts.map(p => {
      const rows = byPart.get(p).map(s => {
        const kindChip = s.kind !== 'modified' ? `<span class="chg-kind chg-kind-${s.kind}">${s.kind === 'added' ? 'New' : 'Removed'}</span>` : '';
        const link = s.kind === 'removed'
          ? esc(s.title)
          : `<a href="/?view=reader&amp;doc=${esc(s.id)}">${esc(s.title)}</a>`;
        return `<li>${kindChip}${link}</li>`;
      }).join('\n');
      return `<details class="chg-part">
<summary><strong>RFO Part ${esc(p)}</strong> — ${byPart.get(p).length} section${byPart.get(p).length !== 1 ? 's' : ''}</summary>
<ul class="chg-list">${rows}</ul>
</details>`;
    }).join('\n');

    const OTHER_LABELS = { r_dfars: 'R-DFARS', far_companion: 'FAR Companion', category_management: 'Category Mgmt', fmr: 'DoD FMR', afi_63_138: 'DAFI 63-138' };
    const otherSources = Object.keys(OTHER_LABELS)
      .filter(k => run[k] != null)
      .map(k => {
        const v = String(run[k]);
        const label = OTHER_LABELS[k];
        // Ledger strings sometimes already lead with the source name — don't double it.
        return `<li>${v.toLowerCase().startsWith(label.toLowerCase()) ? esc(v) : `${esc(label)}: ${esc(v)}`}</li>`;
      }).join('\n');

    const counts = [
      `<span class="chg-stat"><b>${modified.length}</b> modified</span>`,
      `<span class="chg-stat"><b>${added.length}</b> added</span>`,
      `<span class="chg-stat"><b>${removed.length}</b> removed</span>`,
      rfo.unchanged != null ? `<span class="chg-stat"><b>${Number(rfo.unchanged).toLocaleString()}</b> unchanged</span>` : ''
    ].filter(Boolean).join('\n');

    return `<section class="sec chg-run">
<h2 id="run-${esc(String(run.run_at || '').slice(0, 10))}">Re-index of ${runDate}</h2>
<div class="chg-stats">${counts}</div>
${partBlocks || '<p>No RFO text changes in this re-index.</p>'}
${otherSources ? `<p class="srcref" style="margin-top:14px"><strong>Other sources checked:</strong></p><ul class="chg-other">${otherSources}</ul>` : ''}
</section>`;
  }).join('\n');

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'CollectionPage',
    name: 'AcqVault corpus refresh log', description, url: canonical,
    isPartOf: { '@type': 'WebSite', name: 'AcqVault', url: SITE }
  };

  const CHG_STYLE = `<style>
.chg-stats{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 14px}
.chg-stat{font-size:12.5px;font-weight:600;color:var(--muted);background:#f4f2ec;border:1px solid var(--line2);border-radius:999px;padding:4px 11px}
.chg-stat b{color:var(--ink);font-variant-numeric:tabular-nums}
details.chg-part{border:1px solid var(--line2);border-radius:10px;padding:0;margin:8px 0;background:#fff}
details.chg-part summary{cursor:pointer;padding:10px 14px;font-size:14.5px;list-style-position:inside}
details.chg-part[open] summary{border-bottom:1px solid var(--line2)}
ul.chg-list{margin:8px 0 12px;padding:0 16px 0 34px;font-size:14px}
ul.chg-list li{padding:3px 0}
ul.chg-list a{color:var(--accent);text-decoration:none}ul.chg-list a:hover{text-decoration:underline}
.chg-kind{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;border-radius:4px;padding:1px 6px;margin-right:7px;vertical-align:1px}
.chg-kind-added{background:#f0fdf4;color:#166534}
.chg-kind-removed{background:#fff1f2;color:#991b1b}
ul.chg-other{font-size:13.5px;color:var(--muted);margin:4px 0 0;padding-left:22px}
</style>`;

  const body = `${CHG_STYLE}<nav class="crumbs"><a href="/?home=1">AcqVault</a> › What changed</nav>
<h1>What changed</h1>
<p class="lede">AcqVault re-indexes its sources monthly and logs exactly which sections changed. This is that log — cite it when you need to show a regulation moved under you. Section links open the current full text; always verify against the signed deviations and <a href="https://www.acquisition.gov/far-overhaul" rel="noopener">acquisition.gov</a> before relying on a result in a contract file.</p>
${runHtml}`;

  return shell({ title, description, canonical, jsonld, body });
}

// ── /study — the client-side drill room (Basic/Advanced tracks; assets/study.js does the work) ──
function renderStudyPage() {
  const canonical = `${SITE}/study`;
  const title = 'AcqVault Study — drills & spaced review for the acquisition community | AcqVault';
  const description = esc('Free, no-login study drills for contracting professionals: spaced-repetition knowledge checks from the AcqVault Field Guides, rapid threshold sprints, and board-style scenario simulations with follow-up questions. Works offline. No account needed.');

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'WebApplication',
    name: 'AcqVault Study', applicationCategory: 'EducationalApplication',
    operatingSystem: 'Any', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    description, url: canonical,
    isPartOf: { '@type': 'WebSite', name: 'AcqVault', url: SITE }
  };

  const STUDY_CSS = `<style>
.lband--room{position:relative;overflow:hidden;background:var(--off);border-top:1px solid rgba(135,101,28,.16)}
.st-guilloche{position:absolute;right:-150px;top:-120px;width:520px;height:520px;opacity:.06;pointer-events:none;-webkit-mask-image:radial-gradient(circle at 50% 50%,#000 38%,transparent 72%);mask-image:radial-gradient(circle at 50% 50%,#000 38%,transparent 72%)}
.st-guilloche svg{width:100%;height:100%}
.st-wrap{position:relative;max-width:880px;margin:0 auto;padding:38px 24px 74px}
#study-app{min-height:420px}
.st-h2{font-family:var(--serif);font-size:24px;color:var(--ink);letter-spacing:-.012em;margin:30px 0 4px}
.st-sub{color:var(--muted);font-size:14px;margin:0 0 14px;line-height:1.55}
.st-head{display:flex;justify-content:flex-end;margin:0 0 12px}
.st-track-chip{font-size:12.5px;font-weight:700;color:var(--brass-ink);background:#f6efdd;border:1px solid rgba(135,101,28,.28);border-radius:999px;padding:5px 12px}
.st-link{background:none;border:none;color:var(--brass-ink);text-decoration:underline;cursor:pointer;font-size:12.5px;padding:0}
.st-tracks{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
@media(max-width:640px){.st-tracks{grid-template-columns:1fr}}
.st-trackcard{display:flex;gap:0;align-items:stretch;text-align:left;background:#fff;border:1px solid var(--line2);border-radius:14px;padding:0;overflow:hidden;cursor:pointer;transition:box-shadow .15s,transform .15s,border-color .15s;box-shadow:0 14px 34px -24px rgba(15,37,64,.35)}
.st-trackcard:hover{border-color:rgba(135,101,28,.5);box-shadow:0 20px 40px -20px rgba(15,37,64,.4);transform:translateY(-2px)}
.st-tcover{flex:none;width:88px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;background:linear-gradient(165deg,#173a60,#0f2540 62%,#0a1c33);border-right:1px solid rgba(228,196,119,.35)}
.st-tcover svg{width:34px;height:34px}
.st-tcover-vol{font-family:var(--serif);font-weight:700;font-size:15px;color:#e4c477;letter-spacing:.04em}
.st-tc-body{padding:17px 18px 15px}
.st-tc-kicker{display:block;font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--brass);margin-bottom:5px}
.st-trackcard b{font-family:var(--serif);font-size:19px;letter-spacing:-.01em;color:var(--ink)}
.st-trackcard p{color:var(--muted);font-size:13.5px;line-height:1.55;margin:7px 0 0}
.st-daily{position:relative;overflow:hidden;display:block;width:100%;text-align:left;background:linear-gradient(158deg,#173a60,#0f2540 62%,#0a1c33);border:1px solid rgba(228,196,119,.4);border-radius:16px;padding:22px 24px 20px;cursor:pointer;transition:border-color .15s,transform .15s,box-shadow .2s;box-shadow:0 22px 44px -22px rgba(15,37,64,.55)}
.st-daily::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--brass-deep),var(--brass-bright) 50%,var(--brass-deep))}
.st-daily::after{content:"";position:absolute;right:-60px;bottom:-140px;width:340px;height:340px;opacity:.12;background:repeating-radial-gradient(circle at 50% 50%,rgba(228,196,119,.6) 0 1px,transparent 1px 12px);pointer-events:none}
.st-daily:hover{border-color:rgba(228,196,119,.7);transform:translateY(-2px)}
.st-daily-eyebrow{display:flex;align-items:center;gap:8px;font-size:10.5px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--brass-bright);margin-bottom:10px}
.st-daily-eyebrow::before{content:"";width:16px;height:2px;background:var(--brass-bright);border-radius:2px}
.st-daily-row{position:relative;display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
.st-daily-num{font-family:var(--serif);font-weight:700;font-size:52px;line-height:.95;color:#f4f8fc;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.st-daily-what{font-size:15px;font-weight:700;color:#f4f8fc}
.st-daily-sub{position:relative;display:block;color:rgba(221,233,246,.75);font-size:13px;line-height:1.5;margin-top:8px;max-width:52ch}
.st-daily-go{position:absolute;right:22px;top:50%;transform:translateY(-50%);font-size:22px;color:var(--brass-bright);transition:transform .15s}
.st-daily:hover .st-daily-go{transform:translateY(-50%) translateX(4px)}
.st-modes{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:12px 0 8px}
.st-mode{text-align:left;background:#fff;border:1px solid var(--line2);border-radius:12px;padding:15px 16px;cursor:pointer;transition:border-color .15s,box-shadow .15s,transform .15s;box-shadow:0 10px 26px -22px rgba(15,37,64,.4)}
.st-mode:hover{border-color:rgba(135,101,28,.5);box-shadow:0 14px 30px -18px rgba(15,37,64,.35);transform:translateY(-2px)}
.st-mode b{display:flex;align-items:center;font-size:15.5px;color:var(--ink);letter-spacing:-.01em}
.st-mode span{display:block;color:var(--muted);font-size:12.5px;margin-top:6px;line-height:1.45}
.st-mode-ic{display:inline-flex;flex:none;width:28px;height:28px;border-radius:8px;background:#f6efdd;color:#87651c;align-items:center;justify-content:center;margin-right:9px}
.st-mode-ic svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.st-ready-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:30px 0 4px}
.st-ready-head .st-h2{margin:0}
.st-overall{font-size:13px;font-weight:800;color:var(--brass-ink);font-variant-numeric:tabular-nums;white-space:nowrap}
.st-topics{display:grid;grid-template-columns:1fr 1fr;gap:8px}
@media(max-width:760px){.st-topics{grid-template-columns:1fr}}
.st-topic{display:grid;grid-template-columns:1fr auto;grid-template-areas:"name name" "bar meta";gap:6px 10px;align-items:center;text-align:left;background:#fff;border:1px solid var(--line2);border-radius:10px;padding:11px 14px;cursor:pointer;min-height:44px;transition:border-color .13s,transform .13s,box-shadow .13s}
.st-topic:hover{border-color:rgba(135,101,28,.5);transform:translateY(-1px);box-shadow:0 8px 20px -14px rgba(15,37,64,.3)}
.st-topic-name{grid-area:name;font-size:13px;font-weight:700;color:var(--ink);line-height:1.3}
.st-bar{grid-area:bar;height:7px;background:#ece8dd;border-radius:99px;overflow:hidden}
.st-bar-fill{display:block;height:100%;background:linear-gradient(90deg,#6f521a,#b8934a);border-radius:99px}
.st-topic-meta{grid-area:meta}
.st-topic-meta{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.st-topic-meta .st-due{color:var(--brass-ink);font-weight:700}
.st-btn:focus-visible,.st-topic:focus-visible,.st-mode:focus-visible,.st-trackcard:focus-visible{outline:3px solid rgba(135,101,28,.4);outline-offset:2px}
.st-session-head{display:flex;justify-content:space-between;font-size:12.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--brass-ink);margin:4px 0 8px}
.st-prog{height:5px;background:#ece8dd;border-radius:99px;overflow:hidden;margin:0 0 14px}
.st-prog span{display:block;height:100%;background:linear-gradient(90deg,#6f521a,#b8934a);border-radius:99px;transition:width .3s ease}
.st-prog-lg{height:8px;margin:14px 0 10px}
.st-card{position:relative;overflow:hidden;background:#fff;border:1px solid var(--line2);border-radius:16px;padding:26px 28px;box-shadow:0 24px 48px -26px rgba(15,37,64,.35)}
.st-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--brass-deep),var(--brass-bright) 50%,var(--brass-deep))}
@media(max-width:640px){.st-card{padding:20px 18px}}
.st-chip{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--brass-ink);background:#f6efdd;border-radius:4px;padding:2px 8px;margin-bottom:12px}
.st-q{font-family:var(--serif);font-size:23px;line-height:1.32;color:var(--ink);letter-spacing:-.008em}
.st-a{margin-top:16px;padding-top:14px;border-top:1px dashed rgba(135,101,28,.4);font-size:15.5px;line-height:1.6;color:#2a3140}
.st-actions{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap}
.st-btn{border:none;border-radius:9px;padding:11px 18px;font-size:14.5px;font-weight:700;cursor:pointer;min-height:44px}
.st-btn kbd{font-family:ui-monospace,Menlo,monospace;font-size:10.5px;opacity:.65;font-weight:600;margin-left:5px;border:1px solid currentColor;border-radius:3px;padding:0 4px}
.st-btn-reveal{background:linear-gradient(158deg,#173a60,#0f2540 70%);color:#f4f8fc}
.st-g1{background:#fdf0ef;color:#8c2b23;border:1px solid rgba(179,38,30,.3)}
.st-g2{background:#f6efdd;color:#5e4715;border:1px solid rgba(135,101,28,.3)}
.st-g3{background:#eef7f0;color:#155433;border:1px solid rgba(30,107,67,.3)}
.st-quit{display:block;margin:16px auto 0}
.st-summary{text-align:center;padding:34px 28px}
.st-summary .st-q{font-size:24px}
.st-summary .st-actions{justify-content:center}
.st-summary .st-sub{max-width:46ch;margin:6px auto 0}
.st-sum-num{font-family:var(--serif);font-size:56px;color:var(--ink);letter-spacing:-.02em;line-height:1;margin:10px 0 4px}
.st-sum-num span{font-family:Inter,system-ui,sans-serif;font-size:17px;color:var(--muted);letter-spacing:0;font-weight:600}
.st-summary .st-prog-lg{max-width:340px;margin:16px auto 12px}
.st-scenario{background:linear-gradient(158deg,#173a60,#0f2540 70%);color:#dde9f6;border-left:3px solid #e4c477;border-radius:10px;padding:16px 18px;font-size:15px;line-height:1.6}
.st-scen-eyebrow{font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#e4c477;margin-bottom:8px}
.st-panel-ask{margin-top:12px;background:#f6efdd;border:1px solid rgba(135,101,28,.3);border-left:3px solid var(--brass);border-radius:0 10px 10px 0;padding:12px 15px;font-size:15px;line-height:1.55;color:#2a3140;font-weight:600}
.st-ask-kicker{display:block;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--brass-ink);margin-bottom:5px}
.st-script{margin-top:16px;background:linear-gradient(158deg,#173a60,#0f2540 70%);border-left:3px solid #e4c477;border-radius:0 12px 12px 0;padding:16px 18px}
.st-script-head{font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#e4c477;margin-bottom:8px}
.st-script p{margin:0;font-size:14.5px;line-height:1.68;color:#dde9f6}
.st-fu-debrief{margin-top:14px;background:var(--off,#f7f6f2);border-left:3px solid rgba(228,196,119,.9);border-radius:0 8px 8px 0;padding:13px 15px}
.st-fu-debrief-head{font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--brass-ink);margin-bottom:6px}
.st-fu-debrief p{margin:0;font-size:14px;line-height:1.6;color:#3d444d}
.st-scenario-sm{font-size:13px;opacity:.92;margin-bottom:14px}
.st-outloud{color:var(--brass-ink);font-size:13.5px;font-style:italic;margin:14px 0 0}
.st-fact{border-left:3px solid rgba(228,196,119,.9);padding:7px 0 7px 12px;margin:10px 0;font-size:14px;line-height:1.55}
.st-fact b{color:var(--ink)}
.st-fact>div{color:#3d444d;margin-top:2px}
.st-bait{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#8c2b23;background:#fdf0ef;border-radius:3px;padding:1px 6px;margin-left:6px}
.st-gov{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#155433;background:#eef7f0;border-radius:3px;padding:1px 6px;margin-left:6px}
.st-boardans{background:var(--off,#f7f6f2);border-radius:8px;padding:12px 14px;font-size:14px;line-height:1.6;margin-top:12px}
.st-followup{margin:6px 0 0}
.st-followup>span{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--brass)}
.st-foot-tools{margin-top:26px;font-size:12.5px;color:var(--muted)}
.st-trackcard{position:relative}
.st-trackcard-active{border-color:rgba(135,101,28,.55);box-shadow:0 16px 34px -18px rgba(15,37,64,.4)}
.st-tc-continue{position:absolute;top:10px;right:12px;z-index:1;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#5e4715;background:#f6efdd;border:1px solid rgba(135,101,28,.4);border-radius:999px;padding:2px 9px}
.st-opts{display:flex;flex-direction:column;gap:8px;margin-top:18px}
.st-opt{display:flex;align-items:baseline;gap:10px;text-align:left;background:#fff;border:1px solid var(--line2);border-radius:9px;padding:11px 14px;font-size:14.5px;line-height:1.5;color:#2a3140;cursor:pointer;min-height:44px;transition:border-color .12s,transform .12s,box-shadow .12s}
.st-opt:hover:not(:disabled){border-color:rgba(135,101,28,.5);transform:translateY(-1px);box-shadow:0 8px 18px -12px rgba(15,37,64,.3)}
.st-opt:focus-visible{outline:3px solid rgba(135,101,28,.4);outline-offset:2px}
.st-opt kbd{flex:none;font-family:ui-monospace,Menlo,monospace;font-size:10.5px;color:var(--muted);border:1px solid var(--line2);border-radius:4px;padding:1px 6px;min-width:20px;text-align:center;transition:background .12s,color .12s}
.st-opt:disabled{cursor:default;opacity:.7}
.st-opt-right{border-color:#1e6b43!important;background:#eef7f0;opacity:1!important;box-shadow:0 0 0 1px #1e6b43 inset}
.st-opt-right kbd{background:#1e6b43;border-color:#1e6b43;color:#fff}
.st-opt-wrong{border-color:#b3261e!important;background:#fdf0ef;opacity:1!important}
.st-opt-wrong kbd{background:#b3261e;border-color:#b3261e;color:#fff}
.st-explain{margin-top:16px;background:var(--off,#f7f6f2);border-left:3px solid rgba(228,196,119,.9);border-radius:0 8px 8px 0;padding:13px 15px}
.st-explain p{font-size:14px;line-height:1.6;color:#3d444d;margin:0}
.st-verdict{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;margin-bottom:7px}
.st-verdict-right{color:#155433}
.st-verdict-wrong{color:#8c2b23}
.st-explain-ref{margin-top:9px;padding-top:8px;border-top:1px dashed rgba(135,101,28,.35);font-size:12.5px;color:var(--muted)}
.st-explain-ref b{color:var(--brass-ink);font-weight:700}
.st-walk{margin-top:18px;background:var(--off,#f7f6f2);border:1px solid rgba(135,101,28,.22);border-radius:10px;padding:16px 18px}
.st-walk-head{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--brass-ink);margin-bottom:10px}
.st-walk-head::before{content:"";display:inline-block;width:16px;height:2px;background:var(--brass);border-radius:2px;margin-right:8px;vertical-align:3px}
.st-walk ol{margin:0;padding:0;list-style:none;counter-reset:walk}
.st-walk ol>li{counter-increment:walk;position:relative;padding:0 0 12px 34px;font-size:14px;line-height:1.6;color:#3d444d}
.st-walk ol>li:last-child{padding-bottom:0}
.st-walk ol>li::before{content:counter(walk);position:absolute;left:0;top:1px;width:22px;height:22px;border-radius:50%;background:linear-gradient(158deg,#173a60,#0f2540);color:#e4c477;font-size:11.5px;font-weight:800;display:flex;align-items:center;justify-content:center;font-variant-numeric:tabular-nums}
.st-walk ol>li b{color:var(--ink)}
.st-walk ul{margin:7px 0 0;padding-left:18px}
.st-walk ul li{font-size:13.5px;line-height:1.55;color:#3d444d;padding:2px 0}
.st-btn-hint{background:#f6efdd;color:#5e4715;border:1px solid rgba(135,101,28,.35)}
.st-btn-hint:disabled{opacity:.55;cursor:default}
.st-hint-n{display:inline-block;background:#5e4715;color:#f6efdd;border-radius:999px;font-size:11px;padding:0 7px;margin-left:4px;font-variant-numeric:tabular-nums}
.st-hint{background:var(--off,#f7f6f2);border-left:3px solid rgba(228,196,119,.9);border-radius:0 6px 6px 0;padding:9px 12px;font-size:13.5px;line-height:1.55;color:#3d444d;margin-top:10px}
.st-hint b{color:var(--brass-ink)}
.st-cites{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:10px}
.st-cites-lab{font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.st-cite{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:700;color:var(--brass-ink);background:#fff;border:1px solid rgba(135,101,28,.4);border-radius:999px;padding:4px 11px;text-decoration:none;transition:background .13s,border-color .13s,transform .13s}
.st-cite svg{width:9px;height:9px;opacity:.7}
.st-cite:hover{background:#f6efdd;border-color:rgba(135,101,28,.65);transform:translateY(-1px)}
.st-cite:focus-visible{outline:3px solid rgba(135,101,28,.4);outline-offset:2px}
.st-streak{display:inline-flex;align-items:center;gap:6px;margin-right:auto;font-size:12.5px;font-weight:800;color:var(--brass-ink);background:linear-gradient(158deg,#f6efdd,#f1e5c6);border:1px solid rgba(135,101,28,.35);border-radius:999px;padding:5px 12px;font-variant-numeric:tabular-nums}
.st-streak svg{width:12px;height:12px;fill:var(--brass)}
@keyframes st-right-pulse{0%{box-shadow:0 0 0 1px #1e6b43 inset,0 0 0 0 rgba(30,107,67,.35)}100%{box-shadow:0 0 0 1px #1e6b43 inset,0 0 0 9px rgba(30,107,67,0)}}
.st-opt-right{animation:st-right-pulse .5s ease-out 1}
@keyframes st-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
/* games hub: third track card + level toggle */
.st-games-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.st-games-head .st-streak{margin:26px 0 0}




/* hub v3: status cards + done panel */
.st-hub-done{display:flex;gap:14px;align-items:flex-start;background:linear-gradient(158deg,#173a60,#0f2540 62%,#0a1c33);border:1px solid rgba(228,196,119,.45);border-radius:14px;padding:16px 20px;margin:0 0 14px;box-shadow:0 18px 38px -22px rgba(15,37,64,.55)}
.st-hub-done-mark{flex:none;width:34px;height:34px;border-radius:50%;background:#1e6b43;color:#fff;font-size:17px;font-weight:800;display:flex;align-items:center;justify-content:center}
.st-hub-done b{display:block;font-family:var(--serif);font-size:17px;color:#f4f8fc;margin-bottom:3px}
.st-hub-done span{display:block;font-size:13px;line-height:1.55;color:rgba(221,233,246,.78);font-variant-numeric:tabular-nums}
.st-plate-done{border-color:rgba(30,107,67,.65)}
.st-plate-done::before{background:linear-gradient(90deg,#155433,#1e6b43 50%,#155433)}
.st-plate-played .st-plate-eyebrow{color:#9fd4b4}
.st-hub-grid{display:flex;flex-direction:column;gap:2px}
.st-hub-gridrow{display:flex;gap:2px}
.st-hub-cell{width:13px;height:13px;border-radius:2.5px;background:rgba(244,248,252,.14)}
.st-hub-cell-c{background:#1e6b43}
.st-hub-cell-p{background:#e4c477}
.st-hub-cell-a{background:rgba(244,248,252,.22)}
/* quick rounds: game plates */
.st-plates{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:12px 0 8px}
@media(max-width:640px){.st-plates{grid-template-columns:1fr}}
.st-plate{position:relative;overflow:hidden;text-align:left;background:linear-gradient(158deg,#173a60,#0f2540 62%,#0a1c33);border:1px solid rgba(228,196,119,.4);border-radius:14px;padding:18px 20px 16px;cursor:pointer;transition:border-color .15s,transform .15s,box-shadow .2s;box-shadow:0 18px 38px -22px rgba(15,37,64,.55)}
.st-plate::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--brass-deep),var(--brass-bright) 50%,var(--brass-deep))}
.st-plate:hover{border-color:rgba(228,196,119,.75);transform:translateY(-2px)}
.st-plate:focus-visible{outline:3px solid rgba(228,196,119,.55);outline-offset:2px}
.st-plate-eyebrow{display:block;font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--brass-bright);margin-bottom:11px}
.st-plate b{display:block;font-family:var(--serif);font-size:20px;letter-spacing:-.01em;color:#f4f8fc;margin:11px 0 5px}
.st-plate-sub{display:block;font-size:12.5px;line-height:1.5;color:rgba(221,233,246,.72)}
.st-plate-meta{display:block;margin-top:11px;padding-top:9px;border-top:1px solid rgba(228,196,119,.22);font-size:11.5px;font-weight:700;color:var(--brass-bright);font-variant-numeric:tabular-nums}
.st-plate-art{display:flex;gap:4px}
.st-mini-tile{width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#f4f8fc;background:rgba(244,248,252,.08);border:1px solid rgba(244,248,252,.25);border-radius:5px}
.st-mini-hit{background:#1e6b43;border-color:#1e6b43}
.st-mini-near{background:#c9a44c;border-color:#c9a44c;color:#0f2540}
.st-plate-art-ring{position:relative;width:46px;height:46px}
.st-plate-art-ring svg{width:46px;height:46px}
.st-plate-ring-n{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#f4f8fc;font-variant-numeric:tabular-nums}
/* The Combination */
.st-cb-card{padding:22px 18px 18px}
.st-cb-board{display:flex;flex-direction:column;gap:6px;align-items:center}
.st-cb-row{display:flex;gap:6px}
.st-cb-row-shake{animation:st-shake .3s ease-in-out 1}
.st-cb-tile{width:clamp(46px,11vw,58px);height:clamp(46px,11vw,58px);display:flex;align-items:center;justify-content:center;font-family:var(--serif);font-size:clamp(22px,5vw,27px);font-weight:700;color:var(--ink);background:#fff;border:2px solid var(--line2);border-radius:8px;transition:transform .16s,background .16s,border-color .16s,color .16s}
.st-cb-fill{border-color:rgba(23,58,96,.55);transform:scale(1.04)}
.st-cb-flip{animation:st-cb-flip .34s ease-in-out 1}
@keyframes st-cb-flip{0%{transform:rotateX(0)}50%{transform:rotateX(88deg)}100%{transform:rotateX(0)}}
.st-cb-c{background:#1e6b43;border-color:#1e6b43;color:#fff}
.st-cb-p{background:#e4c477;border-color:#c9a44c;color:#3b2f10}
.st-cb-a{background:#565e6b;border-color:#565e6b;color:#eef1f5}
.st-cb-cat{display:flex;align-items:center;justify-content:center;gap:9px;margin:0 auto 10px;font-family:var(--serif);font-size:17px;font-weight:600;color:var(--ink);text-align:center}
.st-cb-cat span{font-family:'Inter',sans-serif;font-size:9.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#fff;background:linear-gradient(158deg,#173a60,#0f2540);border-radius:999px;padding:4px 10px}
.st-cb-prompt{text-align:center;font-size:12.5px;color:var(--muted);margin:0 0 12px;line-height:1.5}
.st-cb-prompt b{color:var(--ink);font-weight:700}
.st-cb-legend{display:flex;justify-content:center;gap:16px;flex-wrap:wrap;margin:12px 0 2px}
.st-cb-legend span{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:var(--muted)}
.st-cb-legend .st-cb-tile{width:15px;height:15px;border-radius:3.5px;border-width:1px;font-size:0;transition:none}
.st-cb-msg{min-height:20px;text-align:center;font-size:13px;font-weight:700;color:var(--brass-ink);margin:8px 0 2px}
.st-cb-kb{display:flex;flex-direction:column;gap:6px;margin-top:6px}
.st-cb-kbrow{display:flex;gap:5px;justify-content:center}
.st-cb-key{min-width:clamp(26px,7.6vw,40px);height:50px;padding:0 6px;display:flex;align-items:center;justify-content:center;font-size:13.5px;font-weight:700;color:var(--ink);background:var(--off,#f7f6f2);border:1px solid var(--line2);border-radius:7px;cursor:pointer;transition:background .12s,color .12s,border-color .12s;text-transform:uppercase}
.st-cb-key:active{transform:translateY(1px)}
.st-cb-key-wide{min-width:clamp(44px,12vw,62px);font-size:11px}
.st-cb-key-c{background:#1e6b43;border-color:#1e6b43;color:#fff}
.st-cb-key-p{background:#e4c477;border-color:#c9a44c;color:#3b2f10}
.st-cb-key-a{background:#565e6b;border-color:#565e6b;color:#eef1f5}
.st-cb-result{text-align:center;padding:6px 4px}
.st-cb-dial{width:74px;height:74px;margin:0 auto 6px;color:var(--brass)}
.st-cb-dial svg{width:100%;height:100%}
.st-cb-dial-spin{animation:st-cb-spin 1.4s cubic-bezier(0.55,0.15,0.45,0.85) 1}
@keyframes st-cb-spin{0%{transform:rotate(0)}100%{transform:rotate(720deg)}}
.st-cb-verdict{font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--brass-ink)}
.st-cb-word{font-family:var(--serif);font-size:44px;font-weight:700;letter-spacing:.14em;color:var(--ink);margin:2px 0 6px}
.st-cb-def{max-width:46ch;margin:0 auto 10px;font-size:14.5px;line-height:1.6;color:#3d444d}
.st-cb-result .st-explain-ref{border-top:none;padding-top:0}
.st-cb-result .st-cites{justify-content:center}
.st-cb-streakline{margin-top:12px;font-size:13px;font-weight:700;color:var(--brass-ink)}
.st-cb-hist{max-width:300px;margin:14px auto 0;display:grid;gap:4px}
.st-cb-hrow{display:flex;align-items:center;gap:8px;font-size:11.5px;font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums}
.st-cb-hbar{flex:1;height:16px;background:#ece8dd;border-radius:4px;overflow:hidden}
.st-cb-hbar span{display:flex;align-items:center;justify-content:flex-end;padding-right:6px;height:100%;min-width:16px;background:#9aa3ad;border-radius:4px;color:#fff;font-size:10.5px}
.st-cb-hbar span.st-cb-hbar-me{background:linear-gradient(90deg,#6f521a,#b8934a)}
/* Combination: today's board (result view) */
.st-cb-board-mod{max-width:330px;margin:16px auto 0}
.st-lb-head{font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--brass-ink);text-align:center;margin-bottom:8px}
.st-lb-list{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.st-lb-list li{display:flex;align-items:baseline;gap:9px;padding:6px 11px;background:var(--off,#f7f6f2);border-radius:7px;font-size:13px;color:#2a3140}
.st-lb-list li.st-lb-me{background:#f6efdd;box-shadow:0 0 0 1px rgba(135,101,28,.35) inset}
.st-lb-rank{flex:none;width:18px;font-weight:800;color:var(--brass-ink);font-variant-numeric:tabular-nums}
.st-lb-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.st-lb-g{flex:none;font-weight:800;color:#155433;font-variant-numeric:tabular-nums}
.st-lb-post{display:flex;gap:8px;margin-top:10px}
.st-lb-post input{flex:1;min-width:0;border:1px solid var(--line2);border-radius:8px;padding:9px 12px;font-size:13.5px;font-family:inherit;color:var(--ink)}
.st-lb-post input:focus-visible{outline:3px solid rgba(135,101,28,.4);outline-offset:1px}
.st-lb-post .st-btn{white-space:nowrap;min-height:0;padding:9px 14px;font-size:13px}
/* Which Part Governs */
.st-gv-head{display:flex;justify-content:space-between;align-items:center;margin:2px 0 12px}
.st-gv-score{display:flex;align-items:baseline;gap:10px}
.st-gv-score b{font-family:var(--serif);font-size:34px;letter-spacing:-.02em;color:var(--ink);font-variant-numeric:tabular-nums}
.st-gv-combo{font-size:13px;font-weight:800;color:var(--muted);font-variant-numeric:tabular-nums;transition:color .15s,transform .15s}
.st-gv-combo-hot{color:var(--brass-ink);transform:scale(1.12)}
.st-gv-ring{position:relative;width:58px;height:58px;flex:none}
.st-gv-ring svg{width:58px;height:58px}
.st-gv-ring b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums}
#gv-arc{transition:stroke-dashoffset .12s linear,stroke .4s}
.st-gv-ring-low #gv-arc{stroke:#87651c}
.st-gv-ring-crit #gv-arc{stroke:#b3261e}
.st-gv-ring-crit b{color:#8c2b23}
@keyframes st-gv-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
.st-gv-ring-crit{animation:st-gv-pulse .9s ease-in-out infinite}
.st-gv-card{padding:22px 24px 20px}
.st-gv-card-hit{border-color:#1e6b43;box-shadow:0 0 0 1px #1e6b43 inset,0 24px 48px -26px rgba(15,37,64,.35)}
.st-gv-kicker{font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--brass);margin-bottom:8px}
.st-gv-q{font-family:var(--serif);font-size:21px;line-height:1.35;color:var(--ink);letter-spacing:-.008em;min-height:58px}
.st-gv-opts{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:16px}
@media(max-width:480px){.st-gv-opts{grid-template-columns:1fr}}
.st-gv-opt{text-align:left;background:#fff;border:1px solid var(--line2);border-radius:10px;padding:12px 14px;cursor:pointer;min-height:60px;transition:border-color .12s,transform .12s,box-shadow .12s}
.st-gv-opt:hover:not(:disabled){border-color:rgba(135,101,28,.5);transform:translateY(-1px);box-shadow:0 8px 18px -12px rgba(15,37,64,.3)}
.st-gv-opt:focus-visible{outline:3px solid rgba(135,101,28,.4);outline-offset:2px}
.st-gv-opt b{display:block;font-family:var(--serif);font-size:17px;color:var(--ink)}
.st-gv-opt span{display:block;font-size:11.5px;color:var(--muted);margin-top:2px}
.st-gv-opt:disabled{cursor:default;opacity:.75}
.st-gv-opt-right{border-color:#1e6b43!important;background:#eef7f0;opacity:1!important;box-shadow:0 0 0 1px #1e6b43 inset}
.st-gv-opt-wrong{border-color:#b3261e!important;background:#fdf0ef;opacity:1!important;animation:st-shake .3s ease-in-out 1}
.st-gv-tier{font-family:var(--serif);font-size:19px;color:var(--brass-ink);margin:2px 0 8px}
.st-gv-end .st-sum-num{font-size:62px}
.st-gv-misslist{max-width:520px;margin:14px auto 4px;text-align:left}
.st-gv-miss{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px dashed rgba(135,101,28,.25);font-size:13px;line-height:1.45;color:#3d444d}
.st-gv-miss:last-child{border-bottom:none}
.st-gv-miss .st-cite{flex:none}
/* Combination help + keys */
.st-cb-helpbtn{font-size:11.5px;text-transform:none;letter-spacing:0}
.st-cb-help{max-width:430px;margin:0 auto;padding:4px 2px}
.st-cb-help-head{font-family:var(--serif);font-size:21px;color:var(--ink);letter-spacing:-.01em;margin-bottom:8px;text-align:center}
.st-cb-help p{font-size:14px;line-height:1.6;color:#3d444d;margin:.5em 0}
.st-cb-help-row{display:flex;align-items:center;gap:4px;margin:10px 0}
.st-cb-help-row>span:last-child{margin-left:9px;font-size:12.5px;line-height:1.45;color:#3d444d}
.st-cb-tile-ex{width:34px;height:34px;font-size:17px;flex:none}
.st-cb-key-enter{font-size:11.5px;letter-spacing:.04em}
.st-cb-key-back{background:#f6efdd;border-color:rgba(135,101,28,.4);color:#5e4715}
.st-cb-key-back svg{width:22px;height:22px}
/* Governs: intro, docket, pips, float, seal */
.st-gv-intro{padding:26px 24px 22px}
.st-gv-intro-ring{display:flex;justify-content:center;margin-bottom:10px}
.st-gv-intro .st-chip{display:block;width:max-content;margin:0 auto 4px}
.st-gv-rules{display:grid;gap:8px;max-width:380px;margin:16px auto 6px}
.st-gv-rules span{position:relative;padding-left:22px;font-size:13.5px;line-height:1.5;color:#3d444d}
.st-gv-rules span::before{content:"";position:absolute;left:2px;top:7px;width:9px;height:9px;border-radius:50%;background:linear-gradient(135deg,#b8934a,#87651c)}
.st-gv-rules b{color:var(--ink)}
.st-gv-start{font-size:15.5px;padding:13px 26px}
.st-gv-docket{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px dashed rgba(135,101,28,.35);padding-bottom:8px;margin-bottom:12px}
.st-gv-stampline{font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#8c2b23;border:1.5px solid rgba(179,38,30,.55);border-radius:3px;padding:2px 7px;transform:rotate(1.6deg)}
.st-gv-card{background:linear-gradient(180deg,#fffdf7,#fbf7ec);border-color:rgba(135,101,28,.3)}
.st-gv-card::before{background:linear-gradient(90deg,#6f521a,#b8934a 50%,#6f521a)}
.st-gv-card-in{animation:st-gv-in .2s ease-out 1}
@keyframes st-gv-in{0%{opacity:0;transform:translateY(9px)}100%{opacity:1;transform:none}}
.st-gv-pips{display:inline-flex;align-items:center;gap:3px;margin-left:2px}
.st-gv-pip{width:9px;height:16px;border-radius:3px;background:#ece8dd;transition:background .15s,transform .15s}
.st-gv-pip-on{background:linear-gradient(180deg,#b8934a,#87651c)}
.st-gv-pips-hot .st-gv-pip-on{box-shadow:0 0 7px rgba(228,196,119,.8)}
.st-gv-pips b{margin-left:5px;font-size:12.5px;font-weight:800;color:var(--brass-ink);font-variant-numeric:tabular-nums}
.st-gv-float{position:fixed;z-index:900;transform:translateX(-50%);font-family:var(--serif);font-size:19px;font-weight:700;color:#1e6b43;pointer-events:none;animation:st-gv-float .85s ease-out forwards}
@keyframes st-gv-float{0%{opacity:0;transform:translateX(-50%) translateY(4px)}18%{opacity:1}100%{opacity:0;transform:translateX(-50%) translateY(-30px)}}
.st-gv-seal{width:86px;height:86px;margin:6px auto 2px}
.st-gv-seal svg{width:100%;height:100%;filter:drop-shadow(0 6px 12px rgba(111,82,26,.35))}
.st-gv-seal-stamp{animation:st-gv-stamp .5s cubic-bezier(.2,1.6,.35,1) 1}
@keyframes st-gv-stamp{0%{opacity:0;transform:scale(1.7) rotate(-7deg)}60%{opacity:1;transform:scale(.96) rotate(1deg)}100%{transform:scale(1) rotate(0)}}
@media(prefers-reduced-motion:reduce){.st-opt-right,.st-gv-opt-wrong,.st-cb-row-shake,.st-cb-flip,.st-cb-dial-spin,.st-gv-ring-crit,.st-gv-card-in,.st-gv-float,.st-gv-seal-stamp{animation:none}}
.st-rungs{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}
@media(max-width:560px){.st-rungs{grid-template-columns:1fr 1fr}}
@media(max-width:360px){.st-rungs{grid-template-columns:1fr}}
.st-rung{text-align:left;background:#fff;border:1px solid var(--line2);border-left:3px solid transparent;border-radius:10px;padding:12px 14px;min-height:44px;font-size:14px;font-weight:700;color:#2a3140;cursor:pointer;font-variant-numeric:tabular-nums;transition:border-color .13s}
.st-rung:hover{border-color:var(--line);border-left-width:3px}
.st-rung:focus-visible{outline:3px solid rgba(135,101,28,.4);outline-offset:2px}
.st-rung-on,.st-rung-on:hover{border-left-color:var(--brass);color:var(--ink)}
.st-lad-count{color:var(--muted);font-size:13px;margin:10px 0 0;font-variant-numeric:tabular-nums}
.st-lad-ready{display:flex;align-items:center;gap:10px;max-width:440px;margin:16px 0 0}
.st-lad-ready .st-bar{flex:1}
.st-lad-ready-lab{flex:none;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.st-lad-quote{margin-top:14px;border-left:3px solid var(--brass);padding:2px 0 2px 14px;font-size:14.5px;line-height:1.65;color:#3d444d}
.st-lad-dod{margin-top:10px}.st-lad-dod-tag{display:inline-block;font:700 10px/1.4 var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--ink);opacity:.62;margin-right:6px;vertical-align:1px}.st-lad-quote-link{color:var(--brass-ink);font-weight:700;text-decoration:underline}
.st-lad-sink{margin-top:24px}
.st-lad-head{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--brass-ink);margin-bottom:8px}
.st-lad-sink-item{font-size:14px;line-height:1.6;color:#2a3140;padding:8px 0;border-top:1px solid var(--line2)}
</style>`;

  const BRAND_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="6" y="6" width="88" height="88" rx="16" fill="#0f2540"/><rect x="13" y="13" width="74" height="74" rx="11" fill="none" stroke="rgba(228,196,119,.5)" stroke-width="1.5"/><circle cx="50" cy="50" r="22" fill="none" stroke="#e4c477" stroke-width="3"/><g stroke="#e4c477" stroke-width="3.4" stroke-linecap="round"><line x1="50" y1="32" x2="50" y2="40"/><line x1="50" y1="68" x2="50" y2="60"/><line x1="32" y1="50" x2="40" y2="50"/><line x1="68" y1="50" x2="60" y2="50"/></g><circle cx="50" cy="50" r="5" fill="#e4c477"/></svg>';

  const SEAL_SVG = '<svg class="lib-seal" viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="st-seal-g" cx="36%" cy="30%" r="80%"><stop offset="0" stop-color="#f2d89a"/><stop offset="48%" stop-color="#cda857"/><stop offset="100%" stop-color="#876514"/></radialGradient></defs><circle cx="50" cy="50" r="47" fill="url(#st-seal-g)" stroke="#6f521a" stroke-width="1.5"/><circle cx="50" cy="50" r="42" fill="none" stroke="#6f521a" stroke-width="1" stroke-dasharray="1.2 2.6" opacity="0.55"/><circle cx="50" cy="50" r="22" fill="none" stroke="#16263f" stroke-width="2.4" opacity="0.9"/><g stroke="#16263f" stroke-width="3" stroke-linecap="round" opacity="0.9"><line x1="50" y1="33" x2="50" y2="41"/><line x1="50" y1="67" x2="50" y2="59"/><line x1="33" y1="50" x2="41" y2="50"/><line x1="67" y1="50" x2="59" y2="50"/></g><circle cx="50" cy="50" r="5.5" fill="#16263f" opacity="0.9"/></svg>';

  const body = `${STUDY_CSS}<header class="lnav"><div class="lnav-inner"><a class="brand" href="/?home=1">${BRAND_SVG}AcqVault</a><span class="hdr-links"><a class="hlink" href="/?home=1">Home</a><a class="cta" href="/?q=">Search all sources →</a></span></div></header>
<section class="lband lhero"><div class="lband-inner">
${SEAL_SVG}
<nav class="crumbs"><a href="/?home=1">AcqVault</a> › Study</nav>
<div class="eyebrow">AcqVault · Study</div>
<h1>Drill it until it&rsquo;s reflex</h1>
<p class="lede">Knowledge checks, threshold sprints, and board-style scenario drills built from the AcqVault Field Guides — every debrief links straight to the governing RFO or R-DFARS text, one click away. Spaced repetition decides what you see; you decide how honest your self-grade is.</p>
<div class="stats"><span class="stat"><b>500+</b> drills</span><span class="stat">A daily word · a 90-second round</span><span class="stat">Free · no account</span><span class="stat">Progress stays on your device</span><span class="stat">Works offline</span></div>
</div></section>
<section class="lband lband--room"><div class="st-guilloche" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><g fill="none" stroke="#0f2540" stroke-width="0.6"><circle cx="300" cy="300" r="150"/><circle cx="300" cy="300" r="120"/><circle cx="300" cy="300" r="90"/><circle cx="300" cy="300" r="60"/></g></svg></div><div class="st-wrap">
<div id="study-app"><noscript><p>AcqVault Study is an interactive drill tool and needs JavaScript. The same material lives in the <a href="/library">Field Guides</a>.</p></noscript><p class="st-sub">Loading the deck…</p></div>
</div></section>
<footer class="lband lband--foot"><div class="lband-inner">
<p class="lfoot-note"><strong>How it works:</strong> answer before you reveal — out loud when you can — then grade yourself honestly. Missed cards return sooner; mastered ones stretch out. Every debrief cites where the rule lives and links to the full RFO/R-DFARS text on this site. Your progress lives only in this browser; use Export to move or back it up. Built from <a href="/library">Field Guide Vols. 1 &amp; 2</a>.</p>
<p class="lfoot-legal">AcqVault is an <strong>unofficial research aid</strong> — not legal advice and not an official source. Verify anything you'll rely on against the signed DoD class deviations and the official text at <a href="https://www.acquisition.gov/far-overhaul" rel="noopener">acquisition.gov</a>.</p>
</div></footer>
<script defer src="/assets/study.js?v=31"></script>`;

  return shell({ title, description, canonical, jsonld, body, bleed: true, ogImage: 'og-study-v2.png' });
}

const RFO_FAQ = [
  ['Is the Revolutionary FAR Overhaul the same as the FAR?',
   'Yes — it is the Federal Acquisition Regulation, overhauled. Under Executive Order 14275, "Restoring Common Sense to Federal Procurement," agencies use the revised FAR text published on the Revolutionary FAR Overhaul web page in lieu of the text codified at 48 CFR.'],
  ['What is R-DFARS?',
   'R-DFARS refers to the DoD class deviations that implement the FAR overhaul for the Department of Defense — the deviation-based replacement for the legacy DFARS material. There are 46 such deviations; see the R-DFARS Deviations Index for each one’s effective date and DARS tracking number.'],
  ['When did the FAR overhaul take effect?',
   'For DoD, the class deviations took effect on February 1, February 17, and March 16, 2026, depending on the FAR part. Each signed deviation lists its own effective date.'],
  ['Where is the official Revolutionary FAR Overhaul text?',
   'The authoritative text is published by the government at acquisition.gov/far-overhaul, and the signed DoD class deviations are the controlling implementation for the Department of Defense.'],
  ['Is AcqVault an official source?',
   'No. AcqVault is an unofficial research aid that makes these materials full-text searchable. Always verify against the signed DoD class deviations and acquisition.gov before relying on any result in a contract file.']
];

function renderExplainerPage() {
  const canonical = `${SITE}/what-is-the-rfo`;
  const title = 'What is the Revolutionary FAR Overhaul (RFO)? | AcqVault';
  const description = esc('A plain-English explainer of the Revolutionary FAR Overhaul (RFO): what it is, the executive order behind it, how DoD implements it through R-DFARS class deviations, and when it took effect.');

  const faqHtml = RFO_FAQ.map(([q, a]) =>
    `<section class="sec"><h2>${esc(q)}</h2><p>${esc(a)}</p></section>`).join('\n');

  const jsonld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'Article', headline: 'What is the Revolutionary FAR Overhaul?', description, mainEntityOfPage: canonical,
      isPartOf: { '@type': 'WebSite', name: 'AcqVault', url: SITE } },
    { '@type': 'FAQPage', mainEntity: RFO_FAQ.map(([q, a]) => ({
      '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }
  ]};

  const body = `<nav class="crumbs"><a href="/?home=1">AcqVault</a> › What is the RFO?</nav>
<h1>What is the Revolutionary FAR Overhaul?</h1>
<p class="lede">The <strong>Revolutionary FAR Overhaul (RFO)</strong> is a restructuring of the Federal Acquisition Regulation directed by <strong>Executive Order 14275</strong>, "Restoring Common Sense to Federal Procurement." Agencies use the overhauled FAR text — published on the government’s Revolutionary FAR Overhaul web page — <em>in lieu of</em> the text codified at 48 CFR.</p>
<section class="sec"><h2>How the Department of Defense implements it</h2>
<p>DoD puts the overhaul into effect through signed <strong>class deviations</strong> — the materials AcqVault indexes as <strong>R-DFARS</strong>. There are <strong>46 deviations</strong>, each with its own effective date and DARS tracking number. See the <a href="/deviations">R-DFARS Deviations Index</a> for the full list, or <a href="/r-dfars">browse R-DFARS by part</a>.</p></section>
<section class="sec"><h2>When it took effect</h2>
<p>For DoD, the class deviations became effective on <strong>February 1</strong>, <strong>February 17</strong>, and <strong>March 16, 2026</strong>, depending on the FAR part.</p></section>
<section class="sec"><h2>Where to read it — and search it</h2>
<p>The authoritative sources are the signed DoD class deviations and the official text at <a href="https://www.acquisition.gov/far-overhaul" rel="noopener">acquisition.gov/far-overhaul</a>. AcqVault makes the <a href="/rfo">Revolutionary FAR Overhaul</a>, R-DFARS deviations, the <a href="/far-companion">FAR Companion</a>, and DAF guidance full-text searchable — <a href="/?home=1">start a search</a>.</p></section>
<h2 style="margin-top:32px">Frequently asked questions</h2>
${faqHtml}`;

  return shell({ title, description, canonical, jsonld, body, ogImage: 'og-src-rfo-v2.png' });
}

function renderSitemap() {
  const urls = [`${SITE}/`];
  urls.push(`${SITE}/what-is-the-rfo`);
  if ((loadLibrary().categories || []).some(c => c.items && c.items.length)) urls.push(`${SITE}/library`);
  if (loadDeviations().length) urls.push(`${SITE}/deviations`);
  if (loadChangesLog().length) urls.push(`${SITE}/changes`);
  urls.push(`${SITE}/study`);
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


// Branded 404 — a copy of the static /404.html. The static file covers platform
// 404s (unknown routes); this covers bad source/part params inside the hub/page
// functions. If you edit one, hand-copy the change to the other.
function renderNotFoundPage() {
  return "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n<title>Page not found — AcqVault</title>\n<meta name=\"robots\" content=\"noindex\">\n<link rel=\"icon\" href=\"/assets/favicon-vault.svg\" type=\"image/svg+xml\">\n<style>\n@font-face{font-family:'Source Serif 4';font-style:normal;font-weight:200 900;font-display:swap;src:url(/assets/fonts/source-serif4-latin.woff2) format('woff2');}\n*{box-sizing:border-box;margin:0;padding:0;}\nbody{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;\n  background:radial-gradient(120% 140% at 12% 8%,#1b436b 0%,#123253 42%,#0a1c33 100%);\n  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#eaf1fb;}\n.card{max-width:520px;width:100%;text-align:center;padding:48px 32px;}\n.dial{width:88px;height:88px;margin:0 auto 28px;filter:drop-shadow(0 12px 28px rgba(0,0,0,.4));}\n.eyebrow{font-size:13px;font-weight:800;letter-spacing:.22em;text-transform:uppercase;color:#e4c477;margin-bottom:14px;}\nh1{font-family:'Source Serif 4',Georgia,serif;font-weight:600;font-size:clamp(30px,6vw,42px);line-height:1.05;letter-spacing:-.015em;color:#fff;margin-bottom:14px;}\np{font-size:16px;line-height:1.55;color:rgba(230,238,248,.82);margin-bottom:28px;}\n.actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;}\n.btn{display:inline-block;font-size:14.5px;font-weight:700;text-decoration:none;padding:11px 22px;border-radius:999px;transition:transform .15s,background .15s;}\n.btn:hover{transform:translateY(-1px);}\n.btn-brass{background:#e4c477;color:#0a1c33;}\n.btn-brass:hover{background:#f0d79a;}\n.btn-ghost{color:#eaf1fb;border:1px solid rgba(255,255,255,.22);}\n.btn-ghost:hover{background:rgba(255,255,255,.07);}\n.links{margin-top:26px;font-size:14px;color:rgba(230,238,248,.6);}\n.links a{color:#e4c477;text-decoration:none;margin:0 8px;}\n.links a:hover{text-decoration:underline;}\na:focus-visible,.btn:focus-visible{outline:2px solid #e4c477;outline-offset:3px;}\n</style>\n</head>\n<body>\n<main class=\"card\">\n  <svg class=\"dial\" viewBox=\"0 0 100 100\" aria-hidden=\"true\"><rect x=\"3\" y=\"3\" width=\"94\" height=\"94\" rx=\"20\" fill=\"#0f2540\" stroke=\"#6f521a\" stroke-width=\"1\"/><rect x=\"11\" y=\"11\" width=\"78\" height=\"78\" rx=\"14\" fill=\"none\" stroke=\"#87651c\" stroke-width=\"2\"/><circle cx=\"50\" cy=\"50\" r=\"24\" fill=\"none\" stroke=\"#e4c477\" stroke-width=\"3.5\"/><g stroke=\"#e4c477\" stroke-width=\"4\" stroke-linecap=\"round\"><line x1=\"50\" y1=\"29\" x2=\"50\" y2=\"39\"/><line x1=\"50\" y1=\"71\" x2=\"50\" y2=\"61\"/><line x1=\"29\" y1=\"50\" x2=\"39\" y2=\"50\"/><line x1=\"71\" y1=\"50\" x2=\"61\" y2=\"50\"/></g><circle cx=\"50\" cy=\"50\" r=\"6\" fill=\"#e4c477\"/></svg>\n  <div class=\"eyebrow\">404 · Not found</div>\n  <h1>This one isn&rsquo;t in the vault.</h1>\n  <p>The page you&rsquo;re after doesn&rsquo;t exist — it may have moved when the rulebook did. Search the full text instead, or start from the front door.</p>\n  <div class=\"actions\">\n    <a class=\"btn btn-brass\" href=\"/?q=\">Search the rulebook</a>\n    <a class=\"btn btn-ghost\" href=\"/?home=1\">Go home</a>\n  </div>\n  <div class=\"links\">\n    <a href=\"/rfo\">RFO</a>·<a href=\"/r-dfars\">R-DFARS</a>·<a href=\"/library\">Library</a>·<a href=\"/study\">Study</a>\n  </div>\n</main>\n</body>\n</html>\n";
}

module.exports = { SOURCES, SOURCE_KEYS, renderPartPage, renderHubPage, renderDeviationsPage, renderExplainerPage, renderLibraryPage, renderChangesPage, renderStudyPage, renderSitemap, renderNotFoundPage, SITE };
