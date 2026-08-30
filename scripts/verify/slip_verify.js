#!/usr/bin/env node
// Plays a whole game of Blank Slip against an in-memory Redis and asserts the
// invariants that actually matter. The load-bearing claim of api/_slip.js is
// "your own number never reaches your device" - that claim is asserted here,
// not assumed.
//
//   node scripts/verify/slip_verify.js
//
// Exits 0 on success, 1 on the first failed assertion.

process.env.UPSTASH_REDIS_REST_URL = 'http://stub.invalid';
process.env.UPSTASH_REDIS_REST_TOKEN = 'stub';

/* ── in-memory stand-in for the Upstash REST /pipeline endpoint ─────────── */
const store = new Map();

function runCmd(cmd) {
  const op = String(cmd[0]).toUpperCase();
  if (op === 'GET') {
    return store.has(cmd[1]) ? store.get(cmd[1]) : null;
  }
  if (op === 'SET') {
    const [, k, val, ...rest] = cmd;
    const nx = rest.some(a => String(a).toUpperCase() === 'NX');
    if (nx && store.has(k)) return null;
    store.set(k, String(val));
    return 'OK';
  }
  if (op === 'DEL') {
    const had = store.has(cmd[1]);
    store.delete(cmd[1]);
    return had ? 1 : 0;
  }
  if (op === 'EVAL') {
    // The only script this codebase runs: compare-and-swap.
    const k = cmd[3], oldVal = cmd[4], newVal = cmd[5];
    const cur = store.has(k) ? store.get(k) : null;
    if (cur === oldVal) { store.set(k, String(newVal)); return 1; }
    return 0;
  }
  if (op === 'INCR') {
    const n = Number(store.get(cmd[1]) || 0) + 1;
    store.set(cmd[1], String(n));
    return n;
  }
  if (op === 'EXPIRE') return 1;
  throw new Error('stub redis: unhandled command ' + op);
}

global.fetch = async function (_url, opts) {
  const cmds = JSON.parse(opts.body);
  const results = cmds.map(c => ({ result: runCmd(c) }));
  return { ok: true, json: async () => results };
};

const slip = require('../../api/_slip.js');

/* ── request/response doubles ───────────────────────────────────────────── */
function call(method, action, payload) {
  return new Promise(resolve => {
    const req = {
      method,
      headers: { 'cf-connecting-ip': '203.0.113.' + (1 + Math.floor(Math.random() * 250)) },
      query: method === 'GET' ? Object.assign({ slip: action }, payload) : { slip: action },
      body: method === 'POST' ? payload : undefined
    };
    const res = {
      _status: 200,
      setHeader() {},
      status(c) { this._status = c; return this; },
      json(o) { resolve({ status: this._status, body: o }); return this; }
    };
    slip(req, res);
  });
}

