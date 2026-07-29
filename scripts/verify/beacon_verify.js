/* Gate for the analytics beacon (assets/analytics.js).
   Loads the real beacon in a minimal DOM shim and dispatches the EXACT CustomEvents
   app.js dispatches, asserting the payload that would reach /api/feedback. This is
   the contract between app.js and the beacon: if someone drops `n` from the
   acqvault:searched detail, or renames an event, the zero-result list silently goes
   empty on the dashboard and nothing else would notice. Ends with a NEGATIVE TEST.
   usage: node scripts/verify/beacon_verify.js
*/
const fs = require('fs'), path = require('path'), vm = require('vm');

const REPO = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(REPO, 'assets/analytics.js'), 'utf8');

let fails = 0;
let expectFail = false;
const ok = (n, c, x) => { if (!c) { fails++; console.log((expectFail ? '  (expected fail) ' : '  FAIL  ') + n + (x && !expectFail ? '  ->  ' + x : '')); } else console.log('  ok    ' + n); };

function load({ gpc = undefined, beacon = true } = {}) {
  const posts = [];
  const doc = new EventTarget();
  doc.readyState = 'complete';
  doc.referrer = 'https://www.google.com/search?q=far+19';
  doc.prerendering = false;
  doc.scripts = [];

  const ctx = {
    navigator: {
      globalPrivacyControl: gpc,
      sendBeacon: beacon ? (url, blob) => { posts.push({ via: 'beacon', url, body: blob._text }); return true; } : undefined
    },
    document: doc,
    location: { pathname: '/rfo/part-19', href: 'https://www.acqvault.com/rfo/part-19?q=secret' },
    window: { innerWidth: 1280, addEventListener() {} },
    Blob: class { constructor(parts, opts) { this._text = parts.join(''); this.type = opts && opts.type; } },
    fetch: (url, o) => { posts.push({ via: 'fetch', url, body: o.body }); return Promise.resolve(); },
    console
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { posts, doc, bodies: () => posts.map((p) => JSON.parse(p.body)) };
}

console.log('\n— pageview —');
let s = load();
ok('fires exactly one pageview on load', s.posts.length === 1, s.posts.length);
let b = s.bodies()[0];
ok('uses the px mode marker', b.kind === 'px', JSON.stringify(b));
ok('action is view', b.a === 'view');
ok('sends path only, NOT the query string', b.p === '/rfo/part-19' && !JSON.stringify(b).includes('secret'), JSON.stringify(b));
ok('sends referrer for the server to reduce', b.r.includes('google.com'));
ok('device bucket from viewport', b.d === 'desktop', b.d);
ok('sent via sendBeacon, not fetch', s.posts[0].via === 'beacon');
ok('posts to /api/feedback', s.posts[0].url === '/api/feedback', s.posts[0].url);
ok('no cookie/storage key in payload', !/session|uid|cid|token/i.test(JSON.stringify(b)));

console.log('\n— the app.js contract —');
s = load();
s.doc.dispatchEvent(Object.assign(new Event('acqvault:searched'), { detail: { q: 'Simplified Acquisition Threshold', n: 12 } }));
b = s.bodies()[1];
ok('search event forwarded', b && b.a === 'search', JSON.stringify(b));
ok('carries the query', b.q === 'Simplified Acquisition Threshold');
ok('carries the result count', b.n === 12, b.n);

s.doc.dispatchEvent(Object.assign(new Event('acqvault:searched'), { detail: { q: 'ghost clause', n: 0 } }));
b = s.bodies()[2];
ok('zero-result search sends n=0', b.a === 'search' && b.n === 0, JSON.stringify(b));

s.doc.dispatchEvent(Object.assign(new Event('acqvault:asked'), { detail: { q: 'what is the SAT', n: 3 } }));
ok('ask event forwarded', s.bodies()[3].a === 'ask' && s.bodies()[3].n === 3, JSON.stringify(s.bodies()[3]));

s.doc.dispatchEvent(Object.assign(new Event('acqvault:draweropen'), { detail: {} }));
ok('opening a result is counted', s.bodies()[4].a === 'open');

s.doc.dispatchEvent(Object.assign(new Event('acqvault:mode'), { detail: { mode: 'browse' } }));
ok('browse lane counted', s.bodies()[5].a === 'browse');
s.doc.dispatchEvent(Object.assign(new Event('acqvault:mode'), { detail: { mode: 'fulltext' } }));
ok('fulltext lane counted', s.bodies()[6].a === 'fulltext');
const before = s.posts.length;
s.doc.dispatchEvent(Object.assign(new Event('acqvault:mode'), { detail: { mode: 'search' } }));
ok('default search lane NOT double-counted', s.posts.length === before, s.posts.length + ' vs ' + before);

console.log('\n— guards —');
s = load({ gpc: true });
ok('Global Privacy Control suppresses everything', s.posts.length === 0, s.posts.length);

s = load({ beacon: false });
ok('falls back to fetch when sendBeacon is absent', s.posts.length === 1 && s.posts[0].via === 'fetch');

s = load();
for (let i = 0; i < 200; i++) s.doc.dispatchEvent(Object.assign(new Event('acqvault:draweropen'), { detail: {} }));
ok('per-page ceiling caps a runaway listener', s.posts.length === 60, s.posts.length);

s = load();
s.doc.dispatchEvent(Object.assign(new Event('acqvault:searched'), { detail: null }));
ok('malformed event does not throw', true);

console.log('\n— NEGATIVE TEST —');
const real = fails;
expectFail = true;
ok('deliberately false', false);
expectFail = false;
const caught = fails - real; fails = real;
console.log(caught === 1 ? '  ok    harness detects failures' : '  FAIL  HARNESS IS BLIND');
if (caught !== 1) fails++;

console.log('\n' + (fails ? `${fails} FAILURE(S)` : 'ALL PASS'));
process.exit(fails ? 1 : 0);
