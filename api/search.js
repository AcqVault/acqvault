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

// Order sections the way the rulebook reads: a "Subpart NN.M" heading sits just
// before the NN.Mxx sections it introduces, instead of sorting to the very end
// (plain alphabetical put every "Subpart …" title after the digit-led ones).
// Returns null for titles that aren't numbered sections/subparts so other
// sources fall back to the numeric-aware locale compare (their current order).
// KEEP IDENTICAL to app.js regTitleCmp (scorer parity) and api/_seo.js.
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
      partNum(a.doc) - partNum(b.doc) || regTitleCmp(a.doc.title, b.doc.title));
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

/* ── ASK THE VAULT — opt-in AI answers, grounded in the site's own text ────────
   action:'ask' retrieves the most relevant corpus sections + Field Guide study
   material for the question, hands ONLY those excerpts to the model (Groq,
   OpenAI-compatible), and returns the answer with the excerpt list so the
   client can render verifiable citations. No GROQ_API_KEY → configured:false
   (the client falls back to authoritative search). */

const STOPWORDS = new Set(('a an and any are as at be but by can could did do does for from get had has have how i if in is it its just like make many me more most much my need new of on only or our should so some than that the their them then there these they this to under up us use using very was we what when where which who why will with would you your'
  // conversational filler — questions arrive as chat ("im curious about…", "my
  // boss keeps telling me…"); these words must never count toward retrieval
  + ' im ive id youre hes shes theyre whats hows curious wondering wonder interested asking asked ask boss supervisor keeps keep telling tell tells told saying says said wants want wanted trying tried help please thanks thing things stuff really always still even maybe actually basically currently right okay ok hey hi so um uh guys guy someone somebody anyone everybody about also into been being whether gets getting got gonna doing done going'
).split(' '));

/* Concept lexicon — bridges everyday phrasings to the regulation's own
   vocabulary (a purely lexical match can't get from "sole source… compete" to
   "other than full and open competition"). Each entry: a pattern tested against
   the RAW lowercased question, and the corpus phrases it should light up.
   Docs containing a lit phrase get a strong score boost and qualify for
   retrieval even when the chatty query words themselves don't match. */
const ASK_CONCEPTS = [
  { re: /sole[- ]?sourc|single[- ]?sourc|only one (vendor|supplier|contractor|source)|no[- ]?bid|without competition/, add: ['other than full and open competition', 'only one responsible source', 'justification', 'sole source'] },
  { re: /\bcompet/, add: ['full and open competition', 'competition requirement', 'competitive procedures'] },
  { re: /j&a|justification/, add: ['justification', 'approval of justification'] },
  { re: /set[- ]?aside|small business|8\(a\)|hubzone|sdvosb|wosb/, add: ['set-aside', 'small business', 'rule of two'] },
  { re: /micro[- ]?purchase|mpt\b|gpc|purchase card/, add: ['micro-purchase threshold', 'micro-purchase'] },
  { re: /simplified acquisition|\bsat\b|\bsap\b/, add: ['simplified acquisition threshold', 'simplified acquisition procedures'] },
  { re: /tina|certified cost|cost or pricing data|truth in negotiation/, add: ['certified cost or pricing data', 'cost or pricing data'] },
  { re: /commercial (item|product|service)|commerciality/, add: ['commercial products and commercial services', 'commercial acquisition'] },
  { re: /\bidiq\b|indefinite[- ]delivery|task order|delivery order/, add: ['indefinite-delivery', 'task order', 'fair opportunity'] },
  { re: /\bbpa\b|blanket purchase/, add: ['blanket purchase agreement'] },
  { re: /\bota\b|other transaction/, add: ['other transaction'] },
  { re: /best value|tradeoff|trade-off|lpta|lowest price/, add: ['best value', 'tradeoff process', 'lowest price technically acceptable'] },
  { re: /past performance|cpars/, add: ['past performance'] },
  { re: /debrief/, add: ['debriefing'] },
  { re: /protest/, add: ['protest'] },
  { re: /terminat/, add: ['termination for convenience', 'termination for default'] },
  { re: /\brea\b|equitable adjustment/, add: ['equitable adjustment'] },
  { re: /\bclaim\b|disputes?\b/, add: ['claim', 'disputes'] },
  { re: /option (year|period)|exercise (an |the )?option/, add: ['exercise of option', 'option to extend'] },
  { re: /market research/, add: ['market research'] },
  { re: /data rights|technical data|intellectual property/, add: ['rights in technical data', 'data rights'] },
  { re: /change order|modification|\bmod\b/, add: ['modification', 'changes clause'] },
  { re: /fixed[- ]?price|\bffp\b|cost[- ]?(plus|reimburs)|cpff|\bt&m\b|time and materials/, add: ['contract type', 'firm-fixed-price', 'cost-reimbursement'] },
  { re: /ratif/, add: ['ratification', 'unauthorized commitment'] },
  { re: /synopsi|sam\.gov|advertis|posting|publiciz/, add: ['publicizing', 'contract actions'] }
];
function askConceptPhrases(qLc) {
  const out = [];
  for (const c of ASK_CONCEPTS) if (c.re.test(qLc)) for (const p of c.add) if (!out.includes(p)) out.push(p);
  return out;
}
// Word-aware matching: substring matching let "im" hit inside "time"/"claim"
// and junk outranked everything. hasWordExact requires word boundaries; hasTerm
// lets long terms substring-match via a light stem so "compete" finds
// "competition" and "debriefing" finds "debrief".
function hasWordExact(text, word) {
  let idx = text.indexOf(word);
  while (idx !== -1) {
    const b = idx > 0 ? text[idx - 1] : '';
    const a = idx + word.length < text.length ? text[idx + word.length] : '';
    if (!/[a-z0-9]/.test(b) && !/[a-z0-9]/.test(a)) return true;
    idx = text.indexOf(word, idx + 1);
  }
  return false;
}
function hasTerm(text, term) {
  if (term.length >= 5) {
    if (text.includes(term)) return true;
    const stem = term.replace(/(?:ing|ed|es|e|s)$/, '');
    return stem.length >= 4 && text.includes(stem);
  }
  return hasWordExact(text, term);
}
// Concept phrases: multiword phrases are distinctive enough for substring;
// single words must land exactly ("claim" must not fire inside "disclaimer").
function hasPhrase(text, phrase) {
  return phrase.includes(' ') ? text.includes(phrase) : hasWordExact(text, phrase);
}

