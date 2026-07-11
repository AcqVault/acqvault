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

// Market-wide incumbent leaderboard (top recipients by total obligation across
// the whole market, not just the awards pulled). Best-effort — the award list is
// the primary result, so a leaderboard failure must not fail the request.
async function fetchLeaderboardSafe(filters) {
  try {
    const upstream = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_category/recipient/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ filters, limit: 6 })
    });
    if (!upstream.ok) return null;
    const data = await upstream.json().catch(() => null);
    if (!data || !Array.isArray(data.results)) return null;
    return data.results.map(r => ({ name: r.name || '—', total: Number(r.amount) || 0 })).filter(r => r.total > 0);
  } catch (e) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (await enforce(req, res, { max: 20 })) return;

  const body0 = req.body || {};
  if (body0.mode === 'vehicles') return vehiclesMode(res, body0); // folded in — Hobby plan caps at 12 functions

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

    const [data, leaderboard] = await Promise.all([
      fetchUsa({ filters, fields: FIELDS, sort: 'Award Amount', order: 'desc', limit: 25 }),
      fetchLeaderboardSafe(filters)
    ]);
    const results = (data.results || []).map(compactAward);

    // Prefer the market-wide leaderboard; fall back to a rollup across the pulled
    // awards if the category endpoint is unavailable.
    let recipients, recipientsScope;
    if (leaderboard && leaderboard.length) {
      recipients = leaderboard;
      recipientsScope = 'market';
    } else {
      const rollup = new Map();
      results.forEach(a => {
        const key = a.recipient || '—';
        const cur = rollup.get(key) || { name: key, total: 0, count: 0 };
        cur.total += Number(a.amount) || 0;
        cur.count += 1;
        rollup.set(key, cur);
      });
      recipients = [...rollup.values()].sort((a, b) => b.total - a.total).slice(0, 6);
      recipientsScope = 'sample';
    }

    // Data is stable historical record → cache hard at the edge.
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({
      awards: results.slice(0, 12),
      recipients,
      recipientsScope,
      pulled: results.length,
      naics,
      psc,
      years,
      note: results.length
        ? `Top recipients by total obligation${recipientsScope === 'market' ? ' across this market' : ' across the awards pulled'} and the largest recent contract awards, last ${years} FY.`
        : 'No contract awards found for these codes in the window.'
    });
  } catch (error) {
    console.error('usaspending error:', error && error.message ? error.message : error);
    return res.status(error.status || 500).json({ error: 'USASpending request failed.' });
  }
};


// ═══ VEHICLES MODE (was api/vehicles.js — merged to stay within the 12-function limit) ═══
// Contract-vehicle discovery — find EXISTING vehicles (GWACs, IDIQs, FSS, BPAs,
// BOAs) where money is actually flowing for a NAICS/PSC market, via USASpending
// (keyless; proxied because CORS + CAC networks block third-party client calls).
//
// Strategy (validated 2026-07-11 against the live API):
//  A. Search recent CHILD ORDERS (types A = BPA call, C = delivery/task order) by
//     NAICS/PSC and group them by parent vehicle. Parent-IDV NAICS search alone
//     systematically misses the big multi-agency vehicles — an IDV record carries
//     ONE principal NAICS (SEWP V is 541519, so a 541512 search never finds it,
//     despite daily 541512 ordering). The parent id is embedded in each order's
//     generated_internal_id: CONT_AWD_{orderPIID}_{agy}_{parentPIID}_{parentAgy}.
//     (The "Parent Award ID" field validates but returns null — do not use it.)
//  B. Union with a direct parent-IDV search (all 8 IDV type codes) to catch niche
//     single-award IDIQs whose principal NAICS matches but that had few orders.
//  C. Enrich the merged top vehicles: funding_rollup (distinct awarding-agency
//     count = "multi-agency in practice"), award detail (ceiling, type label,
//     ordering-end date).

const USA = 'https://api.usaspending.gov/api/v2';
const IDV_CODES = ['IDV_A', 'IDV_B', 'IDV_B_A', 'IDV_B_B', 'IDV_B_C', 'IDV_C', 'IDV_D', 'IDV_E'];
const ORDER_CODES = ['A', 'C']; // BPA calls + delivery/task orders

function vToArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  if (v == null || v === '') return [];
  return [String(v)];
}
function vIsoDaysAgo(days) { return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); }
function vToday() { return new Date().toISOString().slice(0, 10); }

async function post(path, payload) {
  const r = await fetch(`${USA}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw Object.assign(new Error(`USASpending ${path} HTTP ${r.status}`), { status: r.status });
  return r.json();
}
async function get(path) {
  const r = await fetch(`${USA}${path}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) return null; // enrichment is best-effort
  return r.json().catch(() => null);
}

// CONT_AWD_{orderPIID}_{agy}_{parentPIID}_{parentAgy} → CONT_IDV_{parentPIID}_{parentAgy}
function parentIdFromOrder(genId) {
  const m = String(genId || '').match(/^CONT_AWD_[^_]*_[^_]*_(.+)_([^_]+)$/);
  if (!m || m[1] === '-NONE-' || m[2] === '-NONE-') return null;
  return `CONT_IDV_${m[1]}_${m[2]}`;
}

