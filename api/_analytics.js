// AcqVault analytics — self-hosted, cookieless, no third-party anything.
// Underscore prefix => not routed as its own endpoint (same convention as _seo.js
// and _ratelimit.js). Vercel Hobby is at the 12-function cap, so this rides
// api/feedback.js as a mode, exactly like the Combination leaderboard does.
//
// WHY THIS EXISTS: the site shipped for months with NO instrumentation of any
// kind, so "is anyone using it?" was unanswerable. Plausible/GA/Vercel Analytics
// are all third-party script origins — CAC-locked .mil networks block them, and
// the CSP here is script-src 'self'. So the collector is ours, same-origin.
//
// WHAT IS STORED — the complete list:
//   • the path visited (e.g. /rfo/part-19)
//   • the referring HOSTNAME only (never the full referring URL)
//   • device class: mobile | tablet | desktop
//   • an action name: search, ask, open, browse, ...
//   • search query TEXT (see redact() — capped, lowercased, emails/long digit
//     runs stripped) and whether it returned zero results
//   • a per-day HyperLogLog for unique-visitor COUNTING
// WHAT IS NOT STORED: no cookie, no localStorage id, no device fingerprint, no
// IP address, no user agent string, no full URL, no cross-day identity. The
// visitor hash is salted with the UTC day and fed ONLY into a HyperLogLog, which
// is a lossy probabilistic counter — it cannot be enumerated or reversed, and the
// same person on two days is two unrelated hashes by construction.

const crypto = require('crypto');
const { clientIp } = require('./_ratelimit');

const U_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const U_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const configured = () => !!(U_URL && U_TOKEN);

const TTL = String(90 * 86400);   // keep 90 days, then it evaporates on its own
const P = 'av';                   // key prefix
const MAX_Q = 80;                 // query text cap

// Actions a CLIENT may claim. An allow-list, not free text: a public POST endpoint
// must never be able to invent unbounded hash fields. Note 'search0'/'ask0' are
// absent on purpose — those are derived server-side from the result count, so a
// client cannot post them directly and skew the zero-result rate.
const ACTIONS = new Set(['view', 'search', 'ask', 'open', 'browse', 'fulltext']);

function utcDay(t) {
  return new Date(t === undefined ? Date.now() : t).toISOString().slice(0, 10);
}

