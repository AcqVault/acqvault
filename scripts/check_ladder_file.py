#!/usr/bin/env python3
"""Validate ONE ladder authoring file against the corpus — read-only.

    python3 scripts/check_ladder_file.py study-tool/deck-ladder-sat.json

Runs the same assertions as the build's ladder_gate (exact section, not
[Reserved]/empty, quote verbatim, amount inside the quote) plus the DoD-overlay
report, but writes nothing. Exists so several authors can work different rungs
at once without racing each other on assets/study-deck.json.

Exit 0 = the file would pass the build. Exit 1 = it would FATAL.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def norm(t):
    return re.sub(r'\s+', ' ', re.sub(r'\bL\d+:', ' ', t)).strip()


def main(path):
    docs = json.load(open(os.path.join(ROOT, 'output', 'documents.json')))

    sec_idx, dod_idx = {}, {}
    for d in docs:
        src = d.get('source')
        if src not in ('rfo', 'r-dfars'):
            continue
        m = re.match(r'^(\d{1,3}\.[\d.-]+)', d['title'])
        if not m:
            continue
        num = m.group(1).rstrip('.-')
        want = num.split('.')[0]
        if src == 'r-dfars':
            dod_idx.setdefault(num, d)
            if want.startswith('2') and len(want) == 3:
                want = str(int(want) - 200)
        if str(d.get('part') or '').strip() == want:
            sec_idx[(src, num)] = d

    items = json.load(open(path))['items']
    fails, unreviewed = [], []

    for it in items:
        tag = (it.get('q') or '(no q)')[:56]
        for f in ('rung', 'type', 'topic', 'q', 'a', 'cite'):
            if not it.get(f):
                fails.append(f'{tag}: missing field "{f}"')
                continue
        cite = it.get('cite') or {}
        for f in ('src', 'sec', 'quote'):
            if not cite.get(f):
                fails.append(f'{tag}: missing cite.{f}')
        if not cite.get('src') or not cite.get('sec'):
            continue

        d = sec_idx.get((cite['src'], cite['sec']))
        if not d:
            fails.append(f'{tag}: no such section {cite["src"]} {cite["sec"]} (exact match required)')
            continue

        body, title = norm(d['content']), norm(d['title'])
        if body.lower().startswith(title.lower()):
            body = body[len(title):].strip(' .')
        if '[Reserved]' in d['title'] or len(body) < 40:
            fails.append(f'{tag}: {cite["src"]} {cite["sec"]} is [Reserved]/empty')
            continue
        if norm(cite['quote']) not in norm(d['content']):
            fails.append(f'{tag}: quote not verbatim in {cite["src"]} {cite["sec"]}')
        if cite.get('amount') and cite['amount'] not in cite['quote']:
            fails.append(f'{tag}: amount {cite["amount"]} not inside the quote')

        # A `dod` object must itself be verbatim — nothing else checks it, and an
        # unverified DoD quote is exactly the claim a reader would most rely on.
        dod = it.get('dod')
        if isinstance(dod, dict):
            for f in ('src', 'sec', 'quote'):
                if not dod.get(f):
                    fails.append(f'{tag}: dod.{f} missing')
            if dod.get('sec'):
                dd = sec_idx.get((dod.get('src', 'r-dfars'), dod['sec'])) or dod_idx.get(dod['sec'])
                if not dd:
                    fails.append(f'{tag}: dod cites no such section {dod["sec"]}')
                elif norm(dod.get('quote', '')) not in norm(dd['content']):
                    fails.append(f'{tag}: dod quote not verbatim in {dod["sec"]}')
        elif dod is not None and dod != 'n/a':
            fails.append(f'{tag}: dod must be an object or the string "n/a", got {dod!r}')

        # DoD overlay: does an RFO cite sit on a section R-DFARS supplements?
        # DoD-unique sections carry -70/-170/-270/-970 suffixes and do NOT mirror the
        # RFO number, so an exact-match lookup silently misses them. That hole hid a
        # brand-name card that told DoD readers the opposite of their own rule.
        if cite['src'] == 'rfo' and not it.get('dod'):
            head, _, tail = cite['sec'].partition('.')
            if head.isdigit() and tail:
                base = '2%02d.%s' % (int(head), tail)
                for key in sorted(dod_idx):
                    if key != base and not key.startswith(base + '-'):
                        continue
                    if key != base:
                        suf = key[len(base) + 1:]
                        if not (suf.isdigit() and int(suf) >= 70):
                            continue          # a normal child section, not a DoD-unique one
                    if len(norm(dod_idx[key]['content'])) >= 160:
                        unreviewed.append((key, tag))
                        break

    print(f'{os.path.basename(path)}: {len(items)} cards')
    if fails:
        print(f'\n  {len(fails)} GATE FAILURE(S) — the build would FATAL:')
        for f in fails:
            print(f'    {f}')
    else:
        print('  gate: all cites verify (exact section, verbatim quote)')

    if unreviewed:
        print(f'\n  {len(unreviewed)} card(s) still need a `dod` field:')
        for sec, q in unreviewed:
            print(f'    R-DFARS {sec:<13} {q}')
    else:
        print('  DoD overlay: every RFO cite with a supplement is reviewed')

    return 1 if fails else 0


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1]))
