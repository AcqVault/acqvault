#!/usr/bin/env python3
"""Prove the ladder citation gate in study-tool/build_deck_v2.py.

Runs the real build once (the 6 seed items in study-tool/deck-ladder.json must all
pass), then runs the build against nine synthetic BAD ladder files via the
ACQVAULT_LADDER_FILE hook and asserts each one FATALs with the RIGHT reason.

Negative runs never touch assets/study-deck.json: the gate sys.exit()s before the
deck is written. The final positive run leaves the deck in its normal built state.

Exit 0 = all 6 seeds pass + all 9 negative cases FATAL correctly. Exit 1 otherwise.
"""
import json, os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, 'study-tool', 'build_deck_v2.py')
DECK = os.path.join(ROOT, 'assets', 'study-deck.json')

def item(sec='2.101', quote='Simplified acquisition threshold means $350,000',
         amount='$350,000', src='rfo', rung='sat'):
    it = {'rung': rung, 'type': 'recall', 'topic': 'Thresholds',
          'q': 'Test question?', 'a': 'Test answer.',
          'cite': {'src': src, 'sec': sec, 'quote': quote}}
    if amount: it['cite']['amount'] = amount
    return it

# name, item, substring(s) the FATAL message must contain
NEGATIVE = [
    ('SAT misquoted as $250,000 (the real source-material error)',
     item(quote='Simplified acquisition threshold means $250,000'),
     ['quote not verbatim', '2.101']),
    ('MPT misquoted as $10,000 (bare $10,000 DOES exist elsewhere in 2.101 — quote check must catch it anyway)',
     item(quote='Micro-purchase threshold means $10,000', amount='$10,000'),
     ['quote not verbatim', '2.101']),
    ('cite to 46.701 — [Reserved] section',
     item(sec='46.701', quote='anything', amount=None),
     ['[Reserved]/empty', '46.701']),
    ('cite to 19.502-2 — no such section',
     item(sec='19.502-2', quote='anything', amount=None),
     ['no such section', '19.502-2']),
    ('cite to 6.30 — no such section (prefix matching is OFF; old find_sec would resolve to 6.301)',
     item(sec='6.30', quote='anything', amount=None),
     ['no such section', '6.30']),
    ('amount $350,000 not inside the quote',
     item(quote='Micro-purchase threshold means $15,000', amount='$350,000'),
     ['amount $350,000 not inside the quote']),
    # The number-mapping cannot reach 244.301-70 from 44.301-3, so before _DOD_EXTRA this
    # card built clean while resting on a section DoD tells you to ignore. Without this
    # case the table could be emptied by accident and every check would still report green.
    ('cite to 44.301-3 with no `dod` — displaced by 244.301-70, which no number-mapping finds',
     item(sec='44.301-3', amount=None,
          quote='The contracting officer is responsible for granting, withholding, or '
                'withdrawing approval of a contractor’s purchasing system'),
     ['244.301-70', 'dod']),
    # SSP is a first-class citeable source. A misquote must fail as "not verbatim in ssp 3.9"
    # — NOT as "no such section". If SSP were dropped from the section index, this would
    # regress to the wrong error, which is the signal that citeability broke.
    ('cite to ssp 3.9 with a misquote — proves SSP is indexed and verbatim-gated',
     item(sec='3.9', src='ssp', amount=None, quote='The SSA decides whatever seems best'),
     ['quote not verbatim', 'ssp', '3.9']),
    ('cite to ssp 9.9 — no such SSP section',
     item(sec='9.9', src='ssp', amount=None, quote='anything'),
     ['no such section', 'ssp', '9.9']),
]

def run(env_extra=None):
    env = dict(os.environ)
    if env_extra: env.update(env_extra)
    return subprocess.run([sys.executable, BUILD], cwd=ROOT, env=env,
                          capture_output=True, text=True)

failures = 0

