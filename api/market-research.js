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
    const span = Math.min(remaining, 365);
    const cursorStart = new Date(cursorEnd);
    cursorStart.setDate(cursorEnd.getDate() - span);
    ranges.push({ postedFrom: mmddyyyy(cursorStart), postedTo: mmddyyyy(cursorEnd) });
    cursorEnd = new Date(cursorStart);
    cursorEnd.setDate(cursorEnd.getDate() - 1);
    remaining -= span;
  }
  return ranges;
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.SAM_API_KEY;
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
    const limit = Math.min(Math.max(Number(body.limit) || 12, 1), 48);
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
    const requestCount = Math.max(1, types.length * ranges.length);
    const perRequestLimit = requestCount > 1 ? Math.ceil(limit / requestCount) : limit;
    const requests = [];
    for (const range of ranges) {
      for (const ptype of types) requests.push(fetchSam({ ...base, ...range, ptype, limit: perRequestLimit }, apiKey));
    }
    const responses = await Promise.all(requests);
    const seen = new Set();
    const opportunities = responses
      .flatMap(data => data.opportunitiesData || [])
      .map(compactOpportunity)
      .filter(item => {
        const key = item.id || `${item.title}-${item.postedDate}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
    return res.status(200).json({
      configured: true,
      totalRecords: responses.reduce((sum, data) => sum + (Number(data.totalRecords) || 0), 0),
      opportunities,
      query: base.query,
      postedFrom: ranges[ranges.length - 1]?.postedFrom,
      postedTo: ranges[0]?.postedTo
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: 'Market research request failed.',
      detail: error && error.message ? error.message : String(error)
    });
  }
};
