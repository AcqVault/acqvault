#!/usr/bin/env python3
"""Does the SHIPPED study deck still agree with the corpus shipping beside it?

    python3 scripts/deck_health.py

corpus_health.py asks "is the DATA valid?"; render_health.py asks "can the
RENDERERS read it?". Neither looks at assets/study-deck.json, which is a
committed artefact that refresh.py neither rebuilds nor reads. So a corpus edit
could silently invalidate a study card's verbatim quote or deep link, and
nothing would notice until someone happened to re-run build_deck_v2.py.

That is not hypothetical. Rejoining 113 split citations in the corpus rewrote
text that ladder quotes are matched against; five quotes spanned a repaired
span. They survived, but only because they were checked by hand at the time.
This makes the check automatic.

What it asserts about the SHIPPED deck (not the authoring files):
  1. every cite.quote / cites[].quote / dod.quote is verbatim IN THE SECTION IT
     NAMES — scoped per section, not "somewhere in that source", so a right
     quote filed under a wrong section number still fails
  2. every internal link resolves: the part exists AND the #anchor exists on it
  3. the deck's own ids are unique

⚠ The corpus stores a per-line indent prefix (L0:/L1:/…). Any quote spanning a
stored line break contains one mid-sentence, so a naive substring test returns
false negatives — strip the markers before comparing. Getting this wrong made
four perfectly good quotes look broken.
"""
import collections
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DECK = os.path.join(ROOT, 'assets', 'study-deck.json')
DOCS = os.path.join(ROOT, 'output', 'documents.json')

failures = []


def fail(msg, fix=''):
    failures.append((msg, fix))
    print('  FAIL  ' + msg)
    if fix:
        print('        ' + fix)


def strip_markers(s):
    return re.sub(r'(?m)^L\d+:\s*', '', s or '')


def norm(s):
    return re.sub(r'\s+', ' ', s or '').strip()


SRC_OF_LABEL = {'RFO': 'rfo', 'R-DFARS': 'r-dfars', 'PGI': 'pgi', 'DoD SSP': 'ssp',
                'DAFI 63-138': 'afi-63-138', 'FAR Companion': 'far-companion',
                'DoD FMR': 'fmr'}


def src_sec_from_label(t):
    """Board cites carry only a display label ("R-DFARS 216.507-5"), not src/sec."""
    t = (t or '').strip()
    m = re.match(r'^(PGI)\s+([\d.\-]+)', t)
    if m:
        return 'pgi', m.group(2)
    m = re.match(r'^(R-DFARS|RFO|DoD SSP|DAFI 63-138|FAR Companion|DoD FMR)\s+([\d.\-]+)', t)
    return (SRC_OF_LABEL[m.group(1)], m.group(2)) if m else (None, None)


def main():
    deck = json.load(open(DECK))
    raw = json.load(open(DOCS))
    docs = raw if isinstance(raw, list) else raw['documents']

    by_section, anchors, parts = {}, collections.defaultdict(set), collections.defaultdict(set)
    for d in docs:
        m = re.match(r'((?:PGI\s+)?\d{1,3}\.\d{1,4}(?:-\d+)*)', (d.get('title') or '').strip())
        if m:
            by_section.setdefault((d.get('source'), m.group(1).replace('PGI ', '')), []).append(d)
        p = str(d.get('part') or '').strip()
        parts[d.get('source')].add(p)
        anchors[(d.get('source'), p)].add(str(d.get('anchor') or d.get('id')))

    # ── 1. quotes verbatim in the section they name ──────────────────────────
    checked = broken = 0
    for rung, cards in (deck.get('ladder') or {}).items():
        for c in cards:
            for key in ('cite', 'dod'):
                o = c.get(key)
                if not isinstance(o, dict) or not o.get('quote'):
                    continue
                checked += 1
                cand = by_section.get((o.get('src'), o.get('sec')), [])
                if not (cand and any(norm(o['quote']) in norm(strip_markers(d.get('content')))
                                     for d in cand)):
                    broken += 1
                    fail(f'ladder {rung}: {key} quote not verbatim in '
                         f'{o.get("src")} {o.get("sec")} — "{norm(o["quote"])[:58]}"')
    for rung, boards in (deck.get('ladder_boards') or {}).items():
        for b in boards:
            for c in (b.get('cites') or []):
                if not c.get('quote'):
                    continue
                checked += 1
                src, sec = src_sec_from_label(c.get('t'))
                cand = by_section.get((src, sec), [])
                if not (cand and any(norm(c['quote']) in norm(strip_markers(d.get('content')))
                                     for d in cand)):
                    broken += 1
                    fail(f'board {rung}: quote not verbatim in {c.get("t")} — '
                         f'"{norm(c["quote"])[:58]}"')
    if not broken:
        print(f'  PASS  all {checked} deck quotes verbatim in the section they cite')

    # ── 2. every internal link resolves (part AND anchor) ────────────────────
    url_pat = re.compile(r'^/([a-z0-9-]+)/part-([^#]+)(?:#(.+))?$')
    seen_urls = bad_links = 0

    def check_url(u, where):
        nonlocal seen_urls, bad_links
        if isinstance(u, dict):
            u = u.get('u')
        if not isinstance(u, str):
            return
        seen_urls += 1
        m = url_pat.match(u)
        if not m:
            return                      # hub pages like /fmr are legitimate
        src, part, anchor = m.group(1), m.group(2), m.group(3)
        if part not in parts.get(src, ()):
            bad_links += 1
            fail(f'{where}: link to a part that does not exist — {u}')
        elif anchor and anchor not in anchors[(src, part)]:
            bad_links += 1
            fail(f'{where}: link anchor does not exist on that page — {u}')

    def walk(node, where):
        if isinstance(node, dict):
            for k, v in node.items():
                if k == 'link':
                    check_url(v, where)
                elif k in ('links', 'cites') and isinstance(v, list):
                    for it in v:
                        if isinstance(it, dict):
                            check_url(it.get('u') or it.get('link'), where)
                else:
                    walk(v, where)
        elif isinstance(node, list):
            for x in node:
                walk(x, where)

    for pool in deck:
        walk(deck[pool], pool)
    if not bad_links:
        print(f'  PASS  all {seen_urls} deck links resolve to a real part and anchor')

    # ── 3. ids unique across the pools that carry them ───────────────────────
    ids = []
    for pool in ('recall_basic', 'recall_advanced', 'scenarios', 'thresholds'):
        ids += [c.get('id') for c in (deck.get(pool) or []) if c.get('id')]
    for group in ('ladder', 'ladder_boards'):
        for rung, cards in (deck.get(group) or {}).items():
            ids += [c.get('id') for c in cards if c.get('id')]
    dupes = [i for i, n in collections.Counter(ids).items() if n > 1]
    if dupes:
        fail(f'duplicate deck ids: {len(dupes)} — e.g. {dupes[:4]}')
    else:
        print(f'  PASS  all {len(ids)} deck ids unique')

    print()
    if failures:
        print(f'✗ {len(failures)} deck health failure(s) — the shipped deck disagrees with '
              f'the corpus it ships beside.')
        print('  Rebuild with: python3 study-tool/build_deck_v2.py')
        return 1
    print('All deck health checks passed.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
