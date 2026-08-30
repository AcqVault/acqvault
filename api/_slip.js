// Blank Slip - the forehead number game. Unlisted, at /slip.
//
// Underscore prefix => NOT routed as its own endpoint (same convention as
// _ratelimit.js / _analytics.js / _seo.js). Vercel Hobby caps deployable
// functions at 12 and api/ is already at exactly 12, so this rides
// api/feedback.js, which forwards `?slip=<action>` here in one line.
//
// THE WHOLE POINT OF THE SERVER: a player's own number never reaches their
// device. Every response is built by redact() below, which nulls `you.num`
// until that player reveals. The old URL-hash version only *declined to draw*
// your number - it was still in the page. Here the bytes are never sent.
//
// Store = Upstash Redis REST, same env vars the rate limiter uses. One key
// per room, JSON, 12h TTL. No presence keys, no per-player keys, no counters.

const { enforce } = require('./_ratelimit');
const crypto = require('crypto');

const U_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const U_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const configured = !!(U_URL && U_TOKEN);

const TTL = 43200;              // 12h: survives dinner, a movie, and a rematch
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;   // with two, you see one number - still deducible
const NAME_MAX = 16;
const THEME_MAX = 120;
const ASK_MAX = 120;

// Letters only, and none that get MISHEARD over a bad connection: no I/O/S/Z
// (1/0/5/2), no digits at all, so nobody has to ask "letter or number?".
const ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXY';
const CODE_RE = /^[ABCDEFGHJKLMNPQRTUVWXY]{4}$/;
const PID_RE = /^p_[a-f0-9]{16}$/;
// Codes get read aloud to friends. One line of insurance.
const UGLY_RE = /FUCK|CUNT|TWAT|WANK|TURD|ANAL|ARSE|CRAP|DAMN|HELL|PUKE|PISS/;

/* ── redis ──────────────────────────────────────────────────────────────────
   Same shape as the helper in feedback.js: plain fetch at the REST /pipeline
   endpoint, hard timeout, and null on ANY failure so callers branch rather
   than throw. Game state never fails open - a fabricated board is worse than
   an honest error. */
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
  } catch (_e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Compare-and-swap. The most concurrent moment in the game is five people
// tapping Join in the 200ms after the host reads the code out. A plain
// GET-mutate-SET loses joins ("why isn't my name up?"); this cannot.
const CAS =
  "if redis.call('GET',KEYS[1])==ARGV[1] then redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]) return 1 end return 0";

const key = code => `slip:${code}`;

async function loadRoom(code) {
  const out = await redis([['GET', key(code)]]);
  if (out === null) return { err: 'STORE_DOWN' };
  const raw = out[0] && out[0].result;
  if (raw == null) return { err: 'ROOM_GONE' };
  try {
    return { raw: String(raw), room: JSON.parse(raw) };
  } catch (_e) {
    return { err: 'ROOM_GONE' };
  }
}

async function saveRoom(code, oldRaw, room) {
  room.v++;
  const next = JSON.stringify(room);
  const out = await redis([['EVAL', CAS, '1', key(code), oldRaw, next, String(TTL)]]);
  if (out === null) return { err: 'STORE_DOWN' };
  const won = Number(out[0] && out[0].result) === 1;
  return won ? { ok: true, raw: next } : { err: 'CONFLICT' };
}

/* ── validation ─────────────────────────────────────────────────────────── */
function cleanName(v) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}
function cleanTheme(v) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, THEME_MAX);
}
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

/* ── the secrecy choke point ────────────────────────────────────────────────
   NO handler returns `room`. Every client payload comes from here.
   Three invariants, all checkable by reading this function:
     1. you.num is null unless YOU revealed.
     2. No `id` appears in any payload, ever - so the only pid anyone can
        learn is their own, which is precisely the redacted one.
     3. A pending player (joined after the deal) sees NO numbers at all,
        which is what stops a second browser tab from reading your number. */
function redact(room, pid) {
  const me = room.players.find(p => p.id === pid);
  if (!me) return null;
  const pending = room.phase !== 'lobby' && me.num === null;
  return {
    ok: true,
    v: room.v,
    code: room.code,
    phase: room.phase,
    round: room.round,
    theme: room.theme,
    isHost: room.host === pid,
    you: {
      slot: me.slot,
      name: me.name,
      revealed: me.revealed,
      pending,
      num: me.revealed ? me.num : null
    },
    players: room.players
      .filter(p => p.slot !== me.slot)
      .map(p => ({
        slot: p.slot,
        name: p.name,
        revealed: p.revealed,
        seated: p.id !== null,
        num: pending ? null : p.num
      })),
    ask: askView(room, me)
  };
}

