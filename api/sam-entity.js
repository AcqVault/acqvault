// SAM.gov Entity + Exclusions "quick picture" proxy — registration status,
// business size/socioeconomic types, and active exclusion/debarment for a
// vendor (by UEI or legal name). Server-side because CAC blocks 3rd-party
// client calls. NOTE: SAM's Entity Management API is role-gated — the shared
// opportunities key may NOT be authorized (returns 401/403); the handler
// surfaces that distinctly so the UI can hide the feature cleanly.
const { enforce } = require('./_ratelimit');

const looksLikeUei = (s) => /^[A-Z0-9]{12}$/i.test(s);

function compactEntity(e) {
  const reg = e.entityRegistration || {};
  const core = e.coreData || {};
  const bt = (core.businessTypes && core.businessTypes.businessTypeList) || [];
  return {
    name: reg.legalBusinessName || '',
    uei: reg.ueiSAM || '',
    cage: reg.cageCode || '',
    status: reg.registrationStatus || '',
    expires: reg.registrationExpirationDate || '',
    purpose: reg.purposeOfRegistrationDesc || '',
    businessTypes: bt.map(b => b.businessTypeDesc || b.businessTypeCode).filter(Boolean)
  };
}

async function samGet(version, path, params, apiKey) {
  const url = new URL(`https://api.sam.gov/entity-information/${version}/${path}`);
  url.searchParams.set('api_key', apiKey);
  Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.set(k, v); });
  const upstream = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  const text = await upstream.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = { _raw: text.slice(0, 200) }; }
  return { ok: upstream.ok, status: upstream.status, data };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (await enforce(req, res, { max: 20 })) return;

  const apiKey = process.env.SAM_API_KEY;
  if (!apiKey) return res.status(200).json({ configured: false, message: 'SAM_API_KEY not set.' });

  const q = String((req.body && req.body.q) || '').trim();
  if (!q) return res.status(200).json({ configured: true, entity: null, note: 'Provide a vendor name or UEI.' });

  try {
    const entParams = looksLikeUei(q)
      ? { ueiSAM: q.toUpperCase(), includeSections: 'entityRegistration,coreData' }
      : { legalBusinessName: q, includeSections: 'entityRegistration,coreData', registrationStatus: 'A' };
    const ent = await samGet('v3', 'entities', entParams, apiKey);

    // Role-gated key → not authorized for the Entity API. Surface distinctly.
    if (ent.status === 401 || ent.status === 403) {
      return res.status(200).json({
        configured: true,
        authorized: false,
        message: 'This SAM.gov API key is not authorized for the Entity Management API. Enabling it requires a SAM.gov account role + a separate key request.',
        upstreamStatus: ent.status
      });
    }
    if (!ent.ok) {
      const e = new Error(ent.data?.error?.message || ent.data?.message || `SAM entities HTTP ${ent.status}`);
      e.status = ent.status;
      throw e;
    }

    const list = ent.data.entityData || ent.data.entities || [];
    const entity = list.length ? compactEntity(list[0]) : null;

    // Exclusions (debarment) — by UEI when we have one, else by name.
    let exclusions = { checked: false, count: 0, excluded: false };
    const uei = entity?.uei || (looksLikeUei(q) ? q.toUpperCase() : '');
    const exParams = uei ? { ueiSAM: uei } : { exclusionName: q };
    // Exclusions live at a different API version than entities; try v4 then v3.
    let ex = await samGet('v4', 'exclusions', exParams, apiKey);
    if (ex.status === 404) ex = await samGet('v3', 'exclusions', exParams, apiKey);
    if (ex.ok) {
      const count = Number(ex.data.totalRecords) || (Array.isArray(ex.data.excludedEntityData) ? ex.data.excludedEntityData.length : 0);
      exclusions = { checked: true, count, excluded: count > 0 };
    } else {
      exclusions = { checked: false, count: 0, excluded: false, debugStatus: ex.status, debugMsg: (ex.data && (ex.data.error?.message || ex.data.message || ex.data._raw)) || '' };
    }

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      configured: true,
      authorized: true,
      query: q,
      entity,
      exclusions,
      note: entity ? '' : 'No active SAM registration matched. Try the exact legal name or the UEI.'
    });
  } catch (error) {
    console.error('sam-entity error:', error && error.message ? error.message : error);
    return res.status(error.status || 500).json({ error: 'SAM entity request failed.' });
  }
};
