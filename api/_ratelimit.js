// Rate limiter for the keyed /api/* proxies.
// Underscore prefix => not routed as its own endpoint (same convention as _seo.js).
//
// Uses Upstash Redis (REST) when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
// are set — a shared store, so limits are enforced ACROSS Vercel's ephemeral
// serverless instances (real protection, incl. the SAM.gov key quota).
// If those env vars are absent it falls back to a best-effort in-memory,
// per-instance limiter (weak on Vercel — basically a no-op against distributed
// abuse — but keeps the API working before Upstash is configured).
// No dependency: talks to Upstash's REST API with fetch.

const WINDOW_MS = 60_000;

function clientIp(req) {
  const h = req.headers || {};
  // Production sits behind Cloudflare, so from Vercel's viewpoint the "client"
  // is a ROTATING Cloudflare colo — x-forwarded-for/x-real-ip change request to
  // request and per-IP buckets never accumulate (verified live 2026-07-16).
  // cf-connecting-ip carries the real visitor and is set by Cloudflare itself.
  const cf = h['cf-connecting-ip'];
  if (cf) return String(cf).trim();
  const xff = h['x-forwarded-for'] || h['x-real-ip'] || '';
  const first = String(xff).split(',')[0].trim();
  return first || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// ── In-memory fallback (per-instance; weak on Vercel) ─────────────────────────
const hits = new Map();
function inMemoryLimit(req, max, windowMs, name) {
  const ip = (name ? name + ':' : '') + clientIp(req);
  const now = Date.now();
  let arr = hits.get(ip);
  if (!arr) { arr = []; hits.set(ip, arr); }
  while (arr.length && arr[0] <= now - windowMs) arr.shift();
  if (arr.length >= max) {
    return { limited: true, retryAfter: Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000)) };
  }
  arr.push(now);
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      while (v.length && v[0] <= now - windowMs) v.shift();
      if (!v.length) hits.delete(k);
    }
  }
  return { limited: false };
}

// ── Upstash Redis (shared; enforced across instances) ─────────────────────────
// Accept the Upstash-branded vars or Vercel's KV-branded ones (same store, either name).
const U_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const U_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const useRedis = !!(U_URL && U_TOKEN);

// Fixed-window counter: key = rl:<ip>:<windowBucket>; INCR + EXPIRE in one pipeline.
// Fails OPEN on any error/timeout so a Redis blip never takes the API down.
async function redisLimit(req, max, windowMs, name) {
  const ip = (name ? name + ':' : '') + clientIp(req);
  const windowSec = Math.ceil(windowMs / 1000);
  const bucket = Math.floor(Date.now() / windowMs);
  const key = `rl:${ip}:${bucket}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 800);
  try {
    const res = await fetch(`${U_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${U_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCR', key], ['EXPIRE', key, String(windowSec)]]),
      signal: ctrl.signal
    });
    if (!res.ok) return { limited: false, diag: 'http' + res.status };
    const data = await res.json();
    const count = Array.isArray(data) ? Number(data[0] && data[0].result) : NaN;
    if (!Number.isFinite(count)) return { limited: false, diag: 'nan:' + JSON.stringify(data).slice(0, 60) };
    if (count > max) {
      const retryAfter = Math.ceil((windowMs - (Date.now() % windowMs)) / 1000);
      return { limited: true, retryAfter: Math.max(1, retryAfter) };
    }
    return { limited: false, diag: 'ok:' + count };
  } catch (_e) {
    return { limited: false, diag: 'err:' + String(_e && _e.message).slice(0, 40) }; // fail open
  } finally {
    clearTimeout(timer);
  }
}

// Enforce and, if over the limit, write the 429. Returns true if it blocked.
async function enforce(req, res, { max = 30, windowMs = WINDOW_MS, name = '' } = {}) {
  const r = useRedis ? await redisLimit(req, max, windowMs, name) : inMemoryLimit(req, max, windowMs, name);
  try { res.setHeader('x-acq-rl-' + (name || 'g'), (useRedis ? 'redis' : 'mem') + '|' + (r.diag || 'na') + '|lim:' + r.limited); } catch (_h) {}
  if (r.limited) {
    res.setHeader('Retry-After', String(r.retryAfter));
    res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' });
    return true;
  }
  return false;
}

module.exports = { enforce, clientIp, usingRedis: () => useRedis };