// The open question, as this player should see it. Carries only the text and
// a yes/no tally - never anything derived from a number.
function askView(room, me) {
  const q = room.ask;
  if (!q) return null;
  const asker = room.players.find(p => p.slot === q.by);
  // Only players who were dealt into THIS round can answer - a latecomer is
  // pending and has no number, so counting them would leave the asker waiting
  // on someone who is not allowed to reply.
  const responders = room.players.filter(
    p => p.id !== null && p.slot !== q.by && p.num !== null
  );
  let yes = 0, no = 0;
  responders.forEach(p => {
    const a = q.a[p.slot];
    if (a === 1) yes++; else if (a === 0) no++;
  });
  return {
    by: q.by,
    byName: asker ? asker.name : 'Someone',
    text: q.t,
    mine: me.slot === q.by,
    answered: q.a[me.slot] !== undefined,
    yes, no,
    waiting: responders.length - (yes + no)
  };
}

const MSG = {
  BAD_REQUEST: "That didn't look right - try again.",
  NOT_HOST: 'Only the host can do that.',
  ROOM_GONE: 'That room is gone - it expired, or the code was wrong.',
  NAME_TAKEN: 'Someone in the room already has that name - add an initial.',
  ROOM_FULL: 'That room is full at 8 players.',
  NOT_SEATED: "You're not in this room any more.",
  TOO_FEW: 'You need one more player - you need a number you can see.',
  PENDING: "You're in from the next round - the host deals you in.",
  NO_QUESTION: 'That question is gone - someone asked a new one.',
  CONFLICT: 'Everyone tapped at once. Try that again.',
  CODE_BUSY: 'Could not find a free room code. Try once more.',
  STORE_DOWN: "The game store didn't answer. Try again in a moment.",
  NOT_CONFIGURED: "The game isn't switched on yet."
};
const HTTP = {
  BAD_REQUEST: 400, NOT_HOST: 403, ROOM_GONE: 404, NAME_TAKEN: 409,
  ROOM_FULL: 409, NOT_SEATED: 409, TOO_FEW: 409, PENDING: 409,
  CONFLICT: 409, CODE_BUSY: 503, STORE_DOWN: 502, NOT_CONFIGURED: 503,
  NO_QUESTION: 409
};
function bail(res, err) {
  return res.status(HTTP[err] || 400).json({ ok: false, err, msg: MSG[err] || MSG.BAD_REQUEST });
}

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
    if (!UGLY_RE.test(c)) return c;
  }
}

// Distinct numbers, so "am I higher than Ana?" and "am I the highest?" always
// have an answer. Partial Fisher-Yates over 1..RANGE - we only need the first n.
const RANGE = 100;
function dealNumbers(n) {
  const pool = [];
  for (let i = 1; i <= RANGE; i++) pool.push(i);
  for (let i = 0; i < n; i++) {
    const j = i + crypto.randomInt(0, pool.length - i);
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  return pool.slice(0, n);
}

/* ── actions ────────────────────────────────────────────────────────────── */

async function doCreate(req, res, body) {
  const name = cleanName(body.name);
  const theme = cleanTheme(body.theme);
  const pid = String(body.pid || '');
  if (!PID_RE.test(pid) || !name || !theme) return bail(res, 'BAD_REQUEST');

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const room = {
      v: 1, code, phase: 'lobby', theme, host: pid, round: 0, nextSlot: 1,
      createdAt: Date.now(),
      players: [{ id: pid, slot: 0, name, num: null, revealed: false }]
    };
    const out = await redis([['SET', key(code), JSON.stringify(room), 'NX', 'EX', String(TTL)]]);
    if (out === null) return bail(res, 'STORE_DOWN');
    // NX is the uniqueness check - a null result means that code is live.
    if (out[0] && out[0].result) return res.status(200).json(redact(room, pid));
  }
  return bail(res, 'CODE_BUSY');
}

async function doJoin(req, res, body) {
  const code = String(body.code || '').toUpperCase();
  const pid = String(body.pid || '');
  const name = cleanName(body.name);
  if (!CODE_RE.test(code) || !PID_RE.test(pid) || !name) return bail(res, 'BAD_REQUEST');

  for (let attempt = 0; attempt < 3; attempt++) {
    const got = await loadRoom(code);
    if (got.err) return bail(res, got.err);
    const room = got.room;

    // Already seated => this is a refresh/rejoin. Costs one command, no write.
    if (room.players.some(p => p.id === pid)) {
      return res.status(200).json(redact(room, pid));
    }
    if (room.players.some(p => p.id !== null && sameName(p.name, name))) {
      return bail(res, 'NAME_TAKEN');
    }
    if (room.players.filter(p => p.id !== null).length >= MAX_PLAYERS) {
      return bail(res, 'ROOM_FULL');
    }

    // Slots are stable ids, never array indices - otherwise a leave landing
    // concurrently with a join renumbers everyone.
    room.players.push({
      id: pid, slot: room.nextSlot++, name, num: null, revealed: false
    });

    const saved = await saveRoom(code, got.raw, room);
    if (saved.ok) return res.status(200).json(redact(room, pid));
    if (saved.err === 'STORE_DOWN') return bail(res, 'STORE_DOWN');
    // CONFLICT => someone else wrote first; re-read and try again.
  }
  return bail(res, 'CONFLICT');
}