let deckEntriesCache = null;
function loadDeckEntries() {
  if (deckEntriesCache) return deckEntriesCache;
  const out = [];
  try {
    const deck = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'assets', 'study-deck.json'), 'utf8'));
    // deck.thresholds carries the AUTHORED current dollar values — statute can lead
    // the official FAR text (e.g. TINA $10M via NDAA FY26 while 15.403-3 still
    // prints $2.5M), and these cards state the current figure with its date.
    for (const c of [...(deck.recall_basic || []), ...(deck.recall_advanced || []), ...(deck.thresholds || [])]) {
      const text = `Q: ${c.q}\nA: ${c.a}${c.x ? `\n${c.x}` : ''}`;
      const link = (c.links && c.links[0]) || null;
      out.push({
        cite: link ? link.t : `Field Guide — ${c.topic || 'card'}`,
        title: `Field Guide card — ${c.topic || 'general'}`,
        url: link ? link.u : '/study',
        kind: 'Field Guide',
        text, titleLc: String(c.q || '').toLowerCase(), contentLc: text.toLowerCase()
      });
    }
    for (const s of (deck.scenarios || [])) {
      const text = `Scenario: ${s.scenario || ''}\nBoard answer: ${s.board_answer || ''}`;
      const link = (s.coach && s.coach.links && s.coach.links[0]) || null;
      out.push({
        cite: link ? link.t : 'Board scenario',
        title: `Board scenario — ${(s.topics || []).join(', ') || 'general'}`,
        url: link ? link.u : '/study',
        kind: 'Board scenario',
        text, titleLc: String(s.scenario || '').slice(0, 160).toLowerCase(), contentLc: text.toLowerCase()
      });
    }
  } catch (_e) { /* deck missing in a build — corpus-only retrieval still works */ }
  deckEntriesCache = out;
  return deckEntriesCache;
}

