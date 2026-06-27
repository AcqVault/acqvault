// Lightweight in-memory rate limiter for the keyed /api/* proxies.
// Underscore prefix => not routed as its own endpoint (same convention as _seo.js).
//
// NOTE: Vercel serverless instances are per-instance and ephemeral, so this is a
// best-effort, per-warm-instance limiter — it blunts naive rapid-fire abuse (and
// protects the SAM.gov key quota on market-research) but is NOT a distributed
// guarantee. For hard limits across instances, front it with Vercel KV / Upstash
// or a Cloudflare rate rule.

const WINDOW_MS = 60_000;
const hits = new Map(); // ip -> number[] (request timestamps within the window)

function clientIp(req) {
  const xff = (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '';
  const first = String(xff).split(',')[0].trim();
  return first || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Fixed-window-ish sliding limiter. Returns { limited, retryAfter (seconds) }.
function rateLimit(req, { max = 30, windowMs = WINDOW_MS } = {}) {
  const ip = clientIp(req);
  const now = Date.now();
  let arr = hits.get(ip);
  if (!arr) { arr = []; hits.set(ip, arr); }
  while (arr.length && arr[0] <= now - windowMs) arr.shift();

  if (arr.length >= max) {
    const retryAfter = Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000));
    return { limited: true, retryAfter };
  }
  arr.push(now);

  // Bound memory: periodically sweep stale IPs.
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      while (v.length && v[0] <= now - windowMs) v.shift();
      if (!v.length) hits.delete(k);
    }
  }
  return { limited: false };
}

// Convenience: enforce and write the 429 response. Returns true if it handled (blocked).
function enforce(req, res, opts) {
  const r = rateLimit(req, opts);
  if (r.limited) {
    res.setHeader('Retry-After', String(r.retryAfter));
    res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' });
    return true;
  }
  return false;
}

module.exports = { rateLimit, enforce, clientIp };
