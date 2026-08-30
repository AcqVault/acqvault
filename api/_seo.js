// Shared helpers for the server-rendered, crawlable SEO pages.
// Underscore-prefixed files under /api are NOT routed by Vercel — this is a
// plain module required by page.js / hub.js / sitemap.js.
const fs = require('fs');
const path = require('path');

const SITE = 'https://www.acqvault.com';

// /assets/* is served immutable for 30 days, so a changed part-nav.js MUST come
// with a bumped ?v or every client that already holds it keeps the old file.
const PART_NAV_V = 4;
// The analytics beacon rides EVERY server-rendered page, so the part pages, the
// hubs, /study and /48cons are all counted — not just the SPA home. Same
// immutable-asset rule applies: bump on any change to assets/analytics.js.
const ANALYTICS_V = 1;
// study.js is now loaded by TWO pages (/study and the unlisted /48cons). One constant so a
// bump can never reach one page and not the other.
const STUDY_V = 93;
// assets/slip.js - same immutable-asset rule: bump on every edit.
const SLIP_V = 4;

const SOURCES = {
  'rfo':                 { name: 'Revolutionary FAR Overhaul', short: 'RFO',
    desc: 'Full text of the Revolutionary FAR Overhaul (RFO) — the overhauled acquisition rulebook agencies cite for new awards, implemented for DoD via class deviations under E.O. 14275.' },
  'r-dfars':             { name: 'R-DFARS Deviations', short: 'R-DFARS',
    desc: 'DoD class deviations implementing the RFO for the Department of Defense — the deviation set you cite in place of the legacy supplement. Part 252 additionally carries the pre-deviation clause library, kept for reference and labelled as such.' },
  'far-companion':       { name: 'FAR Companion', short: 'FAR Companion',
    desc: 'Practitioner guidance accompanying the Revolutionary FAR Overhaul.' },
  'afi-63-138':          { name: 'DAFI 63-138', short: 'DAFI 63-138',
    desc: 'Department of the Air Force Instruction 63-138, Acquisition of Services.' },
  'category-management': { name: 'Category Management Buying Guide', short: 'Category Management',
    desc: 'Federal category management buying guidance.' },
  'fmr':                 { name: 'DoD Financial Management Regulation', short: 'DoD FMR',
    desc: 'DoD 7000.14-R Financial Management Regulation — the full text of all 16 volumes (budget, accounting, disbursing, pay, contract payment, and more), by volume and chapter.' },
  'pgi':                 { name: 'R-DFARS Procedures, Guidance, and Information', short: 'R-DFARS PGI',
    desc: 'The PGI attachment that ships with each DoD class deviation \u2014 the procedural companion to the R-DFARS rule: how to build a PIID, what a contract action report must carry, how to run a mentor-prot\u00e9g\u00e9 agreement. Guidance, not regulation: it tells you how to execute a rule, it does not impose one.' },
  'ssp':                 { name: 'DoD Source Selection Procedures', short: 'DoD SSP',
    desc: 'The Department of Defense Source Selection Procedures (August 20, 2022) — what every competitively negotiated DoD source selection above $10 million runs on: source selection team roles, the rating methods and their adjectival definitions, the tradeoff and LPTA processes, and the debriefing guide.' }
};
const SOURCE_KEYS = Object.keys(SOURCES);

// "Part 1 … Part A" is meaningless for a document whose divisions are named sections and
// lettered appendices, so a source may supply its own labels. Used by BOTH the hub (the
// part list) and the part page (title, breadcrumb, h1) so the two never disagree —
// previously the hub said "Appendix A — Debriefing Guide" and the page it linked to said
// "Part A". Sources without an entry keep the plain "Part N" wording untouched.
const PART_LABELS = {
  ssp: {
    '1': '1. Purpose, Roles, and Responsibilities', '2': '2. Pre-Solicitation Activities',
    '3': '3. Evaluation and Decision Process', '4': '4. Documentation Requirements',
    '5': '5. Definitions', 'A': 'Appendix A — Debriefing Guide',
    'B': 'Appendix B — Tradeoff Source Selection', 'C': 'Appendix C — LPTA',
    'D': 'Appendix D — Streamlining Source Selection', 'E': 'Appendix E — Intellectual Property'
  }
};
// The corpus stores the DFARS 200-series under its FAR-aligned number (part 204 is "4"),
// and the FMR is organised in Volumes. Both are internal storage details that were
// leaking into the crawlable page: /r-dfars/part-4 headed itself "Part 4" while every
// section on it is numbered 204.xxx and the in-app reader called it "Part 204", and the
// FMR called a Volume a Part. The URL keeps the index part; only the LABEL is corrected.
// KEEP IN SYNC with PART_200_SOURCES / displayPartForSource / partWord in assets/app.js.
const PART_200_SOURCES = { 'r-dfars': 1, 'pgi': 1 };
function displayPartForSource(source, part) {
  const n = Number(part);
  if (PART_200_SOURCES[source] && Number.isFinite(n) && n > 0 && n < 200) return String(n + 200);
  return String(part);
}
function partWord(source) { return source === 'fmr' ? 'Volume' : 'Part'; }
// What a source's top-level divisions are actually CALLED. The FMR has Volumes (the
// hub linked to "Volume 1…Volume 16" while the lede said "20 parts"), and the SSP has
// numbered sections plus lettered appendices, never "parts".
// Google prints these verbatim, so cut on a word boundary and mark the elision —
// a hard slice ended /fmr's description on "…by volum".
function clampDesc(text, max) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}
// The authority depends on the SOURCE. A single global line claiming "the signed DoD
// class deviations and acquisition.gov" was stamped on the FMR (authority: DoD
// Comptroller, DoD 7000.14-R) and the DoD SSP (authority: OUSD A&S/DPC), which is
// simply the wrong provenance for those documents.
function authorityLine(source) {
  if (source === 'fmr') return 'The authoritative source is the official DoD Financial Management Regulation (DoD 7000.14-R) published by the Under Secretary of Defense (Comptroller).';
  if (source === 'ssp') return 'The authoritative source is the official DoD Source Selection Procedures issued by OUSD(A&amp;S)/DPC.';
  if (source === 'afi-63-138') return 'The authoritative source is the official Department of the Air Force Instruction published on e-Publishing.';
  if (source === 'category-management') return 'The authoritative source is the official category management guidance published by the FAR Council.';
  return 'The authoritative sources are the signed DoD class deviations and the official text at <a href="https://www.acquisition.gov/far-overhaul" rel="noopener">acquisition.gov</a>.';
}
function hubUnit(source, n) {
  if (source === 'fmr') return n === 1 ? 'volume' : 'volumes';
  if (source === 'ssp') return 'sections and appendices';
  return n === 1 ? 'part' : 'parts';
}
function partLabel(source, part) {
  return (PART_LABELS[source] && PART_LABELS[source][part])
    || `${partWord(source)} ${displayPartForSource(source, part)}`;
}

// Descriptive part names, generated from PARTS_BY_SOURCE in assets/app.js by
// scripts/gen_part_labels.js. Without these the hub pages listed 49 links all reading
// "Part 1 … Part 53" while the in-app grid showed "Small Business Programs" for the
// same parts. Missing file degrades to the plain numbers rather than throwing.
let partNamesCache = null;
function partNames() {
  if (partNamesCache) return partNamesCache;
  try {
    partNamesCache = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'output', 'part-labels.json'), 'utf8'));
  } catch (e) { partNamesCache = {}; }
  return partNamesCache;
}

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
  // Strip the PGI prefix before keying: PGI titles read "PGI 204.201 …" and every match
  // below is anchored at a digit, so regOrderKey returned null for all 427 PGI docs and
  // their ordering silently fell back to a locale string compare.
  const t = String(title || '').trim().replace(/^PGI\s+/i, '');
  const sub = t.match(/^Subpart\s+(\d+)\.(\d+)/i);
  if (sub) return [parseInt(sub[1], 10), parseInt(sub[2], 10), 0, 0, 0, 0];
  const sec = t.match(/^(\d+)\.(\d+)(?:-(\d+))?(?:-(\d+))?/);
  if (sec) return [parseInt(sec[1], 10), Math.floor(parseInt(sec[2], 10) / 100), 1, parseInt(sec[2], 10), sec[3] ? parseInt(sec[3], 10) : 0, sec[4] ? parseInt(sec[4], 10) : 0];
  const letter = t.match(/^([A-E])\.(\d{1,2})(?:\.(\d+))?/);
  if (letter) return [letter[1].charCodeAt(0), 0, 1, parseInt(letter[2], 10), letter[3] ? parseInt(letter[3], 10) : 0, 0];
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


// ── SUPERSEDED CLAUSE NOTES (r-dfars part 52) ─────────────────────────────────
// Part 52 reproduces the legacy pre-deviation clause library — deliberately, because
// 74 clauses (including 252.204-7012) exist nowhere else. But where a deviation memo
// RESTATES a clause, the memo's copy in the clause's subject part is the authoritative
// text, and the two can disagree on the prescription (verified against the signed
// memos: subject-part matches 12/13, part 52 0/13). Say so on the page, per section,
// with a link to the current copy — never silently, and never by editing reproduced text.
function supersededBy(doc) {
  if (doc.source !== 'r-dfars' || String(doc.part) !== '52') return null;
  const m = String(doc.title || '').trim().match(/^(252\.\d{3}-\d{4}(?:-\d+)?)\b/);
  if (!m) return null;
  for (const d of loadDocs()) {
    if (d.source !== 'r-dfars' || String(d.part) === '52' || d.id === doc.id) continue;
    if (String(d.title || '').trim().startsWith(m[1]) && String(d.content || '').length > 200)
      return d;
  }
  return null;
}
function supersededChip(doc) {
  const cur = supersededBy(doc);
  if (!cur) return '';
  return `<div class="pair pair-rule"><span class="lead">Deviated</span><a href="/r-dfars/part-${encodeURIComponent(String(cur.part))}#${encodeURIComponent(String(cur.anchor || cur.id))}">current text in Part ${esc(displayPartForSource('r-dfars', cur.part))}</a><span class="note">this copy is the pre-deviation clause — the deviation restates it, and the prescriptions can differ</span></div>`;
}

// ── RULE ⇄ PROCEDURE PAIRING ──────────────────────────────────────────────────
// The DoD class deviation ships the rule (Attachment A1) and its procedure (A2) in ONE
// document. AcqVault indexes them as two sources, so /r-dfars/part-4 and /pgi/part-4
// had no idea the other existed. The numbering pairs exactly, which is what makes the
// link unambiguous. MIRRORS assets/app.js — edit both.
//
// ⭐ THE DIRECTIONS ARE NOT SYMMETRICAL, ON PURPOSE. The PGI does not bind the way the
// DFARS does. A neutral "see also" both ways would make them look interchangeable —
// the exact confusion the Guidance badge and the clay colour exist to prevent.
const PAIR_SOURCE = { 'r-dfars': 'pgi', 'pgi': 'r-dfars' };

function pairKey(title) {
  const m = String(title || '').match(/^(?:PGI\s+)?(\d{3}\.\d{1,6}(?:-\d+)*)/i);
  return m ? m[1] : null;
}

function pairIndexFor(source, part) {
  const other = PAIR_SOURCE[source];
  if (!other) return null;
  const map = new Map();
  for (const d of loadDocs()) {
    if (d.source !== other || String(d.part) !== String(part)) continue;
    const k = pairKey(d.title);
    if (!k) continue;
    // ⚠ A section number is NOT unique within a part — R-DFARS part 233 holds two
    // different sections both numbered 233.170. First-wins would tell the reader that
    // one section's procedure belongs to the other, under a label reading "tells you
    // how to carry this out". Ambiguous number => no chip. MIRRORS assets/app.js.
    if (map.has(k)) { map.set(k, null); continue; }
    map.set(k, d);
  }
  return map.size ? map : null;
}

function pairHref(other, mate) {
  return `/${other}/part-${encodeURIComponent(String(mate.part))}#${encodeURIComponent(String(mate.anchor || mate.id))}`;
}

