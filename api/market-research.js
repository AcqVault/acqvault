const { enforce } = require('./_ratelimit');

const NOTICE_TYPE_LABELS = {
  p: 'Pre-solicitation',
  r: 'Sources sought',
  o: 'Solicitation',
  k: 'Combined synopsis/solicitation',
  a: 'Award notice',
  s: 'Special notice',
  u: 'Justification',
  i: 'Intent to bundle',
  g: 'Sale of surplus'
};

// SAM.gov quota is billed per REQUEST, not per page size, so pulling a generous
// page per (notice-type × date-range) bucket costs no extra quota while letting
// us rank/slice the full set locally instead of truncating each bucket to a few
// most-recent records before scoring.
const FETCH_PAGE = 100;

function mmddyyyy(date) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function normalizeInput(value) {
  return String(value || '').trim();
}

function buildDateRanges(days) {
  const end = new Date();
  const totalDays = Math.min(Math.max(Number(days) || 365, 1), 1095);
  const ranges = [];
  let remaining = totalDays;
  let cursorEnd = new Date(end);
  while (remaining > 0) {
    const span = Math.min(remaining, 364);
    const cursorStart = new Date(cursorEnd);
    cursorStart.setDate(cursorEnd.getDate() - span);
    ranges.push({ postedFrom: mmddyyyy(cursorStart), postedTo: mmddyyyy(cursorEnd) });
    cursorEnd = new Date(cursorStart);
    cursorEnd.setDate(cursorEnd.getDate() - 1);
    remaining -= span;
  }
  return ranges;
}

function queryTerms(query) {
  return String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map(term => term.replace(/[^a-z0-9-]/g, ''))
    .filter(term => term.length > 2);
}

function opportunityHaystack(item) {
  return [
    item.title,
    item.solicitationNumber,
    item.organization,
    item.naicsCode,
    item.classificationCode,
    item.setAside,
    item.type
  ].filter(Boolean).join(' ').toLowerCase();
}

function hasWord(text, term) {
  return new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(String(text || ''));
}

function scoreOpportunity(item, terms) {
  if (!terms.length) return 1;
  const title = String(item.title || '').toLowerCase();
  const haystack = opportunityHaystack(item);
  return terms.reduce((score, term) => {
    if (hasWord(title, term)) return score + 3;
    if (hasWord(haystack, term)) return score + 1;
    return score;
  }, 0);
}

function matchesAllTerms(item, terms) {
  if (!terms.length) return true;
  const haystack = opportunityHaystack(item);
  return terms.every(term => hasWord(haystack, term));
}

function compactOpportunity(item) {
  const org = item.fullParentPathName || [item.department, item.subTier, item.office].filter(Boolean).join(' · ');
  const award = item.award || item.data?.award || null;
  return {
    id: item.noticeId || item.solicitationNumber || item.title,
    title: item.title || 'Untitled opportunity',
    solicitationNumber: item.solicitationNumber || '',
    type: item.type || NOTICE_TYPE_LABELS[item.baseType] || 'Opportunity',
    postedDate: item.postedDate || '',
    responseDeadline: item.responseDeadLine || item.responseDeadline || '',
    organization: org || '',
    naicsCode: item.naicsCode || '',
    classificationCode: item.classificationCode || '',
    setAside: item.typeOfSetAsideDescription || item.setAside || '',
    active: item.active || '',
    awardAmount: award?.amount || '',
    awardee: award?.awardee?.name || award?.awardee || '',
    attachments: Array.isArray(item.resourceLinks) ? item.resourceLinks.length : 0,
    additionalInfoLink: item.additionalInfoLink && item.additionalInfoLink !== 'null' ? item.additionalInfoLink : '',
    uiLink: item.uiLink && item.uiLink !== 'null'
      ? item.uiLink
      : (item.noticeId ? `https://sam.gov/opp/${encodeURIComponent(item.noticeId)}/view` : 'https://sam.gov/search/?index=opp')
  };
}

async function fetchSam(params, apiKey) {
  const url = new URL('https://api.sam.gov/opportunities/v2/search');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('limit', String(params.limit || 12));
  url.searchParams.set('offset', '0');
  url.searchParams.set('postedFrom', params.postedFrom);
  url.searchParams.set('postedTo', params.postedTo);
  if (params.query) url.searchParams.set('title', params.query);
  if (params.agency) url.searchParams.set('organizationName', params.agency);
  if (params.naics) url.searchParams.set('ncode', params.naics);
  if (params.psc) url.searchParams.set('ccode', params.psc);
  if (params.setAside) url.searchParams.set('typeOfSetAside', params.setAside);
  if (params.ptype) url.searchParams.set('ptype', params.ptype);

  const upstream = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  const data = await upstream.json().catch(async () => ({ error: await upstream.text() }));
  if (!upstream.ok) {
    const error = new Error(data?.error || data?.message || `SAM.gov returned HTTP ${upstream.status}`);
    error.status = upstream.status;
    throw error;
  }
  return data;
}

