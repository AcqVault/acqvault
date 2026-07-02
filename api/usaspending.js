// USASpending.gov proxy — comparable contract awards + incumbent rollup for a
// market (by NAICS / PSC). Keyless upstream, but proxied server-side because CORS
// + CAC networks block third-party client calls. Data is stable → cache hard.
const { enforce } = require('./_ratelimit');

const AWARD_TYPES = ['A', 'B', 'C', 'D']; // definitive contracts + IDVs
const FIELDS = ['Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency', 'Awarding Sub Agency', 'Start Date', 'End Date', 'Contract Award Type', 'generated_internal_id'];

function toArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  if (v == null || v === '') return [];
  return [String(v)];
}
function isoDaysAgo(days) { return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); }
function today() { return new Date().toISOString().slice(0, 10); }

function compactAward(a) {
  const id = a.generated_internal_id || '';
  return {
    id,
    recipient: a['Recipient Name'] || '',
    amount: a['Award Amount'],
    agency: a['Awarding Agency'] || '',
    subAgency: a['Awarding Sub Agency'] || '',
    start: a['Start Date'] || '',
    end: a['End Date'] || '',
    type: a['Contract Award Type'] || '',
    link: id ? `https://www.usaspending.gov/award/${encodeURIComponent(id)}` : 'https://www.usaspending.gov/search'
  };
}

async function fetchUsa(payload) {
  const upstream = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await upstream.json().catch(async () => ({ error: await upstream.text() }));
  if (!upstream.ok) {
    const error = new Error(data?.detail || data?.error || `USASpending returned HTTP ${upstream.status}`);
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
  if (await enforce(req, res, { max: 20 })) return;

  try {
    const body = req.body || {};
    const naics = toArray(body.naics).map(s => s.replace(/[^0-9]/g, '')).filter(Boolean).slice(0, 10);
    const psc = toArray(body.psc).map(s => s.toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean).slice(0, 10);
    if (!naics.length && !psc.length) {
      return res.status(200).json({ awards: [], recipients: [], pulled: 0, note: 'Provide a NAICS or PSC to pull comparable awards.' });
    }
    const years = Math.min(Math.max(Number(body.years) || 3, 1), 5);
    const filters = { award_type_codes: AWARD_TYPES, time_period: [{ start_date: isoDaysAgo(years * 365), end_date: today() }] };
    if (naics.length) filters.naics_codes = naics;
    if (psc.length) filters.psc_codes = psc;

    const data = await fetchUsa({ filters, fields: FIELDS, sort: 'Award Amount', order: 'desc', limit: 25 });
    const results = (data.results || []).map(compactAward);

    // Incumbent rollup across the pulled set (top awards by obligated $).
    const rollup = new Map();
    results.forEach(a => {
      const key = a.recipient || '—';
      const cur = rollup.get(key) || { name: key, total: 0, count: 0 };
      cur.total += Number(a.amount) || 0;
      cur.count += 1;
      rollup.set(key, cur);
    });
    const recipients = [...rollup.values()].sort((a, b) => b.total - a.total).slice(0, 6);

    // Data is stable historical record → cache hard at the edge.
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({
      awards: results.slice(0, 12),
      recipients,
      pulled: results.length,
      naics,
      psc,
      years,
      note: results.length
        ? `Top contract awards by obligated amount over the last ${years} FY. The recipient rollup is across the awards pulled, not the entire market.`
        : 'No contract awards found for these codes in the window.'
    });
  } catch (error) {
    console.error('usaspending error:', error && error.message ? error.message : error);
    return res.status(error.status || 500).json({ error: 'USASpending request failed.' });
  }
};