// Count how many docs IN THIS PART share each section number. Ambiguity cuts both ways:
// the mate can be ambiguous (handled in pairIndexFor) and so can the section doing the
// pointing — R-DFARS part 233 has two different sections numbered 233.170, and both
// would otherwise claim the single PGI 233.170 as "the procedure for this".
function ownKeyCounts(docs) {
  const counts = new Map();
  for (const d of docs) {
    const k = pairKey(d.title);
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

function pairChip(source, doc, pairIdx, ownCounts) {
  if (!pairIdx) return '';
  const k = pairKey(doc.title);
  if (!k) return '';
  if (ownCounts && ownCounts.get(k) > 1) return '';
  const mate = pairIdx.get(k);
  if (!mate) return '';
  const other = PAIR_SOURCE[source];
  const num = pairKey(mate.title) || k;
  return other === 'pgi'
    ? `<div class="pair pair-pgi"><span class="lead">Procedure</span><a href="${pairHref(other, mate)}">PGI ${esc(num)}</a><span class="note">guidance — tells you how to carry this out, does not impose a requirement</span></div>`
    : `<div class="pair pair-rule"><span class="lead">Rule</span><a href="${pairHref(other, mate)}">${esc(num)}</a><span class="note">the binding requirement this procedure implements</span></div>`;
}

function partPairBanner(source, part, pairIdx) {
  const other = PAIR_SOURCE[source];
  if (!other || !pairIdx) return '';
  const href = `/${other}/part-${encodeURIComponent(String(part))}`;
  const disp = esc(displayPartForSource(source, part));
  if (source === 'pgi') {
    return `<div class="partpair partpair-pgi"><span class="tag">Guidance</span><div><strong>This is the PGI — it does not bind.</strong> It is the procedural half of the DoD class deviation: how to carry out a rule, not the rule itself. The binding text is <a href="${href}">R-DFARS Part ${disp}</a>. Only the PGI reissued by the deviation memos is indexed here, so a part carries fewer PGI sections than it does rules.</div></div>`;
  }
  return `<div class="partpair partpair-rule"><span class="tag">Rule</span><div><strong>This is the binding text.</strong> The same deviation also ships procedures for parts of this part — see <a href="${href}">R-DFARS PGI Part ${disp}</a>, which is guidance and does not impose requirements.</div></div>`;
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
// The DoD SSP rating scales are ingested as one em-dash row per line ("Blue — Outstanding
// — Proposal demonstrates…") under a header line ("Color Rating — Adjectival Rating —
// Description"). Rendered as <p>s the header reads as a nonsense sentence and the columns
// lose all alignment, so we reconstitute the real table. Detection is deliberately narrow —
// the header must open with "Color Rating"/"Adjectival Rating" and close with "Description",
// which ordinary prose never does — so a stray em-dash sentence is never captured.
// KEEP IN SYNC with assets/app.js parseRatingTable (the browse reader).
function stripMark(l) { return String(l == null ? '' : l).replace(/^L\d+:\s*/, '').trim(); }
function parseRatingTable(lines, i, escFn) {
  const header = stripMark(lines[i]);
  // Both shapes: 3-col "Color Rating — Adjectival Rating — Description" and 2-col
  // "Adjectival Rating — Description". The middle column is optional.
  if (!/^(?:Color Rating|Adjectival Rating) — (?:.*— )?Description$/.test(header)) return null;
  const cols = header.split(' — ');
  const N = cols.length;
  const rows = [];
  let last = i;
  for (let j = i + 1; j < lines.length; j++) {
    const raw = stripMark(lines[j]);
    if (!raw) continue;                       // blank separators between rows
    const parts = raw.split(' — ');
    if (parts.length < N) break;              // not a row → the table ends here
    if (parts[0].length > 30 || /[.:]$/.test(parts[0])) break;  // first cell is a short label
    const cells = parts.slice(0, N - 1);
    cells.push(parts.slice(N - 1).join(' — '));  // an em-dash inside the description survives
    rows.push(cells);
    last = j;
  }
  if (!rows.length) return null;
  const th = cols.map(c => `<th scope="col">${escFn(c)}</th>`).join('');
  const body = rows.map(r => '<tr>' + r.map((c, ci) =>
    ci === 0 ? `<th scope="row">${escFn(c)}</th>` : `<td>${escFn(c)}</td>`).join('') + '</tr>').join('');
  return { html: `<div class="ratetable-wrap"><table class="ratetable"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`, endIdx: last };
}

// Tables recovered by scripts/extract_tables.py arrive alongside the text with the
// span of flattened lines they replace. Splicing a marker in — isolated by blank
// lines so downstream block-joining leaves it alone — lets the existing per-line
// loop stay exactly as it was.
const TBL_MARK = /^L0:\u27e6TBL:(\d+)\u27e7$/;
function spliceTables(content, tables) {
  const lines = String(content || '').split('\n');
  if (!tables || !tables.length) return lines;
  const ordered = tables.slice().sort((a, b) => a.start - b.start);
  const out = [];
  let ti = 0;
  for (let i = 0; i < lines.length; i++) {
    const t = ordered[ti];
    if (t && i === t.start) {
      out.push('', `L0:\u27e6TBL:${ti}\u27e7`, '');
      i = t.end;
      ti++;
      continue;
    }
    out.push(lines[i]);
  }
  return out;
}
function tableHtml(rows, escFn) {
  if (!rows || rows.length < 2) return '';
  // An EMPTY header cell is worse than no header: a screen reader announces a column
  // header with no name. Some extracted tables have blank leading/trailing cells, so
  // emit a plain cell for those rather than a nameless th. KEEP IN SYNC across renderers.
  const head = rows[0].map(c => String(c || '').trim() ? `<th scope="col">${escFn(c)}</th>` : '<td></td>').join('');
  const body = rows.slice(1).map(r => '<tr>' + r.map((c, ci) =>
    ci === 0 ? (String(c || '').trim() ? `<th scope="row">${escFn(c)}</th>` : '<td></td>') : `<td>${escFn(c)}</td>`).join('') + '</tr>').join('');
  return `<div class="ratetable-wrap"><table class="ratetable"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
// Paragraph depth from the token a line opens with — see assets/app.js tokenLevel().
// The RFO's HTML publishes an explicit level per paragraph and confirms the fixed
// FAR/DFARS order: (a)->L1 96%, (1)->L2 93%, (i)->L3 91%, (A)->L4 92%. Deriving it at
// render time gives the sources that never had markers (FAR Companion, FMR, SSP) the
// same tiering without touching the corpus, and corrects R-DFARS's collapsed markers.
// KEEP IN SYNC with assets/app.js.
const PARA_TOKEN = /^\(([A-Za-z0-9]{1,4})\)\s/;
const ROMAN_TOKEN = /^(?:i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv)$/;
const AMBIG_PREV = { i: 'h', v: 'u', x: 'w' };
function tokenLevel(text, lastLower) {
  const m = PARA_TOKEN.exec(String(text || '').trim());
  if (!m) return null;
  const t = m[1];
  if (/^\d+$/.test(t)) return 2;
  if (t.length === 1 && t >= 'A' && t <= 'Z') return 4;
  if (AMBIG_PREV[t] && lastLower === AMBIG_PREV[t]) return 1;
  if (ROMAN_TOKEN.test(t)) return 3;
  if (t.length === 1 && t >= 'a' && t <= 'z') return 1;
  return null;
}
function paraTokenLetter(text) {
  const m = PARA_TOKEN.exec(String(text || '').trim());
  return (m && m[1].length === 1 && m[1] >= 'a' && m[1] <= 'z') ? m[1] : null;
}
// The other convention: a dotted outline ("3.1.1.1 All offers…"), used by the FMR,
// the SSP and the DAFI. Depth is the number of components relative to the section's
// own number, so 3.1.1 sits one level under a section titled "3.1". Gated by source
// because a bare "31.205-6" in the RFO is a section reference, not an outline.
const DECIMAL_SOURCES = { 'fmr': 1, 'ssp': 1, 'afi-63-138': 1, 'far-companion': 1 };
const DECIMAL_TOKEN = /^(\d+(?:\.\d+)+)[.)]?\s/;
function decimalLevel(text, source, baseDepth) {
  if (!DECIMAL_SOURCES[source]) return null;
  const m = DECIMAL_TOKEN.exec(String(text || '').trim());
  if (!m) return null;
  const depth = m[1].split('.').length;
  const lvl = baseDepth ? depth - baseDepth : depth - 1;
  return lvl > 0 ? Math.min(lvl, 4) : null;
}
function sectionDepth(title) {
  const m = /^(\d+(?:\.\d+)*)/.exec(String(title || '').trim());
  return m ? m[1].split('.').length : 0;
}

/* ── Category Management curated visuals ──────────────────────────────────────
   These three tables are hand-built rather than extracted, because the buying
   guide's PDF flattens them into unusable runs of cells — an extraction attempt
   put HCaTS under Tier 4 when it belongs to Tier 3, which in a buying guide is
   the whole answer. The curated data lived only in assets/app.js, so the in-app
   reader drew them and these server-rendered pages showed nothing at all.
   Copied verbatim so both surfaces agree. KEEP IN SYNC with assets/app.js.
   The two linkified cells fall back to plain escaping here: the client's
   linkifier emits target="_blank", and this site does not open new tabs. */
function categoryGuideContinuumHTML() {
  const rows = [
    ['Requirements', '<strong>Commercial products and commercial services</strong> Includes COTS items and solutions that can be bought largely as-is.', '<strong>Non-commercial or mission-specific needs</strong> Includes products or services that require more tailoring, integration, or specialized delivery.'],
    ['Value / Competition', '<strong>Micro-purchase to simplified procedures</strong> Use micro-purchase, simplified acquisition, and commercial simplified procedures where the requirement fits.', '<strong>Above simplified commercial lanes</strong> Use more formal procedures when value, risk, or complexity exceeds the simplified pathway.'],
    ['Sources', '<strong>Required and priority sources first</strong> Check mandatory sources, existing government-wide contracts, BPAs, shared services, FSS, GWACs, IDIQs, and other pre-competed vehicles.', '<strong>Agency discretion and open market when needed</strong> Move beyond existing vehicles when they cannot meet the requirement.'],
    ['Contracting Method', '<strong>Fast, structured buying lanes</strong> FAR 8.4 orders/BPAs, FAR 12.201-1 and 12.201-2, FAR 13, and other simplified/commercial procedures.', '<strong>Formal market procedures</strong> FAR 14/15 IFB/RFP, broad agency announcements, construction, architect-engineer, and other specialized pathways.'],
    ['Approach', '<strong>Buy commercial capability as-is</strong> Prioritize speed, value, and adoption of existing market solutions.', '<strong>Plan for mission failure risk</strong> Build the capable team, evaluation strategy, and controls needed for complex or custom work.']
  ];
  return `<div class="cm-native-visual cm-continuum" aria-label="Simple to other-than-simple acquisition continuum">
    <div class="cm-continuum-head">
      <div><strong>Simple Pathway</strong><span>Speed, value, and adoption of commercial solutions as-is.</span></div>
      <div><strong>Other-than-Simple Pathway</strong><span>More planning for capable teams, complexity, and mission-risk reduction.</span></div>
    </div>
    <div class="cm-continuum-grid">
      ${rows.map(([label, simple, complex]) => `<div class="cm-cont-row"><div class="cm-cont-label">${label}</div><div class="cm-cont-cell">${simple}</div><div class="cm-cont-cell">${complex}</div></div>`).join('')}
    </div>
    <div class="cm-native-caption"><strong>Continuum summary</strong><span>Adapted from the Category Management Buying Guide, p. 5</span></div>
  </div>`;
}

function categoryGuideSpendTableHTML() {
  const rows = [
    ['Facilities & Construction', 'Office furniture, building materials, commercial real estate leases, and common maintenance services such as janitorial work.', 'Specialized construction services for government facilities, building of military bases, or custom-designed infrastructure.'],
    ['Human Capital', 'Talent acquisition, employer relocation, and professional development training.', 'Specialized government talent development, security clearances, and employee relations services specific to federal regulations.'],
    ['Industrial Products and Services', 'Basic materials, hardware, tools, machinery, and repair or maintenance services for commercial equipment.', 'Specialized test and measurement supplies, equipment, and services for government-specific research and development projects.'],
    ['Information Technology', 'Commercial off-the-shelf software licenses, computer hardware, and general IT consulting.', 'Highly customized software solutions for federal agencies, cybersecurity for classified networks, and specialized telecommunications.'],
    ['Medical', 'Standard pharmaceuticals, healthcare services, and common medical equipment or supplies.', 'Specialized or customized pharmaceuticals, medical equipment, supplies, or services used exclusively by the military or certain federal agencies.'],
    ['Office Management', 'Office supplies, office furniture, and basic office management services.', 'N/A'],
    ['Professional Services', 'Financial services, legal services, management consulting, and marketing services.', 'Research and development projects for government use only, or advisory services for federal policy.'],
    ['Security & Protection', 'Standard security systems, uniforms or protective apparel, and general security guard services.', 'Specialized weapons, integrated physical access control systems, and tactical communication services.'],
    ['Transportation & Logistics Services', 'Package delivery, motor vehicles, and general transportation equipment.', 'Logistics support for military operations, specialized vehicles for federal agencies, or transportation of classified materials.'],
    ['Travel', 'Lodging, passenger travel, and car rental services.', 'N/A']
  ];
  return `<div class="cm-native-visual">
    <div class="cm-spend-wrap">
      <table class="cm-spend-table">
        <thead><tr><th>Category</th><th>Simple Pathway</th><th>Other-than-Simple Pathway</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody>
      </table>
    </div>
    <div class="cm-native-caption"><strong>Categories of spend examples</strong><span>Adapted from the Category Management Buying Guide, pp. 8-9</span></div>
  </div>`;
}

const CATEGORY_VEHICLE_TABLES = {
  '3': [
    ['Tier 4', 'N/A', 'N/A', 'N/A'],
    ['Tier 3', 'Facilities Reduction Program (FRP)', 'N/A', 'USACE'],
    ['Tier 3', 'Building Maintenance & Operations (BMO)', 'Building Maintenance and Operations Buyer’s Guide', 'GSA'],
    ['Tier 3', 'OASIS+ Facilities Domain', 'OASIS+ Buyer’s Guide', 'GSA'],
    ['Tier 3', 'Maintenance Repair Facility Supplies Generation 2 (MRFS2)', 'MRFS2 How To', 'GSA'],
    ['Tier 3', 'GSA Global Supply', 'GSA Global Supply FAQs', 'GSA'],
    ['Tier 2', 'GSA MAS - Facilities & Construction', 'Construction-Related Services MAS Ordering Guide (GSA 2024)', 'GSA']
  ],
  '4': [
    ['Tier 4', 'N/A', 'N/A', 'N/A'],
    ['Tier 3', 'Human Capital and Training Solutions (HCaTS)', 'HCaTS Ordering Guide', 'GSA'],
    ['Tier 3', 'USA Learning', 'N/A', 'OPM'],
    ['Tier 2', 'GSA MAS - Human Capital', 'N/A', 'GSA']
  ],
  '5': [
    ['Tier 4', 'N/A', 'N/A', 'N/A'],
    ['Tier 3', 'Maintenance Repair Facility Supplies Generation 2 (MRFS2)', 'Maintenance Repair Facility Supplies Generation 2', 'GSA'],
    ['Tier 3', 'GSA Global Supply', 'GSA Global Supply', 'GSA'],
    ['Tier 3', 'DLA eCAT', 'N/A', 'DLA'],
    ['Tier 2', 'GSA MAS - Industrial Products & Services', 'MAS Desk Reference', 'GSA'],
    ['Tier 2', 'VA Federal Supply Schedules', 'N/A', 'VA'],
    ['Tier 2', 'DLA eProcurement', 'N/A', 'DLA'],
    ['Tier 2', 'DLA Special Operational Equipment (SOE)', 'N/A', 'DLA'],
    ['Tier 2', 'DLA Fire and Emergency Services Equipment (FESE)', 'N/A', 'DLA'],
    ['Tier 2', 'DLA Troop Support Tier 2 Contracts', 'N/A', 'DLA'],
    ['Tier 1', 'Treasury Tier 1 Precious Metals', 'N/A', 'Treasury']
  ],
  '6': [
    ['Tier 4', 'N/A', 'N/A', 'N/A'],
    ['Tier 3', '8(a) STARS III', 'Industry partners, master contract, and pricing', 'GSA'],
    ['Tier 3', 'Alliant 2', 'Ordering guide, industry partners, and pricing list', 'GSA'],
    ['Tier 3', 'Digital Market', 'Ordering guide, vendor list, awarded contracts, and pricing', 'Army'],
    ['Tier 3', 'COMSATCOM', 'Complex Commercial SATCOM Solutions and contractor listing/pricing', 'GSA'],
    ['Tier 3', 'EIS', 'GSA EIS Ordering Guide, Fair Opportunity Ordering Guide, Partner Guide, and Service Guide', 'GSA'],
    ['Tier 3', 'MAS IT', 'MAS Ordering Guide and MAS Buyer Websites and Tools', 'GSA'],
    ['Tier 3', 'SEWP', 'SEWP Tools Guide and vendor contracts/services', 'NASA'],
    ['Tier 3', 'NITAAC CIO-CS', 'CIO-CS Ordering Guide and contract holders', 'NIH'],
    ['Tier 3', 'NITAAC CIO-SP3 / CIO-SP3 SB', 'SP3 and SP3 SB ordering guides and contract holders', 'NIH'],
    ['Tier 3', 'VETS 2', 'N/A', 'GSA'],
    ['Tier 3', 'Wireless', 'Wireless Mobility Solutions website, guide, contractor listing, and pricing', 'GSA']
  ],
  '7': [
    ['Tier 4', 'N/A', 'N/A', 'N/A'],
    ['Tier 3', 'Medical Surgical Prime Vendor Program (MSPV)', 'Customer Ordering Guide', 'DLA'],
    ['Tier 3', 'VA Hearing Aids (HRA)', 'Registration & Ordering Guidance', 'VA'],
    ['Tier 3', 'DOD/VA High-Tech Medical Equipment / Radiology', 'DMMonline and VA website', 'DLA / VA'],
    ['Tier 3', 'Defense Logistics Agency Medical Electronic Catalog Program (ECAT)', 'Core ECAT User Customer Ordering Guide', 'DLA'],
    ['Tier 3', 'DOD/VA Joint National Contracts for Generic Pharmaceuticals', 'VA Website', 'VA'],
    ['Tier 2', 'GSA MAS - Medical', 'MAS Ordering Guide', 'GSA'],
    ['Tier 2', 'MQS2NG Multiple-Award IDIQ', 'MQS2NG SharePoint Online', 'DHA'],
    ['Tier 2', 'Pharmaceutical Prime Vendor: DoD / VA', 'Customer use guide and VA website', 'DLA / VA'],
    ['Tier 2', 'VA Federal Supply Schedule medical schedules', 'Orders not requiring SOW, orders requiring SOW, and open market paths', 'VA'],
    ['Tier 2', 'AbilityOne / UNICOR / Omnibus IV / Community Care resources', 'How to Buy Products, ordering procedures, and program resources', 'Multiple']
  ],
  '8': [
    ['Tier 4', 'N/A', 'N/A', 'N/A'],
    ['Tier 3', 'Global Supply Requisition Channel - Furniture', 'Global Supply Furniture Training Video', 'GSA'],
    ['Tier 3', 'Federal Strategic Sourcing Initiative for Office Supplies Fourth Generation (FSSI OS4)', 'FSSI Office Supplies Fourth Generation Buying Guide', 'GSA'],
    ['Tier 2', 'GSA MAS - Office Management', 'MAS Office Administrative Services Ordering Guide (GSA 2024)', 'GSA'],
    ['Tier 2', 'GSA MAS - Furniture and Furnishings', 'N/A', 'GSA']
  ],
  '9': [
    ['Tier 4', 'N/A', 'N/A', 'N/A'],
    ['Tier 3', 'Identity Protection Services (IPS)', 'Data Breach Response and Identity Protection Services Ordering Procedures', 'GSA'],
    ['Tier 3', 'OASIS+', 'OASIS+ Ordering Guide', 'GSA'],
    ['Tier 2', 'MAS - Professional Services', 'N/A', 'GSA'],
    ['Tier 2', 'MAS - Human Capital', 'N/A', 'GSA']
  ],
  '10': [
    ['Tier 4', 'N/A', 'N/A', 'N/A'],
    ['Tier 3', 'Reduced Hazard Training Ammunition (RHTA) II', 'RHTA II Ordering Guide', 'DHS'],
    ['Tier 3', 'Body Armor IV', 'Body Armor Ordering Guide', 'DHS'],
    ['Tier 3', 'Tactical Communications Equipment and Services II (TacCom II)', 'N/A', 'DHS'],
    ['Tier 2', 'GSA MAS - Security & Protection', 'N/A', 'GSA']
  ],
  '11': [
    ['Tier 4', 'N/A', 'N/A', 'N/A'],
    ['Tier 3', 'Next Generation Delivery Service (NGDS)', 'NGDS Contracting Officer’s Ordering Guide', 'DLA'],
    ['Tier 3', 'Direct Delivery Fuels', 'N/A', 'DLA'],
    ['Tier 3', 'GSA Fleet Vehicle Purchasing', 'How to Buy Vehicles', 'GSA'],
    ['Tier 3', 'GSA Fleet Vehicle Leasing', 'N/A', 'GSA']
  ],
  '12': [
    ['Tier 4', 'N/A', 'N/A', 'N/A'],
    ['Tier 3', 'City Pair Program (CPP)', 'N/A', 'GSA'],
    ['Tier 3', 'Civilian Employee Relocation Resource Center (ERRC) / Employee Relocation Solutions', 'N/A', 'GSA'],
    ['Tier 3', 'MAS 531110 Long Term Lodging / FedRooms / DoD Preferred', 'N/A', 'GSA'],
    ['Tier 3', 'U.S. Government Rental Car Program', 'N/A', 'DoD'],
    ['Tier 3', 'Emergency Lodging Services (ELS)', 'Guidance for Using ELS', 'GSA'],
    ['Tier 2', 'E-Gov Travel Service (ETS2)', 'N/A', 'GSA'],
    ['Tier 2', 'Travel Agent Services / Travel Consulting / Lodging Negotiation and Management', 'N/A', 'GSA'],
    ['Tier 2', 'GO.gov / CHAMP / Long Term Lodging / Rideshare', 'N/A', 'GSA']
  ]
};

function categoryGuideVehicleTableHTML(partNum) {
  const rows = CATEGORY_VEHICLE_TABLES[String(partNum)] || [];
  if (!rows.length) return '';
  return `<div class="cm-native-visual">
    <div class="cm-spend-wrap">
      <table class="cm-spend-table cm-vehicle-table">
        <thead><tr><th>Tier</th><th>Program</th><th>Ordering Guide</th><th>Agency Owner</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td></tr>`).join('')}</tbody>
      </table>
    </div>
    <div class="cm-native-caption"><strong>Vehicles Table</strong><span>Adapted from the Category Management Buying Guide</span></div>
  </div>`;
}

// KEEP IN SYNC with categoryGuideVisualAfterLine() in assets/app.js
function cmVisualAfterLine(source, partNum, line, flags) {
  if (source !== 'category-management') return '';
  const t = (line || '').trim();
  if (String(partNum) === '1' && !flags.continuum && /^The [\u201c"]simple[\u201d"].*continuum is a useful framework/i.test(t)) {
    flags.continuum = true;
    return categoryGuideContinuumHTML();
  }
  if (String(partNum) === '2' && !flags.spend && /^Categories of Spend Examples$/i.test(t)) {
    flags.spend = true;
    return categoryGuideSpendTableHTML();
  }
  if (Number(partNum) >= 3 && !flags.vehicles && /^Vehicles Table$/i.test(t)) {
    flags.vehicles = true;
    return categoryGuideVehicleTableHTML(partNum);
  }
  return '';
}


// KEEP IN SYNC with normalizeBrowseLines() in assets/app.js. The curated visuals
// above replace flattened blocks of cells that are still sitting in the text; the
// in-app reader skips those lines, and without the same skip here the page would
// show the table and then the same data again as prose.
function cmSkipLine(source, partNum, line, st) {
  if (source !== 'category-management') return false;
  const t = (line || '').trim();
  if (Number(partNum) >= 3 && /^Types of Vehicles\b/i.test(t)) { st.vehicles = true; return true; }
  if (st.vehicles) {
    if (/^Resources$/i.test(t)) st.vehicles = false;
    else return true;
  }
  if (String(partNum) === '1' && /^Simple\s+Other than Simple$/i.test(t)) { st.graphic = true; return true; }
  if (String(partNum) === '2' && /^Category\s+Simple Pathway\s+Other-than-Simple Pathway$/i.test(t)) { st.graphic = true; return true; }
  if (st.graphic) {
    if ((String(partNum) === '1' && /^Simple Procurements$/i.test(t)) ||
        (String(partNum) === '2' && /^Category Management$/i.test(t))) {
      st.graphic = false;
      if (String(partNum) === '2') return true;
    } else {
      return true;
    }
  }
  return false;
}


// ── CROSS-REFERENCE LINKS (SSR) ───────────────────────────────────────────────
// Mirrors the client engine in assets/app.js (XREF_*, buildXrefMap, linkifyXrefs) —
// same guards, same resolution rules; only the href differs (a real page URL instead
// of the in-app reader). KEEP THE RULES IN SYNC:
//   * "PGI 204.201" resolves ONLY into the PGI; a bare number NEVER does, even inside
//     a PGI document — the rule/guidance boundary is never guessed.
//   * foreign citation systems (CFR, U.S.C., Public Law, DoDI…) are never linkified.
//   * a number split across a PDF line break ("227.7102- 4") is left alone.
//   * duplicated clause numbers resolve to the substantive copy, never a stub.
const SRV_XREF_LEAD = /^(?:PGI\s+)?(\d{1,3}\.\d{1,6}(?:-\d+)*)\b/;
const SRV_XREF_BARE_ORDER = { rfo: ['rfo', 'r-dfars'], 'r-dfars': ['r-dfars', 'rfo'], pgi: ['r-dfars', 'rfo'] };
const SRV_XREF_FOREIGN = /(?:\bC\.?F\.?R\.?|U\.?\s?S\.?\s?C\.?|Public\s+Law|Pub\.?\s*L\.?|DoD[IDM]|DFAS|E\.?O\.?|Executive\s+Order|Chapter)\s*$/i;
let srvXrefMapCache = null;
function srvXrefMap() {
  if (srvXrefMapCache) return srvXrefMapCache;
  const map = { rfo: new Map(), 'r-dfars': new Map(), pgi: new Map() };
  for (const d of loadDocs()) {
    const table = map[d.source];
    if (!table) continue;
    const m = String(d.title || '').trim().match(SRV_XREF_LEAD);
    if (!m) continue;
    const prev = table.get(m[1]);
    if (prev) {
      const better = (a, b) => {
        const ra = /\[reserved\]/i.test(a.title || ''), rb = /\[reserved\]/i.test(b.title || '');
        if (ra !== rb) return rb ? a : b;
        return String(a.content || '').length >= String(b.content || '').length ? a : b;
      };
      if (better(prev, d) === prev) continue;
    }
    table.set(m[1], d);
  }
  srvXrefMapCache = map;
  return map;
}
// Operates on ALREADY-ESCAPED text; emits nothing but the doc's own escaped fields.
function srvLinkify(escaped, source, selfAnchor) {
  if (!SRV_XREF_BARE_ORDER[source] && source !== 'pgi') return escaped;
  const map = srvXrefMap();
  return escaped.replace(/(PGI\s+)?\b(\d{1,3}\.\d{1,6}(?:-\d+)*)\b/g, (full, pgiLead, num, offset, str) => {
    const before = str.slice(Math.max(0, offset - 30), offset);
    if (SRV_XREF_FOREIGN.test(before)) return full;
    const after = str.slice(offset + full.length, offset + full.length + 8);
    if (/^\s*[-–—]\s*\d/.test(after)) return full;
    const tables = pgiLead ? ['pgi'] : (SRV_XREF_BARE_ORDER[source] || []);
    let doc = null;
    for (const t of tables) { const d = map[t] && map[t].get(num); if (d) { doc = d; break; } }
    if (!doc) return full;
    if (String(doc.anchor || doc.id) === String(selfAnchor)) return full;
    const href = `/${doc.source}/part-${encodeURIComponent(String(doc.part))}#${encodeURIComponent(String(doc.anchor || doc.id))}`;
    return `<a class="xref" href="${href}">${full}</a>`;
  });
}

function renderContent(content, title, anchorBase, tables, source, partNum) {
  const lines = spliceTables(content, tables);
  let lastLower = null;   // the (a)…(h)(i) run is per section
  const cmFlags = {};     // each curated Category Management visual draws once
  const cmSkip = {};      // and its flattened cells are skipped, as in the reader
  const baseDepth = sectionDepth(title);
  const out = [];
  const blocks = [];
  const skip = titleEchoLines(lines, title);
  for (let li = skip; li < lines.length; li++) {
    const line = lines[li];
    const tm = TBL_MARK.exec(line);
    if (tm) { out.push(tableHtml((tables || [])[+tm[1]] && (tables || [])[+tm[1]].rows, esc)); continue; }
    const isTop = /^L0:/.test(line);
    // The depth the corpus recorded. Dropping it was what turned a tiered
    // regulation into a flat wall of paragraphs: (a), (1), (2), (b) all landed on
    // the same margin, so you could not see which paragraph governed which.
    const lvlM = line.match(/^L(\d+):/);
    let s = line.replace(/^L\d+:\s*/, '').trim();
    if (!s) continue;
    // The token wins over a stored marker where there is one: R-DFARS recorded
    // 14,774 lines at L1 and a single line at L4 for text that nests four deep.
    let derived = tokenLevel(s, lastLower);
    if (paraTokenLetter(s)) lastLower = paraTokenLetter(s);
    if (derived === null) derived = decimalLevel(s, source, baseDepth);
    const lvl = derived !== null ? derived
              : (lvlM ? Math.min(parseInt(lvlM[1], 10), 4) : 0);
    const pcls = lvl > 0 ? ` class="lvl lvl-${lvl}"` : '';
    const rt = parseRatingTable(lines, li, esc);
    if (rt) { out.push(rt.html); li = rt.endIdx; continue; }

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
        if (rest) out.push(`<p${pcls}>` + srvLinkify(esc(rest), source, anchorBase) + '</p>');
      } else if (!cmSkipLine(source, partNum, t, cmSkip)) {
        out.push(`<p${pcls}>` + srvLinkify(esc(t), source, anchorBase) + '</p>');
        const vis = cmVisualAfterLine(source, partNum, t, cmFlags);
        if (vis) out.push(vis);
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

// Returns PLAIN text. Escape at the HTML-attribute site; JSON-LD must get the raw string
// (JSON.stringify does its own escaping, so feeding it entity-encoded text published
// "R&amp;D" / "Officer&#39;s" inside structured data).
function metaDescription(docs) {
  const text = String((docs[0] && docs[0].content) || '').replace(/^L\d+:\s*/gm, '').replace(/\s+/g, ' ').trim();
  return clampDesc(text, 155);
}

const STYLE = `@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;src:url(/assets/fonts/inter-latin.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;}
@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;src:url(/assets/fonts/inter-latin-ext.woff2) format('woff2');unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF;}
@font-face{font-family:'Source Serif 4';font-style:normal;font-weight:200 900;font-display:swap;src:url(/assets/fonts/source-serif4-latin.woff2) format('woff2');}
:root{--ink:#13151b;--muted:#5e5d66;--line:#948b7c;--line2:#e8e5de;--accent:#87651c;--bg:#fff;--r-sm:4px;--r-md:10px;--r-lg:14px;--r-xl:20px;--r-2xl:28px;--ls-tight:-0.02em;--ls-tighter:-0.025em;--ls-snug:-0.01em;--ls-wide:0.04em;--ls-caps:0.06em;--ls-wider:0.07em;--ls-widest:0.08em;--shadow-rgb:28,22,14;--brass-rgb:135,101,28;--brass-bright-rgb:228,196,119;--navy-rgb:15,37,64;--brass:#87651c;--brass-ink:#5e4715;--brass-bright:#e4c477;--brass-deep:#6f521a;--brass-line:rgba(154,115,32,0.40);--ink-from:#173a60;--ink-mid:#0f2540;--ink-to:#0a1c33;--serif:'Source Serif 4',Georgia,'Times New Roman',serif;--ink2:#262a31;--cm-bg:#e6e8ea;--cm-txt:#333f49;--fs-xs:11px;--fs-sm:12px;--fs-base:13px;--fs-md:14px;--fs-lg:15px;--fw-heavy:800;--fw-black:850}
*{box-sizing:border-box}body{margin:0;font-family:'Inter',-apple-system,system-ui,sans-serif;color:var(--ink);background:var(--bg);line-height:1.6;-webkit-font-smoothing:antialiased}
::selection{background:rgba(var(--brass-rgb),0.16);color:var(--ink)}
mark{background:rgba(var(--brass-rgb),0.20);color:var(--ink);border-radius:2px;padding:0 1px}
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
header.site a.cta:hover{border-color:rgba(var(--brass-bright-rgb),.55)}
.hdr-links{display:inline-flex;align-items:center;gap:16px}
.hlink{font-weight:650;font-size:14px;color:var(--muted);text-decoration:none}
.hlink:hover{color:var(--accent);text-decoration:underline}
/* federal-ink masthead — frames the page in the homepage's visual language */
.lib-mast{position:relative;overflow:hidden;border-radius:18px;margin:0 0 34px;padding:42px 40px 36px;background:linear-gradient(158deg,var(--ink-from),var(--ink-mid) 56%,var(--ink-to));color:#eaf1f8;box-shadow:inset 0 0 0 1px var(--brass-line),0 26px 54px -30px rgba(10,28,51,.62)}
.lib-mast::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--brass-deep),var(--brass-bright) 50%,var(--brass-deep))}
.lib-mast::after{content:"";position:absolute;right:-60px;bottom:-80px;width:320px;height:320px;opacity:.14;background:repeating-radial-gradient(circle at 50% 50%,rgba(var(--brass-bright-rgb),.6) 0 1px,transparent 1px 11px);pointer-events:none}
.lib-mast .eyebrow{position:relative;font-size:11px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:var(--brass-bright);margin:0 0 13px}
.lib-mast h1{position:relative;font-family:var(--serif);font-weight:700;font-size:42px;letter-spacing:var(--ls-snug);line-height:1.05;margin:0 0 13px;color:#f4f8fc;max-width:14ch}
.lib-mast .lede{position:relative;color:rgba(221,233,246,.85);font-size:15.5px;max-width:640px;margin:0 0 22px;line-height:1.6}
.lib-mast .stats{position:relative;display:flex;flex-wrap:wrap;gap:9px}
.lib-mast .stat{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:#eaf1f8;background:rgba(255,255,255,.06);border:1px solid rgba(var(--brass-bright-rgb),.3);border-radius:999px;padding:6px 13px}
.lib-mast .stat b{color:var(--brass-bright);font-variant-numeric:tabular-nums}
.lib-seal{position:absolute;right:46px;top:50%;transform:translateY(-50%);width:112px;height:112px;z-index:1;filter:drop-shadow(0 8px 16px rgba(0,0,0,.42));}
@media(max-width:760px){.lib-seal{display:none}}
nav.crumbs{font-size:13px;color:var(--muted);margin-bottom:8px}
nav.crumbs a{color:var(--accent);text-decoration:none}nav.crumbs a:hover{text-decoration:underline}
h1{font-family:var(--serif);font-weight:700;font-size:30px;letter-spacing:var(--ls-tight);margin:.2em 0 .1em}
.lede{color:var(--muted);margin:0 0 26px;font-size:15px}
.lede a{color:var(--accent);text-decoration:underline;text-underline-offset:2px}
section.sec{padding:18px 0;border-top:1px solid var(--line);scroll-margin-top:14px}
section.sec h2{font-size:18px;letter-spacing:var(--ls-tight);margin:0 0 6px;scroll-margin-top:16px}
.sec-hd{display:flex;align-items:baseline;flex-wrap:wrap}
section.sec h2 a{color:inherit;text-decoration:none}
/* Landing from a deep link (study chips, TOC, copied anchors): bathe the exact section
   in the house brass so the reader spots it without sweeping the page. The :target wash
   stays as a resting emphasis; the stronger flash settles after a moment. */
section.sec:target{background:linear-gradient(90deg,rgba(var(--brass-rgb),.07),rgba(var(--brass-rgb),.02) 62%,transparent);border-left:3px solid var(--accent);border-radius:0 var(--r-md) var(--r-md) 0;padding-left:16px;margin-left:-19px;animation:sec-found 2.8s ease-out 1}
section.sec:target>h2{color:var(--accent)}
@keyframes sec-found{0%,30%{background-color:rgba(var(--brass-bright-rgb),.32)}100%{background-color:rgba(var(--brass-bright-rgb),0)}}
@media(prefers-reduced-motion:reduce){section.sec:target{animation:none}}
.srcref{font-size:12.5px;color:var(--muted);margin:0 0 10px}
.srcref a{color:var(--accent);text-decoration:none}
.parts a .hublabel{display:block;font-size:12.5px;font-weight:500;color:var(--muted);margin-top:2px;line-height:1.3}
section.sec p a.xref{color:var(--accent);text-decoration:underline;text-underline-offset:2px;text-decoration-color:rgba(var(--brass-rgb),.45)}
section.sec p a.xref:hover{text-decoration-color:var(--accent)}
/* Rule ⇄ procedure pairing — KEEP IN SYNC with .br-pair/.br-partpair in assets/app.css.
   The clay literals mirror --pgi-bg/--pgi-txt/--pgi-solid there; the SSR :root does not
   carry the per-source tokens. Clay = being sent to guidance, brass/ink = being sent to
   the binding text. Do not collapse the two into one neutral style. */
.pair{display:flex;align-items:baseline;flex-wrap:wrap;gap:5px 9px;margin:0 0 12px;padding:7px 12px;border-radius:var(--r-sm);font-size:12.5px;line-height:1.45}
.pair-pgi{background:#efe5df;border-left:2px solid #7a5a4a}
.pair-rule{background:#f7f6f2;border-left:2px solid var(--accent)}
.pair .lead{font-weight:800;text-transform:uppercase;letter-spacing:var(--ls-caps);font-size:10px;flex-shrink:0}
.pair-pgi .lead{color:#5b4136}
.pair-rule .lead{color:var(--accent)}
.pair a{font-weight:700;text-decoration:underline;text-underline-offset:2px}
.pair-pgi a{color:#5b4136}
.pair-rule a{color:var(--ink)}
.pair .note{color:var(--muted)}
.partpair{display:flex;gap:11px;margin:0 0 24px;padding:13px 16px;border-radius:var(--r-md);font-size:13px;line-height:1.6}
.partpair-pgi{background:#efe5df;border-left:3px solid #7a5a4a;color:#5b4136}
.partpair-rule{background:#f7f6f2;border-left:3px solid var(--accent);color:var(--ink)}
.partpair .tag{flex-shrink:0;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:var(--ls-wider);padding:3px 8px;border-radius:var(--r-sm);height:fit-content;margin-top:1px}
.partpair-pgi .tag{background:#7a5a4a;color:#fff}
.partpair-rule .tag{background:var(--accent);color:#fff}
.partpair a{color:inherit;font-weight:700;text-decoration:underline;text-underline-offset:2px}
@media(max-width:640px){.partpair{flex-direction:column;gap:8px}.pair{flex-direction:column;gap:3px}}
/* Category Management curated visuals — copied from assets/app.css so the
   server-rendered pages style them the same way the in-app reader does.
   KEEP IN SYNC with assets/app.css. */
.cm-native-visual{width:100%;max-width:100%;margin:24px 0 32px;border:1px solid var(--line2);border-radius:12px;background:#fff;overflow:hidden;box-shadow:0 8px 28px rgba(var(--navy-rgb),0.05);}
.cm-native-caption{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;border-top:1px solid var(--line2);font-size:var(--fs-sm);font-weight:650;color:var(--muted);}
.cm-native-caption strong{color:var(--ink2);}
.cm-continuum{overflow-x:auto;}
.cm-continuum-head{display:grid;grid-template-columns:1fr 1fr;background:linear-gradient(135deg,#10243d,#17375e);color:#fff;}
.cm-continuum-head,.cm-continuum-grid{min-width:680px;}
.cm-continuum-head div{padding:14px 16px;}
.cm-continuum-head strong{display:block;font-size:var(--fs-lg);font-weight:var(--fw-heavy);letter-spacing:-0.015em;}
.cm-continuum-head span{display:block;margin-top:3px;font-size:var(--fs-sm);line-height:1.4;color:rgba(255,255,255,0.78);}
.cm-continuum-grid{display:grid;grid-template-columns:132px 1fr 1fr;}
.cm-cont-row{display:contents;}
.cm-cont-label,.cm-cont-cell{padding:13px 14px;border-top:1px solid var(--line2);font-size:var(--fs-base);line-height:1.45;}
.cm-cont-label{font-size:var(--fs-xs);font-weight:var(--fw-black);letter-spacing:0.065em;text-transform:uppercase;color:var(--muted);background:var(--off);}
.cm-cont-cell{color:var(--ink2);}
.cm-cont-cell strong{display:block;color:var(--ink);font-size:var(--fs-md);margin-bottom:3px;}
.cm-spend-wrap{width:100%;max-width:100%;overflow-x:auto;}
.cm-spend-table{width:100%;border-collapse:separate;border-spacing:0;min-width:720px;}
.cm-spend-table th{background:#142f4d;color:#fff;text-align:left;font-size:var(--fs-sm);font-weight:var(--fw-heavy);letter-spacing:0.035em;text-transform:uppercase;padding:12px 14px;}
.cm-spend-table td{vertical-align:top;padding:13px 14px;border-top:1px solid var(--line2);font-size:var(--fs-base);line-height:1.45;color:var(--ink2);}
.cm-spend-table td:first-child{width:22%;font-weight:var(--fw-heavy);color:var(--ink);background:var(--off);}
.cm-spend-table tr:nth-child(even) td:not(:first-child){background:var(--off);}
.cm-vehicle-table td:first-child{width:15%;font-weight:var(--fw-black);color:var(--cm-txt);background:var(--cm-bg);}
.cm-vehicle-table td:nth-child(2){width:31%;font-weight:var(--fw-heavy);color:var(--ink);}
.cm-vehicle-table td:nth-child(4){width:12%;font-weight:var(--fw-heavy);color:var(--muted);}
.srclink{font-size:12px;font-weight:500;color:var(--muted);text-decoration:none;white-space:nowrap;margin-left:8px;vertical-align:2px}
.srclink:hover{color:var(--accent);text-decoration:underline}
/* Paragraph nesting — the rulebook's own tiering. acquisition.gov indents 24px per
   level (ListL1/ListL2/…) and the corpus already stores that depth as L0:/L1:/L2:
   markers, so match their scale rather than inventing one. Every level keeps the
   SAME ink: in a regulation the operative rule is often at (1)(i), and fading the
   deeper paragraphs makes the binding text the hardest to read on the page. */
/* break-word, not normal: the corpus carries bare URLs as plain text (e.g. the
   Mentor-Protege program address in 19.302-2), and an unbreakable token pushed
   12px of the page off-screen at 375 while the tail of the URL was clipped
   unreadably — the one thing a reader needs to be able to copy by eye. */
.lvl{margin:0 0 10px;overflow-wrap:break-word}
.lvl-1{padding-left:24px}
.lvl-2{padding-left:48px}
.lvl-3{padding-left:72px}
.lvl-4{padding-left:96px}
@media(max-width:640px){
  .lvl-1{padding-left:13px}
  .lvl-2{padding-left:26px}
  .lvl-3{padding-left:39px}
  .lvl-4{padding-left:52px}
}
/* Clause variants (Basic / Alternate N) — jump strip + anchored headings */
.alt-nav{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin:0 0 20px;padding:12px 14px;border:1px solid var(--line2);border-left:3px solid var(--brass);border-radius:var(--r-md);background:rgba(var(--brass-rgb),.04)}
.alt-nav-lbl{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-right:3px}
.alt-nav a{font-size:12.5px;font-weight:650;color:var(--brass-ink);text-decoration:none;border:1px solid var(--brass-line);border-radius:999px;padding:3px 11px;white-space:nowrap}
.alt-nav a:hover{background:rgba(var(--brass-rgb),.10)}
.alt-head{scroll-margin-top:18px;font-family:var(--serif);font-size:20px;font-weight:700;margin:34px 0 10px;padding-top:14px;border-top:1px solid var(--line2)}
.alt-head a{color:var(--ink);text-decoration:none}
.alt-head a:hover{color:var(--accent)}
.sec p{margin:.5em 0;font-size:15px;overflow-wrap:break-word}
.sec p a{color:var(--accent);text-decoration:underline;text-underline-offset:2px}.sec p a:hover{color:var(--brass-ink)}
.parts{columns:2;gap:24px}.parts a{display:block;padding:7px 0;color:var(--accent);text-decoration:none;font-size:15px;break-inside:avoid}
.parts a:hover{text-decoration:underline}
footer{margin-top:40px;border-top:1px solid var(--line);padding-top:18px;font-size:13px;color:var(--muted)}
footer a{color:var(--accent)}
table.devtable{width:100%;border-collapse:collapse;font-size:14px;margin-top:10px}
table.devtable th,table.devtable td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
table.devtable th{font-size:11.5px;text-transform:uppercase;letter-spacing:var(--ls-wide);color:var(--muted);border-bottom:2px solid var(--line)}
table.devtable tr:hover td{background:#f7f6f2}
table.devtable td a{color:var(--accent);text-decoration:none}table.devtable td a:hover{text-decoration:underline}
table.devtable .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;white-space:nowrap}
.ratetable-wrap{overflow-x:auto;margin:14px 0}
@media (hover:hover) and (pointer:fine){table.ratetable tbody tr:hover th,table.ratetable tbody tr:hover td{background:rgba(var(--brass-rgb),0.05)}}
table.ratetable{width:100%;border-collapse:collapse;font-size:14.5px;line-height:1.5}
table.ratetable th,table.ratetable td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
table.ratetable thead th{font-size:11.5px;text-transform:uppercase;letter-spacing:var(--ls-wide);color:var(--muted);border-bottom:2px solid var(--line);white-space:nowrap}
table.ratetable tbody th{font-weight:700;color:var(--ink);white-space:nowrap}
table.ratetable tbody td{color:#3d444d}
table.ratetable tr:last-child th,table.ratetable tr:last-child td{border-bottom:none}
@media(max-width:560px){.parts{columns:1}table.devtable{font-size:12.5px}table.devtable th,table.devtable td{padding:7px 6px}}
.libcat{padding:30px 0 8px;border-top:none}
.libcat+.libcat{border-top:1px solid var(--line);padding-top:32px}
.libcat .eyebrow{display:flex;align-items:center;gap:9px;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--brass);margin:0 0 6px}
.libcat .eyebrow::before{content:"";width:18px;height:2px;background:var(--brass);border-radius:2px}
.libcat h2{font-size:22px;letter-spacing:var(--ls-tight);margin:0 0 5px}
.libcat .catblurb{color:var(--muted);font-size:14px;margin:0 0 18px;max-width:660px;line-height:1.55}
/* feature "report cover" cards — matte federal-ink + brass seal + engraved vault emblem */
/* auto-FIT, not auto-fill: the container resolves to 4 tracks, so the 1-card
   Templates band left 3 empty tracks and the 2-card Field Guides band left 2.
   auto-fit collapses the empties so each band fills its row. .libsrc-grid below
   stays auto-fill — its 8 cards fill 4 tracks exactly, and fitting would
   stretch them. */
.libgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(232px,1fr));gap:14px}
.libfeat{display:flex;flex-direction:column;background:#fff;border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;text-decoration:none;color:inherit;box-shadow:0 1px 2px rgba(var(--shadow-rgb),.04);transition:box-shadow .2s,transform .18s,border-color .18s}
.libfeat:hover{border-color:rgba(var(--brass-rgb),.35);box-shadow:0 16px 34px -16px rgba(var(--navy-rgb),.34);transform:translateY(-3px)}
.libcover{position:relative;height:120px;padding:14px 16px;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;background:linear-gradient(158deg,#173a60,#0f2540 56%,#0a1c33)}
.libcover::before{content:"";position:absolute;inset:0;opacity:.5;background:repeating-radial-gradient(circle at 84% 128%,rgba(202,168,95,.05) 0 1px,transparent 1px 9px)}
.libcover::after{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,#8a641d,#e4c477 50%,#8a641d)}
.libcover svg{position:absolute;right:-18px;bottom:-22px;width:120px;height:120px;opacity:.22}
.libcover .kind{position:relative;font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#dcc081}
.libcover .vol{position:relative;font-family:var(--serif);font-weight:700;font-size:30px;color:#f3f6fa;line-height:1}
.libcover .vol small{display:block;font-family:Inter,system-ui,sans-serif;font-size:10px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:rgba(214,226,240,.62);margin-bottom:5px}
.libfeat-body{display:flex;flex-direction:column;gap:5px;padding:14px 16px;flex:1}
.libfeat-body h3{font-size:16px;font-weight:800;letter-spacing:var(--ls-tight);margin:0;line-height:1.25;color:var(--ink)}
.libfeat-body .desc{font-size:13px;color:#3d444d;line-height:1.5;margin:0;flex:1;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.libfeat-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px}
.libfeat-foot .m{font-size:12px;color:var(--muted);font-weight:600;font-variant-numeric:tabular-nums}
.libfeat-foot .dl{font-size:13px;font-weight:700;color:var(--accent);background:rgba(var(--brass-rgb),.07);border:1px solid rgba(var(--brass-rgb),.18);border-radius:999px;padding:5px 12px}
.libfeat:hover .libfeat-foot .dl{background:var(--accent);color:#fff}
/* source-document cards, color-coded to the search UI */
.libsrc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:12px}
.libsrc{position:relative;display:flex;flex-direction:column;gap:3px;background:#fff;border:1px solid var(--line);border-left:3px solid var(--src,#94a3b8);border-radius:var(--r-md);padding:13px 14px;text-decoration:none;color:inherit;transition:box-shadow .15s,transform .15s}
.libsrc:hover{box-shadow:0 8px 18px -8px rgba(var(--navy-rgb),.24);transform:translateY(-2px)}
.libsrc .nm{font-size:14.5px;font-weight:800;letter-spacing:var(--ls-snug);color:var(--ink);padding-right:20px;line-height:1.25}
.libsrc .sb{font-size:12px;color:var(--muted);font-weight:600}
.libsrc .mt{font-size:11px;color:var(--muted);margin-top:2px}
.libsrc .dl{position:absolute;top:12px;right:13px;font-size:14px;font-weight:800;color:var(--src,#94a3b8)}
.libsrc[data-src="rfo"]{--src:#24486f}.libsrc[data-src="r-dfars"]{--src:#33654a}.libsrc[data-src="far-companion"]{--src:#6a4a63}.libsrc[data-src="category-management"]{--src:#4d5a64}.libsrc[data-src="dafi-63-138"]{--src:#7e2f3a}.libsrc[data-src="fmr"]{--src:#6d6234}.libsrc[data-src="ssp"]{--src:#6f521a}.libsrc[data-src="pgi"]{--src:#7a5a4a}
.libnote{font-size:12.5px;color:var(--muted);margin:8px 0 0;line-height:1.55}
@media(max-width:560px){.libgrid,.libsrc-grid{grid-template-columns:1fr}}
/* ── Library themed full-bleed bands (homepage rhythm: navy hero / white / beige) ── */
:root{--off:#f7f6f2}
.lnav{background:#fff;border-bottom:1px solid var(--line2)}
.lnav-inner{max-width:1060px;margin:0 auto;padding:15px 24px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.lnav .brand{display:inline-flex;align-items:center;gap:9px;font-weight:800;font-size:18px;letter-spacing:-0.03em;color:var(--ink);text-decoration:none}
.lnav .brand svg{display:block;width:27px;height:27px;flex-shrink:0}
.lnav .cta{font-weight:650;font-size:14px;color:#fff;background:linear-gradient(160deg,var(--ink-from),var(--ink-mid));border:1px solid var(--brass-line);padding:8px 15px;border-radius:999px;text-decoration:none;transition:border-color .15s}
.lnav .cta:hover{border-color:rgba(var(--brass-bright-rgb),.55)}
.lband{width:100%}
.lband-inner{max-width:1060px;margin:0 auto;padding:54px 24px}
.lband--white{background:#fff}
.lband--off{background:var(--off)}
.lband--white+.lband--white{border-top:1px solid var(--line2)}
.lband .libcat{padding:0;border:none}
.lband .libcat+.libcat{padding:0;border:none}
.lhero{position:relative;overflow:hidden;background:linear-gradient(158deg,var(--ink-from),var(--ink-mid) 56%,var(--ink-to));color:#eaf1f8}
.lhero::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--brass-deep),var(--brass-bright) 50%,var(--brass-deep));z-index:2}
.lhero::after{content:"";position:absolute;right:-40px;bottom:-130px;width:440px;height:440px;opacity:.12;background:repeating-radial-gradient(circle at 50% 50%,rgba(var(--brass-bright-rgb),.6) 0 1px,transparent 1px 12px);pointer-events:none}
.lhero .lband-inner{position:relative;padding:54px 24px 52px}
.lhero .crumbs{font-size:13px;margin:0 0 14px;color:rgba(214,226,240,.72)}
.lhero .crumbs a{color:rgba(var(--brass-bright-rgb),.9);text-decoration:none}
.lhero .eyebrow{display:flex;align-items:center;gap:9px;font-size:11px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:var(--brass-bright);margin:0 0 13px}
.lhero .eyebrow::before{content:"";width:18px;height:2px;background:var(--brass-bright);border-radius:2px}
.lhero h1{font-family:var(--serif);font-weight:700;font-size:44px;letter-spacing:var(--ls-snug);line-height:1.04;margin:0 0 14px;color:#f4f8fc;max-width:15ch}
.lhero .lede{color:rgba(221,233,246,.85);font-size:16px;max-width:640px;margin:0 0 22px;line-height:1.6}
.lhero .stats{display:flex;flex-wrap:wrap;gap:9px}
.lhero .stat{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:#eaf1f8;background:rgba(255,255,255,.06);border:1px solid rgba(var(--brass-bright-rgb),.3);border-radius:999px;padding:6px 13px}
.lhero .stat b{color:var(--brass-bright);font-variant-numeric:tabular-nums}
.lhero .lib-seal{position:absolute;right:24px;top:50%;transform:translateY(-50%);width:120px;height:120px;z-index:1;filter:drop-shadow(0 8px 16px rgba(0,0,0,.42))}
@media(max-width:820px){.lhero .lib-seal{display:none}.lhero h1{font-size:34px}}
/* 48 CONS hero patch — same treatment as the library seal, but it survives on phones
   (that page's audience studies on them) by shrinking to the top-right corner instead
   of vanishing; the inner pads right so the crumbs and lede never run under it.
   The disc's navy is nearly the hero's navy, so a faint brass backlight and a layered
   shadow (tight contact + soft ambient) lift it off the band; the fade-in is opacity-only
   so it needs no reduced-motion carve-out. */
.cons-patch{position:absolute;right:26px;top:50%;transform:translateY(-50%);width:158px;height:auto;z-index:1;filter:drop-shadow(0 2px 5px rgba(0,0,0,.45)) drop-shadow(0 14px 28px rgba(0,0,0,.38));opacity:1;transition:opacity .5s ease}
@starting-style{.cons-patch{opacity:0}}
.lhero--cons .lband-inner::before{content:"";position:absolute;right:-52px;top:50%;transform:translateY(-50%);width:320px;height:320px;border-radius:50%;background:radial-gradient(circle,rgba(var(--brass-bright-rgb),.13),rgba(var(--brass-bright-rgb),.04) 45%,transparent 68%);pointer-events:none}
@media(max-width:900px){.cons-patch{width:92px;top:30px;transform:none;right:18px}.lhero--cons .lband-inner{padding-right:118px}.lhero--cons .lband-inner::before{width:190px;height:190px;right:-38px;top:16px;transform:none}}
/* margin-top/padding-top zeroed: the generic footer rule above ships margin-top:40px +
   padding-top:18px, which .lband--foot never overrode — so a 40px stripe of body white sat
   between two identical warm-paper bands, reading as an accidental fourth background. The
   band's own 1px rule is what should separate them. */
.lband--foot{background:var(--off);border-top:1px solid var(--line2);margin-top:0;padding-top:0}
.lband--foot .lband-inner{padding:30px 24px 42px}
.lfoot-note{font-size:12.5px;color:var(--muted);margin:0 0 14px;line-height:1.55;max-width:840px}
.lfoot-legal{font-size:12.5px;color:var(--muted);line-height:1.55;margin:0;max-width:840px}
.lfoot-legal a{color:var(--accent)}
@media(max-width:560px){.lband-inner{padding:40px 18px}.lhero .lband-inner{padding:40px 18px 38px}.lhero h1{font-size:30px}}
/* .lband--rail: opt a page's furniture onto the app column's rail. .lband-inner is 1060px and
   .st-wrap is 880px, so the hero/footer text sat 90px left of every heading in the app band —
   nav, hero and footer all agreed on one x, and only the middle third disagreed. Narrowing the
   furniture (rather than widening the app) keeps the reading measure that the sprint card and
   the intro form depend on. Opt-in by class: nothing else on the site moves. */
.lband--rail .lband-inner{max-width:880px}
/* The hero is 66% of a 390px viewport and never collapses, so nothing actionable was on the
   first screen of a phone — the device this page is actually studied on. */
@media(max-width:560px){.lband--rail.lhero .lband-inner{padding:30px 18px 28px}.lband--rail.lhero .lede{font-size:15px}.lband--rail.lhero .stats{gap:7px}.lband--rail.lhero .stat{font-size:12px;padding:5px 11px}}
/* ── PART NAV: Contents · in-part search · back-to-top (assets/part-nav.js) ──
   The Contents is server-rendered and works without JS; the search bar and the
   back-to-top button are built by the script, so nothing here is a dead control
   when JS is off. Brass on warm paper, matching the in-app reader. */
.ptoc{border:1px solid var(--line2);border-left:3px solid var(--brass);border-radius:var(--r-md);background:rgba(var(--brass-rgb),.035);margin:0 0 26px;overflow:hidden}
.ptoc-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:13px 16px 9px;border-bottom:1px solid var(--line2)}
.ptoc-head h2{font-family:var(--serif);font-size:17px;font-weight:700;margin:0;letter-spacing:var(--ls-snug)}
.ptoc-count{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-variant-numeric:tabular-nums}
/* Scrolls internally: a 60-section part must not cost 60 rows of page before
   the reader reaches the text they came for. */
.ptoc-list{list-style:none;margin:0;padding:8px 6px;max-height:min(46vh,380px);overflow-y:auto;overscroll-behavior:contain}
.ptoc-list li{margin:0}
.ptoc-list a{display:block;padding:9px 12px;border-radius:7px;font-size:14px;line-height:1.4;color:var(--ink);text-decoration:none;overflow-wrap:break-word}
.ptoc-list a:hover{background:rgba(var(--brass-rgb),.09);color:var(--brass-ink)}
.pn-skip{position:absolute;left:-9999px;top:0;z-index:100;padding:10px 16px;background:#0f2540;color:#fff;font-weight:600;border-radius:0 0 8px 0}
.pn-skip:focus{left:0}
.part-main{min-width:0}
.ptoc-list a.ptoc-active{background:rgba(var(--brass-rgb),.10);color:var(--brass-ink);font-weight:600;box-shadow:inset 2px 0 0 var(--brass)}
@media(min-width:1000px){.part-cols{display:grid;grid-template-columns:minmax(0,1fr) 224px;gap:44px;align-items:start}.part-main{grid-column:1;grid-row:1;min-width:0}.ptoc{grid-column:2;grid-row:1;position:sticky;top:16px;margin:0;max-height:calc(100vh - 32px);display:flex;flex-direction:column}.ptoc .ptoc-list{max-height:none;overflow-y:auto}}
.pn-search{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:9px;margin:0 0 16px;padding:0 8px 0 13px;min-height:48px;border:1.5px solid rgba(var(--brass-rgb),.2);border-radius:12px;background:#fff;box-shadow:0 6px 20px rgba(var(--navy-rgb),.07)}
.pn-search:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px rgba(var(--brass-rgb),.16)}
/* Visually hidden, not absent: the input needs a real label, not a placeholder. */
.pn-search-lbl{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.pn-search-icon{display:flex;color:var(--muted);flex-shrink:0}
.pn-search-icon svg{width:15px;height:15px;display:block}
.pn-search-input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:var(--ink);padding:12px 0}
.pn-search-input::-webkit-search-cancel-button{display:none}
.pn-search-count{font-size:12px;font-weight:700;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.pn-search-nav{display:none;gap:2px}
.pn-search-nav.visible{display:inline-flex}
.pn-step,.pn-clear{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;border:0;background:transparent;color:var(--muted);font-size:15px;line-height:1;cursor:pointer;border-radius:8px}
.pn-step:hover:not(:disabled),.pn-clear:hover{background:rgba(var(--brass-rgb),.1);color:var(--brass-ink)}
.pn-step:disabled{opacity:.35;cursor:default}
.pn-clear{display:none}
.pn-clear.visible{display:inline-flex}
mark.pn-mark{background:rgba(var(--brass-rgb),.22);color:var(--ink);border-radius:2px;padding:0 1px}
mark.pn-mark.active{background:var(--brass-bright);box-shadow:0 0 0 2px rgba(var(--brass-rgb),.45)}
.pn-top{position:fixed;right:18px;bottom:18px;z-index:60;display:inline-flex;align-items:center;gap:7px;min-height:44px;padding:0 16px;border:1px solid var(--brass-line);border-radius:999px;background:linear-gradient(160deg,var(--ink-from),var(--ink-mid));color:#fff;font:inherit;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 10px 26px rgba(var(--navy-rgb),.28);opacity:0;visibility:hidden;transform:translateY(8px);transition:opacity .18s,transform .18s,visibility .18s}
.pn-top.visible{opacity:1;visibility:visible;transform:translateY(0)}
.pn-top:hover{border-color:rgba(var(--brass-bright-rgb),.6)}
.pn-top svg{width:15px;height:15px;display:block}
@media(prefers-reduced-motion:reduce){.pn-top{transition:none}}
@media(max-width:560px){.ptoc-list{max-height:min(40vh,300px)}.pn-top{right:12px;bottom:12px}}
/* Touch has no pointer to move away, so a mobile browser latches :hover on tap and
   the lift never comes back down — the card you opened stays 3px high behind the
   next page. Cancel the lift only; colour and shadow feedback are harmless. */
@media (hover:none){.libfeat:hover,.libsrc:hover{transform:none}}
/* prefers-contrast: more — token override, so every card edge, divider, caption
   and chip on every server-rendered page follows without a component rule.
   STYLE is injected by shell() into ALL of them, /study and /48cons included
   (those two carry STYLE in the head and STUDY_CSS in the body, and no external
   stylesheet at all), so this one block is the whole surface. Mirrors the
   app.css block that covers the search app. --ink3 is declared here because
   STUDY_CSS reads it as var(--ink3,#474c55) — without it the fallback wins and
   the study intro copy would stay the one grey that did not lift. */
@media (prefers-contrast:more){
:root{--muted:#33323a;--muted2:#33323a;--ink3:#262a31;--line:#4a4335;--line2:#8c8577}
:where(button,a,[role="button"],input,select,textarea,[tabindex]):focus-visible{outline-width:3px;outline-offset:2px}
}`;

function shell({ title, description, canonical, jsonld, body, wide, bleed, ogImage, source, partNav, noindex }) {
  const og = ogImage || 'og-home-v2.png';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${description}">
${noindex ? '<meta name="robots" content="noindex, nofollow">\n' : ''}<link rel="canonical" href="${canonical}">
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
<a class="pn-skip" href="#main">Skip to content</a>
<header class="site"><a class="brand" href="/?home=1"><svg viewBox="0 0 100 100" aria-hidden="true"><rect x="6" y="6" width="88" height="88" rx="16" fill="#0f2540"/><rect x="13" y="13" width="74" height="74" rx="11" fill="none" stroke="rgba(var(--brass-bright-rgb),.5)" stroke-width="1.5"/><circle cx="50" cy="50" r="22" fill="none" stroke="#e4c477" stroke-width="3"/><g stroke="#e4c477" stroke-width="3.4" stroke-linecap="round"><line x1="50" y1="32" x2="50" y2="40"/><line x1="50" y1="68" x2="50" y2="60"/><line x1="32" y1="50" x2="40" y2="50"/><line x1="68" y1="50" x2="60" y2="50"/></g><circle cx="50" cy="50" r="5" fill="#e4c477"/></svg>AcqVault</a><span class="hdr-links"><a class="hlink" href="/?home=1">Home</a><a class="cta" href="/?q=">Search all sources →</a></span></header>
<main id="main" tabindex="-1">${body}</main>
<footer>AcqVault is an <strong>unofficial research aid</strong> — not legal advice and not an official source. ${authorityLine(source)} Always verify before relying on any result in a contract file.</footer>
</div>`}
${partNav ? `<script src="/assets/part-nav.js?v=${PART_NAV_V}" defer></script>` : ''}
<script src="/assets/analytics.js?v=${ANALYTICS_V}" defer></script>
</body>
</html>`;
}

function renderPartPage(source, part) {
  const meta = SOURCES[source];
  const { groups } = partsForSource(source);
  const docs = groups.get(String(part));
  if (!meta || !docs || !docs.length) return null;
  const canonical = `${SITE}/${source}/part-${encodeURIComponent(part)}`;
  const label = partLabel(source, part);   // "Part 6" for most; "Appendix A — Debriefing Guide" for ssp
  const title = `${meta.short} ${label} — ${meta.name} | AcqVault`;
  const descPlain = metaDescription(docs);
  const description = esc(descPlain);   // meta/og attributes need escaping; JSON-LD does not

  // Sources published as one document (the SSP, for instance) give every section the
  // same landing page, so a per-section credit repeats one URL dozens of times down
  // the page. When the whole part shares a URL, credit it once above the sections.
  const srcref = url => /dps\.mil/i.test(url)
    ? `<p class="srcref">Reproduced from the DAF Contracting Compass (the official DAF source is CAC-gated).</p>`
    // A bare URL printed under every heading competed with the regulation for
    // attention and wrapped onto two lines; the link is the useful part, the
    // 90-character path is not.
    : `<p class="srcref">Source: <a href="${esc(url)}" rel="noopener nofollow">acquisition.gov</a></p>`;
  const urls = new Set(docs.map(d => d.url).filter(Boolean));
  const sharedUrl = (urls.size === 1 && docs.every(d => d.url)) ? [...urls][0] : null;
  const partSrc = sharedUrl ? srcref(sharedUrl) : '';

  const pairIdx = pairIndexFor(source, part);
  const ownCounts = ownKeyCounts(docs);
  const sections = docs.map(d => {
    const anchor = esc(d.anchor || d.id);
    // Per-section provenance rides ON the heading rather than taking a line of its
    // own beneath it. Every section deep-linking to its official anchor is worth
    // keeping; spending a full line per section to say so is not.
    const src = (d.url && !sharedUrl && !/dps\.mil/i.test(d.url))
      ? ` <a class="srclink" href="${esc(d.url)}" rel="noopener nofollow">acquisition.gov</a>`
      : '';
    const compassNote = (d.url && !sharedUrl && /dps\.mil/i.test(d.url)) ? srcref(d.url) : '';
    return `<section class="sec" id="${anchor}">
<div class="sec-hd"><h2><a href="#${anchor}">${esc(d.title)}</a></h2>${src}</div>
${compassNote}
${pairChip(source, d, pairIdx, ownCounts)}
${supersededChip(d)}
${renderContent(d.content, d.title, anchor, d.tables, source, part)}
</section>`;
  }).join('\n');

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'Article',
    headline: `${meta.name} — ${label}`,
    description: descPlain,
    isPartOf: { '@type': 'WebSite', name: 'AcqVault', url: SITE },
    publisher: { '@type': 'Organization', name: 'AcqVault', url: SITE },
    mainEntityOfPage: canonical
  };

  // Contents — server-rendered so it works, and crawls, with JavaScript off.
  // These pages run 62,000–137,000px tall and had no way to move within them;
  // the in-app reader has had a Contents for months. Scrolls internally rather
  // than growing with the section count, so a 60-section part costs the same
  // screen as a 6-section one.
  const toc = docs.length > 1 ? `<nav class="ptoc" id="ptoc" aria-labelledby="ptoc-h">
<div class="ptoc-head"><h2 id="ptoc-h">Contents</h2><span class="ptoc-count">${docs.length} section${docs.length !== 1 ? 's' : ''}</span></div>
<ol class="ptoc-list">${docs.map(d => {
    const a = esc(d.anchor || d.id);
    return `<li><a href="#${a}">${esc(d.title)}</a></li>`;
  }).join('')}</ol>
</nav>` : '';

  const body = `<nav class="crumbs" aria-label="Breadcrumb"><a href="/?home=1">AcqVault</a> › <a href="/${source}">${esc(meta.name)}</a> › ${esc(label)}</nav>
<h1>${esc(meta.name)} · ${esc(label)}</h1>
<p class="lede">${esc(meta.desc)} Full text of ${esc(label)} (${docs.length} section${docs.length !== 1 ? 's' : ''}), searchable at <a href="/?q=part%20${esc(part)}">AcqVault</a>.</p>
${partPairBanner(source, part, pairIdx)}
${partSrc}
<div class="part-cols">${toc}<div class="part-main">${sections}</div></div>`;

  return shell({ title, description, canonical, jsonld, body, source, ogImage: `og-src-${source}-v2.png`, partNav: true, wide: docs.length > 1 });
}

function renderHubPage(source) {
  const meta = SOURCES[source];
  if (!meta) return null;
  const { parts } = partsForSource(source);
  if (!parts.length) return null;
  const canonical = `${SITE}/${source}`;
  const title = `${meta.name} — full text & parts | AcqVault`;
  const description = esc(clampDesc(meta.desc, 155));

  const names = partNames()[source] || {};
  const links = parts.map(p => {
    const nm = names[String(p)] || names[String(displayPartForSource(source, p))];
    return `<a href="/${source}/part-${encodeURIComponent(p)}">${esc(partLabel(source, p))}` +
           (nm ? `<span class="hublabel">${esc(nm)}</span>` : '') + `</a>`;
  }).join('\n');

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
<p class="lede">${esc(meta.desc)} Browse all ${parts.length} ${hubUnit(source, parts.length)} below, or <a href="/?home=1">search the full text</a>.</p>
${devLink}
<div class="parts">${links}</div>`;

  return shell({ title, description, canonical, jsonld, body, source, ogImage: `og-src-${source}-v2.png` });
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
<p class="lede">Every DoD class deviation implementing the Revolutionary FAR Overhaul (${rows.length} deviations), with its RFO part, legacy DFARS reference, effective date, and DARS tracking number. Click a part for the full text on AcqVault, or the signed memo for the authoritative source.</p>
<table class="devtable">
<thead><tr><th scope="col">RFO Part</th><th scope="col">Legacy DFARS ref</th><th scope="col">Effective</th><th scope="col">DARS Tracking #</th><th scope="col">Read</th></tr></thead>
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
  const description = esc(`Free downloadable AcqVault field guides and templates for the DoD acquisition community, plus the full text of every indexed source (RFO, R-DFARS, the R-DFARS PGI, FAR Companion, Category Management, DAFI 63-138, the DoD FMR, and the DoD Source Selection Procedures). ${totalItems} resources, no account required.`);

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
        // Three link kinds: an external official PDF (new tab), a compiled PDF we host
        // (download), or an in-app browse hub like /ssp — which is a page, so it navigates
        // normally. A download attribute on an internal page would try to save the HTML.
        const internalPage = !ext && !/\.pdf$/i.test(it.file || '');
        const attrs = ext ? 'target="_blank" rel="noopener"'
          : internalPage ? 'rel="noopener"'
          : `download="${esc(it.download || '')}" rel="noopener"`;
        const glyph = ext ? '↗' : internalPage ? '→' : '↓';
        return `<a class="libsrc" data-src="${esc(srcKey)}" href="${esc(it.file)}" ${attrs}>
<span class="dl" aria-hidden="true">${glyph}</span>
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
    hasPart: cats.flatMap(c => c.items.map(it => {
      // it.file may be an absolute URL (FMR → its official host), an internal HTML page
      // (SSP → /ssp browse hub), or a hosted PDF. The old code prefixed SITE onto all three,
      // producing "https://www.acqvault.comhttps://…" for FMR, and declared everything a PDF.
      const abs = /^https?:/i.test(it.file || '');
      const isPdf = /\.pdf$/i.test(it.file || '');
      const node = { '@type': isPdf ? 'DigitalDocument' : 'WebPage',
                     name: it.title, url: abs ? it.file : `${SITE}${it.file}` };
      if (isPdf) node.encodingFormat = 'application/pdf';
      return node;
    }))
  };

  const BRAND_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="6" y="6" width="88" height="88" rx="16" fill="#0f2540"/><rect x="13" y="13" width="74" height="74" rx="11" fill="none" stroke="rgba(var(--brass-bright-rgb),.5)" stroke-width="1.5"/><circle cx="50" cy="50" r="22" fill="none" stroke="#e4c477" stroke-width="3"/><g stroke="#e4c477" stroke-width="3.4" stroke-linecap="round"><line x1="50" y1="32" x2="50" y2="40"/><line x1="50" y1="68" x2="50" y2="60"/><line x1="32" y1="50" x2="40" y2="50"/><line x1="68" y1="50" x2="60" y2="50"/></g><circle cx="50" cy="50" r="5" fill="#e4c477"/></svg>';

  const body = `<header class="lnav"><div class="lnav-inner"><a class="brand" href="/?home=1">${BRAND_SVG}AcqVault</a><span class="hdr-links"><a class="hlink" href="/?home=1">Home</a><a class="cta" href="/?q=">Search all sources →</a></span></div></header>
<main>
<section class="lband lhero"><div class="lband-inner">
<nav class="crumbs"><a href="/?home=1">AcqVault</a> › Library</nav>
<div class="eyebrow">AcqVault · Library</div>
<h1>The reference shelf for federal&nbsp;acquisition</h1>
<p class="lede">Field guides, templates, and the full text of every indexed source — one place to pull what you need.</p>
<div class="stats"><span class="stat"><b>${totalItems}</b> resources</span><span class="stat">Free · no account</span><span class="stat">Source text re-indexed monthly</span></div>
<svg class="lib-seal" viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="ls-g" cx="36%" cy="30%" r="80%"><stop offset="0" stop-color="#f2d89a"/><stop offset="48%" stop-color="#cda857"/><stop offset="100%" stop-color="#876514"/></radialGradient></defs><circle cx="50" cy="50" r="47" fill="url(#ls-g)" stroke="#6f521a" stroke-width="1.5"/><circle cx="50" cy="50" r="42" fill="none" stroke="#6f521a" stroke-width="1" stroke-dasharray="1.2 2.6" opacity="0.55"/><circle cx="50" cy="50" r="22" fill="none" stroke="#16263f" stroke-width="2.4" opacity="0.9"/><g stroke="#16263f" stroke-width="3" stroke-linecap="round" opacity="0.9"><line x1="50" y1="33" x2="50" y2="41"/><line x1="50" y1="67" x2="50" y2="59"/><line x1="33" y1="50" x2="41" y2="50"/><line x1="67" y1="50" x2="59" y2="50"/></g><circle cx="50" cy="50" r="5.5" fill="#16263f" opacity="0.9"/></svg>
</div></section>
${catHtml}
</main>
<footer class="lband lband--foot"><div class="lband-inner">
<p class="lfoot-note"><strong>Originals</strong> are written by AcqVault as research aids. <strong>Source documents</strong> are compiled from official material and regenerated monthly.</p>
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

    const OTHER_LABELS = { r_dfars: 'R-DFARS', far_companion: 'FAR Companion', category_management: 'Category Mgmt', fmr: 'DoD FMR', afi_63_138: 'DAFI 63-138', ssp: 'DoD SSP' };
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
details.chg-part{border:1px solid var(--line2);border-radius:var(--r-md);padding:0;margin:8px 0;background:#fff}
details.chg-part summary{cursor:pointer;padding:10px 14px;font-size:14.5px;list-style-position:inside}
details.chg-part[open] summary{border-bottom:1px solid var(--line2)}
ul.chg-list{margin:8px 0 12px;padding:0 16px 0 34px;font-size:14px}
ul.chg-list li{padding:3px 0}
ul.chg-list a{color:var(--accent);text-decoration:none}ul.chg-list a:hover{text-decoration:underline}
.chg-kind{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:var(--ls-caps);text-transform:uppercase;border-radius:var(--r-sm);padding:1px 6px;margin-right:7px;vertical-align:1px}
.chg-kind-added{background:#f0fdf4;color:#166534}
.chg-kind-removed{background:#fff1f2;color:#991b1b}
ul.chg-other{font-size:13.5px;color:var(--muted);margin:4px 0 0;padding-left:22px}
</style>`;

  const body = `${CHG_STYLE}<nav class="crumbs"><a href="/?home=1">AcqVault</a> › What changed</nav>
<h1>What changed</h1>
<p class="lede">Each time AcqVault re-fetches a source it diffs the new text against the last copy and records the sections whose wording moved. This is that log — cite it when you need to show a regulation changed under you. It records CHANGES to text already indexed, so a source&rsquo;s first ingest does not appear here, and a source is listed only for the runs in which it was re-fetched. Section links open the current full text; always verify against the signed deviations and <a href="https://www.acquisition.gov/far-overhaul" rel="noopener">acquisition.gov</a> before relying on a result in a contract file.</p>
${runHtml}`;

  return shell({ title, description, canonical, jsonld, body });
}

// ── /study — the client-side drill room (Basic/Advanced tracks; assets/study.js does the work) ──
// Shared by /study and the unlisted /48cons page — module scope so the two cannot drift.
const STUDY_CSS = `<style>
.lband--room{position:relative;overflow:hidden;background:var(--off);border-top:1px solid rgba(var(--brass-rgb),.16)}
.st-guilloche{position:absolute;right:-150px;top:-120px;width:520px;height:520px;opacity:.06;pointer-events:none;-webkit-mask-image:radial-gradient(circle at 50% 50%,#000 38%,transparent 72%);mask-image:radial-gradient(circle at 50% 50%,#000 38%,transparent 72%)}
.st-guilloche svg{width:100%;height:100%}
.st-wrap{position:relative;max-width:880px;margin:0 auto;padding:38px 24px 74px}
#study-app{min-height:420px}
/* line-height was inheriting body 1.6 — a 38.4px line box around a 24px cap, and the only
   broken step in the page's leading curve (h1 1.04, .st-sim-title 1.15). Leading tracks size
   inversely; the extra margin-bottom gives back the space the tall line box was providing. */
.st-h2{font-family:var(--serif);font-size:24px;color:var(--ink);letter-spacing:-.012em;line-height:1.15;margin:30px 0 10px}
#study-app>.st-h2:first-child{margin-top:0}
/* 64ch. This was the smallest body size on the page AND the widest measure (84 cpl at 832px)
   — the two errors compound. The neighbouring .st-intro and .st-summary .st-sub already cap. */
.st-sub{color:var(--muted);font-size:14px;margin:0 0 14px;line-height:1.55;max-width:64ch}
.st-intro{font-size:14.5px;line-height:1.6;color:var(--ink3,#474c55);margin:0 0 22px;max-width:60ch}
.st-intro b{color:var(--ink);font-weight:700}
.st-lad-cum{display:inline;color:var(--brass-ink);font-weight:700}
/* Board Introduction Builder (48 CONS page). Reuses the board-sim input idiom (.st-bd-bluf)
   so the builder reads as the same tool, not a bolted-on form.
   .st-sim-feature is an <a> on /study but a <button> here (it swaps a view, it does not
   navigate) — and a button resets width, text-align and font, so the card came out narrow
   and centred. Normalise those three, and add the press feedback a real button owes you;
   the base rule already transitions transform, so :active only needs the value. */
button.st-sim-feature{width:100%;text-align:left;font:inherit;cursor:pointer}
/* transform is ONE property, and button.st-sim-feature:active (0,2,1) outranks
   .st-sim-feature:hover (0,2,0) — so pressing a hovered card REPLACED the -2px lift instead
   of composing with it, and the card fell 2px while it shrank. The lift has to be restated in
   the pressed state to compose. The plain :active (no lift) is what touch gets, where there
   is no hover to preserve; :hover:active (0,3,1) wins on a mouse regardless of order. */
button.st-sim-feature:active{transform:scale(.985);transition-duration:.1s}
@media (hover:hover) and (pointer:fine){button.st-sim-feature:hover:active{transform:translateY(-2px) scale(.985);transition-duration:.1s}}
@media (prefers-reduced-motion:reduce){.st-sim-feature:hover,button.st-sim-feature:active,button.st-sim-feature:hover:active{transform:none}}
.st-intro-ta{resize:vertical;min-height:52px;font-family:inherit}
.st-intro-actions{display:flex;align-items:center;flex-wrap:wrap;gap:14px;margin-top:18px}
.st-intro-out:empty{display:none}
.st-intro-paper{margin-top:22px;padding:20px 22px;background:var(--off);border:1px solid var(--line2);border-radius:var(--r-md)}
.st-intro-h{margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--brass-ink)}
.st-intro-h+.st-intro-script{margin-bottom:18px}
.st-intro-script{margin:0;font-family:var(--serif);font-size:17px;line-height:1.62;color:var(--ink)}
.st-intro-script:last-child{margin-bottom:0}
.st-intro-note{font-size:12.5px;color:var(--muted);max-width:44ch}
@media print{
  /* Print the script alone — the board wants a card to rehearse from, not the whole page. */
  body>*{display:none !important}
  body>main{display:block !important}
  main .lband:not(.lband--room){display:none !important}
  .st-session-head,.st-bd-bluf-lab,.st-intro-ta,.st-intro-actions,.st-quit,.st-guilloche{display:none !important}
  .st-intro-paper{border:none;background:none;padding:0}
  .st-intro-script{font-size:15pt}
}
/* An <h2> now, not a <div>: the page exposed exactly two headings, so a screen-reader user
   rotoring past the ladder found nothing. font-family/font-size are restated because the
   element defaults to the serif h2 style, and the UA margin has to be zeroed. */
.st-tools-label{margin:36px 0 0;padding-top:22px;border-top:1px solid var(--line2);font-family:inherit;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--brass-ink)}
.st-head{display:flex;justify-content:flex-end;margin:0 0 12px}
.st-track-chip{font-size:12.5px;font-weight:700;color:var(--brass-ink);background:#f6efdd;border:1px solid rgba(var(--brass-rgb),.28);border-radius:999px;padding:5px 12px}
/* min-height 24 clears the WCAG 2.2 AA 2.5.8 target floor: these render 14px tall otherwise,
   and .st-quit is the ONLY exit from every view in the tool. The negative inline margin keeps
   the optical left edge where it was for the uses that sit inside a sentence. */
.st-link{background:none;border:none;color:var(--brass-ink);text-decoration:underline;cursor:pointer;font-size:12.5px;padding:5px 8px;margin:0 -8px;border-radius:6px;min-height:24px;display:inline-flex;align-items:center;font-family:inherit}
@media (hover:hover) and (pointer:fine){.st-link:hover{background:#f6efdd}}
.st-link:focus-visible{outline:3px solid var(--brass);outline-offset:2px}
.st-tracks{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
@media(max-width:640px){.st-tracks{grid-template-columns:1fr}}
.st-trackcard{display:flex;gap:0;align-items:stretch;text-align:left;background:#fff;border:1px solid var(--line2);border-radius:var(--r-lg);padding:0;overflow:hidden;cursor:pointer;transition:box-shadow .15s,transform .15s,border-color .15s;box-shadow:0 14px 34px -24px rgba(var(--navy-rgb),.35)}
.st-trackcard:hover{border-color:rgba(var(--brass-rgb),.5);box-shadow:0 20px 40px -20px rgba(var(--navy-rgb),.4);transform:translateY(-2px)}
.st-tcover{flex:none;width:88px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;background:linear-gradient(165deg,#173a60,#0f2540 62%,#0a1c33);border-right:1px solid rgba(var(--brass-bright-rgb),.35)}
.st-tcover svg{width:34px;height:34px}
.st-tcover-vol{font-family:var(--serif);font-weight:700;font-size:15px;color:#e4c477;letter-spacing:var(--ls-wide)}
.st-tc-body{padding:17px 18px 15px}
.st-tc-kicker{display:block;font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--brass);margin-bottom:5px}
.st-trackcard b{font-family:var(--serif);font-size:19px;letter-spacing:var(--ls-snug);color:var(--ink)}
.st-trackcard p{color:var(--muted);font-size:13.5px;line-height:1.55;margin:7px 0 0}
.st-daily{position:relative;overflow:hidden;display:block;width:100%;text-align:left;background:linear-gradient(158deg,#173a60,#0f2540 62%,#0a1c33);border:1px solid rgba(var(--brass-bright-rgb),.4);border-radius:16px;padding:22px 24px 20px;cursor:pointer;transition:border-color .15s,transform .15s,box-shadow .2s;box-shadow:0 22px 44px -22px rgba(var(--navy-rgb),.55)}
.st-daily::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--brass-deep),var(--brass-bright) 50%,var(--brass-deep))}
.st-daily::after{content:"";position:absolute;right:-60px;bottom:-140px;width:340px;height:340px;opacity:.12;background:repeating-radial-gradient(circle at 50% 50%,rgba(var(--brass-bright-rgb),.6) 0 1px,transparent 1px 12px);pointer-events:none}
.st-daily:hover{border-color:rgba(var(--brass-bright-rgb),.7);transform:translateY(-2px)}.st-daily:disabled,.st-daily-dead{cursor:default}.st-daily:disabled:hover,.st-daily-dead:hover{border-color:rgba(var(--brass-bright-rgb),.4);transform:none}
.st-daily-eyebrow{display:flex;align-items:center;gap:8px;font-size:10.5px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--brass-bright);margin-bottom:10px}
.st-daily-eyebrow::before{content:"";width:16px;height:2px;background:var(--brass-bright);border-radius:2px}
.st-daily-row{position:relative;display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
.st-daily-num{font-family:var(--serif);font-weight:700;font-size:52px;line-height:.95;color:#f4f8fc;letter-spacing:var(--ls-tight);font-variant-numeric:tabular-nums}
.st-daily-what{font-size:15px;font-weight:700;color:#f4f8fc}
.st-daily-sub{position:relative;display:block;color:rgba(221,233,246,.75);font-size:13px;line-height:1.5;margin-top:8px;max-width:52ch}
.st-daily-go{position:absolute;right:22px;top:50%;transform:translateY(-50%);font-size:22px;color:var(--brass-bright);transition:transform .15s}
.st-daily:hover .st-daily-go{transform:translateY(-50%) translateX(4px)}
.st-modes{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:12px 0 8px}
.st-mode{text-align:left;background:#fff;border:1px solid var(--line2);border-radius:12px;padding:15px 16px;cursor:pointer;transition:border-color .15s,box-shadow .15s,transform .15s;box-shadow:0 10px 26px -22px rgba(var(--navy-rgb),.4)}
.st-mode:hover{border-color:rgba(var(--brass-rgb),.5);box-shadow:0 14px 30px -18px rgba(var(--navy-rgb),.35);transform:translateY(-2px)}
.st-mode b{display:flex;align-items:center;font-size:15.5px;color:var(--ink);letter-spacing:var(--ls-snug)}
.st-mode span{display:block;color:var(--muted);font-size:12.5px;margin-top:6px;line-height:1.45}
.st-mode-ic{display:inline-flex;flex:none;width:28px;height:28px;border-radius:8px;background:#f6efdd;color:#87651c;align-items:center;justify-content:center;margin-right:9px}
.st-mode-ic svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.st-ready-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:30px 0 4px}
.st-ready-head .st-h2{margin:0}
.st-overall{font-size:13px;font-weight:800;color:var(--brass-ink);font-variant-numeric:tabular-nums;white-space:nowrap}
.st-topics{display:grid;grid-template-columns:1fr 1fr;gap:8px}
@media(max-width:760px){.st-topics{grid-template-columns:1fr}}
.st-topic{display:grid;grid-template-columns:1fr auto;grid-template-areas:"name name" "bar meta";gap:6px 10px;align-items:center;text-align:left;background:#fff;border:1px solid var(--line2);border-radius:var(--r-md);padding:11px 14px;cursor:pointer;min-height:44px;transition:border-color .13s,transform .13s,box-shadow .13s}
.st-topic:hover{border-color:rgba(var(--brass-rgb),.5);transform:translateY(-1px);box-shadow:0 8px 20px -14px rgba(var(--navy-rgb),.3)}
.st-topic-name{grid-area:name;font-size:13px;font-weight:700;color:var(--ink);line-height:1.3}
.st-bar{grid-area:bar;height:7px;background:#ece8dd;border-radius:99px;overflow:hidden}
/* The only one of the three identical progress bars in the repo with no transition —
   .st-prog span and .ss-prog span both slide. Same gradient, same job, so this read as an
   oversight rather than a decision. */
.st-bar-fill{display:block;height:100%;background:linear-gradient(90deg,#6f521a,#b8934a);border-radius:99px;transition:width .35s cubic-bezier(.23,1,.32,1)}
@media(prefers-reduced-motion:reduce){.st-bar-fill{transition:none}}
.st-topic-meta{grid-area:meta}
.st-topic-meta{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.st-topic-meta .st-due{color:var(--brass-ink);font-weight:700}
.st-btn:focus-visible,.st-topic:focus-visible,.st-mode:focus-visible,.st-trackcard:focus-visible{outline:3px solid var(--brass);outline-offset:2px}
.st-session-head{display:flex;justify-content:space-between;font-size:12.5px;font-weight:700;letter-spacing:var(--ls-widest);text-transform:uppercase;color:var(--brass-ink);margin:4px 0 8px}
.st-prog{height:5px;background:#ece8dd;border-radius:99px;overflow:hidden;margin:0 0 14px}
.st-prog span{display:block;height:100%;background:linear-gradient(90deg,#6f521a,#b8934a);border-radius:99px;transition:width .3s ease}
.st-prog-lg{height:8px;margin:14px 0 10px}
.st-card{position:relative;overflow:hidden;background:#fff;border:1px solid var(--line2);border-radius:16px;padding:26px 28px;box-shadow:0 24px 48px -26px rgba(var(--navy-rgb),.35)}
.st-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--brass-deep),var(--brass-bright) 50%,var(--brass-deep))}
@media(max-width:640px){.st-card{padding:20px 18px}}
.st-chip{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--brass-ink);background:#f6efdd;border-radius:var(--r-sm);padding:2px 8px;margin-bottom:12px}
.st-q{font-family:var(--serif);font-size:23px;line-height:1.32;color:var(--ink);letter-spacing:-.008em}
.st-a{margin-top:16px;padding-top:14px;border-top:1px dashed rgba(var(--brass-rgb),.4);font-size:15.5px;line-height:1.6;color:#2a3140}
.st-actions{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap}
/* Press feedback. Every action in the tool is a .st-btn — Reveal, the three grades, Study
   these cards, Face the board, Record — and none of them acknowledged a press at all, while
   .st-topic (a secondary list row, 20 lines up) already lifted on hover. 100ms press / 160ms
   release: the deliberate action snaps, the system's answer settles. */
.st-btn{border:none;border-radius:9px;padding:11px 18px;font-size:14.5px;font-weight:700;cursor:pointer;min-height:44px;transition:transform .16s cubic-bezier(.23,1,.32,1),box-shadow .16s,border-color .16s,filter .16s}
.st-btn:active:not(:disabled){transform:scale(.97);transition-duration:.1s}
.st-btn:disabled{opacity:.6;cursor:default}
@media(prefers-reduced-motion:reduce){.st-btn{transition:none}.st-btn:active:not(:disabled){transform:none}}
.st-btn kbd{font-family:ui-monospace,Menlo,monospace;font-size:10.5px;opacity:.65;font-weight:600;margin-left:5px;border:1px solid currentColor;border-radius:3px;padding:0 4px}
/* A keyboard hint on a device with no keyboard is noise. */
@media (pointer:coarse){.st-btn kbd{display:none}}
.st-btn-reveal{background:linear-gradient(158deg,#173a60,#0f2540 70%);color:#f4f8fc;box-shadow:0 10px 22px -14px rgba(var(--navy-rgb),.65)}
@media (hover:hover) and (pointer:fine){.st-btn-reveal:hover{filter:brightness(1.08);box-shadow:0 14px 26px -14px rgba(var(--navy-rgb),.78)}.st-btn-hint:hover:not(:disabled){border-color:var(--accent)}}
.st-btn-opts{background:#fff;color:var(--muted);border:1px solid var(--line2);font-weight:650}
.st-btn-opts:hover{border-color:rgba(var(--brass-rgb),.5);color:var(--brass-ink)}
.st-produce-hint{margin-top:14px;font-size:13px;font-style:italic;color:var(--muted2)}
.st-capped{margin-top:12px;font-size:13px;line-height:1.5;color:var(--brass-ink);background:#f6efdd;border:1px solid rgba(var(--brass-rgb),.28);border-radius:8px;padding:9px 12px}
.st-g1{background:#fdf0ef;color:#8c2b23;border:1px solid rgba(179,38,30,.3)}
.st-g2{background:#f6efdd;color:#5e4715;border:1px solid rgba(var(--brass-rgb),.3)}
.st-g3{background:#eef7f0;color:#155433;border:1px solid rgba(30,107,67,.3)}
/* flex + max-content + auto margins keeps the old centring while the padded hit area from
   .st-link applies — display:inline-flex alone would not centre. */
.st-quit{display:flex;width:max-content;margin:20px auto 0;padding:9px 12px}
.st-summary{text-align:center;padding:34px 28px}
.st-summary .st-q{font-size:24px}
.st-summary .st-actions{justify-content:center}
.st-summary .st-sub{max-width:46ch;margin:6px auto 0}
.st-sum-num{font-family:var(--serif);font-size:56px;color:var(--ink);letter-spacing:var(--ls-tight);line-height:1;margin:10px 0 4px}
.st-sum-num span{font-family:Inter,system-ui,sans-serif;font-size:17px;color:var(--muted);letter-spacing:0;font-weight:600}
.st-summary .st-prog-lg{max-width:340px;margin:16px auto 12px}
.st-scenario{background:linear-gradient(158deg,#173a60,#0f2540 70%);color:#dde9f6;border-left:3px solid #e4c477;border-radius:var(--r-md);padding:16px 18px;font-size:15px;line-height:1.6}
.st-scen-eyebrow{font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#e4c477;margin-bottom:8px}
.st-panel-ask{margin-top:12px;background:#f6efdd;border:1px solid rgba(var(--brass-rgb),.3);border-left:3px solid var(--brass);border-radius:0 var(--r-md) var(--r-md) 0;padding:12px 15px;font-size:15px;line-height:1.55;color:#2a3140;font-weight:600}
.st-ask-kicker{display:block;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--brass-ink);margin-bottom:5px}
.st-script{margin-top:16px;background:linear-gradient(158deg,#173a60,#0f2540 70%);border-left:3px solid #e4c477;border-radius:0 12px 12px 0;padding:16px 18px}
.st-script-head{font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#e4c477;margin-bottom:8px}
.st-script p{margin:0;font-size:14.5px;line-height:1.68;color:#dde9f6}
.st-fu-debrief{margin-top:14px;background:var(--off,#f7f6f2);border-left:3px solid rgba(var(--brass-bright-rgb),.9);border-radius:0 8px 8px 0;padding:13px 15px}
.st-fu-debrief-head{font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--brass-ink);margin-bottom:6px}
.st-fu-debrief p{margin:0;font-size:14px;line-height:1.6;color:#3d444d}
.st-scenario-sm{font-size:13px;opacity:.92;margin-bottom:14px}
.st-outloud{color:var(--brass-ink);font-size:13.5px;font-style:italic;margin:14px 0 0}
.st-fact{border-left:3px solid rgba(var(--brass-bright-rgb),.9);padding:7px 0 7px 12px;margin:10px 0;font-size:14px;line-height:1.55}
.st-fact b{color:var(--ink)}
.st-fact>div{color:#3d444d;margin-top:2px}
.st-bait{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#8c2b23;background:#fdf0ef;border-radius:3px;padding:1px 6px;margin-left:6px}
.st-gov{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#155433;background:#eef7f0;border-radius:3px;padding:1px 6px;margin-left:6px}
.st-followup{margin:6px 0 0}
.st-followup>span{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--brass)}
.st-lad-boards{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-top:10px;padding-top:11px;border-top:1px solid var(--line2)}
/* Ladder subject filter. A select, not chips — SAT alone carries 18 subjects. */
.st-lad-topic{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:13px}
.st-lad-topic-lab{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
/* The only native-chrome control on the site: OS chevron, OS focus ring, 40px against the
   44px every button uses, radius 8 against 9. It was also sized by its longest option, so
   switching rung changed its width by up to 19px and dragged "Clear" sideways — hence the
   fixed max-width. Chevron is an inline data URI: self-hosted, no request. %23 for the
   colour is required — a raw # ends the URI. */
.st-lad-topic-sel{font:inherit;font-size:13.5px;color:var(--ink);background:#fff;border:1px solid var(--line2);border-radius:9px;padding:10px 36px 10px 12px;min-height:44px;width:100%;max-width:420px;cursor:pointer;-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'><path d='M1 1.5 6 6.5 11 1.5' fill='none' stroke='%235e5d66' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/></svg>");background-repeat:no-repeat;background-position:right 13px center;background-size:12px 8px;transition:border-color .15s,box-shadow .15s}
@media (hover:hover) and (pointer:fine){.st-lad-topic-sel:hover{border-color:rgba(var(--brass-rgb),.5)}}
.st-lad-topic-sel:focus-visible{outline:3px solid var(--brass);outline-offset:2px}
/* 16px stops iOS Safari zooming the viewport on focus. */
@media(max-width:640px){.st-lad-topic-sel{font-size:16px}}
.st-lad-topic-clear{border:none;background:none;color:var(--accent);font:inherit;font-size:12.5px;font-weight:700;text-decoration:underline;cursor:pointer;min-height:40px;padding:0 4px}
/* My Cards. Deliberately NOT styled like the corpus cards — a warm neutral panel with an
   explicit unverified tag, so a card someone typed never reads as a checked one. */
.st-my-err{margin:0 0 12px;padding:9px 12px;border-radius:8px;background:#fdf3f2;border:1px solid rgba(140,43,35,.3);color:#8c2b23;font-size:13px;line-height:1.5}
.st-my-opt{font-weight:400;color:var(--muted)}
.st-my-list{margin-top:18px;display:flex;flex-direction:column;gap:10px}
.st-my-item{padding:13px 15px;background:#fbfaf7;border:1px solid var(--line2);border-left:3px solid var(--brass);border-radius:0 var(--r-md) var(--r-md) 0}
.st-my-item-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.st-my-tag{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--brass-ink);background:#f6efdd;border-radius:var(--r-sm);padding:2px 7px}
.st-my-subj{font-size:11.5px;color:var(--muted)}
.st-my-q{font-size:15px;font-weight:700;color:var(--ink);line-height:1.45}
.st-my-a{margin-top:5px;font-size:14px;color:#2a3140;line-height:1.55;white-space:pre-wrap}
.st-my-row{display:flex;gap:14px;margin-top:9px}
.st-my-act{font-size:12.5px}
.st-my-bar{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}
.st-my-meta{margin:10px 0 0;font-size:11.5px;color:var(--muted);line-height:1.5}
.st-my-warn{margin:12px 0 0;padding:9px 12px;border-radius:8px;background:#f6efdd;border:1px solid rgba(var(--brass-rgb),.3);color:#5e4715;font-size:12.5px;line-height:1.5}
/* Hide-a-card: reversible, so the ladder always says how many are out and offers them back. */
.st-lad-foot{display:flex;align-items:center;justify-content:center;gap:18px;flex-wrap:wrap}
.st-hide{color:var(--muted)}
.st-hide:hover{color:var(--accent)}
.st-lad-hidden{margin:8px 0 0;font-size:12.5px;color:var(--muted)}
.st-lad-unhide{border:none;background:none;padding:0;font:inherit;font-size:12.5px;font-weight:700;color:var(--accent);text-decoration:underline;cursor:pointer}
.st-lad-boards-lab{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.st-lad-boards-n{font-size:14px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}
.st-lad-boards-split{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}
/* ── The navy plate, shared by the study feature card and the ladder callout ──
   These were the same component written twice and drifting: identical brass
   hairline, identical 3px brass top rule, identical brass arrow, identical
   hover-brighten-and-lift, identical focus ring — but .st-sim-feature gated its
   hover on a fine pointer and .st-lad-sim did not, which is exactly the kind of
   divergence a duplicated component accumulates.
   Only the shared IDIOM lives here. Radius, padding, margin, shadow depth, the
   gradient stop and the arrow inset stay on each component: one is a feature
   card and the other an inline callout, and that difference is real. */
.st-sim-feature,.st-lad-sim{position:relative;display:block;overflow:hidden;text-decoration:none;border:1px solid rgba(var(--brass-bright-rgb),.4);transition:border-color .15s,transform .15s}
.st-sim-feature::before,.st-lad-sim::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--brass-deep),var(--brass-bright) 50%,var(--brass-deep))}
.st-sim-feature:focus-visible,.st-lad-sim:focus-visible{outline:3px solid rgba(var(--brass-bright-rgb),.6);outline-offset:2px}
.st-sim-go,.st-lad-sim-go{position:absolute;top:50%;transform:translateY(-50%);font-size:22px;color:var(--brass-bright);transition:transform .15s}
@media (hover:hover) and (pointer:fine){.st-sim-feature:hover,.st-lad-sim:hover{border-color:rgba(var(--brass-bright-rgb),.7);transform:translateY(-2px)}
.st-sim-feature:hover .st-sim-go,.st-lad-sim:hover .st-lad-sim-go{transform:translateY(-50%) translateX(4px)}}
.st-lad-sim{margin-top:14px;padding:18px 46px 18px 20px;background:linear-gradient(158deg,#173a60,#0f2540 64%,#0a1c33);border-radius:var(--r-lg);box-shadow:0 20px 42px -24px rgba(var(--navy-rgb),.6)}
.st-lad-sim-go{right:20px}
.st-lad-sim-kick{display:block;font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--brass-bright);margin-bottom:6px}
.st-lad-sim-t{display:block;font-family:var(--serif);font-size:19px;letter-spacing:var(--ls-snug);color:#f4f8fc;line-height:1.2}
.st-lad-sim-d{display:block;color:rgba(221,233,246,.8);font-size:13px;line-height:1.5;margin-top:6px;max-width:56ch}
.st-bd-bluf-lab{display:block;margin-top:15px;margin-bottom:6px;font-size:12.5px;font-weight:700;color:var(--ink)}
/* Board-sim notes: the written half of the record-and-assess loop. */
.st-bd-note{resize:vertical;min-height:66px;font-family:inherit}
.st-bd-note-lab{display:block;margin-top:18px;margin-bottom:6px;font-size:12.5px;font-weight:700;color:var(--ink)}
.st-bd-note-meta{margin:6px 0 0;font-size:11.5px;color:var(--muted)}
.st-lad-notes{margin-left:auto;border:1px solid rgba(var(--brass-rgb),.35);background:#f6efdd;color:#5e4715;border-radius:7px;padding:5px 11px;font:inherit;font-size:12px;font-weight:700;cursor:pointer;min-height:32px}
.st-lad-notes:hover{border-color:var(--accent)}
.st-bd-bluf{display:block;width:100%;box-sizing:border-box;padding:11px 13px;font-size:15px;line-height:1.45;color:var(--ink);background:#fff;border:1px solid var(--line2);border-radius:8px}
.st-bd-bluf:focus{outline:none;border-color:var(--brass);box-shadow:0 0 0 3px rgba(var(--brass-rgb),.13)}
.st-bd-echo{margin-top:2px;padding:12px 15px;background:#f6efdd;border:1px solid rgba(var(--brass-rgb),.3);border-left:3px solid var(--brass);border-radius:0 var(--r-md) var(--r-md) 0;font-size:15px;line-height:1.55;color:#2a3140}
.st-bd-echo-head{font-size:10.5px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:var(--brass-ink);margin-bottom:5px}
/* Board-sim answer recorder. The dot and the Stop button reuse #8c2b23 — the red the "Rough"
   verdict already uses — rather than adding a colour to the palette. */
.st-rec{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:14px 0 4px;padding:12px 14px;background:#fbfaf7;border:1px solid var(--line2);border-radius:var(--r-md)}
.st-rec-dot{display:inline-block;width:9px;height:9px;margin-right:8px;border-radius:50%;background:#8c2b23;vertical-align:-1px}
.st-rec-stop{background:#8c2b23;color:#fff}
.st-rec-stop .st-rec-dot{background:#fff}
.st-rec-time{font-variant-numeric:tabular-nums;font-size:14px;font-weight:700;color:var(--ink)}
.st-rec-live{font-size:13px;color:#8c2b23;font-weight:600}
.st-rec-audio{height:38px;max-width:100%;flex:1 1 220px;min-width:0}
.st-rec-del{font-size:13px}
.st-rec-err{flex:1 1 100%;font-size:13px;color:#8c2b23;line-height:1.5}
.st-rec-priv{flex:1 1 100%;margin:0;font-size:11.5px;color:var(--muted)}
.st-bd-echo-audio{display:block;margin-top:10px}
@media (prefers-reduced-motion:no-preference){
.st-rec-stop .st-rec-dot{animation:stRecPulse 1.4s ease-in-out infinite}
@keyframes stRecPulse{0%,100%{opacity:1}50%{opacity:.25}}
}
.st-bd-echo-none{background:var(--off,#f7f6f2);border-color:var(--line2);border-left-color:var(--line2);color:var(--muted);font-size:13.5px}
.st-bd-cites{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-top:13px}
.st-bd-cites-head{font-size:10.5px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:var(--muted)}
.st-bd-cite{font-size:12.5px;font-weight:700;color:#3d444d;background:var(--off,#f7f6f2);border:1px solid var(--line2);border-radius:var(--r-sm);padding:2px 8px}
.st-bd-sources{margin-top:16px;padding-top:14px;border-top:1px solid var(--line2);text-align:left}
.st-bd-sources-head{font-size:10.5px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:var(--muted);margin-bottom:9px}
.st-bd-source{padding:7px 0 7px 12px;border-left:2px solid var(--line2);margin-bottom:6px}
.st-bd-source-q{margin-top:3px;font-size:13.5px;line-height:1.6;color:#3d444d}
.st-bd-check{display:flex;flex-direction:column;gap:8px;margin-top:14px;text-align:left}
.st-bd-chk{display:flex;align-items:flex-start;gap:10px;width:100%;padding:12px 14px;font-size:14.5px;line-height:1.5;font-weight:600;color:#2a3140;text-align:left;background:#fff;border:1px solid var(--line2);border-radius:9px;cursor:pointer}
.st-bd-chk-box{flex:none;width:17px;height:17px;margin-top:1px;border:2px solid var(--line);border-radius:var(--r-sm);background:#fff}
.st-bd-chk:focus-visible{outline:3px solid var(--brass);outline-offset:2px}
.st-bd-chk-on{border-color:var(--brass);background:#f6efdd}
.st-bd-chk-on .st-bd-chk-box{border-color:var(--brass);background:var(--brass)}
.st-bd-capped{margin:11px 0 0;font-size:12.5px;font-style:italic;color:var(--muted)}
.st-bd-verdict{font-size:25px;font-weight:700;font-family:var(--serif);letter-spacing:.01em;margin-top:4px}
.st-bd-v1{color:#8c2b23}
.st-bd-v2{color:var(--brass-ink)}
.st-bd-v3{color:#155433}
.st-foot-tools{margin-top:26px;font-size:12.5px;color:var(--muted)}
.st-trackcard{position:relative}
.st-trackcard-active{border-color:rgba(var(--brass-rgb),.55);box-shadow:0 16px 34px -18px rgba(var(--navy-rgb),.4)}
.st-tc-continue{display:inline-block;margin-bottom:7px;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#5e4715;background:#f6efdd;border:1px solid rgba(var(--brass-rgb),.4);border-radius:999px;padding:2px 9px}
.st-opts{display:flex;flex-direction:column;gap:8px;margin-top:18px}
.st-opt{display:flex;align-items:baseline;gap:10px;text-align:left;background:#fff;border:1px solid var(--line2);border-radius:9px;padding:11px 14px;font-size:14.5px;line-height:1.5;color:#2a3140;cursor:pointer;min-height:44px;transition:border-color .12s,transform .12s,box-shadow .12s}
.st-opt:hover:not(:disabled){border-color:rgba(var(--brass-rgb),.5);transform:translateY(-1px);box-shadow:0 8px 18px -12px rgba(var(--navy-rgb),.3)}
.st-opt:focus-visible{outline:3px solid var(--brass);outline-offset:2px}
.st-opt kbd{flex:none;font-family:ui-monospace,Menlo,monospace;font-size:10.5px;color:var(--muted);border:1px solid var(--line2);border-radius:var(--r-sm);padding:1px 6px;min-width:20px;text-align:center;transition:background .12s,color .12s}
.st-opt:disabled{cursor:default;opacity:.7}
.st-opt-right{border-color:#1e6b43!important;background:#eef7f0;opacity:1!important;box-shadow:0 0 0 1px #1e6b43 inset}
.st-opt-right kbd{background:#1e6b43;border-color:#1e6b43;color:#fff}
.st-opt-wrong{border-color:#b3261e!important;background:#fdf0ef;opacity:1!important}
.st-opt-wrong kbd{background:#b3261e;border-color:#b3261e;color:#fff}
.st-explain{margin-top:16px;background:var(--off,#f7f6f2);border-left:3px solid rgba(var(--brass-bright-rgb),.9);border-radius:0 8px 8px 0;padding:13px 15px}
.st-explain p{font-size:14px;line-height:1.6;color:#3d444d;margin:0}
.st-verdict{font-size:12px;font-weight:800;letter-spacing:var(--ls-widest);text-transform:uppercase;margin-bottom:7px}
.st-verdict-right{color:#155433}
.st-verdict-wrong{color:#8c2b23}
.st-explain-ref{margin-top:9px;padding-top:8px;border-top:1px dashed rgba(var(--brass-rgb),.35);font-size:12.5px;color:var(--muted)}
.st-explain-ref b{color:var(--brass-ink);font-weight:700}
.st-walk{margin-top:18px;background:var(--off,#f7f6f2);border:1px solid rgba(var(--brass-rgb),.22);border-radius:var(--r-md);padding:16px 18px}
.st-walk-head{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--brass-ink);margin-bottom:10px}
.st-walk-head::before{content:"";display:inline-block;width:16px;height:2px;background:var(--brass);border-radius:2px;margin-right:8px;vertical-align:3px}
.st-walk ol{margin:0;padding:0;list-style:none;counter-reset:walk}
.st-walk ol>li{counter-increment:walk;position:relative;padding:0 0 12px 34px;font-size:14px;line-height:1.6;color:#3d444d}
.st-walk ol>li:last-child{padding-bottom:0}
.st-walk ol>li::before{content:counter(walk);position:absolute;left:0;top:1px;width:22px;height:22px;border-radius:50%;background:linear-gradient(158deg,#173a60,#0f2540);color:#e4c477;font-size:11.5px;font-weight:800;display:flex;align-items:center;justify-content:center;font-variant-numeric:tabular-nums}
.st-walk ol>li b{color:var(--ink)}
.st-walk ul{margin:7px 0 0;padding-left:18px}
.st-walk ul li{font-size:13.5px;line-height:1.55;color:#3d444d;padding:2px 0}
.st-btn-hint{background:#f6efdd;color:#5e4715;border:1px solid rgba(var(--brass-rgb),.35)}
.st-btn-hint:disabled{opacity:.55;cursor:default}
.st-hint-n{display:inline-block;background:#5e4715;color:#f6efdd;border-radius:999px;font-size:11px;padding:0 7px;margin-left:4px;font-variant-numeric:tabular-nums}
.st-hint{background:var(--off,#f7f6f2);border-left:3px solid rgba(var(--brass-bright-rgb),.9);border-radius:0 6px 6px 0;padding:9px 12px;font-size:13.5px;line-height:1.55;color:#3d444d;margin-top:10px}
.st-hint b{color:var(--brass-ink)}
.st-cites{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:10px}
.st-cites-lab{font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.st-cite{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:700;color:var(--brass-ink);background:#fff;border:1px solid rgba(var(--brass-rgb),.4);border-radius:999px;padding:4px 11px;text-decoration:none;transition:background .13s,border-color .13s,transform .13s}
.st-cite:hover{background:#f6efdd;border-color:rgba(var(--brass-rgb),.65);transform:translateY(-1px)}
.st-cite:focus-visible{outline:3px solid var(--brass);outline-offset:2px}
.st-streak{display:inline-flex;align-items:center;gap:6px;margin-right:auto;font-size:12.5px;font-weight:800;color:var(--brass-ink);background:linear-gradient(158deg,#f6efdd,#f1e5c6);border:1px solid rgba(var(--brass-rgb),.35);border-radius:999px;padding:5px 12px;font-variant-numeric:tabular-nums}
.st-streak svg{width:12px;height:12px;fill:var(--brass)}
@keyframes st-right-pulse{0%{box-shadow:0 0 0 1px #1e6b43 inset,0 0 0 0 rgba(30,107,67,.35)}100%{box-shadow:0 0 0 1px #1e6b43 inset,0 0 0 9px rgba(30,107,67,0)}}
.st-opt-right{animation:st-right-pulse .5s ease-out 1}
@keyframes st-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
/* games hub: third track card + level toggle */
.st-games-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.st-games-head .st-streak{margin:26px 0 0}
.st-sim-feature{background:linear-gradient(158deg,#173a60,#0f2540 62%,#0a1c33);border-radius:16px;padding:22px 54px 20px 24px;margin:14px 0 4px;box-shadow:inset 0 0 0 1px rgba(var(--brass-bright-rgb),.22),0 26px 50px -24px rgba(var(--navy-rgb),.6)}
.st-sim-feature::before{z-index:2}
.st-sim-feature::after{content:"";position:absolute;right:-60px;bottom:-150px;width:360px;height:360px;opacity:.12;background:repeating-radial-gradient(circle at 50% 50%,rgba(var(--brass-bright-rgb),.6) 0 1px,transparent 1px 12px);pointer-events:none}
.st-sim-kick{position:relative;display:block;font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--brass-bright);margin-bottom:7px}
.st-sim-title{position:relative;display:block;font-family:var(--serif);font-size:23px;letter-spacing:var(--ls-snug);color:#f4f8fc;line-height:1.15}
.st-sim-desc{position:relative;display:block;color:rgba(221,233,246,.82);font-size:13.5px;line-height:1.55;margin-top:7px;max-width:60ch}
.st-sim-chips{position:relative;display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:13px}
.st-sim-chip{font-size:12px;font-weight:800;color:var(--brass-bright);border:1px solid rgba(var(--brass-bright-rgb),.5);border-radius:999px;padding:4px 12px;letter-spacing:.02em;white-space:nowrap}
.st-sim-meta{font-size:12.5px;color:rgba(221,233,246,.72);font-variant-numeric:tabular-nums}
@media(prefers-reduced-motion:reduce){.st-sim-feature:hover .st-sim-go,.st-lad-sim:hover .st-lad-sim-go{transform:translateY(-50%)}}

/* ---- 48 CONS: the tools are SUBORDINATE to the ladder ---------------------------------
   On /study .st-sim-feature is a single feature card and the navy slab is right. On /48cons
   there are THREE of them stacked, and measured against the hero band they came out at
   532,051px² vs the hero's 531,340 — the secondary content carried the same visual mass as
   the page header, using byte-identical decoration (::before and ::after here were the same
   declarations as .lhero::before/::after). They were also 2.9x the height of the ladder the
   page is named after, and every one of them opens onto a calm white paper card.
   So on this page only they become the page's own light-card idiom — the same one .st-rung
   and the interior views already use. #study-app carries data-mode="48cons"; /study is
   untouched. The four text colours below are MANDATORY, not cosmetic: the defaults are tuned
   for navy and fail AA on white. */
/* flex column + margin-top:auto on the chips row: the grid stretches the three cards to equal
   height, but the descriptions run 2-3 lines, so the state chips sat at three different
   heights. Pinning the chips to the card floor lines them up across the row. */
#study-app[data-mode="48cons"] .st-sim-feature{display:flex;flex-direction:column;background:#fff;border:1px solid var(--line2);border-left:3px solid var(--brass);border-radius:0 var(--r-md) var(--r-md) 0;padding:15px 40px 14px 17px;margin:0;box-shadow:0 1px 3px rgba(16,24,40,.06)}
#study-app[data-mode="48cons"] .st-sim-chips{margin-top:auto;padding-top:12px;flex-wrap:wrap;row-gap:4px}
#study-app[data-mode="48cons"] .st-sim-feature::before,#study-app[data-mode="48cons"] .st-sim-feature::after{content:none}
@media (hover:hover) and (pointer:fine){#study-app[data-mode="48cons"] .st-sim-feature:hover{border-color:rgba(var(--brass-rgb),.5);border-left-color:var(--brass);box-shadow:0 10px 24px -16px rgba(var(--navy-rgb),.45)}}
#study-app[data-mode="48cons"] .st-sim-feature:focus-visible{outline:3px solid var(--brass)}
#study-app[data-mode="48cons"] .st-sim-kick{font-size:10px;letter-spacing:.14em;color:var(--brass-ink);margin-bottom:5px}
#study-app[data-mode="48cons"] .st-sim-title{font-family:var(--serif);font-size:18px;line-height:1.2;color:var(--ink)}
#study-app[data-mode="48cons"] .st-sim-desc{font-size:13px;line-height:1.5;color:var(--muted);margin-top:5px;max-width:46ch}
#study-app[data-mode="48cons"] .st-sim-chips{gap:10px}
#study-app[data-mode="48cons"] .st-sim-chip{font-size:11.5px;color:var(--brass-ink);border-color:rgba(var(--brass-rgb),.35);background:#f6efdd}
#study-app[data-mode="48cons"] .st-sim-meta{font-size:12px;color:var(--muted)}
#study-app[data-mode="48cons"] .st-sim-go{right:16px;font-size:18px;color:var(--brass-ink)}
/* Three abreast on desktop, stacked on a phone. The grid is what turns a 724px stack into
   one band; .st-tools exists only on this page. */
#study-app[data-mode="48cons"] .st-tools{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px}
@media(max-width:760px){#study-app[data-mode="48cons"] .st-tools{grid-template-columns:1fr}}




/* hub v3: status cards + done panel */
.st-hub-done{display:flex;gap:14px;align-items:flex-start;background:linear-gradient(158deg,#173a60,#0f2540 62%,#0a1c33);border:1px solid rgba(var(--brass-bright-rgb),.45);border-radius:var(--r-lg);padding:16px 20px;margin:0 0 14px;box-shadow:0 18px 38px -22px rgba(var(--navy-rgb),.55)}
.st-hub-done-mark{flex:none;width:34px;height:34px;border-radius:50%;background:#1e6b43;color:#fff;font-size:17px;font-weight:800;display:flex;align-items:center;justify-content:center}
.st-hub-done b{display:block;font-family:var(--serif);font-size:17px;color:#f4f8fc;margin-bottom:3px}
.st-hub-done span{display:block;font-size:13px;line-height:1.55;color:rgba(221,233,246,.78);font-variant-numeric:tabular-nums}
.st-plate-done{border-color:rgba(30,107,67,.65)}
.st-plate-done::before{background:linear-gradient(90deg,#155433,#1e6b43 50%,#155433)}
.st-plate-played .st-plate-eyebrow{color:#9fd4b4}
.st-hub-grid{display:flex;flex-direction:column;gap:2px}
.st-hub-gridrow{display:flex;gap:2px}
.st-hub-cell{width:13px;height:13px;border-radius:2.5px;background:rgba(244,248,252,.14)}
.st-hub-cell-c{background:#f4f8fc} /* on the dark plate the "correct" pole is paper-white — navy would vanish; white-vs-brass reads under every CVD type */
.st-hub-cell-p{background:#e4c477}
.st-hub-cell-a{background:rgba(244,248,252,.22)}
/* quick rounds: game plates */
.st-plates{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:12px 0 8px}
@media(max-width:640px){.st-plates{grid-template-columns:1fr}}
.st-plate{position:relative;overflow:hidden;text-align:left;background:linear-gradient(158deg,#173a60,#0f2540 62%,#0a1c33);border:1px solid rgba(var(--brass-bright-rgb),.4);border-radius:var(--r-lg);padding:18px 20px 16px;cursor:pointer;transition:border-color .15s,transform .15s,box-shadow .2s;box-shadow:0 18px 38px -22px rgba(var(--navy-rgb),.55)}
.st-plate::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--brass-deep),var(--brass-bright) 50%,var(--brass-deep))}
.st-plate:hover{border-color:rgba(var(--brass-bright-rgb),.75);transform:translateY(-2px)}
.st-plate:focus-visible{outline:3px solid rgba(var(--brass-bright-rgb),.55);outline-offset:2px}
.st-plate-eyebrow{display:block;font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--brass-bright);margin-bottom:11px}
.st-plate b{display:block;font-family:var(--serif);font-size:20px;letter-spacing:var(--ls-snug);color:#f4f8fc;margin:11px 0 5px}
.st-plate-sub{display:block;font-size:12.5px;line-height:1.5;color:rgba(221,233,246,.72)}
.st-plate-meta{display:block;margin-top:11px;padding-top:9px;border-top:1px solid rgba(var(--brass-bright-rgb),.22);font-size:11.5px;font-weight:700;color:var(--brass-bright);font-variant-numeric:tabular-nums}
.st-plate-art{display:flex;gap:4px}
.st-mini-tile{width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#f4f8fc;background:rgba(244,248,252,.08);border:1px solid rgba(244,248,252,.25);border-radius:5px}
.st-mini-hit{background:#6aaa64;border-color:#6aaa64;color:#0f2540}
.st-mini-near{background:#c9b458;border-color:#c9b458;color:#0f2540}
.st-plate-art-ring{position:relative;width:46px;height:46px}
.st-plate-art-ring svg{width:46px;height:46px}
.st-plate-ring-n{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#f4f8fc;font-variant-numeric:tabular-nums}
/* The Combination */
.st-cb-card{padding:22px 18px 18px}
/* Tiles size themselves from the word length: study.js sets --cb-len (and a tighter
   --cb-gap past six letters) on the board, and the tiles inherit the result. The
   binding constraint on length is mobile legibility, not difficulty — at 375px an
   8-letter row lands near 36px per tile, the floor we were willing to ship. vw math
   rather than %, because a percentage inside a custom property would resolve against
   the tile itself, not the row. */
.st-cb-board{--cb-len:5;--cb-gap:6px;--cb-size:min(58px,calc((100vw - 56px - (var(--cb-len) - 1) * var(--cb-gap)) / var(--cb-len)));display:flex;flex-direction:column;gap:var(--cb-gap);align-items:center}
.st-cb-row{display:flex;gap:var(--cb-gap)}
.st-cb-row-shake{animation:st-shake .3s ease-in-out 1}
.st-cb-tile{width:var(--cb-size);height:var(--cb-size);display:flex;align-items:center;justify-content:center;font-family:var(--serif);font-size:calc(var(--cb-size) * .47);font-weight:700;color:var(--ink);background:#fff;border:2px solid var(--line2);border-radius:8px;transition:transform .16s,background .16s,border-color .16s,color .16s}
.st-cb-fill{border-color:rgba(23,58,96,.55);transform:scale(1.04)}
.st-cb-flip{animation:st-cb-flip .34s ease-in-out 1}
@keyframes st-cb-flip{0%{transform:rotateX(0)}50%{transform:rotateX(88deg)}100%{transform:rotateX(0)}}
/* Combination states are COLORBLIND-FIRST by owner's call — do not restore green.
   Green-vs-gold is the classic deutan/protan confusion, and the old green (#1e6b43) and
   old slate (#565e6b) were luminance-IDENTICAL (L .112 vs .110), so "right spot" vs "not
   in the word" was unreadable without normal color vision. The trio is now navy/brass/
   slate: blue-vs-yellow survives every red-green deficiency AND it's the brand axis, and
   the luminances ladder (L .04 / .57 / .18) so a pure-greyscale viewer reads the board. */
.st-cb-c{background:#6aaa64;border-color:#6aaa64;color:#13151b}
.st-cb-p{background:#c9b458;border-color:#c9b458;color:#13151b}
.st-cb-a{background:#787c7e;border-color:#787c7e;color:#fff}
.st-cb-cat{display:flex;align-items:center;justify-content:center;gap:9px;margin:0 auto 10px;font-family:var(--serif);font-size:17px;font-weight:600;color:var(--ink);text-align:center}
.st-cb-cat span{font-family:'Inter',sans-serif;font-size:9.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#fff;background:linear-gradient(158deg,#173a60,#0f2540);border-radius:999px;padding:4px 10px}
.st-cb-prompt{text-align:center;font-size:12.5px;color:var(--muted);margin:0 0 12px;line-height:1.5}
.st-cb-prompt b{color:var(--ink);font-weight:700}
.st-cb-legend{display:flex;justify-content:center;gap:16px;flex-wrap:wrap;margin:12px 0 2px}
.st-cb-legend span{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:var(--muted)}
.st-cb-legend .st-cb-tile{width:15px;height:15px;border-radius:3.5px;border-width:1px;font-size:0;transition:none}
.st-cb-msg{min-height:20px;text-align:center;font-size:13px;font-weight:700;color:var(--brass-ink);margin:8px 0 2px}
/* Hints. A taken hint reads as a note pinned to the board, not as another control — it is
   already paid for, so it should sit quietly and be legible. The row it cost is struck out
   on the board itself (.st-cb-row-spent), which is where the trade stays visible. */
.st-cb-hints{margin:10px auto 2px;max-width:min(460px,100%);display:flex;flex-direction:column;gap:7px}
.st-cb-hint{display:flex;flex-direction:column;gap:2px;padding:9px 12px;background:#f6efdd;border:1px solid rgba(var(--brass-rgb),.4);border-left:3px solid var(--brass);border-radius:0 8px 8px 0}
.st-cb-hint-k{font-size:9.5px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:var(--brass-ink)}
.st-cb-hint-v{font-size:13.5px;line-height:1.5;color:var(--ink)}
.st-cb-hintbar{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap}
.st-cb-hintbtn{display:inline-flex;align-items:baseline;gap:7px}
.st-cb-hintbtn[disabled]{opacity:.45;cursor:not-allowed}
.st-cb-hint-cost{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;opacity:.75}
.st-cb-hint-left{font-size:11.5px;font-weight:600;color:var(--muted)}
.st-cb-hintused{text-align:center;font-size:12px;font-weight:600;color:var(--muted);margin-top:-4px}
/* The rows a hint bought. Dimmed and ruled through: they are gone, and the board says so. */
.st-cb-row-spent{opacity:.4}
.st-cb-row-spent .st-cb-tile{background:repeating-linear-gradient(135deg,#fff,#fff 5px,var(--off,#f7f6f2) 5px,var(--off,#f7f6f2) 10px);border-style:dashed}
.st-cb-kb{display:flex;flex-direction:column;gap:6px;margin-top:6px}
.st-cb-kbrow{display:flex;gap:4px;justify-content:center}
.st-cb-key{min-width:clamp(24px,7vw,40px);height:50px;padding:0 5px;display:flex;align-items:center;justify-content:center;font-size:13.5px;font-weight:700;color:var(--ink);background:var(--off,#f7f6f2);border:1px solid var(--line2);border-radius:7px;cursor:pointer;transition:background .12s,color .12s,border-color .12s;text-transform:uppercase}
.st-cb-key:active{transform:translateY(1px)}
.st-cb-key-wide{min-width:clamp(44px,12vw,62px);font-size:11px}
.st-cb-key-c{background:#6aaa64;border-color:#6aaa64;color:#13151b}
.st-cb-key-p{background:#c9b458;border-color:#c9b458;color:#13151b}
.st-cb-key-a{background:#787c7e;border-color:#787c7e;color:#fff}
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
.st-cb-hbar{flex:1;height:16px;background:#ece8dd;border-radius:var(--r-sm);overflow:hidden}
.st-cb-hbar span{display:flex;align-items:center;justify-content:flex-end;padding-right:6px;height:100%;min-width:16px;background:#6e6a60;border-radius:var(--r-sm);color:#fff;font-size:10.5px}
.st-cb-hbar span.st-cb-hbar-me{background:linear-gradient(90deg,#6f521a,#b8934a)}
/* Combination: today's board (result view) */
.st-cb-board-mod{max-width:330px;margin:16px auto 0}
.st-lb-head{font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--brass-ink);text-align:center;margin-bottom:8px}
.st-lb-list{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.st-lb-list li{display:flex;align-items:baseline;gap:9px;padding:6px 11px;background:var(--off,#f7f6f2);border-radius:7px;font-size:13px;color:#2a3140}
.st-lb-list li.st-lb-me{background:#f6efdd;box-shadow:0 0 0 1px rgba(var(--brass-rgb),.35) inset}
.st-lb-rank{flex:none;width:18px;font-weight:800;color:var(--brass-ink);font-variant-numeric:tabular-nums}
.st-lb-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.st-lb-g{flex:none;font-weight:800;color:#155433;font-variant-numeric:tabular-nums}
.st-lb-post{display:flex;gap:8px;margin-top:10px}
.st-lb-post input{flex:1;min-width:0;border:1px solid var(--line2);border-radius:8px;padding:9px 12px;font-size:13.5px;font-family:inherit;color:var(--ink)}
.st-lb-post input:focus-visible{outline:3px solid var(--brass);outline-offset:1px}
.st-lb-post .st-btn{white-space:nowrap;min-height:0;padding:9px 14px;font-size:13px}
/* Which Part Governs */
.st-gv-head{display:flex;justify-content:space-between;align-items:center;margin:2px 0 12px}
.st-gv-score{display:flex;align-items:baseline;gap:10px}
.st-gv-score b{font-family:var(--serif);font-size:34px;letter-spacing:var(--ls-tight);color:var(--ink);font-variant-numeric:tabular-nums}
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
.st-gv-card-hit{border-color:#1e6b43;box-shadow:0 0 0 1px #1e6b43 inset,0 24px 48px -26px rgba(var(--navy-rgb),.35)}
.st-gv-kicker{font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--brass);margin-bottom:8px}
.st-gv-q{font-family:var(--serif);font-size:21px;line-height:1.35;color:var(--ink);letter-spacing:-.008em;min-height:58px}
.st-gv-opts{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:16px}
@media(max-width:480px){.st-gv-opts{grid-template-columns:1fr}}
.st-gv-opt{position:relative;text-align:left;background:#fff;border:1px solid var(--line2);border-radius:var(--r-md);padding:12px 34px 12px 14px;cursor:pointer;min-height:60px;transition:border-color .12s,transform .12s,box-shadow .12s}
.st-gv-mark{position:absolute;top:8px;right:10px;font-size:15px;font-weight:800;line-height:1;color:#1e6b43}
.st-gv-mark-x{color:#b3261e}
.st-gv-opt:hover:not(:disabled){border-color:rgba(var(--brass-rgb),.5);transform:translateY(-1px);box-shadow:0 8px 18px -12px rgba(var(--navy-rgb),.3)}
.st-gv-opt:focus-visible{outline:3px solid var(--brass);outline-offset:2px}
.st-gv-opt b{display:block;font-family:var(--serif);font-size:17px;color:var(--ink)}
.st-gv-opt span{display:block;font-size:11.5px;color:var(--muted);margin-top:2px}
.st-gv-opt:disabled{cursor:default;opacity:.75}
.st-gv-opt-right{border-color:#1e6b43!important;background:#eef7f0;opacity:1!important;box-shadow:0 0 0 1px #1e6b43 inset}
.st-gv-opt-wrong{border-color:#b3261e!important;background:#fdf0ef;opacity:1!important;animation:st-shake .3s ease-in-out 1}
.st-gv-tier{font-family:var(--serif);font-size:19px;color:var(--brass-ink);margin:2px 0 8px}
.st-gv-end .st-sum-num{font-size:62px}
.st-gv-misslist{max-width:520px;margin:14px auto 4px;text-align:left}
.st-gv-miss{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px dashed rgba(var(--brass-rgb),.25);font-size:13px;line-height:1.45;color:#3d444d}
.st-gv-miss:last-child{border-bottom:none}
.st-gv-miss .st-cite{flex:none}
/* Combination help + keys */
.st-cb-helpbtn{font-size:11.5px;text-transform:none;letter-spacing:0}
.st-cb-help{max-width:430px;margin:0 auto;padding:4px 2px}
.st-cb-help-head{font-family:var(--serif);font-size:21px;color:var(--ink);letter-spacing:var(--ls-snug);margin-bottom:8px;text-align:center}
.st-cb-help p{font-size:14px;line-height:1.6;color:#3d444d;margin:.5em 0}
.st-cb-help-row{display:flex;align-items:center;gap:4px;margin:10px 0}
.st-cb-help-row>span:last-child{margin-left:9px;font-size:12.5px;line-height:1.45;color:#3d444d}
.st-cb-tile-ex{width:34px;height:34px;font-size:17px;flex:none}
.st-cb-key-enter{font-size:11.5px;letter-spacing:var(--ls-wide)}
.st-cb-key-back{background:#f6efdd;border-color:rgba(var(--brass-rgb),.4);color:#5e4715}
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
.st-gv-docket{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px dashed rgba(var(--brass-rgb),.35);padding-bottom:8px;margin-bottom:12px}
.st-gv-stampline{font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#8c2b23;border:1.5px solid rgba(179,38,30,.55);border-radius:3px;padding:2px 7px;transform:rotate(1.6deg)}
.st-gv-card{background:linear-gradient(180deg,#fffdf7,#fbf7ec);border-color:rgba(var(--brass-rgb),.3)}
.st-gv-card::before{background:linear-gradient(90deg,#6f521a,#b8934a 50%,#6f521a)}
.st-gv-card-in{animation:st-gv-in .2s ease-out 1}
@keyframes st-gv-in{0%{opacity:0;transform:translateY(9px)}100%{opacity:1;transform:none}}
.st-gv-pips{display:inline-flex;align-items:center;gap:3px;margin-left:2px}
.st-gv-pip{width:9px;height:16px;border-radius:3px;background:#ece8dd;transition:background .15s,transform .15s}
.st-gv-pip-on{background:linear-gradient(180deg,#b8934a,#87651c)}
.st-gv-pips-hot .st-gv-pip-on{box-shadow:0 0 7px rgba(var(--brass-bright-rgb),.8)}
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
/* font:inherit FIRST and unconditionally. .st-rung is a <button>, and a button resets the font
   to the UA default — so .st-rung-what and .st-rung-n rendered in Arial while every label
   around them was Inter. Same trap the comment above button.st-sim-feature describes: the
   secondary card got the fix, the primary control never did. It has to precede
   font-variant-numeric, because the font shorthand resets font-variant. */
.st-rung{display:flex;flex-direction:column;align-items:flex-start;gap:3px;font:inherit;text-align:left;background:#fff;border:1px solid var(--line2);border-left:3px solid transparent;border-radius:var(--r-md);padding:15px 16px 14px;cursor:pointer;font-variant-numeric:tabular-nums;transition:border-color .15s,box-shadow .15s,transform .15s}.st-rung-ceiling{font-family:var(--serif);font-size:25px;font-weight:600;line-height:1.05;color:var(--ink);letter-spacing:var(--ls-snug)}.st-rung-what{font-size:12px;line-height:1.4;color:var(--muted)}.st-rung-n{margin-top:auto;padding-top:3px;font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}.st-rung-on{border-left-color:var(--brass);box-shadow:0 8px 20px -14px rgba(var(--navy-rgb),.3)}.st-rung-on .st-rung-n{color:var(--brass-ink)}
/* Hover used to paint the SELECTED state's exact shadow onto an unselected rung — so hover
   read as selection, and on the selected rung it was a no-op. Brass border + the house lift,
   matching every other light card (.st-topic, .st-trackcard, .st-mode). */
@media (hover:hover) and (pointer:fine){.st-rung:hover{border-color:rgba(var(--brass-rgb),.5);box-shadow:0 10px 24px -16px rgba(var(--navy-rgb),.45);transform:translateY(-2px)}}
.st-rung:active{transform:translateY(0) scale(.985)}
.st-rung:focus-visible{outline:3px solid var(--brass);outline-offset:2px}
@media(prefers-reduced-motion:reduce){.st-rung:hover,.st-rung:active{transform:none}}
.st-rung-on,.st-rung-on:hover{border-left-color:var(--brass);color:var(--ink)}
.st-lad-count{color:var(--muted);font-size:13px;margin:10px 0 0;font-variant-numeric:tabular-nums}
.st-lad-ready{display:flex;align-items:center;gap:10px;max-width:440px;margin:16px 0 0}
.st-lad-ready .st-bar{flex:1}
.st-lad-ready-lab{flex:none;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.st-lad-q{margin:14px 0 0;border:1px solid var(--line2);border-radius:8px;overflow:hidden;background:#fff}.st-lad-q-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--off);border-bottom:1px solid var(--line2);padding:6px 12px}.st-lad-q-src{font-size:11px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:var(--brass-ink);text-decoration:none}.st-lad-q-src:hover{text-decoration:underline}.st-lad-q-dodtag{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink);opacity:.55}.st-lad-q-body{margin:0;padding:12px 14px;font-size:14.5px;line-height:1.65;color:#3d444d}.st-lad-q-dod .st-lad-q-bar{background:rgba(var(--brass-rgb),.09)}.st-lad-quote-link{color:var(--brass-ink);font-weight:700;text-decoration:underline}
.st-sum-miss{margin:16px 0 4px;padding-top:14px;border-top:1px solid var(--line2);text-align:left}.st-sum-miss-head{font-size:10.5px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:var(--ink);opacity:.5;margin-bottom:9px}.st-sum-miss-item{font-size:13.5px;line-height:1.5;color:var(--ink);padding:5px 0 5px 11px;border-left:2px solid var(--line2)}.st-sum-miss-more{font-size:12px;color:var(--muted);padding:5px 0 0 11px}
.st-lad-sink{margin-top:24px}
.st-lad-head{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--brass-ink);margin-bottom:8px}
.st-lad-sink-item{font-size:14px;line-height:1.6;color:#2a3140;padding:8px 0;border-top:1px solid var(--line2)}
/* ── Touch: hover lift must not stick ──────────────────────────────────────
   .st-sim-feature and .st-rung were gated when the 48 CONS page was reviewed;
   the rest of the study surface was not. On touch there is no pointer to move
   away, so the browser latches :hover on tap and the lift stays until the next
   tap lands elsewhere. Worst on .st-opt / .st-gv-opt — the answer buttons —
   where the option you just chose sits 1px high through the whole verdict.
   Cancel the translate only; the border and shadow feedback are harmless, and
   the child arrow nudges have no meaning without a pointer.
   Literal transform values, no var(): app.css never loads on these pages. */
@media (hover:none){
  .st-trackcard:hover,.st-daily:hover,.st-mode:hover,.st-topic:hover,
  .st-opt:hover:not(:disabled),.st-cite:hover,.st-plate:hover,
  .st-gv-opt:hover:not(:disabled){transform:none}
  .st-daily:hover .st-daily-go{transform:translateY(-50%)}
}
</style>`;

function renderStudyPage() {
  const canonical = `${SITE}/study`;
  const title = 'AcqVault Study — practice & spaced review for the acquisition community | AcqVault';
  const description = esc('Free, no-login practice for contracting professionals: spaced-repetition knowledge checks from the AcqVault Field Guides, rapid threshold sprints, and board-style scenario simulations with follow-up questions. Works offline. No account needed.');

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'WebApplication',
    name: 'AcqVault Study', applicationCategory: 'EducationalApplication',
    operatingSystem: 'Any', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    description, url: canonical,
    isPartOf: { '@type': 'WebSite', name: 'AcqVault', url: SITE }
  };

  const BRAND_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="6" y="6" width="88" height="88" rx="16" fill="#0f2540"/><rect x="13" y="13" width="74" height="74" rx="11" fill="none" stroke="rgba(var(--brass-bright-rgb),.5)" stroke-width="1.5"/><circle cx="50" cy="50" r="22" fill="none" stroke="#e4c477" stroke-width="3"/><g stroke="#e4c477" stroke-width="3.4" stroke-linecap="round"><line x1="50" y1="32" x2="50" y2="40"/><line x1="50" y1="68" x2="50" y2="60"/><line x1="32" y1="50" x2="40" y2="50"/><line x1="68" y1="50" x2="60" y2="50"/></g><circle cx="50" cy="50" r="5" fill="#e4c477"/></svg>';

  const SEAL_SVG = '<svg class="lib-seal" viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="st-seal-g" cx="36%" cy="30%" r="80%"><stop offset="0" stop-color="#f2d89a"/><stop offset="48%" stop-color="#cda857"/><stop offset="100%" stop-color="#876514"/></radialGradient></defs><circle cx="50" cy="50" r="47" fill="url(#st-seal-g)" stroke="#6f521a" stroke-width="1.5"/><circle cx="50" cy="50" r="42" fill="none" stroke="#6f521a" stroke-width="1" stroke-dasharray="1.2 2.6" opacity="0.55"/><circle cx="50" cy="50" r="22" fill="none" stroke="#16263f" stroke-width="2.4" opacity="0.9"/><g stroke="#16263f" stroke-width="3" stroke-linecap="round" opacity="0.9"><line x1="50" y1="33" x2="50" y2="41"/><line x1="50" y1="67" x2="50" y2="59"/><line x1="33" y1="50" x2="41" y2="50"/><line x1="67" y1="50" x2="59" y2="50"/></g><circle cx="50" cy="50" r="5.5" fill="#16263f" opacity="0.9"/></svg>';

  const body = `${STUDY_CSS}<header class="lnav"><div class="lnav-inner"><a class="brand" href="/?home=1">${BRAND_SVG}AcqVault</a><span class="hdr-links"><a class="hlink" href="/?home=1">Home</a><a class="cta" href="/?q=">Search all sources →</a></span></div></header>
<main>
<section class="lband lhero"><div class="lband-inner">
${SEAL_SVG}
<nav class="crumbs"><a href="/?home=1">AcqVault</a> › Study</nav>
<div class="eyebrow">AcqVault · Study</div>
<h1>Know it cold</h1>
<p class="lede">Knowledge checks, threshold sprints, and board-style scenarios from the AcqVault Field Guides, plus the Source Selection Simulator, run against the DoD Source Selection Procedures. Every debrief links straight to the governing RFO or R-DFARS text, one click away. Spaced repetition decides what you see; you decide how honest your self-grade is.</p>
<div class="stats"><span class="stat"><b>400+</b> questions</span><span class="stat">A daily word · a 90-second round</span><span class="stat">Free · no account</span><span class="stat">Progress stays on your device</span><span class="stat">Works offline</span></div>
</div></section>
<section class="lband lband--room"><div class="st-guilloche" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><g fill="none" stroke="#0f2540" stroke-width="0.6"><circle cx="300" cy="300" r="150"/><circle cx="300" cy="300" r="120"/><circle cx="300" cy="300" r="90"/><circle cx="300" cy="300" r="60"/></g></svg></div><div class="st-wrap">
<div id="study-app"><noscript><p>AcqVault Study is an interactive study tool and needs JavaScript. The same material lives in the <a href="/library">Field Guides</a>.</p></noscript><p class="st-sub">Loading the deck…</p></div>
</div></section>
</main>
<footer class="lband lband--foot"><div class="lband-inner">
<p class="lfoot-note"><strong>How it works:</strong> answer before you reveal — out loud when you can — then grade yourself honestly. Missed cards return sooner; mastered ones stretch out. Every debrief cites where the rule lives and links to the full RFO/R-DFARS text on this site. Your progress lives only in this browser; use Export to move or back it up. Built from <a href="/library">Field Guide Vols. 1 &amp; 2</a>.</p>
<p class="lfoot-legal">AcqVault is an <strong>unofficial research aid</strong> — not legal advice and not an official source. Verify anything you'll rely on against the signed DoD class deviations and the official text at <a href="https://www.acquisition.gov/far-overhaul" rel="noopener">acquisition.gov</a>.</p>
</div></footer>
<script defer src="/assets/study.js?v=${STUDY_V}"></script>`;

  return shell({ title, description, canonical, jsonld, body, bleed: true, ogImage: 'og-study-v2.png' });
}

/* Unlisted page for 48 CONS. Not in renderSitemap(), not in robots.txt (listing it there
   would advertise it), no inbound link anywhere on the site, noindex on both the meta tag and
   an X-Robots-Tag header in vercel.json. It rides the /api/study function rather than adding
   an api/ file — the project sits exactly at the Vercel Hobby 12-function cap.
   Unlisted is NOT private: anything shown here is public to anyone holding the URL, so this
   page carries only corpus-built cards and the user's own typing. */
function render48ConsPage() {
  const canonical = `${SITE}/48cons`;
  const title = 'Warrant board prep — 48 CONS | AcqVault';
  const description = esc('Warrant board preparation for 48 CONS: the AcqVault Warrant Ladder by warrant ceiling, every card quoting the governing rule, plus a board introduction builder.');

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'WebApplication',
    name: 'AcqVault — 48 CONS Warrant Prep', applicationCategory: 'EducationalApplication',
    operatingSystem: 'Any', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    description, url: canonical,
    isPartOf: { '@type': 'WebSite', name: 'AcqVault', url: SITE }
  };

  const BRAND_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="6" y="6" width="88" height="88" rx="16" fill="#0f2540"/><rect x="13" y="13" width="74" height="74" rx="11" fill="none" stroke="rgba(var(--brass-bright-rgb),.5)" stroke-width="1.5"/><circle cx="50" cy="50" r="22" fill="none" stroke="#e4c477" stroke-width="3"/><g stroke="#e4c477" stroke-width="3.4" stroke-linecap="round"><line x1="50" y1="32" x2="50" y2="40"/><line x1="50" y1="68" x2="50" y2="60"/><line x1="32" y1="50" x2="40" y2="50"/><line x1="68" y1="50" x2="60" y2="50"/></g><circle cx="50" cy="50" r="5" fill="#e4c477"/></svg>';

  const body = `${STUDY_CSS}<header class="lnav"><div class="lnav-inner"><a class="brand" href="/?home=1">${BRAND_SVG}AcqVault</a><span class="hdr-links"><a class="hlink" href="/study">Study</a><a class="cta" href="/?q=">Search all sources &rarr;</a></span></div></header>
<main>
<section class="lband lhero lhero--cons lband--rail"><div class="lband-inner">
<img class="cons-patch" src="/assets/48cons-patch.png?v=3" alt="48th Contracting Squadron emblem" width="182" height="186" decoding="async">
<nav class="crumbs"><a href="/?home=1">AcqVault</a> &rsaquo; <a href="/study">Study</a> &rsaquo; Warrant board prep</nav>
<div class="eyebrow">AcqVault &middot; 48 CONS</div>
<h1>Hold the ceiling</h1>
<p class="lede">Warrant board preparation for the 48th Contracting Squadron. The Warrant Ladder scopes your prep to the warrant you&rsquo;re testing for &mdash; SAT through unlimited &mdash; and every card carries the governing rule in its own words, with the DoD deviation where one applies.</p>
<div class="stats"><span class="stat"><b>206</b> cards &middot; <b>47</b> board sims</span><span class="stat">Rebuilt when the rulebook moves</span><span class="stat">Progress stays on your device</span></div>
</div></section>
<section class="lband lband--room"><div class="st-guilloche" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><g fill="none" stroke="#0f2540" stroke-width="0.6"><circle cx="300" cy="300" r="150"/><circle cx="300" cy="300" r="120"/><circle cx="300" cy="300" r="90"/><circle cx="300" cy="300" r="60"/></g></svg></div><div class="st-wrap">
<div id="study-app" data-mode="48cons"><noscript><p>This page is an interactive study tool and needs JavaScript. The same material lives in the <a href="/library">Field Guides</a>.</p></noscript><p class="st-sub">Loading the deck&hellip;</p></div>
</div></section>
</main>
<footer class="lband lband--foot lband--rail"><div class="lband-inner">
<p class="lfoot-note"><strong>How it works:</strong> answer before you reveal &mdash; out loud when you can &mdash; then grade yourself honestly. Cards you miss come back sooner and mastered ones stretch out, so each level hands you what is due rather than a fresh shuffle. Every debrief cites where the rule lives and links to the full RFO/R-DFARS text on this site.</p>
<p class="lfoot-note"><strong>What stays on your device:</strong> your progress, your board-sim notes and anything you type into the introduction builder live only in this browser and are never uploaded &mdash; they leave this device only in a file you ask for. A board-sim recording is not stored at all &mdash; it stays in the tab and is gone the moment you leave the sim.</p>
<p class="lfoot-legal">AcqVault is an <strong>unofficial research aid</strong> &mdash; not legal advice and not an official source, and nothing here is squadron policy. Verify anything you&rsquo;ll rely on against the signed DoD class deviations and the official text at <a href="https://www.acquisition.gov/far-overhaul" rel="noopener">acquisition.gov</a>.</p>
</div></footer>
<script defer src="/assets/study.js?v=${STUDY_V}"></script>`;

  return shell({ title, description, canonical, jsonld, body, bleed: true, noindex: true, ogImage: 'og-study-v2.png' });
}

/* Blank Slip - an unlisted party game at /slip. Kept hidden exactly the way
   /48cons is: noindex meta + an X-Robots-Tag header in vercel.json, absent from
   renderSitemap(), absent from robots.txt (listing it there would advertise it),
   and no inbound link anywhere on the site. It rides the /api/study function
   because the project sits exactly at the Vercel Hobby 12-function cap.

   It deliberately shares NOTHING with the rest of AcqVault's visual system: it
   declares every token it uses and inherits nothing from app.css (which never
   loads on a server-rendered page). Do not "fix" it to match the site.

   Game state lives in Upstash Redis via api/_slip.js. A player's own number is
   never sent to their device until they reveal. */
function renderSlipPage() {
  const canonical = `${SITE}/slip`;
  const title = 'Blank Slip';
  const description = esc('A forehead number game for 2 to 8 people on a call. Everyone can see your number except you.');

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'WebApplication',
    name: 'Blank Slip', applicationCategory: 'GameApplication',
    operatingSystem: 'Any', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    description, url: canonical
  };

  const body = `<style>/* ============================================================
   BLANK SLIP
   Apple's typographic discipline, Apple's dark-mode system
   palette, one hue per player. Self-contained: declares every
   token it uses and inherits nothing from app.css, which never
   loads on a server-rendered page.
   ============================================================ */
@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;src:url(/assets/fonts/inter-latin.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+2000-206F,U+2122,U+2191,U+2193,U+2212}

:root{
  /* --- ground and elevated surfaces (Apple dark mode) --- */
  --bg:#000000;
  --surface:#1C1C1E;
  --surface-2:#2C2C2E;
  --fill:rgba(118,118,128,.20);
  --fill-hi:rgba(118,118,128,.32);
  --separator:rgba(84,84,88,.55);

  /* --- labels: Apple's four levels --- */
  --label:#FFFFFF;
  --label-2:rgba(235,235,245,.62);
  --label-3:rgba(235,235,245,.52);   /* 2.81:1 -> 4.83:1 on --surface */
  --label-4:rgba(235,235,245,.20);

  /* --- system colors, dark variants --- */
  --blue:#0A84FF;
  --green:#30D158;
  --indigo:#8B88FF;   /* lightened from Apple's #5E5CE6: 3.36:1 -> 5.72:1 as name text */
  --orange:#FF9F0A;
  --pink:#FF375F;
  --purple:#BF5AF2;
  --teal:#40CBE0;
  --yellow:#FFD60A;
  --red:#FF453A;

  --tint:var(--blue);          /* text + links: 4.66:1 on a card */
  --tint-solid:#0A6FD8;        /* filled buttons: white on this is 4.91:1 */
  --font:'Inter',-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;

  /* --- 8pt spacing --- */
  --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px; --s6:32px; --s7:44px; --s8:64px;

  /* --- radii: Apple's cards are generously round --- */
  --r-card:16px; --r-ctl:12px; --r-chip:980px;

  /* --- motion: critically damped, no overshoot, except on release --- */
  --ease:cubic-bezier(.32,.72,0,1);         /* Apple's sheet curve */
  --ease-out:cubic-bezier(.23,1,.32,1);
  --t-press:100ms;                           /* response must be instant */
  --t-ui:240ms;
  --t-enter:340ms;
}

*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}

body{
  margin:0;
  background:var(--bg);
  color:var(--label);
  font-family:var(--font);
  font-size:17px;                 /* Apple body */
  line-height:1.47;
  letter-spacing:0;               /* body sits near zero */
  -webkit-font-smoothing:antialiased;
  min-height:100svh;
  /* a barely-there wash so pure black doesn't read as a void */
  background-image:
    radial-gradient(120% 60% at 50% -10%,rgba(10,132,255,.10),transparent 62%),
    radial-gradient(90% 45% at 50% 108%,rgba(191,90,242,.07),transparent 66%);
  background-attachment:fixed;
}

.wrap{
  max-width:540px;margin:0 auto;
  padding:var(--s6) var(--s5) calc(var(--s8) + env(safe-area-inset-bottom));
  display:flex;flex-direction:column;gap:var(--s6);
}

/* ============================================================
   TYPE - tracking is size-specific, never one value for all
   ============================================================ */
h1,h2,h3{margin:0;font-weight:800;font-family:var(--font);color:var(--label)}
h1{                                   /* large display */
  font-size:clamp(40px,12.5vw,54px);
  line-height:1.02;
  letter-spacing:-.045em;             /* large text needs negative tracking */
  text-wrap:balance;
}
h2{font-size:24px;line-height:1.14;letter-spacing:-.026em;font-weight:700}
h3{font-size:19px;line-height:1.22;letter-spacing:-.02em;font-weight:650}
p{margin:0}

.label{                                /* uppercase eyebrow: small text wants POSITIVE tracking */
  font-size:12px;font-weight:600;
  letter-spacing:.055em;text-transform:uppercase;
  color:var(--label-3);
}
.lede{color:var(--label-2);font-size:17px;letter-spacing:-.01em;max-width:32ch}
.note{color:var(--label-3);font-size:13px;letter-spacing:0;margin:0}
.tabular{font-variant-numeric:tabular-nums}

.masthead{display:flex;flex-direction:column;gap:var(--s2)}
/* Once you are in a room the wordmark is dead weight above a live board. */
.masthead.compact{gap:0}
.masthead.compact .label,.masthead.compact .lede{display:none}
.masthead.compact h1{font-size:22px;letter-spacing:-.026em}
.masthead h1 .hot{
  background:linear-gradient(96deg,var(--blue),var(--purple) 62%,var(--pink));
  -webkit-background-clip:text;background-clip:text;
  -webkit-text-fill-color:transparent;color:var(--blue);
}

/* ============================================================
   SURFACES
   ============================================================ */
.panel{
  background:var(--surface);
  border-radius:var(--r-card);
  padding:var(--s5);
  display:flex;flex-direction:column;gap:var(--s4);
}

/* ============================================================
   CONTROLS - feedback on press, instantly
   ============================================================ */
.btn{
  font:inherit;font-size:17px;font-weight:600;letter-spacing:-.01em;
  cursor:pointer;
  border-radius:var(--r-ctl);
  padding:14px var(--s5);
  min-height:50px;                    /* comfortably over the 44pt target */
  border:none;
  background:var(--fill);
  color:var(--label);
  transition:transform var(--t-press) var(--ease-out),
             background var(--t-press) ease,
             opacity var(--t-press) ease;
}
.btn:active{transform:scale(.97)}
.btn[disabled]{opacity:.38;cursor:not-allowed}
.btn[disabled]:active{transform:none}
.btn-primary{background:var(--tint-solid);color:#fff;font-weight:650}
.btn-quiet{background:transparent;color:var(--tint);font-weight:600;min-height:44px;padding:10px var(--s3)}
.btn-sm{font-size:15px;padding:9px var(--s4);min-height:40px}
.btn-block{width:100%}
@media (hover:hover) and (pointer:fine){
  .btn:hover{background:var(--fill-hi)}
  .btn-primary:hover{background:#0A7BEF}
  .btn-quiet:hover{background:rgba(10,132,255,.12)}
}
:where(a,button,input,select,[tabindex]):focus-visible{
  outline:3px solid var(--blue);outline-offset:3px;border-radius:var(--r-ctl);
}

label{display:flex;flex-direction:column;gap:var(--s2);font-size:13px;font-weight:600;letter-spacing:.01em;color:var(--label-2)}
.field{
  font:inherit;font-size:17px;                /* >=16px or iOS zooms the page */
  color:var(--label);background:var(--fill);
  border:1px solid transparent;border-radius:var(--r-ctl);
  padding:14px var(--s4);width:100%;
  transition:border-color var(--t-press) ease,background var(--t-press) ease;
}
.field::placeholder{color:var(--label-4)}
.field:focus{border-color:var(--blue);background:var(--surface-2);outline:none}

/* ============================================================
   TOPIC CARD
   ============================================================ */
.topic{
  display:flex;flex-direction:column;gap:var(--s3);
  padding:var(--s4);
  border-radius:var(--r-card);
  background:var(--surface-2);
}
.topic-text{
  font-size:22px;font-weight:700;line-height:1.2;letter-spacing:-.024em;
  text-wrap:balance;color:var(--label);min-height:2.4em;
  display:flex;align-items:center;
  transition:opacity 160ms ease,filter 160ms ease;
}
.topic-text.swapping{opacity:.15;filter:blur(4px)}
.topic-actions{display:flex;gap:var(--s2);flex-wrap:wrap}

/* ============================================================
   ROOM CODE
   ============================================================ */
.code-field{
  font-size:34px;font-weight:700;
  letter-spacing:.26em;text-indent:.26em;
  text-align:center;text-transform:uppercase;
  padding:var(--s4) var(--s2);
  font-variant-numeric:tabular-nums;
}
.code-plate{
  display:flex;flex-direction:column;align-items:center;gap:var(--s2);
  padding:var(--s5);border-radius:var(--r-card);
  background:var(--surface);
}
.code-plate .code{
  font-size:52px;font-weight:800;line-height:1;
  letter-spacing:.2em;text-indent:.2em;
  font-variant-numeric:tabular-nums;
  background:linear-gradient(96deg,var(--blue),var(--teal));
  -webkit-background-clip:text;background-clip:text;
  -webkit-text-fill-color:transparent;color:var(--blue);
}
/* Jackbox keeps the code on screen the whole game so latecomers can join. */
.code-chip{
  display:inline-flex;align-items:center;gap:var(--s2);
  align-self:flex-start;
  padding:7px var(--s3);border-radius:var(--r-chip);
  background:var(--fill);
  font-size:13px;font-weight:600;letter-spacing:.02em;color:var(--label-2);
}
.code-chip b{
  color:var(--label);font-weight:700;
  letter-spacing:.16em;font-variant-numeric:tabular-nums;
}

/* ============================================================
   PLAYER HUES - one per seat, assigned by slot
   ============================================================ */
.hue-0{--pc:var(--blue)}
.hue-1{--pc:var(--orange)}
.hue-2{--pc:var(--green)}
.hue-3{--pc:var(--pink)}
.hue-4{--pc:var(--purple)}
.hue-5{--pc:var(--teal)}
.hue-6{--pc:var(--yellow)}
.hue-7{--pc:var(--indigo)}

/* ============================================================
   THE SLIPS
   ============================================================ */
.slips{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:var(--s3)}
.slip{
  position:relative;
  background:var(--surface);
  border-radius:var(--r-card);
  padding:var(--s4) var(--s3) var(--s3);
  display:flex;flex-direction:column;align-items:center;gap:var(--s1);
  overflow:hidden;
}
/* a thin wash of the player's colour, so the card is theirs without shouting */
.slip::after{
  content:"";position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(180deg,color-mix(in srgb,var(--pc,var(--blue)) 16%,transparent),transparent 58%);
}
.slip-num{
  font-size:56px;font-weight:800;line-height:1.04;
  letter-spacing:-.045em;                 /* big numerals need tight tracking */
  font-variant-numeric:tabular-nums;
  color:var(--label);
  position:relative;z-index:1;
}
.slip-num.d3{font-size:40px;letter-spacing:-.05em}   /* 100 has three digits */
.slip.is-you .slip-num.d3{font-size:58px}
.slip-name{
  font-size:14px;font-weight:600;letter-spacing:-.005em;
  color:var(--pc,var(--label-2));
  text-align:center;overflow-wrap:anywhere;
  position:relative;z-index:1;
}
.slip-tag{
  font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;
  color:var(--label-3);position:relative;z-index:1;
}

/* your own slip: the hero, and the only blank one */
.slip.is-you{
  grid-column:1/-1;
  padding:var(--s6) var(--s4) var(--s5);
  background:var(--surface-2);
  box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--pc,var(--blue)) 70%,transparent);
}
.slip.is-you::after{
  background:radial-gradient(90% 130% at 50% 0%,color-mix(in srgb,var(--pc,var(--blue)) 26%,transparent),transparent 66%);
}
.slip.is-you .slip-num{font-size:76px;letter-spacing:-.05em}
.slip.is-you .slip-name{font-size:15px;font-weight:650}
.slip-blank{
  font-size:76px;font-weight:800;line-height:1.04;letter-spacing:-.05em;
  color:var(--pc,var(--blue));
  position:relative;z-index:1;
}
.slip.waiting{opacity:.55}
.slip.waiting .slip-num{color:var(--label-3)}

/* Cards arrive together, quickly, and only on a real change. */
@media (prefers-reduced-motion:no-preference){
  .slips.fresh .slip{animation:card-in var(--t-enter) var(--ease) both}
  .slips.fresh .slip:nth-child(1){animation-delay:0ms}
  .slips.fresh .slip:nth-child(2){animation-delay:36ms}
  .slips.fresh .slip:nth-child(3){animation-delay:72ms}
  .slips.fresh .slip:nth-child(4){animation-delay:108ms}
  .slips.fresh .slip:nth-child(5){animation-delay:144ms}
  .slips.fresh .slip:nth-child(6){animation-delay:180ms}
  .slips.fresh .slip:nth-child(7){animation-delay:216ms}
  .slips.fresh .slip:nth-child(8){animation-delay:252ms}
}
@keyframes card-in{
  from{opacity:0;transform:translateY(10px) scale(.97)}
  to{opacity:1;transform:none}
}

/* The one big moment: turning your own slip over. Real perspective, or it
   reads as a flat squash rather than a card rotating in space. */
.slip-flip3d{perspective:900px}
.slip.is-you.flipping{animation:slip-flip 520ms var(--ease) both;transform-style:preserve-3d}
@keyframes slip-flip{
  0%{transform:rotateY(0deg)}
  48%{transform:rotateY(88deg) scale(1.03)}
  100%{transform:rotateY(0deg)}
}
@media (prefers-reduced-motion:reduce){
  .slip.is-you.flipping{animation:slip-fade 200ms ease both}
  @keyframes slip-fade{from{opacity:.35}to{opacity:1}}
}

/* ============================================================
   ROSTER
   ============================================================ */
.roster{display:flex;flex-direction:column;gap:1px;margin:0;padding:0;list-style:none;
  background:var(--separator);border-radius:var(--r-ctl);overflow:hidden}
.roster li{
  display:flex;align-items:center;gap:var(--s3);
  padding:13px var(--s4);
  background:var(--surface-2);
  font-size:17px;font-weight:500;letter-spacing:-.01em;
}
.roster li .who{flex:1;overflow-wrap:anywhere}
.roster li .tag{
  font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
  color:var(--label-3);
}
.roster li.self .who{font-weight:650}
.dot{width:10px;height:10px;border-radius:50%;background:var(--pc,var(--green));flex:none}

/* ============================================================
   QUESTION
   ============================================================ */
.q-card{
  background:var(--surface);
  border-radius:var(--r-card);padding:var(--s5);
  display:flex;flex-direction:column;gap:var(--s3);
}
.q-card .label{color:var(--tint)}
.q-text{
  font-size:26px;font-weight:700;line-height:1.2;letter-spacing:-.03em;
  text-wrap:balance;color:var(--label);min-height:2.4em;
  display:flex;align-items:center;
  transition:opacity 160ms ease,filter 160ms ease;
}
.q-text.swapping{opacity:.15;filter:blur(4px)}

/* ============================================================
   MISC
   ============================================================ */
.divider{display:flex;align-items:center;gap:var(--s3);color:var(--label-3);margin:var(--s1) 0}
.divider::before,.divider::after{content:"";flex:1;height:1px;background:var(--separator)}
.divider span{font-size:12px;font-weight:600;letter-spacing:.055em;text-transform:uppercase}

.banner{
  display:flex;flex-direction:column;gap:var(--s1);
  padding:var(--s4);border-radius:var(--r-card);
  background:var(--surface);
}
.banner strong{font-size:19px;font-weight:700;letter-spacing:-.022em;line-height:1.24;text-wrap:balance}
.banner.hot{background:rgba(255,159,10,.14);box-shadow:inset 0 0 0 1px rgba(255,159,10,.4)}
.banner.hot .label{color:var(--orange)}
.banner.hot strong{color:var(--orange)}

.err{color:var(--orange);font-size:15px;font-weight:600;letter-spacing:-.01em}
.err:empty{display:none}

.order{font-size:15px;color:var(--label-2);letter-spacing:-.01em}
.order b{color:var(--label);font-weight:650}

footer{display:flex;flex-direction:column;gap:var(--s3);align-items:flex-start;
  border-top:1px solid var(--separator);padding-top:var(--s4);
  margin-top:0;font-size:15px;color:var(--label-2)}
footer .note{max-width:50ch}

[data-screen]{display:flex;flex-direction:column;gap:var(--s5)}
[hidden]{display:none!important}
.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}</style>
<div class="wrap" id="slip-app">
<header class="masthead">
    <span class="label">A forehead game for 2 to 8</span>
    <h1>Blank <span class="hot">Slip</span></h1>
    <p class="lede">Everyone can see your number. You can't. Ask your way to it.</p>
  </header>

  <!-- ============ HOME ============ -->
  <section data-screen="home" hidden>
    <div class="panel">
      <h2>Start a room</h2>
      <label>Your name
        <input class="field" id="hostName" type="text" maxlength="16" autocomplete="off" placeholder="Sam">
      </label>

      <div class="topic">
        <span class="label">The number will mean</span>
        <p class="topic-text" id="topicText"></p>
        <div class="topic-actions">
          <button class="btn btn-sm" id="shuffleTopic" type="button">Shuffle</button>
          <button class="btn btn-sm btn-quiet" id="ownTopic" type="button">Write my own</button>
        </div>
      </div>
      <label id="customWrap" hidden>Your own topic
        <input class="field" id="customTheme" type="text" maxlength="120" placeholder="how likely you are to survive a bar fight">
      </label>

      <div class="err" id="createErr" role="alert"></div>
      <button class="btn btn-primary btn-block" id="doCreate" type="button">Start the room</button>
      <p class="note">You'll get a 4-letter code to read out on the call.</p>
    </div>

    <div class="divider"><span>or</span></div>

    <div class="panel">
      <h2>Join a room</h2>
      <label>Room code
        <input class="field code-field" id="joinCode" type="text" maxlength="4"
               autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="----">
      </label>
      <label>Your name
        <input class="field" id="joinName" type="text" maxlength="16" autocomplete="off" placeholder="Alex">
      </label>
      <div class="err" id="joinErr" role="alert"></div>
      <button class="btn btn-block" id="doJoin" type="button">Join</button>
    </div>
  </section>

  <!-- ============ LOBBY ============ -->
  <section data-screen="lobby" hidden>
    <div class="code-plate">
      <span class="label">Room code</span>
      <span class="code" id="lobbyCode">----</span>
      <button class="btn btn-quiet btn-sm" id="copyCode" type="button">Copy the link</button>
    </div>

    <div class="banner">
      <span class="label">The number means</span>
      <strong id="lobbyTheme"></strong>
    </div>

    <div class="panel">
      <h3 id="lobbyCount">Waiting for players</h3>
      <ul class="roster" id="lobbyRoster"></ul>
      <div class="err" id="lobbyErr" role="alert"></div>
      <button class="btn btn-primary btn-block" id="doDeal" type="button" hidden>Deal the slips</button>
      <p class="note" id="waitNote">The host deals when everyone's in.</p>
    </div>

    <footer>
      <p class="note">Numbers are dealt on the server. Nobody's phone ever receives their own.</p>
      <button class="btn btn-quiet btn-sm" id="doLeaveLobby" type="button">Leave the room</button>
    </footer>
  </section>

  <!-- ============ BOARD ============ -->
  <section data-screen="board" hidden>
    <div class="banner hot" id="pendingBanner" hidden>
      <span class="label">Sit tight</span>
      <strong>You're in from the next round. The host deals you in.</strong>
    </div>

    <span class="code-chip" id="boardCode" hidden>Room <b></b></span>

    <div class="banner">
      <span class="label" id="roundLabel">Round 1 &middot; the number means</span>
      <strong id="boardTheme"></strong>
    </div>

    <div class="slip-flip3d">
      <div class="slips" id="slips"></div>
    </div>
    <p class="order" id="playOrder"></p>

    <div class="q-card" id="qCard">
      <span class="label" id="qKind">Ask the room</span>
      <p class="q-text" id="qText">Tap below and I'll hand you something to ask.</p>
      <button class="btn" id="doAsk" type="button">Give me a question</button>
    </div>

    <div class="panel">
      <h3 id="revealHead">Ready to call it?</h3>
      <p class="note" id="revealNote">Say your guess out loud first. Then turn your slip over.</p>
      <div class="err" id="boardErr" role="alert"></div>
      <button class="btn btn-primary btn-block" id="doReveal" type="button">Turn my slip over</button>
      <button class="btn btn-block" id="doAgain" type="button" hidden>New round, new topic</button>
      <p class="note" id="againNote" hidden>Everyone's slip goes blank and the numbers are reshuffled.</p>
    </div>

    <footer>
      <p class="note" id="roomFoot"></p>
      <p class="note">Your own number isn't in this page. It stays on the server until you turn your slip over, so there's nothing to peek at.</p>
      <button class="btn btn-quiet btn-sm" id="doLeave" type="button">Leave the room</button>
    </footer>
  </section>
</div>
<script defer src="/assets/slip.js?v=${SLIP_V}"></script>`;

  return shell({ title, description, canonical, jsonld, body, bleed: true, noindex: true });
}