async function fetchSamSafe(params, apiKey) {
  try {
    return await fetchSam(params, apiKey);
  } catch (error) {
    if (error.status === 400) return { totalRecords: 0, opportunitiesData: [] };
    throw error;
  }
}

module.exports = async function handler(req, res) {
  // Rule-of-Two lookups ride GET so Vercel's edge cache actually holds them
  // (s-maxage on POST responses is ignored by the CDN — every POST would burn
  // SAM entity quota). GET /api/market-research?mode=sources&naics=XXXXXX
  if (req.method === 'GET' && req.query && req.query.mode === 'sources') {
    if (await enforce(req, res, { max: 20 })) return;
    return sourcesMode({ body: { naics: req.query.naics } }, res, process.env.SAM_API_KEY);
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (await enforce(req, res, { max: 20 })) return;

  const apiKey = process.env.SAM_API_KEY;
  if ((req.body || {}).mode === 'sources') return sourcesMode(req, res, apiKey);
  if (!apiKey) {
    return res.status(200).json({
      configured: false,
      totalRecords: 0,
      opportunities: [],
      message: 'Set SAM_API_KEY in Vercel to enable in-site SAM.gov opportunity results.'
    });
  }

  try {
    const body = req.body || {};
    const ranges = buildDateRanges(body.windowDays);
    // 'all' returns every matched record — the pool is naturally bounded by
    // FETCH_PAGE per bucket, so this is the same data we already ranked; the
    // old hard cap of 48 made "100 matching · showing 48" a dead end.
    const wantAll = String(body.limit || '').toLowerCase() === 'all';
    const limit = wantAll ? Number.MAX_SAFE_INTEGER : Math.min(Math.max(Number(body.limit) || 12, 1), 500);
    const noticeTypes = Array.isArray(body.noticeTypes) ? body.noticeTypes.filter(Boolean) : [];
    const base = {
      query: normalizeInput(body.query),
      agency: normalizeInput(body.agency),
      naics: normalizeInput(body.naics),
      psc: normalizeInput(body.psc).toUpperCase(),
      setAside: normalizeInput(body.setAside),
      limit
    };

    const types = noticeTypes.length && !noticeTypes.includes('all') ? noticeTypes : [''];
    const makeRequests = (query, limitOverride = FETCH_PAGE) => {
      const requests = [];
      for (const range of ranges) {
        for (const ptype of types) requests.push(fetchSamSafe({ ...base, ...range, query, ptype, limit: limitOverride }, apiKey));
      }
      return requests;
    };
    const mergeResponses = (responses) => {
      const terms = queryTerms(base.query);
      const seen = new Set();
      return responses
        .flatMap(data => data.opportunitiesData || [])
        .map(compactOpportunity)
        .map(item => ({ ...item, _score: scoreOpportunity(item, terms) }))
        .filter(item => {
          const key = item.id || `${item.title}-${item.postedDate}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => b._score - a._score || String(b.postedDate || '').localeCompare(String(a.postedDate || '')));
    };

    let responses = await Promise.all(makeRequests(base.query));
    let matched = mergeResponses(responses);
    if (queryTerms(base.query).length) matched = matched.filter(item => matchesAllTerms(item, queryTerms(base.query)));
    if (!matched.length && queryTerms(base.query).length > 1) {
      // Bounded per-term fallback: at most 3 terms against the most-recent range
      // only, to cap upstream SAM.gov request amplification (quota protection).
      const terms = queryTerms(base.query).slice(0, 3);
      const recentRange = ranges.slice(0, 1);
      const fbRequests = terms.flatMap(term =>
        recentRange.flatMap(range => types.map(ptype =>
          fetchSamSafe({ ...base, ...range, query: term, ptype, limit: FETCH_PAGE }, apiKey))));
      responses = await Promise.all(fbRequests);
      matched = mergeResponses(responses).filter(item => matchesAllTerms(item, terms));
    }
    // `matched` = distinct opportunities actually retrieved and matched (not a
    // naive sum of per-bucket SAM totals, which over-counts in the overlapping
    // per-term fallback). A bucket is "capped" when SAM reports more matches than
    // the page we pulled, meaning additional records exist beyond what we ranked.
    const capped = responses.some(data => (Number(data.totalRecords) || 0) > (data.opportunitiesData?.length || 0));
    const opportunities = matched.slice(0, limit).map(({ _score, ...item }) => item);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
    return res.status(200).json({
      configured: true,
      totalRecords: matched.length,
      capped,
      opportunities,
      query: base.query,
      postedFrom: ranges[ranges.length - 1]?.postedFrom,
      postedTo: ranges[0]?.postedTo
    });
  } catch (error) {
    console.error('market-research error:', error && error.message ? error.message : error);
    return res.status(error.status || 500).json({ error: 'Market research request failed.' });
  }
};


// ═══ SOURCES MODE — Rule-of-Two capable-sources signal (RFO Part 19) ═══════════
// Counts ACTIVE SAM registrants for a NAICS via the Entity Management API using
// count-only queries (size=1, read totalRecords). naicsLimitedSB filters entities
// that certified SMALL under that NAICS — the Rule-of-Two headline number.
// Cert buckets use enum-validated codes: a wrong code errors (caught → bucket
// omitted), it can never return a plausible-but-wrong count. Registration is a
// capability SIGNAL, not proof — the panel says so.
//
// Key-tier caution: a personal SAM key with no role is limited to 10 entity
// requests/day (a role raises it to 1,000). Each lookup = up to 6 requests,
// cached hard at the edge for 7 days per NAICS, and every failure degrades to
// an honest "try DSBS directly" message.
const ENTITY_URL = 'https://api.sam.gov/entity-information/v3/entities';
const CERT_BUCKETS = [
  ['eightA', '8(a)', { sbaBusinessTypeCode: 'A6' }],
  ['hubzone', 'HUBZone', { sbaBusinessTypeCode: 'XX' }],
  ['sdvosb', 'SDVOSB', { businessTypeCode: 'QF' }],
  ['wosb', 'WOSB', { businessTypeCode: '8W' }]
];

async function entityCount(apiKey, params) {
  const qs = new URLSearchParams({ api_key: apiKey, registrationStatus: 'A', size: '1', ...params });
  const r = await fetch(`${ENTITY_URL}?${qs}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) {
    const err = new Error(`entity API HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  const data = await r.json();
  const n = Number(data.totalRecords);
  return Number.isFinite(n) ? n : null;
}

async function sourcesMode(req, res, apiKey) {
  const naics = String((req.body || {}).naics || '').replace(/[^0-9]/g, '').slice(0, 6);
  if (naics.length !== 6) {
    return res.status(200).json({ note: 'Provide a 6-digit NAICS for a capable-sources count.' });
  }
  if (!apiKey) {
    return res.status(200).json({ configured: false, note: 'SAM_API_KEY not configured.' });
  }
  try {
    // Apples-to-apples: naicsLimitedSB counts entities small under the NAICS in ANY
    // position, so the companion total must be all registrants LISTING the NAICS
    // (naicsCode), not primary-NAICS-only — validated live 2026-07-11 (primary-only
    // came back SMALLER than the small count, which read as nonsense).
    const [total, small] = await Promise.all([
      entityCount(apiKey, { naicsCode: naics }),
      entityCount(apiKey, { naicsLimitedSB: naics })
    ]);
    // Cert buckets are best-effort: run in parallel, drop failures individually.
    const certs = (await Promise.all(CERT_BUCKETS.map(async ([key, label, extra]) => {
      try {
        const n = await entityCount(apiKey, { naicsLimitedSB: naics, ...extra });
        return n == null ? null : { key, label, count: n };
      } catch (e) { return null; }
    }))).filter(Boolean);
    // Rule-of-Two data changes slowly → cache a week at the edge, per NAICS.
    res.setHeader('Cache-Control', 's-maxage=604800, stale-while-revalidate=1209600');
    return res.status(200).json({
      naics,
      totalRegistrants: total,
      smallUnderNaics: small,
      certs,
      note: 'Active SAM.gov registrants with this primary NAICS; "small" = entities certifying small under this NAICS in SAM. Registration signals — not proof of — capability: confirm through sources sought, DSBS, and market outreach before the RFO Part 19 determination.'
    });
  } catch (error) {
    const status = error && error.status;
    console.error('sources error:', error && error.message ? error.message : error);
    // 429 = the key's daily entity quota is spent — degrade honestly, cache the
    // failure only briefly so the panel recovers when the quota resets.
    res.setHeader('Cache-Control', 's-maxage=3600');
    return res.status(200).json({
      naics,
      limited: true,
      note: status === 429
        ? 'The capable-sources lookup hit its daily SAM.gov quota — try again later, or search DSBS directly.'
        : 'Capable-sources lookup unavailable right now — search DSBS directly.'
    });
  }
}