async function doDeal(req, res, body) {
  const code = String(body.code || '').toUpperCase();
  const pid = String(body.pid || '');
  if (!CODE_RE.test(code) || !PID_RE.test(pid)) return bail(res, 'BAD_REQUEST');
  const newTheme = body.theme != null ? cleanTheme(body.theme) : null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const got = await loadRoom(code);
    if (got.err) return bail(res, got.err);
    const room = got.room;

    if (!room.players.some(p => p.id === pid)) return bail(res, 'NOT_SEATED');
    if (room.host !== pid) return bail(res, 'NOT_HOST');

    const seated = room.players.filter(p => p.id !== null);
    if (seated.length < MIN_PLAYERS) return bail(res, 'TOO_FEW');
    if (seated.length > MAX_PLAYERS) return bail(res, 'ROOM_FULL');

    const nums = dealNumbers(seated.length);
    seated.forEach((p, i) => { p.num = nums[i]; p.revealed = false; });
    room.phase = 'play';
    room.round++;
    room.ask = null;
    if (newTheme) room.theme = newTheme;

    const saved = await saveRoom(code, got.raw, room);
    if (saved.ok) return res.status(200).json(redact(room, pid));
    if (saved.err === 'STORE_DOWN') return bail(res, 'STORE_DOWN');
  }
  return bail(res, 'CONFLICT');
}

async function doState(req, res, q) {
  const code = String(q.code || '').toUpperCase();
  const pid = String(q.pid || '');
  if (!CODE_RE.test(code) || !PID_RE.test(pid)) return bail(res, 'BAD_REQUEST');

  const got = await loadRoom(code);
  if (got.err) return bail(res, got.err);
  const room = got.room;

  const seen = Number(q.v);
  // Cheapest possible answer: ~30 bytes, and the client does nothing with it.
  if (Number.isFinite(seen) && seen === room.v) {
    return res.status(200).json({ ok: true, v: room.v, same: true });
  }
  const view = redact(room, pid);
  if (!view) return bail(res, 'NOT_SEATED');
  return res.status(200).json(view);
}

async function doReveal(req, res, body) {
  const code = String(body.code || '').toUpperCase();
  const pid = String(body.pid || '');
  if (!CODE_RE.test(code) || !PID_RE.test(pid)) return bail(res, 'BAD_REQUEST');

  for (let attempt = 0; attempt < 3; attempt++) {
    const got = await loadRoom(code);
    if (got.err) return bail(res, got.err);
    const room = got.room;

    const me = room.players.find(p => p.id === pid);
    if (!me) return bail(res, 'NOT_SEATED');
    if (room.phase === 'lobby') return bail(res, 'PENDING');
    if (me.num === null) return bail(res, 'PENDING');
    // Idempotent: a double-tap or a retry must not error.
    if (me.revealed) return res.status(200).json(redact(room, pid));

    me.revealed = true;
    const seated = room.players.filter(p => p.id !== null && p.num !== null);
    if (seated.every(p => p.revealed)) room.phase = 'done';

    const saved = await saveRoom(code, got.raw, room);
    if (saved.ok) return res.status(200).json(redact(room, pid));
    if (saved.err === 'STORE_DOWN') return bail(res, 'STORE_DOWN');
  }
  return bail(res, 'CONFLICT');
}

// Put a question to the room. Replaces any previous one - there is only ever
// one question on the table, the same as at a kitchen table.
async function doAsk(req, res, body) {
  const code = String(body.code || '').toUpperCase();
  const pid = String(body.pid || '');
  const text = cleanTheme(body.text).slice(0, ASK_MAX);
  if (!CODE_RE.test(code) || !PID_RE.test(pid) || !text) return bail(res, 'BAD_REQUEST');

  for (let attempt = 0; attempt < 3; attempt++) {
    const got = await loadRoom(code);
    if (got.err) return bail(res, got.err);
    const room = got.room;
    const me = room.players.find(p => p.id === pid);
    if (!me) return bail(res, 'NOT_SEATED');
    if (room.phase === 'lobby' || me.num === null) return bail(res, 'PENDING');

    room.ask = { by: me.slot, t: text, a: {} };

    const saved = await saveRoom(code, got.raw, room);
    if (saved.ok) return res.status(200).json(redact(room, pid));
    if (saved.err === 'STORE_DOWN') return bail(res, 'STORE_DOWN');
  }
  return bail(res, 'CONFLICT');
}

