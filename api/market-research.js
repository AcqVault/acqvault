const { enforce } = require('./_ratelimit');

// A slow or hung upstream (SAM.gov) would otherwise run until the platform kills the
// function and returns a raw 504; this gives it a real deadline so the handler's own
// graceful JSON error is what the user gets.
async function timedFetch(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 8000);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
  } catch (e) {
    if (e && e.name === 'AbortError') throw Object.assign(new Error('SAM.gov did not respond in time.'), { status: 504 });
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

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

// SAM.gov-supplied URLs are echoed straight into href attributes on the client, so
// reject anything that isn't a real http(s) link (e.g. a javascript:/data: scheme).
function safeHttpUrl(u, fallback) {
  if (typeof u !== 'string' || !u || u === 'null') return fallback;
  try {
    const p = new URL(u);
    return (p.protocol === 'http:' || p.protocol === 'https:') ? u : fallback;
  } catch { return fallback; }
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
    additionalInfoLink: safeHttpUrl(item.additionalInfoLink, ''),
    uiLink: safeHttpUrl(
      item.uiLink,
      item.noticeId ? `https://sam.gov/opp/${encodeURIComponent(item.noticeId)}/view` : 'https://sam.gov/search/?index=opp'
    )
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

  const upstream = await timedFetch(url.toString(), { headers: { Accept: 'application/json' } }, 8000);
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
    if (await enforce(req, res, { max: 20, name: 'mr' })) return;
    return sourcesMode({ body: { naics: req.query.naics } }, res, process.env.SAM_API_KEY);
  }
  // Contract Awards (FPDS) rows for a DoDAAC + FY — GET so the CDN edge-cache holds it
  // and repeated public queries don't each burn the shared SAM key's daily quota.
  if (req.method === 'GET' && req.query && req.query.mode === 'award-rows') {
    if (await enforce(req, res, { max: 20, name: 'mr' })) return;
    return contractAwardsRows(req, res, process.env.SAM_API_KEY);
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (await enforce(req, res, { max: 20, name: 'mr' })) return;

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
    // When the user scopes with a NAICS/PSC code, the CODE is the market-research
    // filter — so we do NOT also pin SAM's title= to the keyword. SAM's keyword only
    // matches the notice TITLE, so "iPad" AND ncode=334111 is a title-AND-code search
    // that buries every award/closed notice whose title doesn't literally say "iPad".
    // Instead we pull the whole code pool and let the keyword RANK it (scoreOpportunity).
    // Keyword-only searches (no code) stay title-scoped — there's nothing to bound a
    // code-less broad pull without amplifying SAM requests past the quota.
    // ONE predicate set drives all of this. It used to be two: `broaden` tested
    // queryTerms() (which drops tokens of 2 chars or fewer) while `titleScoped` tested the
    // raw query, so a 1-2 character keyword plus a code silently fell back to title-only
    // scoping AND told the user to "add a NAICS or PSC code" they had already added.
    // A code always defines the set, so never pin SAM's title= on top of one.
    const hasCode = !!(base.naics || base.psc);
    const hasQuery = !!base.query;
    const terms = queryTerms(base.query);
    // Broaden ONLY when the keyword can actually rank. queryTerms drops tokens of 2 chars
    // or fewer, so "AI"/"IT"/"3D" yield no terms — dropping SAM's title= for those would
    // discard the keyword entirely and collapse the sort to posted-date order while the UI
    // still claimed "keyword-relevant notices ranked first". A short keyword therefore
    // stays on SAM's title filter (alongside the code), and `broadened` stays false so no
    // ranking claim is made. titleScoped stays gated on hasCode so the "add a NAICS or PSC"
    // note can never appear to someone who already supplied one.
    const broaden = hasCode && terms.length > 0;
    const fetchQuery = broaden ? '' : base.query;
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

    let responses = await Promise.all(makeRequests(fetchQuery));
    let matched = mergeResponses(responses);
    // Title mode: hard-filter to keyword matches. Broaden mode: the code defines the
    // set and the keyword only re-orders it, so every in-scope notice stays visible
    // with the keyword-relevant ones on top.
    if (!broaden && terms.length) matched = matched.filter(item => matchesAllTerms(item, terms));
    if (!broaden && !matched.length && terms.length > 1) {
      // Bounded per-term fallback: at most 3 terms against the most-recent range
      // only, to cap upstream SAM.gov request amplification (quota protection).
      const fbTerms = terms.slice(0, 3);
      const recentRange = ranges.slice(0, 1);
      const fbRequests = fbTerms.flatMap(term =>
        recentRange.flatMap(range => types.map(ptype =>
          fetchSamSafe({ ...base, ...range, query: term, ptype, limit: FETCH_PAGE }, apiKey))));
      responses = await Promise.all(fbRequests);
      matched = mergeResponses(responses).filter(item => matchesAllTerms(item, fbTerms));
    }
    // `matched` = distinct opportunities actually retrieved and matched (not a
    // naive sum of per-bucket SAM totals, which over-counts in the overlapping
    // per-term fallback). A bucket is "capped" when SAM reports more matches than
    // the page we pulled, meaning additional records exist beyond what we ranked.
    const capped = responses.some(data => (Number(data.totalRecords) || 0) > (data.opportunitiesData?.length || 0));
    const opportunities = matched.slice(0, limit).map(({ _score, ...item }) => item);
    // In broaden mode the code defines the set and the keyword only re-orders it,
    // so a keyword can rank zero of the pooled notices. Count the ones it actually
    // hit (title or metadata, _score > 0) so the UI can distinguish "N ranked
    // first" from "none matched — showing by date". Costs no extra SAM request:
    // the scores were already computed in mergeResponses.
    const keywordHits = broaden ? matched.reduce((n, it) => n + (it._score > 0 ? 1 : 0), 0) : null;

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
    return res.status(200).json({
      configured: true,
      totalRecords: matched.length,
      capped,
      opportunities,
      query: base.query,
      // titleScoped: the keyword was sent to SAM's title-only filter (keyword, no code).
      // broadened: a NAICS/PSC pulled the full code pool and the keyword only ranked it.
      titleScoped: !hasCode && hasQuery,
      broadened: broaden,
      keywordHits,
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

// ── Contract Awards (FPDS) spend rollup ──────────────────────────────────────
// SAM.gov's Contract Awards API replaced the FPDS ATOM feed when FPDS.gov retired
// (2026-02-24). It is a RECORD search, not an aggregation service, so "spend by
// DoDAAC" means: filter to a contracting office + fiscal year, page the awards, and
// sum their obligations here. The shared key is quota-limited, so this rides GET
// behind a long edge cache (a completed FY's awards are immutable), caps pages per
// request, and degrades honestly on a 429. Exact response field paths are pinned
// after the first live 200 — probe with &debug=1, which echoes one raw record.
const CA_URL = 'https://api.sam.gov/contract-awards/v1/search';
const CA_PAGE = 100;
const CA_MAX_PAGES = 20;  // 2,000 awards fully covers the vast majority of office-years; bounded to protect the shared key's quota

function caNum(x) { const n = Number(String(x == null ? '' : x).replace(/[^0-9.-]/g, '')); return isFinite(n) ? n : 0; }

async function fetchContractAwards(qs, apiKey) {
  const url = new URL(CA_URL);
  url.searchParams.set('api_key', apiKey);
  for (const k in qs) if (qs[k] != null && qs[k] !== '') url.searchParams.set(k, String(qs[k]));
  const upstream = await timedFetch(url.toString(), { headers: { Accept: 'application/json' } }, 9000);
  const text = await upstream.text();
  let data; try { data = JSON.parse(text); } catch (e) { data = { _raw: text.slice(0, 300) }; }
  return { ok: upstream.ok, status: upstream.status, data,
    rate: { limit: upstream.headers.get('x-ratelimit-limit'), remaining: upstream.headers.get('x-ratelimit-remaining') } };
}

// Field paths pinned from a live record (FA8501 FY2025).
function caPath(o, path) {
  var cur = o;
  for (var i = 0; i < path.length; i++) { if (cur == null) return ''; cur = cur[path[i]]; }
  return cur == null ? '' : cur;
}
// FPDS carries no appropriation "color of money" (RDT&E/O&M/Procurement) on a contract
// record; the closest native classification is the PSC bucket — R&D ('A' codes), a
// Service (other letter-led PSC), or a Product/commodity (digit-led PSC). This is the
// Service / Commodity / R&D split.
function caCategory(psc) {
  var c = String(psc || '').trim().toUpperCase();
  if (!c) return '';
  if (c.charAt(0) === 'A') return 'R&D';
  if (/^[0-9]/.test(c)) return 'Product';
  return 'Service';
}
// One flat CSV-ready record. Order here is the column order in the export.
function caRow(a, office, fy) {
  var psc = caPath(a, ['coreData', 'productOrServiceInformation', 'productOrService', 'code']);
  var naics = caPath(a, ['coreData', 'productOrServiceInformation', 'principalNaics', 0]) || {};
  return {
    office: caPath(a, ['coreData', 'federalOrganization', 'contractingInformation', 'contractingOffice', 'code']) || office,
    officeName: caPath(a, ['coreData', 'federalOrganization', 'contractingInformation', 'contractingOffice', 'name']),
    fiscalYear: caPath(a, ['awardDetails', 'dates', 'fiscalYear']) || fy,
    piid: caPath(a, ['contractId', 'piid']),
    mod: caPath(a, ['contractId', 'modificationNumber']),
    awardOrIdv: caPath(a, ['coreData', 'awardOrIDV']),
    awardType: caPath(a, ['coreData', 'awardOrIDVType', 'name']),
    category: caCategory(psc),
    pscCode: psc,
    pscName: caPath(a, ['coreData', 'productOrServiceInformation', 'productOrService', 'name']),
    naicsCode: naics.code || '',
    naicsName: naics.name || '',
    description: String(caPath(a, ['awardDetails', 'productOrServiceInformation', 'descriptionOfContractRequirement']) || '').slice(0, 160),
    vendor: caPath(a, ['awardDetails', 'awardeeData', 'awardeeHeader', 'awardeeName']),
    vendorUEI: caPath(a, ['awardDetails', 'awardeeData', 'awardeeUEIInformation', 'uniqueEntityId']),
    smallBusiness: caPath(a, ['awardDetails', 'awardeeData', 'socioEconomicData', 'smallBusiness']),
    // FPDS keeps three distinct dollar figures per action: what this action obligated,
    // the award's value (base + exercised options), and its ceiling (base + all options).
    obligated: caNum(caPath(a, ['awardDetails', 'dollars', 'actionObligation'])),
    awardAmount: caNum(caPath(a, ['awardDetails', 'dollars', 'baseAndExercisedOptionsValue'])),
    ceiling: caNum(caPath(a, ['awardDetails', 'dollars', 'baseAndAllOptionsValue'])),
    pricingType: caPath(a, ['coreData', 'acquisitionData', 'typeOfContractPricing', 'name']),
    setAside: caPath(a, ['coreData', 'competitionInformation', 'typeOfSetAside', 'name']),
    extentCompeted: caPath(a, ['coreData', 'competitionInformation', 'extentCompeted', 'name']),
    fundingSubtier: caPath(a, ['coreData', 'federalOrganization', 'fundingInformation', 'fundingSubtier', 'name']),
    fundingOffice: caPath(a, ['coreData', 'federalOrganization', 'fundingInformation', 'fundingOffice', 'name']),
    popState: caPath(a, ['coreData', 'principalPlaceOfPerformance', 'state', 'name']),
    dateSigned: String(caPath(a, ['awardDetails', 'dates', 'dateSigned']) || '').slice(0, 10)
  };
}

// One contracting office (DoDAAC) + one fiscal year → the flat award rows, for CSV
// export. Single FY per call so the CDN edge-cache is reused across any multi-year
// combination the client asks for (the client fetches each FY and concatenates).
async function contractAwardsRows(req, res, apiKey) {
  if (!apiKey) return res.status(200).json({ configured: false, note: 'SAM_API_KEY not configured.' });
  const q = req.query || {};
  const office = String(q.office || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const fy = String(q.fy || '').replace(/[^0-9]/g, '').slice(0, 4);
  if (office.length < 4) return res.status(200).json({ note: 'Provide a contracting office code (DoDAAC), e.g. office=FA8501.' });
  if (fy.length !== 4) return res.status(200).json({ note: 'Provide a 4-digit fiscal year, e.g. fy=2025.' });

  try {
    let count = 0, officeName = '', totalRecords = null, rate = null;
    const rows = [];
    for (let page = 0; page < CA_MAX_PAGES; page++) {
      const r = await fetchContractAwards({ contractingOfficeCode: office, fiscalYear: fy, limit: CA_PAGE, offset: page }, apiKey);
      rate = r.rate;
      if (!r.ok) { const e = new Error('Contract Awards HTTP ' + r.status); e.status = r.status; e.body = r.data; throw e; }
      const recs = r.data.awardSummary || r.data.results || r.data.data || [];
      if (totalRecords == null) totalRecords = r.data.totalRecords ?? r.data.totalRecordCount ?? null;
      for (let i = 0; i < recs.length; i++) {
        const row = caRow(recs[i], office, fy);
        if (!officeName && row.officeName) officeName = row.officeName;
        rows.push(row); count++;
      }
      if (recs.length < CA_PAGE) break;
      if (totalRecords != null && (page + 1) * CA_PAGE >= totalRecords) break;
    }
    const truncated = totalRecords != null && count < totalRecords;
    const totalObligated = rows.reduce(function (s, r) { return s + r.obligated; }, 0);
    const now = new Date(); const curFy = now.getUTCFullYear() + (now.getUTCMonth() >= 9 ? 1 : 0);
    res.setHeader('Cache-Control', Number(fy) < curFy
      ? 's-maxage=604800, stale-while-revalidate=1209600'
      : 's-maxage=86400, stale-while-revalidate=172800');
    return res.status(200).json({
      office, officeName, fiscalYear: fy,
      count, totalRecords, truncated,
      totalObligated: Math.round(totalObligated),
      rows,
      source: 'SAM.gov Contract Awards API (FPDS)',
      note: truncated ? ('Returned ' + count + ' of ' + totalRecords + ' awards (page cap).') : undefined
    });
  } catch (error) {
    const status = error && error.status;
    console.error('contract-awards error:', error && error.message, error && error.body ? JSON.stringify(error.body).slice(0, 300) : '');
    res.setHeader('Cache-Control', 's-maxage=600');
    return res.status(200).json({
      office, fiscalYear: fy, limited: true, status: status || null, rows: [],
      note: status === 429 ? 'Hit the daily SAM.gov Contract Awards quota — try again later.'
        : status === 404 ? 'Contract Awards API returned 404 — endpoint or parameters need adjusting.'
          : 'Contract Awards lookup is unavailable right now.'
    });
  }
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