function renderSourceSelectionPage() {
  const canonical = `${SITE}/source-selection`;
  const title = 'Source Selection Simulator — run a DoD source selection | AcqVault';
  const description = esc('A free, hands-on source-selection simulator for the acquisition community. Play the Source Selection Authority through a full best-value tradeoff — acquisition planning, competitive range, discussions, cost realism, and the award decision — with a running protest-risk score. Every call links to the governing DoD Source Selection Procedures. No account.');

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'LearningResource',
    name: 'DoD Source Selection Simulator', learningResourceType: 'Simulation',
    educationalLevel: 'Professional', isAccessibleForFree: true,
    teaches: 'DoD source selection procedures, best-value tradeoff, competitive range, discussions, and source selection decisions',
    description, url: canonical,
    isPartOf: { '@type': 'WebSite', name: 'AcqVault', url: SITE }
  };

  const SRCSEL_CSS = `<style>
.lband--room{position:relative;overflow:hidden;background:var(--off);border-top:1px solid rgba(var(--brass-rgb),.16)}
.st-guilloche{position:absolute;right:-150px;top:-120px;width:520px;height:520px;opacity:.06;pointer-events:none;-webkit-mask-image:radial-gradient(circle at 50% 50%,#000 38%,transparent 72%);mask-image:radial-gradient(circle at 50% 50%,#000 38%,transparent 72%)}
.st-guilloche svg{width:100%;height:100%}
.ss-wrap{position:relative;max-width:860px;margin:0 auto;padding:34px 22px 72px}
#ssim-app{min-height:460px}
.ss-sub{color:var(--muted);font-size:14px;line-height:1.55;margin:0}
.ss-card{position:relative;overflow:hidden;background:#fff;border:1px solid var(--line2);border-radius:16px;padding:24px 26px;box-shadow:0 24px 48px -26px rgba(var(--navy-rgb),.35)}
.ss-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--brass-deep),var(--brass-bright) 50%,var(--brass-deep))}
@media(max-width:640px){.ss-card{padding:19px 17px}}
.ss-eyebrow{font-size:10.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--brass);margin:0 0 7px}
.ss-h2{font-family:var(--serif);font-size:25px;line-height:1.15;letter-spacing:-.012em;color:var(--ink);margin:0 0 8px}
.ss-prog-title{font-family:var(--serif);font-size:22px;line-height:1.2;color:var(--ink);margin:2px 0 3px}
.ss-hat{font-size:13.5px;color:var(--muted);margin:0 0 16px}
.ss-meta{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 2px}
.ss-tag{font-size:12px;font-weight:700;color:var(--brass-ink);background:#f6efdd;border:1px solid rgba(var(--brass-rgb),.28);border-radius:999px;padding:5px 12px}
.ss-note{font-size:12.5px;color:var(--muted);line-height:1.55;margin:16px 0 0;padding-top:14px;border-top:1px dashed rgba(var(--brass-rgb),.35)}
.ss-off-wrap{overflow-x:auto;margin:16px 0 2px}
.ss-off{width:100%;border-collapse:collapse;font-size:13px;min-width:520px}
.ss-off th,.ss-off td{border-bottom:1px solid var(--line2);padding:9px 10px;text-align:left;vertical-align:top}
.ss-off thead th{font-size:10.5px;letter-spacing:var(--ls-caps);text-transform:uppercase;color:var(--muted);font-weight:800}
.ss-off td b{color:var(--ink)}
.ss-off .ss-off-name{font-family:var(--serif);font-size:14px;color:var(--ink)}
.ss-off small{display:block;color:var(--muted);font-size:11.5px;line-height:1.4;margin-top:3px}
.ss-pill{display:inline-block;font-size:11px;font-weight:700;border-radius:5px;padding:1px 7px;white-space:nowrap}
.ss-pill-o{background:#eaf0f6;color:#1c3557}
.ss-pill-g{background:#eef7f0;color:#155433}
.ss-pill-p{background:#e7e2f0;color:#3b0764}
.ss-pill-y{background:#faf3e0;color:#8a6d2e}
.ss-pill-m{background:#fdf0ef;color:#8c2b23}
.ss-startnote{display:flex;gap:10px;align-items:flex-start;background:#faf3e0;border:1px solid rgba(var(--brass-rgb),.32);border-radius:var(--r-md);padding:11px 14px;margin:12px 0 4px;font-size:13px;color:#6f5416;line-height:1.5}
.ss-startnote-ic{flex:none;width:19px;height:19px;border-radius:50%;background:#8a6d2e;color:#fff;font-size:12px;font-weight:800;font-style:italic;display:flex;align-items:center;justify-content:center;line-height:1}
.ss-actions{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap;align-items:center}
.ss-btn{border:none;border-radius:9px;padding:12px 20px;font-size:14.5px;font-weight:700;cursor:pointer;min-height:46px;font-family:inherit}
.ss-btn-primary{background:linear-gradient(158deg,#173a60,#0f2540 70%);color:#f4f8fc}
.ss-btn-primary:hover{filter:brightness(1.08)}
.ss-btn-ghost{background:#fff;border:1px solid var(--line);color:var(--ink)}
.ss-btn-ghost:hover{border-color:var(--muted2,#6f6c74)}
.ss-btn:disabled{opacity:.45;cursor:default}
.ss-btn:focus-visible,.ss-opt:focus-within,.ss-doc-chip:focus-visible,.ss-cite-src:focus-visible,.ss-modal-close:focus-visible{outline:3px solid rgba(var(--brass-rgb),.42);outline-offset:2px}
.ss-resume{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;background:#f6efdd;border:1px solid rgba(var(--brass-rgb),.3);border-radius:12px;padding:13px 16px;margin-bottom:16px}
.ss-resume p{margin:0;font-size:13.5px;color:var(--brass-ink);font-weight:600}
.ss-rail{margin-bottom:16px}
.ss-rail-top{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px 12px;font-size:12px;font-weight:800;letter-spacing:var(--ls-caps);text-transform:uppercase;color:var(--brass-ink);margin-bottom:8px}
.ss-meter{display:inline-flex;align-items:center;gap:7px;letter-spacing:.02em;text-transform:none;font-weight:700;font-size:12px}
.ss-meter-dot{width:9px;height:9px;border-radius:50%;flex:none}
.ss-m-low{color:#155433}.ss-m-low .ss-meter-dot{background:#155433}
.ss-m-mod{color:#8a6d2e}.ss-m-mod .ss-meter-dot{background:#b8934a}
.ss-m-high{color:#8c2b23}.ss-m-high .ss-meter-dot{background:#8c2b23}
.ss-prog{height:6px;background:#ece8dd;border-radius:99px;overflow:hidden}
.ss-prog span{display:block;height:100%;background:linear-gradient(90deg,#6f521a,#b8934a);border-radius:99px;transition:width .35s ease}
.ss-docs{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 18px}
.ss-doc-lab{width:100%;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:2px}
.ss-doc-chip{display:inline-flex;align-items:center;gap:7px;background:#fff;border:1px solid var(--line2);color:var(--ink);border-radius:9px;padding:8px 13px;min-height:44px;font-size:13px;font-weight:650;cursor:pointer;font-family:inherit;transition:border-color .13s,box-shadow .13s}
.ss-doc-chip:hover{border-color:rgba(var(--brass-rgb),.5);box-shadow:0 6px 16px -12px rgba(var(--navy-rgb),.4)}
.ss-doc-chip svg{width:14px;height:14px;flex:none;color:var(--brass)}
.ss-prompt{font-family:var(--serif);font-size:20px;line-height:1.35;color:var(--ink);letter-spacing:-.006em;margin:0 0 16px}
.ss-opts{display:flex;flex-direction:column;gap:10px}
.ss-opt{display:flex;gap:12px;align-items:flex-start;background:#fff;border:1px solid var(--line2);border-radius:11px;padding:13px 15px;cursor:pointer;transition:border-color .13s,box-shadow .13s}
.ss-opt:hover{border-color:rgba(var(--brass-rgb),.5)}
.ss-opt.sel{border-color:var(--brass);box-shadow:0 0 0 1px var(--brass)}
.ss-opt input{margin:2px 0 0;flex:none;accent-color:#87651c;width:17px;height:17px}
.ss-opt-txt{font-size:14.5px;line-height:1.5;color:var(--ink)}
.ss-opt.locked{cursor:default}
.ss-opt.picked-right{border-color:rgba(30,107,67,.55);box-shadow:0 0 0 1px rgba(30,107,67,.4);background:#f6fbf7}
.ss-opt.picked-wrong{border-color:rgba(179,38,30,.5);box-shadow:0 0 0 1px rgba(179,38,30,.35);background:#fdf6f5}
.ss-opt.picked-warn{border-color:rgba(var(--brass-rgb),.5);box-shadow:0 0 0 1px rgba(var(--brass-rgb),.32);background:#fdf9ee}
.ss-opt-mark{margin-left:auto;flex:none;font-size:12px;font-weight:800;align-self:center;white-space:nowrap}
.ss-opt-mark.ok{color:#155433}.ss-opt-mark.no{color:#8c2b23}.ss-opt-mark.warn{color:#8a6d2e}
.ss-fb{border-radius:12px;padding:15px 17px;margin-top:18px;font-size:14.5px;line-height:1.58}
.ss-fb-good{background:#eef7f0;color:#134d2e;border:1px solid rgba(30,107,67,.3)}
.ss-fb-bad{background:#fdf0ef;color:#7c2620;border:1px solid rgba(179,38,30,.3)}
.ss-fb-warn{background:#faf3e0;color:#6f5416;border:1px solid rgba(var(--brass-rgb),.3)}
.ss-fb-head{font-weight:800;letter-spacing:.02em;display:flex;align-items:center;gap:8px;margin-bottom:5px}
.ss-cite{margin-top:15px;border-left:3px solid var(--brass);padding:3px 0 3px 15px}
.ss-cite-q{font-family:var(--serif);font-size:14px;font-style:italic;color:#33404f;line-height:1.5;margin:0 0 8px}
.ss-cite-q+.ss-cite-q{margin-top:8px}
.ss-cite-src{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:var(--brass-ink);text-decoration:none;border-bottom:1px solid rgba(var(--brass-rgb),.45);padding-bottom:1px}
.ss-cite-src:hover{color:#3a2c0d;border-color:var(--brass)}
.ss-cite-src svg{width:12px;height:12px}
.ss-verdict{position:relative;overflow:hidden;border-radius:16px;padding:28px 26px;text-align:center;margin-bottom:18px}
.ss-verdict::before{content:'';position:absolute;top:0;left:0;right:0;height:3px}
.ss-verdict h2{font-family:var(--serif);font-size:27px;letter-spacing:var(--ls-snug);margin:0 0 8px;line-height:1.15}
.ss-verdict p{font-size:14.5px;line-height:1.55;margin:0 auto;max-width:56ch}
.ss-verdict-good{background:#eef7f0;border:1px solid rgba(30,107,67,.32)}.ss-verdict-good h2{color:#155433}.ss-verdict-good::before{background:#155433}
.ss-verdict-warn{background:#faf3e0;border:1px solid rgba(var(--brass-rgb),.32)}.ss-verdict-warn h2{color:#6f5416}.ss-verdict-warn::before{background:var(--brass)}
.ss-verdict-bad{background:#fdf0ef;border:1px solid rgba(179,38,30,.32)}.ss-verdict-bad h2{color:#8c2b23}.ss-verdict-bad::before{background:#8c2b23}
.ss-score{display:inline-flex;align-items:baseline;gap:7px;margin-top:14px;font-size:13px;color:var(--muted);font-weight:600}
.ss-score b{font-family:var(--serif);font-size:30px;color:var(--ink);font-variant-numeric:tabular-nums;line-height:1}
.ss-log{background:#fff;border:1px solid var(--line2);border-radius:12px;overflow:hidden;margin-top:16px}
.ss-log-cap{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);padding:12px 16px 8px}
.ss-log-row{display:grid;grid-template-columns:22px 1fr auto;gap:11px;align-items:baseline;padding:10px 16px;border-top:1px solid var(--line2);font-size:13.5px;line-height:1.45}
.ss-log-mark{font-weight:800;font-size:13px}
.ss-log-ok .ss-log-mark{color:#155433}.ss-log-bad .ss-log-mark{color:#8c2b23}.ss-log-warn .ss-log-mark{color:#8a6d2e}
.ss-log-warn .ss-log-risk{color:#8a6d2e}
.ss-log-txt{color:#2a3140}
.ss-log-txt b{color:var(--ink)}
.ss-log-risk{font-size:11.5px;font-weight:800;color:#8c2b23;font-variant-numeric:tabular-nums;white-space:nowrap}
.ss-log-risk.zero{color:#155433}
.ss-modal{position:fixed;inset:0;background:rgba(10,20,35,.6);display:flex;align-items:flex-start;justify-content:center;padding:30px 14px;z-index:60;overflow-y:auto;-webkit-overflow-scrolling:touch}
.ss-modal-card{background:#fbfaf6;border-radius:var(--r-lg);max-width:720px;width:100%;box-shadow:0 34px 80px -20px rgba(0,0,0,.55);margin:auto 0}
.ss-modal-head{position:sticky;top:0;display:flex;justify-content:space-between;align-items:center;gap:12px;background:#16263f;color:#f4f8fc;padding:13px 18px;border-radius:var(--r-lg) var(--r-lg) 0 0;z-index:2}
.ss-modal-head h3{font-size:15px;margin:0;font-family:var(--serif);font-weight:600}
.ss-modal-close{background:rgba(255,255,255,.15);border:none;color:#fff;width:40px;height:40px;border-radius:8px;cursor:pointer;font-size:18px;line-height:1;flex:none}
.ss-modal-close:hover{background:rgba(255,255,255,.28)}
.ss-doc{padding:22px 24px 26px}
@media(max-width:560px){.ss-doc{padding:18px 16px 22px}}
.ss-train{display:inline-block;font-size:9.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#8a6d2e;background:#faf3e0;border:1px dashed rgba(var(--brass-rgb),.5);border-radius:5px;padding:4px 10px;margin-bottom:15px}
.ss-tscroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:10px 0 14px}
.ss-tscroll .dod-table{margin:0}
.cui-banner{font-size:9.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;text-align:center;color:#8a6d2e;background:#f7efd9;border:1px solid rgba(var(--brass-rgb),.35);border-radius:5px;padding:6px 10px;margin-bottom:16px}
.dod-header{text-align:center;border-bottom:2px solid #16263f;padding-bottom:11px;margin-bottom:15px}
.dod-header h3{font-family:var(--serif);font-size:18px;color:#16263f;margin:0;line-height:1.2}
.dod-header h4{font-size:12px;font-weight:600;color:var(--muted);margin:5px 0 0}
.ss-doc p{font-size:14px;line-height:1.62;color:#2a3140;margin:0 0 11px}
.ss-doc ul{margin:0 0 11px;padding-left:19px}
.ss-doc li{font-size:14px;line-height:1.55;color:#2a3140;margin-bottom:5px}
.ss-doc hr{border:none;border-top:1px solid #e0dccf;margin:14px 0}
.dod-table{width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:12.5px}
.dod-table th,.dod-table td{border:1px solid #cfc8b8;padding:6px 9px;text-align:left;vertical-align:top;line-height:1.4}
.dod-table th{background:#f1ece0;color:#16263f;font-weight:700}
.dod-sig{margin-top:16px;padding-top:9px;border-top:1px solid #cfc8b8;font-size:12.5px;font-style:italic;color:var(--muted);text-align:right}
.ss-fail{background:#fff;border:1px solid var(--line2);border-radius:var(--r-lg);padding:22px 24px}
.ss-fail h2{font-family:var(--serif);font-size:20px;color:var(--ink);margin:0 0 8px}
</style>`;

  const BRAND_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="6" y="6" width="88" height="88" rx="16" fill="#0f2540"/><rect x="13" y="13" width="74" height="74" rx="11" fill="none" stroke="rgba(var(--brass-bright-rgb),.5)" stroke-width="1.5"/><circle cx="50" cy="50" r="22" fill="none" stroke="#e4c477" stroke-width="3"/><g stroke="#e4c477" stroke-width="3.4" stroke-linecap="round"><line x1="50" y1="32" x2="50" y2="40"/><line x1="50" y1="68" x2="50" y2="60"/><line x1="32" y1="50" x2="40" y2="50"/><line x1="68" y1="50" x2="60" y2="50"/></g><circle cx="50" cy="50" r="5" fill="#e4c477"/></svg>';

  const SEAL = '<svg class="lib-seal" viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="ss-seal-g" cx="36%" cy="30%" r="80%"><stop offset="0" stop-color="#f2d89a"/><stop offset="48%" stop-color="#cda857"/><stop offset="100%" stop-color="#876514"/></radialGradient></defs><circle cx="50" cy="50" r="47" fill="url(#ss-seal-g)" stroke="#6f521a" stroke-width="1.5"/><circle cx="50" cy="50" r="42" fill="none" stroke="#6f521a" stroke-width="1" stroke-dasharray="1.2 2.6" opacity="0.55"/><circle cx="50" cy="50" r="22" fill="none" stroke="#16263f" stroke-width="2.4" opacity="0.9"/><g stroke="#16263f" stroke-width="3" stroke-linecap="round" opacity="0.9"><line x1="50" y1="33" x2="50" y2="41"/><line x1="50" y1="67" x2="50" y2="59"/><line x1="33" y1="50" x2="41" y2="50"/><line x1="67" y1="50" x2="59" y2="50"/></g><circle cx="50" cy="50" r="5.5" fill="#16263f" opacity="0.9"/></svg>';

  const body = `${SRCSEL_CSS}<header class="lnav"><div class="lnav-inner"><a class="brand" href="/?home=1">${BRAND_SVG}AcqVault</a><span class="hdr-links"><a class="hlink" href="/study">Study</a><a class="cta" href="/?q=">Search all sources →</a></span></div></header>
<main>
<section class="lband lhero"><div class="lband-inner">
${SEAL}
<nav class="crumbs"><a href="/?home=1">AcqVault</a> › <a href="/study">Study</a> › Source Selection</nav>
<div class="eyebrow">AcqVault · Simulator</div>
<h1>Run a source selection</h1>
<p class="lede">Sit in the Source Selection Authority's chair and work a full best-value tradeoff — from acquisition planning to the signed decision. Every call carries a protest-risk cost, and every call links straight to the governing DoD Source Selection Procedures on this site.</p>
<div class="stats"><span class="stat">9 decisions</span><span class="stat">One $250M source selection</span><span class="stat">Every rule cited to the SSP</span><span class="stat">Free · no account</span><span class="stat">Untimed</span></div>
</div></section>
<section class="lband lband--room"><div class="st-guilloche" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><g fill="none" stroke="#0f2540" stroke-width="0.6"><circle cx="300" cy="300" r="150"/><circle cx="300" cy="300" r="120"/><circle cx="300" cy="300" r="90"/><circle cx="300" cy="300" r="60"/></g></svg></div><div class="ss-wrap">
<div id="ssim-app"><noscript><p class="ss-sub">The source-selection simulator is interactive and needs JavaScript. The procedures it drills are all searchable in the <a href="/ssp">DoD Source Selection Procedures</a>.</p></noscript><p class="ss-sub">Loading the simulator…</p></div>
</div></section>
</main>
<footer class="lband lband--foot"><div class="lband-inner">
<p class="lfoot-note"><strong>How it works:</strong> read the record for each phase, make the call the Source Selection Authority would make, then check it against the governing rule. Wrong calls add to a running protest-risk score that decides whether your award survives a GAO protest. The scenario is fictional; the procedures and citations are real. Adapted from a colleague's warrant-prep exercise and rebuilt on the current DoD Source Selection Procedures.</p>
<p class="lfoot-legal">AcqVault is an <strong>unofficial research aid</strong> — not legal advice and not an official source. Verify anything you'll rely on against the <a href="/ssp">DoD Source Selection Procedures</a> and the official text at <a href="https://www.acquisition.gov/far-overhaul" rel="noopener">acquisition.gov</a>.</p>
</div></footer>
<script defer src="/assets/source-selection.js?v=4"></script>`;

  return shell({ title, description, canonical, jsonld, body, bleed: true, ogImage: 'og-src-ssp-v2.png' });
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
  urls.push(`${SITE}/source-selection`);
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

module.exports = { SOURCES, SOURCE_KEYS, partLabel, displayPartForSource, partWord, regOrderKey, renderPartPage, renderHubPage, renderDeviationsPage, renderExplainerPage, renderLibraryPage, renderChangesPage, renderStudyPage, renderSourceSelectionPage, render48ConsPage, renderSlipPage, renderSitemap, renderNotFoundPage, SITE };
