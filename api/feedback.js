const { enforce, clientIp } = require('./_ratelimit');

// Same-origin feedback relay. The browser only ever talks to acqvault.com (CAC-safe —
// locked-down .mil networks that block third-party form endpoints still work); this
// function forwards the message to Web3Forms server-side, where the access key lives.
//
// SETUP (one-time, owner): create a free form at https://web3forms.com (enter the email
// you want feedback delivered to), copy the Access Key, and set it as the env var
// WEB3FORMS_ACCESS_KEY in Vercel. Until that's set, submissions fail HONESTLY (503) —
// the UI never claims a message was delivered when it wasn't.

const WEB3FORMS_URL = 'https://api.web3forms.com/submit';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

// ── The Combination: daily leaderboard (rides this function — Vercel Hobby is at the
//    12-function cap; new endpoints ride existing ones as modes). Store = Upstash Redis
//    REST, the same env keys the rate limiter uses. Data held per entry: an OPTIONAL
//    display name, guess count, day number — nothing else. Keys expire after ~28h, so
//    the store only ever holds today's board. GET is edge-cached (s-maxage) so hero
//    traffic doesn't hammer Redis.
// Accept either the Upstash-branded env vars or Vercel's KV-branded ones — whichever the
// owner's chosen Vercel storage integration injects, the board works with no code change.
const U_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const U_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
// The Combination rolls at 5 a.m. America/Chicago, NOT UTC midnight. This MUST stay
// logic-identical to assets/study.js comboToday()/COMBO_EPOCH — when it didn't, every
// submission between 19:00 and 04:59 Central was rejected as "not today's round" and the
// homepage board read empty from 7 p.m. onward. A FIXED UTC OFFSET WOULD BE WRONG HALF THE
// YEAR (5am CST is 11:00Z, 5am CDT is 10:00Z), so ask Intl for Chicago's actual offset at
// the instant in question. scripts/verify/combo_tz_verify.js asserts the two agree.
const COMBO_TZ = 'America/Chicago', COMBO_RESET_H = 5;
function tzOffsetMs(t) {
  try {
    const p = {}, f = new Intl.DateTimeFormat('en-US', {
      timeZone: COMBO_TZ, hour12: false, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    f.formatToParts(new Date(t)).forEach(x => { p[x.type] = x.value; });
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second)
           - Math.floor(t / 1000) * 1000;
  } catch (e) { return -6 * 3600000; }   // no Intl: fall back to standard time
}
function comboToday(t) {
  t = (t === undefined) ? Date.now() : t;
  return Math.floor((t + tzOffsetMs(t) - COMBO_RESET_H * 3600000) / 86400000);
}
const COMBO_EPOCH = comboToday(Date.UTC(2026, 6, 12, 12)); // No. 1 = 12 Jul 2026, Central
const SEP = '';
const NAME_RE = /[^A-Za-z0-9 ._\-]/g;
const NAME_BLOCK = /\b(nigg|fagg|cunt|kike|spic|chink)\w*/i; // names are public on the homepage — hard floor

function boardDayNo() { return comboToday() - COMBO_EPOCH + 1; }

async function redis(cmds) {
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

function parseMember(m) {
  const p = String(m).split(SEP);
  return { n: p[1] || 'Anonymous', g: p[2] === 'X' ? 'X' : Number(p[2]) || 0 };
}

async function boardGet(req, res) {
  const no = boardDayNo();
  if (!U_URL || !U_TOKEN) {
    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json({ configured: false, no: no, count: 0, top: [] });
  }
  const out = await redis([
    ['ZRANGE', `lb:${no}`, '0', '24'],
    ['ZCARD', `lb:${no}`]
  ]);
  if (!out) return res.status(200).json({ configured: true, no: no, count: 0, top: [], stale: true });
  const members = (out[0] && out[0].result) || [];
  const count = Number(out[1] && out[1].result) || 0;
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
  return res.status(200).json({ configured: true, no: no, count: count, top: members.map(parseMember) });
}

async function boardPost(req, res, body) {
  if (await enforce(req, res, { max: 6 })) return;
  if (!U_URL || !U_TOKEN) {
    return res.status(503).json({ configured: false, error: 'The board isn’t switched on yet.' });
  }
  const no = boardDayNo();
  if (Number(body.day) !== no) {
    return res.status(400).json({ error: 'That result isn’t for today’s round.' });
  }
  const g = body.guesses === 'X' ? 'X' : Number(body.guesses);
  if (g !== 'X' && !(g >= 1 && g <= 6)) return res.status(400).json({ error: 'Bad result.' });
  let name = clean(body.name, 18).replace(NAME_RE, '').trim() || 'Anonymous';
  if (NAME_BLOCK.test(name)) name = 'Anonymous';
  // one post per IP per day — an office board, not a spam wall. Use clientIp(), which reads
  // cf-connecting-ip: behind Cloudflare the x-forwarded-for is a rotating colo, so hashing it
  // let duplicates through and collided unrelated visitors onto one bucket.
  const ipHash = require('crypto').createHash('sha256')
    .update(clientIp(req) + ':' + no)
    .digest('hex').slice(0, 24);
  const gate = await redis([['SET', `lbip:${no}:${ipHash}`, '1', 'NX', 'EX', '100000']]);
  if (!gate) return res.status(502).json({ error: 'The board didn’t answer — try again.' });
  if (gate[0] && gate[0].result === null) {
    return res.status(409).json({ error: 'Today’s result is already on the board from this connection.' });
  }
  const secs = Math.floor((Date.now() % 86400000) / 1000);
  const score = (g === 'X' ? 9 : g) * 1e6 + secs; // fewer guesses first; earlier post breaks ties
  const member = Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + SEP + name + SEP + g;
  const out = await redis([
    ['ZADD', `lb:${no}`, String(score), member],
    ['EXPIRE', `lb:${no}`, '100000'],
    ['ZRANK', `lb:${no}`, member],
    ['ZCARD', `lb:${no}`]
  ]);
  if (!out) return res.status(502).json({ error: 'The board didn’t answer — try again.' });
  const rank = Number(out[2] && out[2].result);
  const count = Number(out[3] && out[3].result) || 0;
  return res.status(200).json({ ok: true, rank: Number.isFinite(rank) ? rank + 1 : null, count: count, name: name });
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET' && req.query && req.query.board != null) {
    return boardGet(req, res);
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const preBody = req.body || {};
  if (preBody.kind === 'board') return boardPost(req, res, preBody);
  // Feedback is infrequent — keep the limit tight to deter abuse.
  if (await enforce(req, res, { max: 5 })) return;

  const body = req.body || {};
  const message = clean(body.message, 5000);
  const name = clean(body.name, 120) || 'Anonymous';
  const email = clean(body.email, 200);

  if (!message) return res.status(400).json({ error: 'A message is required.' });
  if (email && !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'That email looks off — fix it or leave it blank.' });
  }

  const accessKey = process.env.WEB3FORMS_ACCESS_KEY;
  if (!accessKey) {
    // Never pretend it was delivered. (Owner: set WEB3FORMS_ACCESS_KEY in Vercel.)
    return res.status(503).json({
      configured: false,
      error: 'Feedback isn’t switched on yet — please try again soon.'
    });
  }

  try {
    const upstream = await fetch(WEB3FORMS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(Object.assign(
        {
          access_key: accessKey,
          subject: 'AcqVault feedback',
          from_name: 'AcqVault feedback',
          name: name,
          message: message,
          page: clean(req.headers && req.headers.referer, 300)
        },
        email ? { email: email } : {} // Web3Forms uses this as reply-to when present
      ))
    });
    const data = await upstream.json().catch(function () { return {}; });
    if (!upstream.ok || data.success === false) {
      const msg = (data && (data.message || data.error)) || ('delivery service HTTP ' + upstream.status);
      return res.status(502).json({ error: 'Could not deliver right now (' + msg + ').' });
    }
    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach the feedback service — please try again.' });
  }
};
