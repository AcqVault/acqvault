const fs = require('fs');
const path = require('path');
const { enforce } = require('./_ratelimit');

// AcqVault search runs fully in-memory over output/documents.json (all 7
// sources, ~5,900 docs). No external search service — the corpus is small and
// the data already ships with the deployment, so this removes the MeiliSearch
// dependency (and its credentials) and the local/remote split-brain entirely.

let docsCache = null;
let indexCache = null;

function loadDocs() {
  if (docsCache) return docsCache;
  const docsPath = path.join(process.cwd(), 'output', 'documents.json');
  // DAF Compass is temporarily excluded from search until we can source it in a
  // way that isn't CAC-gated. Docs stay in documents.json (reversible) but are
  // filtered out of the searchable index — keep this identical to the client
  // filter in assets/app.js (acqLoadCorpus).
  docsCache = JSON.parse(fs.readFileSync(docsPath, 'utf8')).filter(Boolean).filter(doc => doc.source !== 'compass');
  return docsCache;
}

// Parallel index of lowercased title/content so queries don't re-lowercase the
// (large) corpus every call. Built once per cold start; never sent to clients.
function loadIndex() {
  if (indexCache) return indexCache;
  indexCache = loadDocs().map(doc => ({
    doc,
    titleLc: String(doc.title || '').toLowerCase(),
    contentLc: String(doc.content || '').toLowerCase()
  }));
  return indexCache;
}

function parseValueFilters(filter, field) {
  const pattern = new RegExp(`${field}\\s*=\\s*"([^"]+)"`, 'g');
  return [...String(filter || '').matchAll(pattern)].map(match => match[1]);
}

// Tokenize on any non-alphanumeric run so "micro-purchase" -> micro, purchase
// (matches how the corpus renders such terms with spaces/hyphens).
function queryTerms(query) {
  return String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 2);
}

// Relevance: every term must appear somewhere (AND). Title hits and full-phrase
// hits dominate so the specific on-point section beats the big part-overview
// doc (raw occurrence count is deliberately NOT used — it biases to long docs).
function scoreEntry(entry, terms, phraseRe) {
  if (!terms.length) return 1;
  let score = 0, titleHits = 0;
  for (const term of terms) {
    const inTitle = entry.titleLc.includes(term);
    const inContent = entry.contentLc.includes(term);
    if (!inTitle && !inContent) return 0;
    if (inTitle) { score += 20; titleHits++; }
    if (inContent) score += 2;
  }
  if (titleHits === terms.length) score += 15;
  // phraseRe allows ANY non-alphanumeric run between the terms, so the hyphenated spelling
  // the corpus actually uses ("micro-purchase threshold") earns the same phrase bonus as the
  // spaced one. Rebuilding the phrase with single spaces made the dominant +100 signal fire
  // only on the rare spaced spelling, ranking a tangential section above every canonical one.
  if (phraseRe && terms.length > 1) {
    if (phraseRe.test(entry.titleLc)) score += 100;
    else if (phraseRe.test(entry.contentLc)) score += 25;
  }
  return score;
}

