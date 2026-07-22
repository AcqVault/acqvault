// Verify the clause dedup on BOTH sides using the real shipped code, and prove
// scorer parity: the two clauseSuppressSet implementations must produce the SAME set.
const fs = require('fs'), path = require('path'), vm = require('vm');
const BASE = path.join(process.env.HOME, 'Documents/Projects/acqvault');
const { grabFunction } = require(path.join(BASE, 'scripts', 'extract_js_fns.js'));

const docs = JSON.parse(fs.readFileSync(path.join(BASE, 'output/documents.json'), 'utf8'))
  .filter(Boolean).filter(d => d.source !== 'compass');
const entries = docs.map(doc => ({ doc }));

function build(srcFile) {
  const src = fs.readFileSync(path.join(BASE, srcFile), 'utf8');
  const sb = { console };
  vm.createContext(sb);
  vm.runInContext([
    'let clauseSuppressCache = null;',
    grabFunction(src, 'clauseNum'),
    grabFunction(src, 'clauseSuppressSet'),
    ';globalThis.clauseSuppressSet = clauseSuppressSet;',
  ].join('\n'), sb);
  return sb.clauseSuppressSet(entries);
}

const server = build('api/search.js');
const client = build('assets/app.js');

let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  ✗ ' + m); fail++; } else console.log('  ✓ ' + m); };

console.log('CLAUSE DEDUP VERIFICATION\n');
console.log(`  suppress set: server=${server.size}  client=${client.size}`);
ok(server.size === client.size && [...server].every(id => client.has(id)),
   'server and client suppress sets are IDENTICAL (scorer parity)');

const byId = new Map(docs.map(d => [d.id, d]));
// the flagship case
ok(server.has('r-dfars-52-252-204-7022'), 'stale part-52 252.204-7022 suppressed from queries');
ok(server.has('r-dfars-12-252-204-7022'), 'title-only stub 252.204-7022 suppressed from queries');
ok(!server.has('r-dfars-4-252-204-7022'), 'the memo copy (part 4, correct prescription) survives');
// a clause that exists ONLY in part 52 must NOT be suppressed
ok(!server.has('r-dfars-52-252-204-7012'), '252.204-7012 (exists only in part 52) is NOT suppressed');

// nothing suppressed outside r-dfars, and every suppressed doc has a surviving twin
let alien = 0, orphaned = 0;
const clauseOf = t => (String(t).match(/^(252\.\d{3}-\d{4}(?:-\d+)?)\b/) || [])[1];
const surviving = new Map();
for (const d of docs) {
  if (d.source !== 'r-dfars') continue;
  const c = clauseOf(d.title);
  if (c && !server.has(d.id)) surviving.set(c, (surviving.get(c) || 0) + 1);
}
for (const id of server) {
  const d = byId.get(id);
  if (!d || d.source !== 'r-dfars') { alien++; continue; }
  const c = clauseOf(d.title);
  if (!c || !surviving.get(c)) orphaned++;
}
ok(alien === 0, 'nothing suppressed outside r-dfars');
ok(orphaned === 0, 'every suppressed doc leaves a surviving copy of its clause');
// exactly one survivor per clause number
const multi = [...surviving.entries()].filter(([, n]) => n > 1);
ok(multi.length === 0, `exactly one search hit remains per clause number (multi: ${multi.length})`);

// how many of the 13 memo-proven conflicts now resolve to the memo copy
const proven = ["252.204-7010","252.204-7022","252.205-7000","252.211-7002","252.216-7004",
  "252.216-7009","252.225-7039","252.226-7001","252.233-7001","252.236-7011",
  "252.237-7010","252.243-7001","252.243-7002"];
let good = 0;
for (const c of proven) {
  const survivors = docs.filter(d => d.source === 'r-dfars' && clauseOf(d.title) === c && !server.has(d.id));
  if (survivors.length === 1 && survivors[0].part !== '52') good++;
}
ok(good === proven.length, `all ${proven.length} memo-proven conflicts now resolve to the subject-part copy (${good}/${proven.length})`);

console.log(fail ? `\n${fail} CHECK(S) FAILED` : '\nALL DEDUP CHECKS PASSED');
process.exit(fail ? 1 : 0);
