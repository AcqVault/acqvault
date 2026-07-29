/* Gate for the analytics collector (api/_analytics.js).
   Stubs Upstash, drives record()/report()/renderHTML(), and asserts on the exact
   Redis pipeline the server would issue — so a change that silently stops
   recording, or starts recording something it shouldn't, fails here.
   Ends with a NEGATIVE TEST: this repo's signature bug is a gate that reports
   green over real errors, so the harness proves it can fail before it claims pass.
   usage: node scripts/verify/analytics_verify.js
*/
process.env.UPSTASH_REDIS_REST_URL = 'https://stub.invalid';
process.env.UPSTASH_REDIS_REST_TOKEN = 'stub-token';
process.env.ANALYTICS_SALT = 'test-salt';

const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const A = require(path.join(REPO, 'api/_analytics.js'));

let captured = null, reply = null;
global.fetch = async (url, opts) => {
  captured = JSON.parse(opts.body);
  return { ok: true, json: async () => reply };
};

let fails = 0;
let expectFail = false;
function ok(name, cond, extra) {
  if (!cond) { fails++; console.log((expectFail ? '  (expected fail) ' : '  FAIL  ') + name + (extra && !expectFail ? '  ->  ' + extra : '')); }
  else console.log('  ok    ' + name);
}
const req = (ip) => ({ headers: { host: 'www.acqvault.com', 'cf-connecting-ip': ip || '1.2.3.4' } });
const cmds = () => captured.map((c) => c.join(' '));
const has = (re) => cmds().some((c) => re.test(c));