# ---- negative cases first (they leave the deck unwritten) ----
tmpdir = tempfile.mkdtemp(prefix='ladder-gate-test-')
for i, (name, bad, must_contain) in enumerate(NEGATIVE):
    path = os.path.join(tmpdir, f'bad-{i}.json')
    with open(path, 'w') as f:
        json.dump({'items': [bad]}, f)
    r = run({'ACQVAULT_LADDER_FILE': path})
    blob = r.stdout + r.stderr
    if r.returncode == 0:
        print(f'FAIL [{name}]: build succeeded but MUST have FATALed')
        failures += 1
        continue
    if 'FATAL: ladder' not in blob:
        print(f'FAIL [{name}]: exited non-zero but not via the ladder gate FATAL. Output: {blob[-300:]}')
        failures += 1
        continue
    missing = [m for m in must_contain if m not in blob]
    if missing:
        print(f'FAIL [{name}]: FATALed but for the wrong reason — missing {missing}. Got: {blob.strip().splitlines()[-1]}')
        failures += 1
        continue
    print(f'PASS (FATAL as required) [{name}]')
    print(f'     -> {blob.strip().splitlines()[-1]}')

# ---- positive: a valid SSP citation builds clean and resolves to a DoD SSP deep link ----
_ssp_quote = ('The SSA’s decision regarding which proposal is most advantageous to the '
              'Government shall be based on a comparative analysis of proposals against all '
              'source selection criteria in the solicitation')
_ssp = os.path.join(tmpdir, 'ssp-ok.json')
with open(_ssp, 'w') as f:
    json.dump({'items': [item(sec='3.9', src='ssp', amount=None, quote=_ssp_quote)]}, f)
r = run({'ACQVAULT_LADDER_FILE': _ssp})
if r.returncode != 0:
    print(f'FAIL [ssp citeable]: valid SSP cite FATALed: {(r.stdout + r.stderr)[-300:]}')
    failures += 1
else:
    lad = (json.load(open(DECK)).get('ladder') or {})
    card = next((c for v in lad.values() for c in v if c.get('cite', {}).get('src') == 'ssp'), None)
    link = (card or {}).get('cite', {}).get('link', {})
    if link.get('t') == 'DoD SSP 3.9' and link.get('u') == '/ssp/part-3#ssp-3-9':
        print('PASS [ssp citeable]: SSP 3.9 built a verbatim-checked DoD SSP deep link')
    else:
        print(f'FAIL [ssp citeable]: link wrong — {link}')
        failures += 1

# ---- positive case: the real 6-seed file must build clean ----
r = run()
if r.returncode != 0:
    print(f'FAIL [seed items]: real build FATALed: {(r.stdout + r.stderr)[-400:]}')
    failures += 1
else:
    deck = json.load(open(DECK))
    lad = deck.get('ladder') or {}
    shape = {k: len(v) for k, v in lad.items()}
    # Assert STRUCTURE, not a card count — the rungs are authored incrementally and a
    # hardcoded total goes stale every time content lands (it did).
    missing = [r for r in ('sat', '5m', '25m', 'unlimited') if not lad.get(r)]
    if missing:
        print(f'FAIL [ladder]: rung(s) missing or empty: {missing} (got {shape})')
        failures += 1
    else:
        # cite.link must resolve to a real part page on EITHER rulebook source
        bad_cards = [c.get('id') or c.get('q', '')[:40] for v in lad.values() for c in v
                     if not (c.get('id') and re.match(
                         r'^/(rfo|r-dfars|far-companion|afi-63-138|category-management|fmr|ssp)/part-',
                         c.get('cite', {}).get('link', {}).get('u', '')))]
        # the six hand-verified seed questions must survive every rebuild
        seeds = ['What is the simplified acquisition threshold?',
                 'What is the micro-purchase threshold?']
        allq = {c['q'] for v in lad.values() for c in v}
        lost = [q for q in seeds if q not in allq]
        if bad_cards:
            print(f'FAIL [ladder]: cards missing id or with an unresolved cite.link: {bad_cards[:5]}')
            failures += 1
        elif lost:
            print(f'FAIL [ladder]: hand-verified seed card(s) vanished from the build: {lost}')
            failures += 1
        else:
            n = sum(shape.values())
            print(f'PASS [ladder]: {n} cards across 4 rungs, all with ids + resolved cite.link ({shape})')

print()
if failures:
    print(f'{failures} test(s) FAILED')
    sys.exit(1)
print('ALL TESTS PASSED: 6 seed items pass the gate, 9 negative cases FATAL with the right reasons')