async function redis(cmds) {
  if (!configured() || !cmds.length) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1200);
  try {
    const r = await fetch(`${U_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${U_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds),
      signal: ctrl.signal
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (_e) { return null; } finally { clearTimeout(timer); }
}

// ── sanitisers ───────────────────────────────────────────────────────────────
function str(v, max) {
  return String(v == null ? '' : v).replace(/[\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Paths are bounded in cardinality (~500 part pages) and knowing WHICH parts get
// read is half the point, so real paths are kept — but only the path, and only if
// it looks like one of ours.
function route(v) {
  let p = str(v, 120);
  if (!p || p[0] !== '/') return '/';
  p = p.split('?')[0].split('#')[0];
  if (!/^[/a-zA-Z0-9._~%-]*$/.test(p)) return '/other';
  return p.length > 1 ? p.replace(/\/+$/, '') || '/' : '/';
}

// Referrer: HOSTNAME ONLY. The full referring URL can carry another site's query
// params (and on a search engine, the searcher's terms) — none of our business.
function refHost(v, host) {
  const s = str(v, 200);
  if (!s) return '(direct)';
  try {
    const h = new URL(s).hostname.replace(/^www\./, '').toLowerCase();
    if (!h) return '(direct)';
    if (host && h === String(host).replace(/^www\./, '').toLowerCase()) return '(internal)';
    return h.slice(0, 60);
  } catch (_e) { return '(direct)'; }
}

function device(v) {
  const d = str(v, 10).toLowerCase();
  return d === 'mobile' || d === 'tablet' ? d : 'desktop';
}

// Search text is the single most valuable signal here (a zero-result query is a
// literal list of what the site failed to answer), but it is also the only field a
// human types freely. Cap it, fold case, and strip the two shapes that could carry
// something personal. Contract/CAGE/section numbers are deliberately KEPT — they
// are the whole point — so only 9+ digit runs go, not short ones.
function redact(v) {
  let q = str(v, MAX_Q * 2).toLowerCase();
  q = q.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]');
  q = q.replace(/\d[\d-]{8,}/g, '[num]');
  return q.slice(0, MAX_Q);
}

// Identity-free unique counting. Salted per UTC day so the same visitor produces
// an unrelated value tomorrow, and only ever PFADD'd — never stored as a value.
function visitorHash(req, day) {
  const salt = process.env.ANALYTICS_SALT || 'acqvault-default-salt';
  return crypto.createHash('sha256').update(`${clientIp(req)}|${day}|${salt}`).digest('hex').slice(0, 32);
}

// ── write ────────────────────────────────────────────────────────────────────
// Fire-and-forget from the caller's point of view: never throws, never blocks a
// user-facing response on Redis, and silently no-ops when Upstash isn't set up.
async function record(req, body) {
  if (!configured()) return { ok: false, configured: false };

  const day = utcDay();
  const host = (req.headers && req.headers.host) || '';
  const act = ACTIONS.has(str(body.a, 12)) ? str(body.a, 12) : 'view';
  const cmds = [];
  const bump = (k, f) => {
    cmds.push(['HINCRBY', `${P}:${day}:${k}`, f, '1']);
    cmds.push(['EXPIRE', `${P}:${day}:${k}`, TTL]);
  };

  bump('act', act);

  if (act === 'view') {
    bump('routes', route(body.p));
    bump('ref', refHost(body.r, host));
    bump('dev', device(body.d));
    cmds.push(['PFADD', `${P}:${day}:uv`, visitorHash(req, day)]);
    cmds.push(['EXPIRE', `${P}:${day}:uv`, TTL]);
  }

  // Queries ride search/ask only. `n` is the result count the client saw; 0 means
  // the site had nothing for them, which gets its own bucket.
  if (act === 'search' || act === 'ask') {
    const q = redact(body.q);
    if (q.length >= 2) {
      bump('q', q);
      if (Number(body.n) === 0) bump('q0', q);
    }
    if (Number(body.n) === 0) bump('act', act + '0');
  }

  await redis(cmds);
  return { ok: true };
}

// ── read ─────────────────────────────────────────────────────────────────────
function topOf(obj, n) {
  return Object.entries(obj || {})
    .map(([k, v]) => [k, Number(v) || 0])
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

async function report(days) {
  const n = Math.min(Math.max(parseInt(days, 10) || 30, 1), 90);
  const dayKeys = [];
  for (let i = 0; i < n; i++) dayKeys.push(utcDay(Date.now() - i * 86400000));

  const kinds = ['act', 'routes', 'ref', 'dev', 'q', 'q0'];
  const cmds = [];
  dayKeys.forEach((d) => kinds.forEach((k) => cmds.push(['HGETALL', `${P}:${d}:${k}`])));
  dayKeys.forEach((d) => cmds.push(['PFCOUNT', `${P}:${d}:uv`]));
  // PFCOUNT over many keys merges them — unique visitors across the whole window,
  // which is NOT the sum of the daily figures (the same person recurs).
  cmds.push(['PFCOUNT'].concat(dayKeys.map((d) => `${P}:${d}:uv`)));

  const out = await redis(cmds);
  if (!out) return null;

  // Upstash returns HGETALL as a flat [field, value, ...] array over the REST API.
  const asObj = (r) => {
    const v = r && r.result;
    if (!v) return {};
    if (Array.isArray(v)) {
      const o = {};
      for (let i = 0; i + 1 < v.length; i += 2) o[v[i]] = v[i + 1];
      return o;
    }
    return v;
  };

  const totals = { act: {}, routes: {}, ref: {}, dev: {}, q: {}, q0: {} };
  const daily = [];
  dayKeys.forEach((d, di) => {
    const row = { day: d, views: 0, searches: 0, uniques: 0 };
    kinds.forEach((k, ki) => {
      const o = asObj(out[di * kinds.length + ki]);
      Object.entries(o).forEach(([f, v]) => {
        totals[k][f] = (totals[k][f] || 0) + (Number(v) || 0);
      });
      if (k === 'act') { row.views = Number(o.view) || 0; row.searches = Number(o.search) || 0; }
    });
    row.uniques = Number(out[dayKeys.length * kinds.length + di]?.result) || 0;
    daily.push(row);
  });

  const uniqueWindow = Number(out[out.length - 1]?.result) || 0;
  const A = totals.act;
  const views = Number(A.view) || 0;
  const searches = Number(A.search) || 0;

  return {
    days: n,
    generated: new Date().toISOString(),
    uniqueVisitors: uniqueWindow,
    views: views,
    searches: searches,
    searchesZero: Number(A.search0) || 0,
    asks: Number(A.ask) || 0,
    opens: Number(A.open) || 0,
    browse: Number(A.browse) || 0,
    // The two numbers that answer "do people bounce?": of the visitors who arrive,
    // how many search at all — and of those who search, how many open a result.
    searchRate: views ? searches / views : 0,
    openRate: searches ? (Number(A.open) || 0) / searches : 0,
    zeroRate: searches ? (Number(A.search0) || 0) / searches : 0,
    daily: daily,
    topRoutes: topOf(totals.routes, 25),
    topReferrers: topOf(totals.ref, 15),
    devices: topOf(totals.dev, 5),
    topQueries: topOf(totals.q, 40),
    zeroQueries: topOf(totals.q0, 40)
  };
}

// ── dashboard ────────────────────────────────────────────────────────────────
// Server-rendered, zero JS (the site CSP is script-src 'self', so an inline
// script would be blocked anyway) and zero third-party anything. Private: it is
// only ever reached with the ANALYTICS_KEY and is sent noindex + no-store.

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pct(x) { return (x * 100).toFixed(1) + '%'; }

function bars(rows, max) {
  if (!rows.length) return '<p class="none">Nothing recorded yet.</p>';
  const top = max || rows[0][1] || 1;
  return '<table>' + rows.map(([k, v]) =>
    `<tr><td class="k">${esc(k)}</td><td class="b"><span style="width:${Math.max(1, (v / top) * 100).toFixed(1)}%"></span></td><td class="v">${v}</td></tr>`
  ).join('') + '</table>';
}

function renderHTML(rep) {
  const maxDay = Math.max(1, ...rep.daily.map((d) => d.views));
  const spark = rep.daily.slice().reverse().map((d) =>
    `<i title="${d.day}: ${d.views} views, ${d.uniques} visitors" style="height:${Math.max(2, (d.views / maxDay) * 100).toFixed(0)}%"></i>`
  ).join('');

  const stat = (label, value, note) =>
    `<div class="stat"><b>${esc(String(value))}</b><span>${esc(label)}</span>${note ? `<em>${esc(note)}</em>` : ''}</div>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>AcqVault analytics — last ${rep.days} days</title>
<style>
:root{--ink:#13151b;--muted:#5c5a55;--line:#e2ded4;--off:#f7f6f2;--accent:#87651c;--navy:#0f2540}
*{box-sizing:border-box}
body{margin:0;padding:28px 20px 60px;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;color:var(--ink);background:#fff}
.wrap{max-width:980px;margin:0 auto}
h1{font-size:20px;margin:0 0 4px;letter-spacing:-.01em}
.sub{color:var(--muted);font-size:13px;margin:0 0 24px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:8px}
.stat{background:var(--off);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.stat b{display:block;font-size:26px;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.stat span{display:block;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-top:2px}
.stat em{display:block;font-size:11px;color:var(--muted);font-style:normal;margin-top:5px;line-height:1.35}
.spark{display:flex;align-items:flex-end;gap:2px;height:64px;margin:22px 0 30px;border-bottom:1px solid var(--line);padding-bottom:2px}
.spark i{flex:1;background:var(--navy);border-radius:2px 2px 0 0;min-height:2px;opacity:.85}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:30px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
table{width:100%;border-collapse:collapse;font-size:13px}
td{padding:4px 6px;vertical-align:middle}
td.k{width:44%;word-break:break-word}
td.b{width:44%}
td.b span{display:block;height:9px;background:var(--accent);border-radius:2px;opacity:.75}
td.v{width:12%;text-align:right;font-variant-numeric:tabular-nums;color:var(--muted)}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:0 34px}
.zero td.b span{background:#a33}
.none{color:var(--muted);font-size:13px;font-style:italic}
.note{background:var(--off);border-left:3px solid var(--accent);padding:10px 14px;font-size:13px;color:var(--muted);border-radius:0 6px 6px 0;margin:8px 0 0}
@media(max-width:720px){.cols{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
<h1>AcqVault analytics</h1>
<p class="sub">Last ${rep.days} days (UTC) · generated ${esc(rep.generated)} · cookieless, no IP stored</p>

<div class="stats">
${stat('Unique visitors', rep.uniqueVisitors, 'across the whole window, not the sum of days')}
${stat('Pageviews', rep.views)}
${stat('Searches', rep.searches)}
${stat('AI asks', rep.asks)}
</div>
<div class="stats">
${stat('Search rate', pct(rep.searchRate), 'visits that ran at least one search')}
${stat('Open rate', pct(rep.openRate), 'searches that led to opening a result')}
${stat('Zero-result rate', pct(rep.zeroRate), 'searches that found nothing')}
${stat('Browse / full-text', rep.browse, 'times the other two lanes were opened')}
</div>

<div class="spark">${spark}</div>

<div class="cols">
<div><h2>Top pages</h2>${bars(rep.topRoutes)}</div>
<div><h2>Referrers</h2>${bars(rep.topReferrers)}
<h2>Devices</h2>${bars(rep.devices)}</div>
</div>

<h2>Top searches</h2>${bars(rep.topQueries)}

<h2>Searches that returned nothing</h2>
<div class="zero">${bars(rep.zeroQueries)}</div>
<p class="note">This is the most actionable list on the page: every line is someone who came to AcqVault with a question and left without an answer. Recurring entries are either missing corpus, or a vocabulary mismatch between what people type and what the scorer indexes.</p>
</div></body></html>`;
}

module.exports = { record, report, configured, utcDay, redact, route, refHost, renderHTML, ACTIONS };