// Natural-language retrieval: unlike searchDocs (strict AND), questions carry
// filler words, so drop stopwords and rank by how many meaningful terms match.
function askTerms(question) {
  return [...new Set(queryTerms(question).filter(t => !STOPWORDS.has(t)))];
}
function softScore(titleLc, contentLc, terms, phrase, concepts) {
  let matched = 0, score = 0, conceptHits = 0;
  for (const t of terms) {
    const inT = hasTerm(titleLc, t), inC = hasTerm(contentLc, t);
    if (!inT && !inC) continue;
    matched++;
    if (inT) score += 20;
    if (inC) score += 2;
  }
  if (phrase && terms.length > 1 && contentLc.includes(phrase)) score += 25;
  for (const p of (concepts || [])) {
    const inT = hasPhrase(titleLc, p), inC = hasPhrase(contentLc, p);
    if (!inT && !inC) continue;
    conceptHits++;
    if (inT) score += 60;
    if (inC) score += 30;
  }
  return { matched, score, conceptHits };
}
function excerptAround(content, terms, budget) {
  const text = content.replace(/\s+/g, ' ').trim();
  if (text.length <= budget) return text;
  let idx = -1;
  const lc = text.toLowerCase();
  for (const t of terms) { idx = lc.indexOf(t); if (idx !== -1) break; }
  if (idx === -1) return text.slice(0, budget);
  const start = Math.max(0, idx - Math.floor(budget / 3));
  return `${start > 0 ? '…' : ''}${text.slice(start, start + budget)}${start + budget < text.length ? '…' : ''}`;
}
function retrieve(question) {
  const terms = askTerms(question);
  const concepts = askConceptPhrases(String(question || '').toLowerCase());
  if (!terms.length && !concepts.length) return [];
  const phrase = terms.join(' ');
  const need = Math.max(1, Math.ceil(terms.length / 2));
  // A doc qualifies by matching enough of the question's own words OR by
  // containing a concept phrase the lexicon mapped from the question — chatty
  // wording must not disqualify the section that actually governs the topic.
  const rank = (items, titleOf, contentOf) => items
    .map(e => ({ e, ...softScore(titleOf(e), contentOf(e), terms, phrase, concepts) }))
    .filter(x => x.matched >= need || x.conceptHits > 0)
    .sort((a, b) => b.score - a.score || (b.matched + b.conceptHits) - (a.matched + a.conceptHits));

  const SRC_LABEL = { 'rfo': 'RFO', 'r-dfars': 'R-DFARS', 'far-companion': 'FAR Companion', 'category-management': 'Category Management', 'afi-63-138': 'DAFI 63-138', 'fmr': 'DoD FMR', 'ssp': 'DoD Source Selection Procedures' };
  const docs = rank(loadIndex(), e => e.titleLc, e => e.contentLc).slice(0, 6).map(({ e }) => {
    const d = e.doc;
    const srcLabel = SRC_LABEL[d.source] || d.source;
    return {
      cite: /^\d/.test(String(d.title || '')) ? `${srcLabel} ${String(d.title).split(' ')[0]}` : `${srcLabel} — ${String(d.title || '').slice(0, 60)}`,
      title: String(d.title || ''),
      url: `/${d.source}/part-${d.part}#${d.anchor || d.id}`,
      kind: srcLabel,
      // L{n}: ingest level markers are structural metadata, not regulation
      // text — strip them so the model never quotes one back
      text: excerptAround(String(d.content || '').replace(/\bL\d+:/g, ''), terms, 1500)
    };
  });
  const deck = rank(loadDeckEntries(), e => e.titleLc, e => e.contentLc).slice(0, 4).map(({ e }) => ({
    cite: e.cite, title: e.title, url: e.url, kind: e.kind,
    text: e.text.length > 1200 ? e.text.slice(0, 1200) + '…' : e.text
  }));
  return [...docs, ...deck];
}

// A question that retrieves NOTHING is the signal for growing ASK_CONCEPTS: it means
// the asker's everyday vocabulary has no bridge to the regulation's wording (the
// "sole source" → "other than full and open competition" problem). Only misses are
// logged — an answered question leaves no trace.
//
// The site keeps nothing about its users, so this logs the stopword-filtered TERMS
// rather than the question. That is also the more useful artifact: the filler is what
// buries the signal ("im curious about sole source my boss keeps telling me" → "sole
// source compete"). Order is preserved so multi-word concepts stay readable. Tokens
// carrying a run of digits are dropped — contract numbers and dollar figures are the
// part most likely to identify someone, and they are worthless as concept vocabulary.
// Goes to the ephemeral Vercel runtime log; nothing is persisted, no IP, no question.
function logRetrievalMiss(question) {
  try {
    // Scrub before tokenizing: an address survives tokenization as its own words
    // ("bob@example.com" → bob example com), which the digit filter never sees.
    const scrubbed = String(question || '')
      .replace(/[\w.+-]+@[\w.-]+\.\w+/g, ' ')
      .replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ');
    const terms = askTerms(scrubbed)
      .filter(t => !/\d{3,}/.test(t))
      .slice(0, 12)
      .join(' ')
      .slice(0, 200);
    if (terms) console.log('ask miss:', terms);
  } catch (e) { /* logging must never break an answer */ }
}

