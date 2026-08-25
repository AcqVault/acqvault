#!/usr/bin/env python3
"""Regenerate assets/offices.json — the DoD contracting-office picker list.

USASpending's agency endpoint returns awarding offices as children of each DoD
sub-agency, and an office only appears in a fiscal year it actually obligated in,
so the union over recent years IS the "still alive" filter — there is no status
flag to read. Codes are the 6-character DoDAACs the Contract Awards API takes.

Only toptier 097 works: Air Force/Navy/Army are sub-agencies under DoD, not
toptiers of their own (057/017/021 all 404).

    python3 scripts/fetch_offices.py        # writes assets/offices.json
"""
import json, re, sys, datetime, urllib.request, collections, pathlib

API = 'https://api.usaspending.gov/api/v2/agency/097/sub_agency/?fiscal_year={}&limit=100'
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'offices.json'
# Six years back matches the fiscal-year picker's span; an office that has not
# obligated since is not one anybody is pulling a report for.
YEARS = 6


def fetch(fy):
    req = urllib.request.Request(API.format(fy), headers={'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def clean(code, name):
    """AF and Army prefix the office name with its own code, irregularly spaced."""
    n = re.sub(r'^\s*' + re.escape(code) + r'\s+', '', str(name or ''))
    return re.sub(r'\s{2,}', ' ', n).strip()


def main():
    cur = datetime.date.today()
    cur_fy = cur.year + (1 if cur.month >= 10 else 0)
    # code -> [name, agency, txn_count]; later years overwrite the name (most current)
    offices = {}
    agencies = {}
    for fy in range(cur_fy - YEARS + 1, cur_fy + 1):
        try:
            data = fetch(fy)
        except Exception as e:                      # a single bad year must not lose the rest
            print('  ! FY%d failed: %s' % (fy, e), file=sys.stderr)
            continue
        for sub in data.get('results', []):
            abbr = sub.get('abbreviation') or sub.get('name') or '?'
            agencies[abbr] = sub.get('name') or abbr
            for ch in sub.get('children', []):
                code = str(ch.get('code') or '').strip().upper()
                if len(code) != 6:
                    continue
                name = clean(code, ch.get('name'))
                txns = int(ch.get('transaction_count') or 0)
                prev = offices.get(code)
                if prev:
                    prev[2] += txns
                    if name:
                        prev[0] = name
                else:
                    offices[code] = [name or code, abbr, txns]
        print('  FY%d: %d offices so far' % (fy, len(offices)))

    if len(offices) < 500:
        sys.exit('refusing to write: only %d offices found (expected >1000)' % len(offices))

    by_agency = collections.defaultdict(list)
    for code, (name, abbr, txns) in offices.items():
        by_agency[abbr].append((txns, code, name))
    groups = []
    for abbr in sorted(by_agency, key=lambda a: -sum(t for t, _, _ in by_agency[a])):
        rows = sorted(by_agency[abbr], key=lambda r: (-r[0], r[1]))
        groups.append({'a': abbr, 'n': agencies.get(abbr, abbr),
                       'o': [[c, n] for _, c, n in rows]})

    OUT.write_text(json.dumps({
        'generated': cur.isoformat(),
        'source': 'USASpending.gov awarding offices, FY%d-FY%d' % (cur_fy - YEARS + 1, cur_fy),
        'count': len(offices),
        'groups': groups,
    }, separators=(',', ':')) + '\n')
    print('wrote %s — %d offices in %d agencies, %d bytes'
          % (OUT.relative_to(ROOT), len(offices), len(groups), OUT.stat().st_size))


if __name__ == '__main__':
    main()
