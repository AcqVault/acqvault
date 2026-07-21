#!/usr/bin/env python3
"""Gate for the source-selection simulator's citations.

Every citation the simulator shows as the governing rule must be a VERBATIM
quote at a section that ACTUALLY EXISTS in the live corpus, and its deep link
must resolve to the real in-app anchor. This is the same trust bar the Warrant
Ladder holds (build_deck_v2.py ladder_gate): a citation that has silently
rotted is worse than no citation, because it looks settled.

Reads:  assets/source-selection.json  +  output/documents.json
Checks each cite (every phase + ratingCite):
  1. Section exists   — SSP keyed by its label (SSP_SEC), RFO/others by title prefix.
  2. Quote verbatim   — whitespace-normalized substring of the section content.
  3. Link resolves    — cite.u equals /<src>/part-<part>#<anchor-or-id> for that doc.
FATAL (exit 1) on any failure, printing every problem found. Run before every ship.
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCEN = os.path.join(ROOT, 'assets', 'source-selection.json')
CORPUS = os.path.join(ROOT, 'output', 'documents.json')

SSP_SEC = re.compile(r'^([1-5]\.\d+|[A-E]\.\d+|[1-5]|[A-E])\b')


def norm(s):
    return re.sub(r'\s+', ' ', (s or '')).strip()


def build_index(docs):
    """(src, sec) -> doc, mirroring build_deck_v2.py.

    SSP keys off the section label at the head of the title (1.3, 5, A.1).
    Everything else keys off the leading token of the title (e.g. '52.215-1').
    """
    idx = {}
    for d in docs:
        src = d.get('source')
        title = d.get('title') or ''
        if src == 'ssp':
            m = SSP_SEC.match(title.strip())
            if m:
                idx.setdefault((src, m.group(1)), d)
        else:
            tok = title.strip().split()
            if tok:
                idx.setdefault((src, tok[0]), d)
    return idx


def cite_list(scen):
    """Yield (where, cite) for every citation the sim renders."""
    if scen.get('ratingCite'):
        yield 'ratingCite', scen['ratingCite']
    for ph in scen.get('phases', []):
        for c in ph.get('cites', []):
            yield 'phase %s (%s)' % (ph.get('n'), ph.get('title')), c


def main():
    scen = json.load(open(SCEN, encoding='utf-8'))
    docs = json.load(open(CORPUS, encoding='utf-8'))
    idx = build_index(docs)

    errors = []
    checked = 0
    for where, c in cite_list(scen):
        checked += 1
        src, sec, quote, u = c.get('src'), c.get('sec'), c.get('quote'), c.get('u')
        tag = '[%s] %s %s' % (where, src, sec)

        d = idx.get((src, sec))
        if not d:
            errors.append('%s: NO SUCH SECTION in corpus' % tag)
            continue

        if norm(quote) not in norm(d.get('content')):
            errors.append('%s: quote NOT VERBATIM in the section\n     quote: %r' % (tag, (quote or '')[:90]))

        part = str(d.get('part') or '').strip()
        frag = d.get('anchor') or d['id']
        want = '/%s/part-%s#%s' % (src, part, frag)
        if u != want:
            errors.append('%s: link MISMATCH\n     have: %s\n     want: %s' % (tag, u, want))

    if errors:
        print('FATAL: source-selection citation gate failed (%d of %d cites bad):\n' % (len(errors), checked))
        for e in errors:
            print('  - ' + e)
        sys.exit(1)

    print('OK: all %d source-selection citations verbatim, sections exist, links resolve.' % checked)


if __name__ == '__main__':
    main()