function partNum(doc) {
  const m = String(doc.part || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 9999;
}

// Order sections the way the rulebook reads: a "Subpart NN.M" heading sits just
// before the NN.Mxx sections it introduces, instead of sorting to the very end
// (plain alphabetical put every "Subpart …" title after the digit-led ones).
// Returns null for titles that aren't numbered sections/subparts so other
// sources fall back to the numeric-aware locale compare (their current order).
// KEEP IDENTICAL to app.js regTitleCmp (scorer parity) and api/_seo.js.
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

function cropContent(content, query, cropLength) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  const limit = Number(cropLength) || 180;
  const q = String(query || '').trim().toLowerCase();
  if (!q) return text.slice(0, limit * 2);
  const firstTerm = q.split(/\s+/).find(Boolean);
  const idx = firstTerm ? text.toLowerCase().indexOf(firstTerm) : -1;
  if (idx === -1) return text.slice(0, limit * 2);
  const start = Math.max(0, idx - Math.floor(limit / 2));
  const end = Math.min(text.length, start + limit * 2);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

// Wrap query terms in <mark>. Returns UNescaped text with <mark> tags; the
// client (markOnly) html-escapes everything else, so this is XSS-safe there.
function highlight(text, query) {
  let out = String(text || '');
  const terms = [...new Set(String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter(term => term.length > 2))];
  // When the query tokenizes to nothing (e.g. "J&A", "8(a)", "T&M" — the rawQ substring
  // branch of searchDocs), mark the literal query instead, or those hits render unhighlighted.
  const rawQ = String(query || '').trim();
  if (!terms.length && /[a-z0-9]/i.test(rawQ)) {
    const escaped = rawQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return out.replace(new RegExp(`(${escaped})`, 'ig'), '<mark>$1</mark>');
  }
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(${escaped})`, 'ig'), '<mark>$1</mark>');
  }
  return out;
}


// ── CLAUSE DEDUP FOR SEARCH ───────────────────────────────────────────────────
// 274 clause numbers exist as more than one r-dfars doc: the deviation memo's copy in
// the clause's SUBJECT part, a legacy pre-deviation copy in part 52, and sometimes a
// title-only stub where a memo merely lists the clause. Their prescriptions can
// DISAGREE (all 13 checked against the signed memos: the subject-part copy matches the
// memo 12/13, part 52 never does — part 52 is the pre-deviation library). Returning
// both from a SEARCH invites citing the stale one, so a query returns only the best
// copy per clause number: subject-part substantive > part-52 substantive > stub.
// Browse is untouched — a part filter shows everything, and part 52 pages carry a
// supersession note instead. KEEP IDENTICAL to app.js acqClauseSuppressed (scorer parity).
function clauseNum(title) {
  const m = String(title || '').trim().match(/^(252\.\d{3}-\d{4}(?:-\d+)?)\b/);
  return m ? m[1] : null;
}
let clauseSuppressCache = null;
function clauseSuppressSet(entries) {
  if (clauseSuppressCache) return clauseSuppressCache;
  const best = new Map();   // clause -> winning doc
  const rank = d => (String(d.part) !== '52' ? 2 : 1) * 1000000 + Math.min(String(d.content || '').length, 999999);
  for (const { doc } of entries) {
    if (doc.source !== 'r-dfars') continue;
    const c = clauseNum(doc.title);
    if (!c) continue;
    const prev = best.get(c);
    if (!prev || rank(doc) > rank(prev)) best.set(c, doc);
  }
  const suppress = new Set();
  for (const { doc } of entries) {
    if (doc.source !== 'r-dfars') continue;
    const c = clauseNum(doc.title);
    if (c && best.get(c) && best.get(c).id !== doc.id) suppress.add(doc.id);
  }
  clauseSuppressCache = suppress;
  return suppress;
}

function searchDocs(body = {}) {
  const filter = body.filter || '';
  const sources = parseValueFilters(filter, 'source');
  const parts = parseValueFilters(filter, 'part');
  const statuses = parseValueFilters(filter, 'status');
  const terms = queryTerms(body.q);
  // terms are already [a-z0-9]-only, so they need no regex escaping.
  const phraseRe = terms.length > 1 ? new RegExp(terms.join('[^a-z0-9]+')) : null;
  const rawQ = String(body.q || '').trim().toLowerCase();

  let entries = loadIndex().filter(({ doc }) => {
    if (sources.length && !sources.includes(String(doc.source || ''))) return false;
    if (parts.length && !parts.includes(String(doc.part || ''))) return false;
    if (statuses.length && !statuses.includes(String(doc.status || ''))) return false;
    return true;
  });

  if (terms.length) {
    // Dedup applies to QUERIES only — a part filter (browse) must keep every doc.
    const suppress = clauseSuppressSet(loadIndex());
    entries = entries
      .filter(({ doc }) => !suppress.has(doc.id))
      .map(entry => ({ entry, score: scoreEntry(entry, terms, phraseRe) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.entry);
  } else if (rawQ) {
    // The query tokenized away entirely — every token was 1 char ("J&A", "8(a)", "T&M").
    // These are everyday acquisition terms, and falling through to the browse branch
    // returned the WHOLE corpus as if it were results. Match the literal string instead.
    const suppress = clauseSuppressSet(loadIndex());
    entries = entries
      .filter(({ doc }) => !suppress.has(doc.id))
      .map(entry => ({ entry, score: (entry.titleLc.includes(rawQ) ? 100 : 0) + (entry.contentLc.includes(rawQ) ? 10 : 0) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.entry);
  } else {
    entries = entries.sort((a, b) =>
      partNum(a.doc) - partNum(b.doc) || regTitleCmp(a.doc.title, b.doc.title));
  }

  const total = entries.length;
  // Clamp both sides: a negative limit made slice(0, -1) return nearly the entire corpus
  // (each hit spreads the full doc) from a public unauthenticated POST.
  const offset = Math.max(0, Number(body.offset) || 0);
  const limit = Math.max(1, Math.min(Number(body.limit) || 20, 100));
  const hits = entries.slice(offset, offset + limit).map(({ doc }) => ({
    ...doc,
    _formatted: {
      title: highlight(doc.title, body.q),
      content: highlight(cropContent(doc.content, body.q, body.cropLength), body.q)
    }
  }));

  return { hits, estimatedTotalHits: total, offset, limit, processingTimeMs: 0, query: body.q || '' };
}

function getDocument(id) {
  return loadDocs().find(doc => String(doc.id) === String(id)) || null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (await enforce(req, res, { max: 40, name: 'search' })) return;

  // A malformed JSON body makes Vercel's parser throw the moment req.body is
  // read — catch it here so the client gets a clean 400, not a generic 500.
  let reqBody;
  try {
    reqBody = req.body || {};
  } catch (_e) {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }

  try {
    const { action, body, id } = reqBody;

    if (action === 'search') {
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json(searchDocs(body || {}));
    }

    if (action === 'document') {
      if (!id) return res.status(400).json({ error: 'Missing document id.' });
      const doc = getDocument(id);
      if (!doc) return res.status(404).json({ error: 'Document not found.' });
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json(doc);
    }

    return res.status(400).json({ error: 'Unsupported search action.' });
  } catch (error) {
    console.error('search error:', error && error.message ? error.message : error);
    return res.status(500).json({ error: 'Search request failed.' });
  }
};