// Answer the question on the table. The asker cannot answer their own.
async function doAnswer(req, res, body) {
  const code = String(body.code || '').toUpperCase();
  const pid = String(body.pid || '');
  if (!CODE_RE.test(code) || !PID_RE.test(pid)) return bail(res, 'BAD_REQUEST');
  const yes = body.yes === true || body.yes === 'true' ? 1 : 0;

  for (let attempt = 0; attempt < 3; attempt++) {
    const got = await loadRoom(code);
    if (got.err) return bail(res, got.err);
    const room = got.room;
    const me = room.players.find(p => p.id === pid);
    if (!me) return bail(res, 'NOT_SEATED');
    if (!room.ask) return bail(res, 'NO_QUESTION');
    if (room.ask.by === me.slot) return bail(res, 'BAD_REQUEST');
    if (me.num === null) return bail(res, 'PENDING');

    room.ask.a[me.slot] = yes;

    const saved = await saveRoom(code, got.raw, room);
    if (saved.ok) return res.status(200).json(redact(room, pid));
    if (saved.err === 'STORE_DOWN') return bail(res, 'STORE_DOWN');
  }
  return bail(res, 'CONFLICT');
}

async function doLeave(req, res, body) {
  const code = String(body.code || '').toUpperCase();
  const pid = String(body.pid || '');
  if (!CODE_RE.test(code) || !PID_RE.test(pid)) return bail(res, 'BAD_REQUEST');
  const target = body.target != null ? Number(body.target) : null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const got = await loadRoom(code);
    if (got.err) return bail(res, got.err);
    const room = got.room;

    const me = room.players.find(p => p.id === pid);
    if (!me) return bail(res, 'NOT_SEATED');

    let dropSlot = me.slot;
    if (target !== null && target !== me.slot) {
      if (room.host !== pid) return bail(res, 'NOT_HOST');
      if (!Number.isInteger(target)) return bail(res, 'BAD_REQUEST');
      dropSlot = target;
    }

    room.players = room.players.filter(p => p.slot !== dropSlot);

    if (room.players.length === 0) {
      const out = await redis([['DEL', key(code)]]);
      if (out === null) return bail(res, 'STORE_DOWN');
      return res.status(200).json({ ok: true, left: true });
    }
    if (room.host === pid && dropSlot === me.slot) room.host = room.players[0].id;

    const saved = await saveRoom(code, got.raw, room);
    if (saved.ok) {
      if (dropSlot === me.slot) return res.status(200).json({ ok: true, left: true });
      return res.status(200).json(redact(room, pid));
    }
    if (saved.err === 'STORE_DOWN') return bail(res, 'STORE_DOWN');
  }
  return bail(res, 'CONFLICT');
}

/* ── entry ──────────────────────────────────────────────────────────────── */
module.exports = async function slip(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!configured) return bail(res, 'NOT_CONFIGURED');

  const action = String((req.query && req.query.slip) || '');

  if (req.method === 'GET') {
    if (action !== 'state') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, err: 'BAD_REQUEST', msg: MSG.BAD_REQUEST }); }
    // Eight phones on one house WiFi share an IP, and each polls.
    if (await enforce(req, res, { max: 240, name: 'slip-r' })) return;
    return doState(req, res, req.query || {});
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, err: 'BAD_REQUEST', msg: MSG.BAD_REQUEST });
  }

  const body = req.body || {};

  if (action === 'create') {
    if (await enforce(req, res, { max: 6, name: 'slip-new' })) return;
    return doCreate(req, res, body);
  }
  if (await enforce(req, res, { max: 60, name: 'slip-w' })) return;

  if (action === 'join') return doJoin(req, res, body);
  if (action === 'deal') return doDeal(req, res, body);
  if (action === 'ask') return doAsk(req, res, body);
  if (action === 'answer') return doAnswer(req, res, body);
  if (action === 'reveal') return doReveal(req, res, body);
  if (action === 'leave') return doLeave(req, res, body);

  return bail(res, 'BAD_REQUEST');
};

// Exported for scripts/verify/slip_verify.js - the redaction invariants are
// the load-bearing part of this file and are asserted, not assumed.
module.exports._internals = { redact, dealNumbers, cleanName, newCode, CODE_RE, ALPHABET, UGLY_RE };