(async () => {
console.log('\n— sanitisers —');
ok('path kept intact', A.route('/rfo/part-19') === '/rfo/part-19', A.route('/rfo/part-19'));
ok('query string stripped', A.route('/x?q=secret#f') === '/x', A.route('/x?q=secret#f'));
ok('trailing slash normalised', A.route('/study/') === '/study', A.route('/study/'));
ok('junk path bucketed', A.route('/<script>') === '/other', A.route('/<script>'));
ok('non-path rejected', A.route('https://evil.tld/x') === '/', A.route('https://evil.tld/x'));
ok('referrer reduced to host', A.refHost('https://www.linkedin.com/feed/?x=1', 'www.acqvault.com') === 'linkedin.com', A.refHost('https://www.linkedin.com/feed/?x=1', 'www.acqvault.com'));
ok('own host = internal', A.refHost('https://acqvault.com/rfo', 'www.acqvault.com') === '(internal)');
ok('no referrer = direct', A.refHost('', 'www.acqvault.com') === '(direct)');
ok('email redacted', A.redact('email me at bob.smith@us.af.mil now') === 'email me at [email] now', A.redact('email me at bob.smith@us.af.mil now'));
ok('long digit run redacted', A.redact('ssn 123456789') === 'ssn [num]', A.redact('ssn 123456789'));
ok('section numbers KEPT', A.redact('FAR 19.502-2') === 'far 19.502-2', A.redact('FAR 19.502-2'));
ok('query capped at 80', A.redact('x'.repeat(500)).length === 80);
ok('control chars stripped', A.redact('a\x00\x1fb') === 'ab', JSON.stringify(A.redact('a\x00\x1fb')));

console.log('\n— record() —');
reply = [];
await A.record(req(), { a: 'view', p: '/rfo/part-19', r: 'https://www.google.com/search?q=far', d: 'mobile' });
ok('view counts the route', has(/HINCRBY av:[\d-]+:routes \/rfo\/part-19 1/));
ok('view counts referrer host only', has(/HINCRBY av:[\d-]+:ref google\.com 1/));
ok('view counts device', has(/HINCRBY av:[\d-]+:dev mobile 1/));
ok('view adds to HyperLogLog', has(/^PFADD av:[\d-]+:uv [0-9a-f]{32}$/));
ok('no raw IP anywhere in payload', !JSON.stringify(captured).includes('1.2.3.4'));
ok('every key gets a TTL', cmds().filter((c) => /^EXPIRE /.test(c)).length >= 4);

await A.record(req(), { a: 'search', q: 'Simplified Acquisition Threshold', n: 12 });
ok('search counted', has(/HINCRBY av:[\d-]+:act search 1/));
ok('query lowercased into :q', has(/HINCRBY av:[\d-]+:q simplified acquisition threshold 1/));
ok('non-zero search not in :q0', !has(/:q0 /));

await A.record(req(), { a: 'search', q: 'widget teleport clause', n: 0 });
ok('zero-result query lands in :q0', has(/HINCRBY av:[\d-]+:q0 widget teleport clause 1/));
ok('search0 derived server-side', has(/HINCRBY av:[\d-]+:act search0 1/));

await A.record(req(), { a: 'evil-unbounded-field', p: '/' });
ok('unknown action falls back to view', has(/HINCRBY av:[\d-]+:act view 1/) && !has(/evil-unbounded-field/));

await A.record(req(), { a: 'search0', q: 'spoof', n: 5 });
ok('client CANNOT post a derived action', !has(/:act search0 /), cmds().join(' | '));

await A.record(req(), { a: 'search', q: 'x', n: 3 });
ok('1-char query not stored', !has(/:q x /));

console.log('\n— report() parsing —');
const today = A.utcDay();
// Upstash returns HGETALL as a FLAT [field, value, ...] array over REST.
const kinds = ['act', 'routes', 'ref', 'dev', 'q', 'q0'];
reply = [];
for (let d = 0; d < 2; d++) {
  for (const k of kinds) {
    if (d === 0 && k === 'act') reply.push({ result: ['view', '100', 'search', '40', 'search0', '10', 'open', '25', 'ask', '5', 'browse', '7'] });
    else if (d === 0 && k === 'routes') reply.push({ result: ['/', '60', '/rfo/part-19', '40'] });
    else if (d === 0 && k === 'q0') reply.push({ result: ['ghost clause', '9'] });
    else reply.push({ result: [] });
  }
}
reply.push({ result: 55 }, { result: 3 }, { result: 57 });
const rep = await A.report(2);
ok('views summed', rep.views === 100, rep.views);
ok('searches summed', rep.searches === 40, rep.searches);
ok('zero-result searches summed', rep.searchesZero === 10, rep.searchesZero);
ok('search rate = searches/views', Math.abs(rep.searchRate - 0.4) < 1e-9, rep.searchRate);
ok('open rate = opens/searches', Math.abs(rep.openRate - 25 / 40) < 1e-9, rep.openRate);
ok('zero rate = zeroes/searches', Math.abs(rep.zeroRate - 0.25) < 1e-9, rep.zeroRate);
ok('window uniques use merged PFCOUNT, not the sum', rep.uniqueVisitors === 57, rep.uniqueVisitors);
ok('daily rows returned', rep.daily.length === 2 && rep.daily[0].day === today, JSON.stringify(rep.daily[0]));
ok('per-day uniques read', rep.daily[0].uniques === 55, rep.daily[0].uniques);
ok('top routes sorted desc', rep.topRoutes[0][0] === '/' && rep.topRoutes[0][1] === 60, JSON.stringify(rep.topRoutes));
ok('zero-result queries surfaced', rep.zeroQueries[0][0] === 'ghost clause', JSON.stringify(rep.zeroQueries));

console.log('\n— dashboard render —');
const html = A.renderHTML(rep);
ok('renders a document', html.startsWith('<!DOCTYPE html>'));
ok('is noindex', html.includes('noindex, nofollow'));
ok('has no <script> at all (CSP script-src self)', !/<script/i.test(html));
ok('loads nothing third-party', !/https?:\/\//i.test(html.replace(/<!DOCTYPE[^>]*>/i, '')));
ok('shows the zero-result list', html.includes('ghost clause'));
const xss = A.renderHTML(Object.assign({}, rep, { zeroQueries: [['<img src=x onerror=alert(1)>', 3]] }));
ok('escapes hostile query text', !xss.includes('<img src=x') && xss.includes('&lt;img'), 'XSS ESCAPE FAILED');

console.log('\n— NEGATIVE TEST (the harness must be able to fail) —');
let caught = 0;
const realFails = fails;
expectFail = true;
ok('deliberately false assertion', 1 === 2);
expectFail = false;
caught = fails - realFails;
fails = realFails;
console.log(caught === 1 ? '  ok    harness detects failures' : '  FAIL  HARNESS IS BLIND');
if (caught !== 1) fails++;

console.log('\n' + (fails ? `${fails} FAILURE(S)` : 'ALL PASS'));
process.exit(fails ? 1 : 0);
})();