async function askVault(question) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { configured: false };
  const q = String(question || '').trim().slice(0, 500);
  if (!q) return { configured: true, error: 'Ask a question about federal acquisition.' };

  const sources = retrieve(q);
  if (!sources.length) {
    logRetrievalMiss(q);
    return { configured: true, answer: null, sources: [],
      refusal: 'Nothing on the site matches that question. Ask the Vault answers only from AcqVault’s own text — the RFO, R-DFARS, the other indexed sources, and the Field Guides. Try rephrasing with acquisition terms, or run an authoritative search.' };
  }

  const excerpts = sources.map((s, i) => `[${i + 1}] CITE: ${s.cite}\nTITLE: ${s.title}\n${s.text}`).join('\n\n---\n\n');
  const system = [
    'You are "Ask the Vault", the research assistant for AcqVault, a federal-acquisition reference site.',
    'HARD RULES:',
    '- Answer ONLY from the numbered excerpts provided. Never use outside knowledge, even when you are confident.',
    '- Every factual claim must carry the citation of the excerpt it came from, in square brackets exactly as given after CITE:, e.g. [RFO 13.201].',
    '- Dollar figures, thresholds, and section numbers must appear verbatim in an excerpt to be stated at all. Never estimate or recall them.',
    '- If the excerpts do not contain the answer, reply with ONE short sentence saying the vault text retrieved for this question does not cover it, and suggest rephrasing with acquisition terms or running an authoritative search. Never list, count, describe, or refer to the excerpts by number.',
    '- Only answer questions about federal acquisition, contracting, or this site’s content. Politely decline anything else.',
    '- You are a research aid, not legal advice. Do not add a disclaimer; the interface displays one.',
    '- Be direct and concise: at most ~200 words, plain language a contracting professional would use.'
  ].join('\n');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        temperature: 0.2,
        max_tokens: 700,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Question: ${q}\n\nExcerpts from AcqVault:\n\n${excerpts}` }
        ]
      }),
      signal: ctrl.signal
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      console.error('ask upstream error:', resp.status, detail.slice(0, 300));
      // 429 = the free tier's per-minute or per-day cap — say so honestly
      // instead of a generic "error" (the authoritative search never caps).
      if (resp.status === 429) return { configured: true, error: 'The free AI lane is at capacity right now — the model host caps how much it serves per day. Try again later, or use the authoritative search, which is never limited.' };
      return { configured: true, error: 'The model host returned an error. Try again shortly, or use an authoritative search.' };
    }
    const data = await resp.json();
    const answer = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!answer) return { configured: true, error: 'The model returned no answer. Try again, or use an authoritative search.' };
    const seen = new Set();
    return {
      configured: true,
      answer: String(answer).trim(),
      sources: sources
        .map((s, i) => ({ n: i + 1, cite: s.cite, title: s.title, url: s.url, kind: s.kind }))
        .filter(s => { const key = s.cite + '|' + s.url; if (seen.has(key)) return false; seen.add(key); return true; })
    };
  } catch (e) {
    console.error('ask error:', e && e.message ? e.message : e);
    return { configured: true, error: 'The AI request timed out or failed. Try again, or use an authoritative search.' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (await enforce(req, res, { max: 40 })) return;

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

    if (action === 'ask') {
      // Model tokens cost real money on a free, no-login site — a much tighter
      // per-IP budget than plain search (its own bucket, so search stays unaffected).
      if (await enforce(req, res, { max: 6, name: 'ask' })) return;
      const result = await askVault(body && body.q);
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'Unsupported search action.' });
  } catch (error) {
    console.error('search error:', error && error.message ? error.message : error);
    return res.status(500).json({ error: 'Search request failed.' });
  }
};
