const fs = require('fs');
const path = require('path');

const LOCAL_SOURCES = new Set(['category-management', 'afi-63-138', 'compass']);
let localDocsCache = null;

function loadLocalDocs() {
  if (localDocsCache) return localDocsCache;
  const docsPath = path.join(process.cwd(), 'output', 'documents.json');
  const docs = JSON.parse(fs.readFileSync(docsPath, 'utf8'));
  localDocsCache = docs.filter(doc => doc && LOCAL_SOURCES.has(doc.source));
  return localDocsCache;
}

function parseSourceFilters(filter) {
  return [...String(filter || '').matchAll(/source\s*=\s*"([^"]+)"/g)].map(match => match[1]);
}

function parseValueFilters(filter, field) {
  const pattern = new RegExp(`${field}\\s*=\\s*"([^"]+)"`, 'g');
  return [...String(filter || '').matchAll(pattern)].map(match => match[1]);
}

function filterIncludesLocal(filter) {
  const sources = parseSourceFilters(filter);
  return !sources.length || sources.some(source => LOCAL_SOURCES.has(source));
}

function stripLocalFromFilter(filter) {
  if (!filterIncludesLocal(filter)) return filter || null;
  const sources = parseSourceFilters(filter).filter(source => !LOCAL_SOURCES.has(source));
  let next = String(filter || '');

  if (sources.length) {
    next = next.replace(/\((?:source\s*=\s*"[^"]+"\s*(?:OR\s*)?)+\)/, '(' + sources.map(source => `source = "${source}"`).join(' OR ') + ')');
  } else {
    next = next
      .replace(/\((?:source\s*=\s*"[^"]+"\s*(?:OR\s*)?)+\)\s*AND\s*/g, '')
      .replace(/\s*AND\s*\((?:source\s*=\s*"[^"]+"\s*(?:OR\s*)?)+\)/g, '')
      .replace(/\((?:source\s*=\s*"[^"]+"\s*(?:OR\s*)?)+\)/g, '')
      .replace(/^\s*source\s*=\s*"[^"]+"\s*AND\s*/g, '')
      .replace(/\s*AND\s*source\s*=\s*"[^"]+"\s*$/g, '')
      .replace(/^\s*source\s*=\s*"[^"]+"\s*$/g, '');
  }

  return next.trim() || null;
}

function localMatchesQuery(doc, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const haystack = `${doc.title || ''}\n${doc.content || ''}`.toLowerCase();
  return q.split(/\s+/).filter(Boolean).every(term => haystack.includes(term));
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

function highlight(text, query) {
  let out = String(text || '');
  const terms = [...new Set(String(query || '').trim().split(/\s+/).filter(term => term.length > 2))];
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(${escaped})`, 'ig'), '<mark>$1</mark>');
  }
  return out;
}

function localSearch(body = {}) {
  const filter = body.filter || '';
  if (!filterIncludesLocal(filter)) {
    return { hits: [], estimatedTotalHits: 0 };
  }

  const sources = parseSourceFilters(filter);
  const parts = parseValueFilters(filter, 'part');
  const statuses = parseValueFilters(filter, 'status');
  let hits = loadLocalDocs().filter(doc => {
    if (sources.length && !sources.includes(String(doc.source || ''))) return false;
    if (parts.length && !parts.includes(String(doc.part || ''))) return false;
    if (statuses.length && !statuses.includes(String(doc.status || ''))) return false;
    return localMatchesQuery(doc, body.q);
  });

  hits = hits.map(doc => ({
    ...doc,
    _formatted: {
      title: highlight(doc.title, body.q),
      content: highlight(cropContent(doc.content, body.q, body.cropLength), body.q)
    }
  }));

  const offset = Number(body.offset) || 0;
  const limit = Number(body.limit) || 20;
  return {
    hits: hits.slice(offset, offset + limit),
    estimatedTotalHits: hits.length,
    offset,
    limit,
    processingTimeMs: 0,
    query: body.q || ''
  };
}

function localDocument(id) {
  return loadLocalDocs().find(doc => String(doc.id) === String(id)) || null;
}

async function fetchMeiliSearch(base, index, headers, body) {
  const upstream = await fetch(`${base}/indexes/${encodeURIComponent(index)}/search`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const data = await upstream.json().catch(async () => ({ error: await upstream.text() }));
  if (!upstream.ok) {
    const message = data && (data.error || data.message) ? (data.error || data.message) : `HTTP ${upstream.status}`;
    const error = new Error(message);
    error.status = upstream.status;
    throw error;
  }
  return data;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const host = process.env.MEILI_HOST;
  const key = process.env.MEILI_SEARCH_KEY;
  const index = process.env.MEILI_INDEX || 'acqvault';

  try {
    const { action, body, id } = req.body || {};
    const remoteConfig = () => ({
      base: host.replace(/\/$/, ''),
      headers: { Authorization: `Bearer ${key}` }
    });

    if (action === 'search') {
      const requestBody = body || {};
      const sourceFilters = parseSourceFilters(requestBody.filter);
      const wantsLocal = filterIncludesLocal(requestBody.filter);
      const meiliFilter = stripLocalFromFilter(requestBody.filter);
      const wantsMeili = sourceFilters.length ? sourceFilters.some(source => !LOCAL_SOURCES.has(source)) : true;
      const local = wantsLocal ? localSearch(requestBody) : { hits: [], estimatedTotalHits: 0 };

      if (!wantsMeili) {
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
        return res.status(200).json(local);
      }
      if (!host || !key) {
        return res.status(500).json({ error: 'Search service is not configured.' });
      }

      const meiliBody = { ...requestBody };
      if (meiliFilter) meiliBody.filter = meiliFilter;
      else delete meiliBody.filter;
      const { base, headers } = remoteConfig();
      const remote = await fetchMeiliSearch(base, index, headers, meiliBody);
      const mergedHits = [...(remote.hits || []), ...(local.hits || [])];
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
      return res.status(200).json({
        ...remote,
        hits: mergedHits.slice(0, Number(requestBody.limit) || mergedHits.length),
        estimatedTotalHits: (remote.estimatedTotalHits || remote.hits?.length || 0) + (local.estimatedTotalHits || 0)
      });
    }

    if (action === 'document') {
      if (!id) return res.status(400).json({ error: 'Missing document id.' });
      const local = localDocument(id);
      if (local) {
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
        return res.status(200).json(local);
      }
      if (!host || !key) {
        return res.status(500).json({ error: 'Search service is not configured.' });
      }

      const { base, headers } = remoteConfig();
      const upstream = await fetch(`${base}/indexes/${encodeURIComponent(index)}/documents/${encodeURIComponent(id)}`, {
        headers
      });
      const text = await upstream.text();
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
      res.status(upstream.status);
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
      return res.send(text);
    }

    return res.status(400).json({ error: 'Unsupported search action.' });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: 'Search request failed.',
      detail: error && error.message ? error.message : String(error)
    });
  }
};
