#!/usr/bin/env python3
"""Find DoD supplements the ladder gate is structurally blind to.

The gate in build_deck_v2.py maps an RFO section to its DoD counterpart by
NUMBER — 6.104-2 -> 206.104-2, 6.103 -> 206.103-170, 15.103-2 -> 215.103-270.
That covers every supplement that mirrors the section it changes, and misses
every supplement that does not: 206.104-71 displaces FAR 6.104-2, 244.301-70
displaces FAR 44.301-3, and no arithmetic on those digits connects them.

This script closes that gap for the class that can be closed. It scans R-DFARS
content for an explicit FAR/RFO section reference sitting inside deviation
language, discards the pairs the number-mapping already covers, and prints what
is left.

WHAT IT CANNOT SEE, and no amount of pattern work will fix: a supplement that
changes the answer without ever naming the section it changes. R-DFARS 235.170
"Contracting methods and contract type" bears on FAR 16.102 "Negotiating
contract type" and cites neither it nor any other FAR section — the connection
is subject matter, not text. (16.102 does have a mirrored supplement at
216.102, so the gate is not blind to that section; but a card resting on it
could still miss what 235.170 says about development programs.) Title
similarity across 2,154 R-DFARS documents is far too noisy to gate on, so that
class stays a reading problem. Do not mistake a clean run here for coverage of
it.

It is a DISCOVERY tool, not a gate. Its output is candidates for a human to
read, because "in lieu of" in a sentence does not by itself mean the cited
section is the thing being displaced — a supplement often cites FAR as the
authority it is FOLLOWING. Confirmed pairs get promoted by hand into
_DOD_EXTRA in build_deck_v2.py, which the FATAL gate does consult.

Usage:
    python3 scripts/reverse_dod_index.py            # candidates the table lacks
    python3 scripts/reverse_dod_index.py --all      # every candidate, seeded or not
    python3 scripts/reverse_dod_index.py --cards    # which ladder cards each would touch
"""
import json
import os
import re
import sys
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Deviation language, and the reference must sit next to it — "in lieu of FAR 6.104-1(b)"
# is a displacement; "in accordance with the requirements of FAR 6.104" one clause later in
# the same sentence is the opposite, an instruction to go and comply with it. Matching the
# sentence rather than the phrase is what produced most of the noise on the first pass.
_REF = r'(?:FAR|RFO)\s+(\d{1,2}\.\d[\d.\-]*)'
DISPLACES = [
    re.compile(r'in lieu of (?:the [a-z ]+ at )?' + _REF, re.I),
    re.compile(r'notwithstanding ' + _REF, re.I),
    re.compile(r'instead of (?:the [a-z ]+ at )?' + _REF, re.I),
    re.compile(r'\buse this section instead of ' + _REF, re.I),
    re.compile(_REF + r'[^.;]{0,60}?\b(?:does|do|shall) not apply', re.I),
    re.compile(r'(?:in addition to|except for) (?:the [a-z ]+ at )?' + _REF, re.I),
]
# A reference that is definitional or a pointer, never a displacement.
BENIGN = re.compile(r'within the meaning of|as defined in|as described in|see also', re.I)


def load_docs():
    p = os.path.join(ROOT, 'output', 'documents.json')
    with open(p) as f:
        return json.load(f)


def own_section(doc):
    m = re.match(r'^(\d{3}\.[\d.\-]+)', doc['title'])
    return m.group(1) if m else None


def mirrors(far, dfars):
    """The number-mapping the gate already performs. Keep in step with _dod_supplements."""
    head, _, tail = far.partition('.')
    if not head.isdigit() or not tail:
        return False
    base = '2%02d.%s' % (int(head), tail)
    if dfars == base:
        return True
    if not dfars.startswith(base):
        return False
    rest = dfars[len(base):]
    if rest.startswith('-'):
        rest = rest[1:]
    return rest.isdigit() and len(rest) <= 3 and int(rest) >= 70


def build_index(docs):
    """{far_section: {dfars_section: evidence_sentence}} for non-mirrored displacements."""
    out = {}
    for d in docs:
        if d.get('source') != 'r-dfars':
            continue
        sec = own_section(d)
        # 252.x are contract clauses, not agency deviations to a FAR section.
        if not sec or sec.startswith('252.'):
            continue
        for sent in re.split(r'(?<=[.;])\s+', d.get('content', '')):
            if BENIGN.search(sent):
                continue
            for pat in DISPLACES:
                for m in pat.finditer(sent):
                    far = m.group(1).rstrip('.-')
                    # FAR 52.x is a clause; substituting a clause is a prescription change,
                    # tracked separately from a rule that changes the answer to a question.
                    if far.startswith('52.'):
                        continue
                    if mirrors(far, sec):
                        continue
                    out.setdefault(far, {}).setdefault(sec, ' '.join(sent.split())[:200])
    return out


