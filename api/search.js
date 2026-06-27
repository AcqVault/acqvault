const fs = require('fs');
const path = require('path');

// AcqVault search runs fully in-memory over output/documents.json (all 6
// sources, ~502 docs). No external search service — the corpus is small and
// the data already ships with the deployment, so this removes the MeiliSearch
// dependency (and its credentials) and the local/remote split-brain entirely.

let docsCache = null;
let indexCache = null;

function loadDocs() {
  if (docsCache) return docsCache;
  const docsPath = path.join(process.cwd(), 'output', 'documents.json');
  docsCache = JSON.parse(fs.readFileSync(docsPath, 'utf8')).filter(Boolean);
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
function scoreEntry(entry, terms, phrase) {
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
  if (phrase && terms.length > 1) {
    if (entry.titleLc.includes(phrase)) score += 100;
    else if (entry.contentLc.includes(phrase)) score += 25;
  }
  return score;
}

function partNum(doc) {
  const m = String(doc.part || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 9999;
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
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(${escaped})`, 'ig'), '<mark>$1</mark>');
  }
  return out;
}

function searchDocs(body = {}) {
  const filter = body.filter || '';
  const sources = parseValueFilters(filter, 'source');
  const parts = parseValueFilters(filter, 'part');
  const statuses = parseValueFilters(filter, 'status');
  const terms = queryTerms(body.q);
  const phrase = terms.join(' ');

  let entries = loadIndex().filter(({ doc }) => {
    if (sources.length && !sources.includes(String(doc.source || ''))) return false;
    if (parts.length && !parts.includes(String(doc.part || ''))) return false;
    if (statuses.length && !statuses.includes(String(doc.status || ''))) return false;
    return true;
  });

  if (terms.length) {
    entries = entries
      .map(entry => ({ entry, score: scoreEntry(entry, terms, phrase) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.entry);
  } else {
    entries = entries.sort((a, b) =>
      partNum(a.doc) - partNum(b.doc) || String(a.doc.title || '').localeCompare(String(b.doc.title || '')));
  }

  const total = entries.length;
  const offset = Number(body.offset) || 0;
  const limit = Math.min(Number(body.limit) || 20, 100);
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

  try {
    const { action, body, id } = req.body || {};

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