async function vehiclesMode(res, body) {
  try {
    const naics = vToArray(body.naics).map(s => s.replace(/[^0-9]/g, '')).filter(Boolean).slice(0, 6);
    const psc = vToArray(body.psc).map(s => s.toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean).slice(0, 6);
    if (!naics.length && !psc.length) {
      return res.status(200).json({ vehicles: [], note: 'Provide a NAICS or PSC to discover vehicles.' });
    }
    const filters = { time_period: [{ start_date: vIsoDaysAgo(2 * 365), end_date: vToday() }] };
    if (naics.length) filters.naics_codes = naics;
    if (psc.length) filters.psc_codes = psc;

    // A) recent orders, obligation-sorted, up to 3 pages — the ranking signal
    const orderFields = ['Award ID', 'Awarding Agency', 'Award Amount', 'generated_internal_id'];
    const orderPages = [];
    for (let page = 1; page <= 3; page++) {
      const data = await post('/search/spending_by_award/', {
        filters: { ...filters, award_type_codes: ORDER_CODES },
        fields: orderFields, sort: 'Award Amount', order: 'desc', limit: 100, page
      });
      const rows = data.results || [];
      orderPages.push(...rows);
      if (rows.length < 100) break;
    }
    const byParent = new Map(); // parentId → {orders, obligated, agencies:Set}
    orderPages.forEach(o => {
      const pid = parentIdFromOrder(o.generated_internal_id);
      if (!pid) return;
      const cur = byParent.get(pid) || { orders: 0, obligated: 0, agencies: new Set() };
      cur.orders += 1;
      cur.obligated += Number(o['Award Amount']) || 0;
      if (o['Awarding Agency']) cur.agencies.add(o['Awarding Agency']);
      byParent.set(pid, cur);
    });

    // B) direct parent-IDV hits (adds niche vehicles the order sample missed)
    const idvFields = ['Award ID', 'Recipient Name', 'Description', 'Awarding Agency', 'Award Amount', 'Last Date to Order', 'generated_internal_id'];
    const idvData = await post('/search/spending_by_award/', {
      filters: { ...filters, award_type_codes: IDV_CODES },
      fields: idvFields, sort: 'Award Amount', order: 'desc', limit: 25, page: 1
    });
    const parentMeta = new Map(); // id → {piid, recipient, desc, agency, lastOrder}
    (idvData.results || []).forEach(v => {
      const id = v.generated_internal_id;
      if (!id) return;
      parentMeta.set(id, {
        piid: v['Award ID'] || '', recipient: v['Recipient Name'] || '',
        desc: v['Description'] || '', agency: v['Awarding Agency'] || '',
        lastOrder: v['Last Date to Order'] || null
      });
      if (!byParent.has(id)) byParent.set(id, { orders: 0, obligated: 0, agencies: new Set() });
    });

    // Rank: recent order obligations desc, tiebreak distinct agencies, take top 12
    const ranked = [...byParent.entries()]
      .sort((a, b) => (b[1].obligated - a[1].obligated) || (b[1].agencies.size - a[1].agencies.size))
      .slice(0, 12);

    // C) enrich (parallel, best-effort): award detail (identity, ceiling, type,
    // ordering-end) + funding rollup (distinct awarding agencies in practice)
    const vehicles = await Promise.all(ranked.map(async ([id, agg]) => {
      const meta = parentMeta.get(id) || {};
      const [detail, rollup] = await Promise.all([
        get(`/awards/${encodeURIComponent(id)}/`),
        post('/idvs/funding_rollup/', { award_id: id }).catch(() => null)
      ]);
      let agencyCount = agg.agencies.size;
      if (rollup && Number(rollup.awarding_agency_count) > agencyCount) agencyCount = Number(rollup.awarding_agency_count);
      let piid = meta.piid, recipient = meta.recipient, desc = meta.desc, agency = meta.agency, lastOrder = meta.lastOrder, ceiling = null, typeLabel = '', multiAward = null;
      if (detail) {
        piid = piid || detail.piid || '';
        recipient = recipient || (detail.recipient && detail.recipient.recipient_name) || '';
        desc = desc || detail.description || '';
        agency = agency || (detail.awarding_agency && detail.awarding_agency.toptier_agency && detail.awarding_agency.toptier_agency.name) || '';
        ceiling = detail.base_and_all_options || null;
        const lt = detail.latest_transaction_contract_data || {};
        typeLabel = lt.idv_type_description || '';
        multiAward = lt.multiple_or_single_award_description || null;
        // Ordering window: the search field "Last Date to Order" only rides parent-search
        // rows; on the detail record the IDV's period end is period_of_performance.end_date.
        lastOrder = lastOrder || (detail.period_of_performance && detail.period_of_performance.end_date) || null;
      }
      return {
        id, piid, recipient, agency,
        desc: String(desc || '').slice(0, 180),
        typeLabel, multiAward, ceiling,
        lastOrder,
        recentOrders: agg.orders,
        recentObligated: Math.round(agg.obligated),
        orderingAgencies: agencyCount,
        link: `https://www.usaspending.gov/award/${encodeURIComponent(id)}`
      };
    }));

    // Data is stable day-to-day → cache hard at the edge.
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({
      vehicles: vehicles.filter(v => v.piid || v.recipient || v.desc),
      sampledOrders: orderPages.length,
      naics, psc,
      note: vehicles.length
        ? `Vehicles ranked by order obligations in the last 2 years across ${orderPages.length} sampled orders. Ordering-agency counts show multi-agency use in practice.`
        : 'No vehicles found with recent ordering for these codes.'
    });
  } catch (error) {
    console.error('vehicles error:', error && error.message ? error.message : error);
    return res.status(error.status || 500).json({ error: 'Vehicle discovery failed.' });
  }
};