def load_seeded():
    """Pairs the build already knows about, in either of its two states.

    Returns (gated, waived) — gated pairs make the FATAL check fire; waived ones were read
    and deliberately left ungated, each with a written reason. Both count as reviewed, so
    only genuinely new findings carry a `*` and the report stays worth reading.
    """
    src = open(os.path.join(ROOT, 'study-tool', 'build_deck_v2.py')).read()
    gated = {}
    m = re.search(r'_DOD_EXTRA\s*=\s*\{(.*?)\n\}', src, re.S)
    if m:
        for far, rest in re.findall(r"'([\d.\-]+)'\s*:\s*\[([^\]]*)\]", m.group(1)):
            gated[far] = set(re.findall(r"'([\d.\-]+)'", rest))
    waived = {}
    m = re.search(r'_DOD_REVIEWED_NO_GATE\s*=\s*\{(.*?)\n\}', src, re.S)
    if m:
        for far, dfars in re.findall(r"\('([\d.\-]+)',\s*'([\d.\-]+)'\)", m.group(1)):
            waived.setdefault(far, set()).add(dfars)
    return gated, waived


def ladder_cards():
    items = []
    for p in sorted(glob.glob(os.path.join(ROOT, 'study-tool', 'deck-ladder*.json'))):
        if os.path.basename(p).startswith('deck-ladder-board-'):
            continue
        with open(p) as f:
            items += json.load(f)['items']
    return items


def main():
    show_all = '--all' in sys.argv
    show_cards = '--cards' in sys.argv
    docs = load_docs()

    rd = [d for d in docs if d.get('source') == 'r-dfars']
    assert rd, 'no r-dfars documents in the corpus — wrong file or a broken build'

    idx = build_index(docs)
    gated, waived = load_seeded()
    seeded = {far: gated.get(far, set()) | waived.get(far, set())
              for far in set(gated) | set(waived)}

    # Two known-good non-mirrored pairs, both verified by reading the section. If a future
    # tightening of the patterns drops either, the script has stopped doing its one job.
    # (An earlier version asserted on 235.170 -> 16.102, which this scan can never find,
    # because 235.170 names no FAR section at all. The assertion caught that claim.)
    for far, dfars in (('44.301-3', '244.301-70'), ('27.404-5', '203.104-4')):
        assert dfars in idx.get(far, {}), (
            'regression: R-DFARS %s displaces FAR %s in plain text and the scan no longer '
            'finds it' % (dfars, far))

    unseeded = {far: sup for far, sup in idx.items()
                if show_all or not set(sup) <= seeded.get(far, set())}

    reviewed = sum(1 for f in idx if set(idx[f]) <= seeded.get(f, set()))
    print('non-mirrored displacement candidates: %d (%d reviewed: %d gated, %d waived)'
          % (len(idx), reviewed, len(gated), sum(len(v) for v in waived.values())))
    if not unseeded:
        print('  nothing unreviewed — every candidate is either gated or waived with a reason')
    for far in sorted(unseeded):
        for dfars, ev in sorted(unseeded[far].items()):
            if dfars in gated.get(far, set()):
                mark = 'G'
            elif dfars in waived.get(far, set()):
                mark = 'w'
            else:
                mark = '*'
            print('%s %-10s <- R-DFARS %-14s %s' % (mark, far, dfars, ev[:110]))

    if show_cards:
        cards = ladder_cards()
        print('\nladder cards sitting on a candidate section:')
        hit = 0
        for it in cards:
            c = it.get('cite', {})
            if c.get('src') != 'rfo' or c.get('sec') not in idx:
                continue
            hit += 1
            dod = it.get('dod')
            state = 'none' if dod is None else ('n/a' if dod == 'n/a' else dod.get('sec'))
            print('  [%-9s] RFO %-10s dod=%-13s %s'
                  % (it['rung'], c['sec'], state, it['q'][:56]))
        if not hit:
            print('  none')
    print('\nG = gated in _DOD_EXTRA · w = read and waived with a reason · * = unreviewed.')
    print('Read the section before promoting a `*`: a supplement often cites FAR as the '
          'authority it follows, not the rule it displaces.')
    if unseeded and any(d not in gated.get(f, set()) and d not in waived.get(f, set())
                        for f in unseeded for d in unseeded[f]):
        sys.exit(1)   # unreviewed findings are a non-zero exit, so CI or a hook can see them


if __name__ == '__main__':
    main()