/* ── assertions ─────────────────────────────────────────────────────────── */
let checks = 0;
function ok(cond, label) {
  checks++;
  if (!cond) { console.error('FAIL: ' + label); process.exit(1); }
}
function eq(a, b, label) { ok(a === b, label + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

const PIDS = {
  ana:  'p_' + 'a'.repeat(16),
  beto: 'p_' + 'b'.repeat(16),
  cami: 'p_' + 'c'.repeat(16),
  dan:  'p_' + 'd'.repeat(16),
  eve:  'p_' + 'e'.repeat(16)
};

(async function main() {
  /* create */
  let r = await call('POST', 'create', { pid: PIDS.ana, name: 'Ana', theme: 'how well you would do on a survival show' });
  eq(r.status, 200, 'create returns 200');
  const code = r.body.code;
  ok(/^[ABCDEFGHJKLMNPQRTUVWXY]{4}$/.test(code), 'code uses the spoken-safe alphabet: ' + code);
  eq(r.body.isHost, true, 'creator is host');
  eq(r.body.phase, 'lobby', 'starts in lobby');
  eq(r.body.players.length, 0, 'creator sees no other players yet');

  /* the floor is 2 now: a lone host cannot deal */
  r = await call('POST', 'deal', { code, pid: PIDS.ana });
  eq(r.body.err, 'TOO_FEW', 'cannot deal alone');

  /* bad code shape */
  r = await call('POST', 'join', { code: 'AB', pid: PIDS.beto, name: 'Beto' });
  eq(r.body.err, 'BAD_REQUEST', 'short code rejected');

  /* unknown room */
  r = await call('POST', 'join', { code: 'BBBB', pid: PIDS.beto, name: 'Beto' });
  eq(r.body.err, 'ROOM_GONE', 'unknown room rejected');

  /* joins */
  r = await call('POST', 'join', { code, pid: PIDS.beto, name: 'Beto' });
  eq(r.status, 200, 'Beto joins');
  eq(r.body.isHost, false, 'joiner is not host');

  /* duplicate name, different case */
  r = await call('POST', 'join', { code, pid: PIDS.dan, name: 'beto' });
  eq(r.body.err, 'NAME_TAKEN', 'duplicate name rejected case-insensitively');

  /* rejoin is idempotent and does not duplicate a seat */
  r = await call('POST', 'join', { code, pid: PIDS.beto, name: 'Beto' });
  eq(r.status, 200, 'rejoin succeeds');
  eq(r.body.players.length, 1, 'rejoin did not add a second seat');

  r = await call('POST', 'join', { code, pid: PIDS.cami, name: 'Cami' });
  eq(r.status, 200, 'Cami joins');

  /* non-host cannot deal */
  r = await call('POST', 'deal', { code, pid: PIDS.beto });
  eq(r.body.err, 'NOT_HOST', 'non-host cannot deal');

  /* deal */
  r = await call('POST', 'deal', { code, pid: PIDS.ana });
  eq(r.status, 200, 'host deals');
  eq(r.body.phase, 'play', 'phase is play');
  eq(r.body.round, 1, 'round incremented');

  /* ---- THE INVARIANTS ---- */
  const views = {};
  for (const who of ['ana', 'beto', 'cami']) {
    const v = await call('GET', 'state', { code, pid: PIDS[who], v: -1 });
    views[who] = v.body;
  }

  for (const who of ['ana', 'beto', 'cami']) {
    const view = views[who];
    eq(view.you.num, null, who + ' cannot see their own number');
    eq(view.you.revealed, false, who + ' has not revealed');
    ok(!/"id"/.test(JSON.stringify(view)), 'no player id leaks in ' + who + "'s payload");
    eq(view.players.length, 2, who + ' sees the two other slips');
    ok(view.players.every(p => typeof p.num === 'number'), who + ' sees every other number');
  }

  /* every number distinct, and the union is what was dealt */
  const anaSees = views.ana.players.map(p => p.num);
  const betoSees = views.beto.players.map(p => p.num);
  ok(new Set(anaSees).size === anaSees.length, 'numbers Ana sees are distinct');
  const all = new Set([].concat(anaSees, betoSees));
  eq(all.size, 3, 'exactly three distinct numbers in play');
  ok([...all].every(n => n >= 1 && n <= 100), 'all numbers within 1-100');

  /* cross-check: what Beto and Cami see of Ana agrees */
  const anaViaBeto = views.beto.players.find(p => p.slot === views.ana.you.slot);
  const anaViaCami = views.cami.players.find(p => p.slot === views.ana.you.slot);
  ok(anaViaBeto && anaViaCami, "Ana's slot visible to both others");
  eq(anaViaBeto.num, anaViaCami.num, 'Beto and Cami agree on Ana\'s number');

  /* ---- the sockpuppet: a second browser joining mid-round ---- */
  r = await call('POST', 'join', { code, pid: PIDS.eve, name: 'Eve' });
  eq(r.status, 200, 'Eve joins mid-round');
  eq(r.body.you.pending, true, 'Eve is pending');
  ok(r.body.players.every(p => p.num === null), 'a pending player sees NO numbers at all');
  eq(r.body.you.num, null, 'pending player has no number of their own');

  /* pending player cannot reveal */
  r = await call('POST', 'reveal', { code, pid: PIDS.eve });
  eq(r.body.err, 'PENDING', 'pending player cannot reveal');

  /* the others are unaffected by Eve being there */
  const anaAfter = (await call('GET', 'state', { code, pid: PIDS.ana, v: -1 })).body;
  eq(anaAfter.you.num, null, 'Ana still cannot see her own number');
  ok(anaAfter.players.some(p => p.name === 'Eve' && p.num === null),
     'Ana sees Eve seated with no number yet');

  /* ---- version short-circuit ---- */
  const cur = anaAfter.v;
  r = await call('GET', 'state', { code, pid: PIDS.ana, v: cur });
  eq(r.body.same, true, 'unchanged poll short-circuits');
  ok(r.body.you === undefined, 'short-circuit payload carries no state');

  /* ---- reveal ---- */
  r = await call('POST', 'reveal', { code, pid: PIDS.ana });
  eq(r.status, 200, 'Ana reveals');
  ok(typeof r.body.you.num === 'number', 'Ana now sees her own number');
  eq(r.body.you.revealed, true, 'Ana marked revealed');
  const anaNum = r.body.you.num;

  /* what others saw of Ana is what Ana got */
  eq(anaViaBeto.num, anaNum, "the number Ana reveals is the one others were seeing all along");

  /* reveal is idempotent */
  r = await call('POST', 'reveal', { code, pid: PIDS.ana });
  eq(r.status, 200, 'second reveal is idempotent, not an error');
  eq(r.body.you.num, anaNum, 'same number on repeat reveal');

  /* phase flips to done only when every dealt player has revealed */
  r = await call('POST', 'reveal', { code, pid: PIDS.beto });
  eq(r.body.phase, 'play', 'still play with one dealt player left');
  r = await call('POST', 'reveal', { code, pid: PIDS.cami });
  eq(r.body.phase, 'done', 'done once all dealt players revealed (pending Eve does not block)');

  /* ---- a question put to the ROOM ---- */
  r = await call('POST', 'ask', { code, pid: PIDS.ana, text: 'Is my number higher than 50?' });
  eq(r.status, 200, 'Ana puts a question to the room');
  eq(r.body.ask.mine, true, 'Ana owns the question');
  eq(r.body.ask.text, 'Is my number higher than 50?', 'question text round-trips');
  eq(r.body.ask.waiting, 2, 'two others still to answer');
  eq(r.body.ask.yes + r.body.ask.no, 0, 'no answers yet');

  const betoOnAsk = (await call('GET', 'state', { code, pid: PIDS.beto, v: -1 })).body;
  eq(betoOnAsk.ask.mine, false, "Beto is not the asker");
  eq(betoOnAsk.ask.byName, 'Ana', 'Beto is told who is asking');
  eq(betoOnAsk.ask.answered, false, 'Beto has not answered yet');
  ok(!('a' in betoOnAsk.ask), 'the raw per-player answer map is never exposed');
  ok(!('id' in betoOnAsk.ask), 'the ask carries no player id');

  /* the asker cannot answer their own question */
  r = await call('POST', 'answer', { code, pid: PIDS.ana, yes: true });
  eq(r.body.err, 'BAD_REQUEST', 'asker cannot answer their own question');

  r = await call('POST', 'answer', { code, pid: PIDS.beto, yes: true });
  eq(r.status, 200, 'Beto answers yes');
  eq(r.body.ask.answered, true, 'Beto is marked as answered');
  eq(r.body.ask.yes, 1, 'one yes');
  eq(r.body.ask.waiting, 1, 'one still deciding');

  r = await call('POST', 'answer', { code, pid: PIDS.cami, yes: false });
  eq(r.body.ask.no, 1, 'one no');
  eq(r.body.ask.waiting, 0, 'the room has answered');

  /* answering twice just overwrites, it does not double-count */
  r = await call('POST', 'answer', { code, pid: PIDS.cami, yes: true });
  eq(r.body.ask.yes + r.body.ask.no, 2, 'a changed answer does not double-count');
  eq(r.body.ask.yes, 2, 'Cami switched to yes');

  /* a pending player cannot ask */
  r = await call('POST', 'ask', { code, pid: PIDS.eve, text: 'Am I even?' });
  eq(r.body.err, 'PENDING', 'a pending player cannot put a question up');

  /* ---- deal again: same room, fresh numbers, Eve included ---- */
  r = await call('POST', 'deal', { code, pid: PIDS.ana });
  eq(r.status, 200, 'host deals again');
  eq(r.body.round, 2, 'round 2');
  eq(r.body.ask, null, 'a new deal clears the question on the table');
  eq(r.body.phase, 'play', 'back to play');
  eq(r.body.you.num, null, 'Ana cannot see her new number');
  eq(r.body.you.revealed, false, 'reveal state cleared');
  eq(r.body.players.length, 3, 'Eve is now dealt in');
  ok(r.body.players.every(p => typeof p.num === 'number'), 'Eve now has a number others can see');

  const eveAfter = (await call('GET', 'state', { code, pid: PIDS.eve, v: -1 })).body;
  eq(eveAfter.you.pending, false, 'Eve is no longer pending');
  eq(eveAfter.you.num, null, 'Eve cannot see her own number either');

  /* ---- leave / kick ---- */
  r = await call('POST', 'leave', { code, pid: PIDS.beto });
  eq(r.body.left, true, 'Beto leaves');
  r = await call('GET', 'state', { code, pid: PIDS.beto, v: -1 });
  eq(r.body.err, 'NOT_SEATED', 'a departed player is told they are not seated');

  r = await call('POST', 'leave', { code, pid: PIDS.cami, target: eveAfter.you.slot });
  eq(r.body.err, 'NOT_HOST', 'a non-host cannot kick');

  r = await call('POST', 'leave', { code, pid: PIDS.ana, target: eveAfter.you.slot });
  eq(r.status, 200, 'host kicks Eve');
  ok(!r.body.players.some(p => p.name === 'Eve'), 'Eve is gone from the roster');

  /* ---- host handover when the host leaves ---- */
  r = await call('POST', 'leave', { code, pid: PIDS.ana });
  eq(r.body.left, true, 'host leaves');
  r = await call('GET', 'state', { code, pid: PIDS.cami, v: -1 });
  eq(r.body.isHost, true, 'host passed to the remaining player');

  /* ---- room disappears when the last player leaves ---- */
  r = await call('POST', 'leave', { code, pid: PIDS.cami });
  eq(r.body.left, true, 'last player leaves');
  r = await call('GET', 'state', { code, pid: PIDS.cami, v: -1 });
  eq(r.body.err, 'ROOM_GONE', 'empty room is deleted');

  /* ---- unit checks on the pieces ---- */
  const { dealNumbers, cleanName, newCode, UGLY_RE } = slip._internals;
  for (let i = 0; i < 200; i++) {
    const n = dealNumbers(8);
    eq(new Set(n).size, 8, 'dealNumbers always returns distinct values');
    ok(n.every(x => x >= 1 && x <= 100), 'dealNumbers stays in 1-100');
  }
  for (let i = 0; i < 2000; i++) ok(!UGLY_RE.test(newCode()), 'generated codes pass the profanity gate');
  eq(cleanName('  Ana   Maria  '), 'Ana Maria', 'names collapse whitespace');
  eq(cleanName('x'.repeat(50)).length, 16, 'names are capped at 16');

  /* ---- a two-player game is legal and still hides your own number ---- */
  const two = await call('POST', 'create', { pid: PIDS.ana, name: 'Ana', theme: 'how likely you are to name the group chat' });
  const c2 = two.body.code;
  await call('POST', 'join', { code: c2, pid: PIDS.beto, name: 'Beto' });
  r = await call('POST', 'deal', { code: c2, pid: PIDS.ana });
  eq(r.status, 200, 'two players can deal');
  eq(r.body.you.num, null, 'in a 2-player game Ana still cannot see her own number');
  eq(r.body.players.length, 1, 'Ana sees exactly one other slip');
  ok(typeof r.body.players[0].num === 'number', 'and it carries a real number');
  const betoView = (await call('GET', 'state', { code: c2, pid: PIDS.beto, v: -1 })).body;
  eq(betoView.you.num, null, 'Beto cannot see his own either');
  ok(betoView.players[0].num !== r.body.players[0].num, 'the two numbers are distinct');

  console.log('slip_verify: ' + checks + ' checks passed');
})().catch(e => { console.error(e); process.exit(1); });
