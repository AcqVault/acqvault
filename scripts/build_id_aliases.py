#!/usr/bin/env python3
"""Map doc ids a corpus update removed to their best successor, into output/id-aliases.json.

Old ids live on in shared links, saved pins and part-page anchors; the app resolves them
through this file (fetchDocumentById, the part-page hash rewrite, the saved-pin migration).

  git show <commit-before-update>:output/documents.json > /tmp/old.json
  python3 scripts/build_id_aliases.py /tmp/old.json        # merges into existing aliases

Scoring is per source, within the same part: the better of shingle containment (old wording
found in the candidate; catches renumbered R-DFARS/PGI sections) and TF-IDF cosine (the FMR
sections are rewritten policy-only digests of the old chapters, so wording rarely survives),
plus title similarity (section number stripped) and a lineage bonus when the new
section number extends the old (201.403 -> 201.403-70). The same number surviving in another
part (clauses in the part 52 library) wins. A weak match outside the old subpart counts as no
successor: the id maps to its surviving parent section, else the nearest section of its
subpart, else the part's first doc (printed as FALLBACK for a hand check). corpus_health.py
fails if any alias target stops existing.
"""
import json, math, re, sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'output' / 'id-aliases.json'
LOW = 0.35
WORD = re.compile(r'[a-z0-9]+')
SECNUM = re.compile(r'^(?:PGI\s+)?(\d{3}\.\d+(?:-\d+)*)\s*')
FMR_PART = re.compile(r'^(2|6|11)[AB]$')
# The FMR edition renamed the Department; without this every title loses a word.
RENAME = {'dod': 'dow', 'defense': 'war'}
# Hand-checked where the score picks the volume's catch-all "General" section.
MANUAL = {
    'fmr-vol-6b-ch-4': 'fmr-vol-6-sec-11', 'fmr-vol-6b-ch-5': 'fmr-vol-6-sec-11',
    'fmr-vol-6b-ch-6': 'fmr-vol-6-sec-11', 'fmr-vol-6b-ch-7': 'fmr-vol-6-sec-11',
    'fmr-vol-6b-ch-12': 'fmr-vol-6-sec-12', 'fmr-vol-2b-ch-10': 'fmr-vol-2-sec-2',
    'fmr-vol-2b-ch-17': 'fmr-vol-2-sec-2', 'fmr-vol-15-ch-1': 'fmr-vol-15-sec-1',
    'fmr-vol-12-ch-14': 'fmr-vol-12-sec-13',
}


def toks(s):
    return [RENAME.get(w, w) for w in WORD.findall((s or '').lower())]


def norm_title(t):
    t = SECNUM.sub('', t or '')
    t = re.sub(r'^(chapter|section)\s+[\d.]+:\s*', '', t, flags=re.I)
    return set(toks(t))


def secnum(t):
    m = SECNUM.match(t or '')
    return m.group(1) if m else ''


def subpart(n):
    """'234.7002' -> '234.70', '225.900-70' -> '225.9', '252.225-7964' -> '252.2'."""
    if not n:
        return ''
    p, sec = n.split('-')[0].split('.')
    return p + '.' + (sec[:2] if len(sec) >= 4 else sec[:1])


def part_key(d):
    p = str(d.get('part', ''))
    if d['source'] == 'fmr':
        m = FMR_PART.match(p)
        if m:
            return m.group(1)          # 2A/2B -> 2 (merged volumes); 7A/7B kept
    return p


def main(old_path):
    old = json.load(open(old_path))
    new = json.load(open(ROOT / 'output' / 'documents.json'))
    new_ids = {d['id'] for d in new}
    gone = [d for d in old if d['id'] not in new_ids]

    def shingles(d):
        w = toks(d.get('content'))
        return {hash(' '.join(w[i:i + 6])) for i in range(max(1, len(w) - 5))}

    docs = new + gone
    df = Counter()
    for d in docs:
        df.update(set(toks(d.get('content'))))
    N = len(docs)

    def tfidf(d):
        tf = Counter(toks(d.get('content')))
        v = {w: (1 + math.log(c)) * math.log(N / df[w]) for w, c in tf.items()}
        n = math.sqrt(sum(x * x for x in v.values())) or 1
        return {w: x / n for w, x in v.items()}

    def cos(a, b):
        if len(a) > len(b):
            a, b = b, a
        return sum(x * b.get(w, 0) for w, x in a.items())

    cache = {}

    def S(d):
        if d['id'] not in cache:
            cache[d['id']] = (shingles(d), tfidf(d))
        return cache[d['id']]

    by_src = {}
    for d in new:
        by_src.setdefault(d['source'], []).append(d)

    def numkey(t):
        return [int(x) for x in re.split(r'[.-]', secnum(t))] if secnum(t) else []

    def prefix_len(a, b):
        n = 0
        for x, y in zip(a, b):
            if x != y:
                break
            n += 1
        return n

    aliases = json.load(open(OUT)) if OUT.exists() else {}
    report = []
    for g in gone:
        gt, gs, gp = norm_title(g['title']), secnum(g['title']), part_key(g)
        best, bscore, bparts = None, -1, None
        part_docs = [c for c in by_src.get(g['source'], []) if part_key(c) == gp]
        sg, vg = S(g)
        gk = numkey(g['title'])
        for c in part_docs:
            ct = norm_title(c['title'])
            tsim = len(gt & ct) / (len(gt | ct) or 1)
            sc, vc = S(c)
            ctn = max(len(sg & sc) / (len(sg) or 1), cos(vg, vc))
            cs = secnum(c['title'])
            lineage = 0.15 if gs and cs and (cs == gs or cs.startswith(gs + '-')) else 0
            # Generic titles ("Policy", "Procedures") recur in every subpart: let the title
            # count fully only near the old section number.
            ck = numkey(c['title'])
            prox = prefix_len(gk, ck) / len(gk) if gk and ck else 1
            score = 0.7 * ctn + 0.3 * tsim * prox + 0.1 * prox + lineage
            if score > bscore:
                best, bscore, bparts = c, score, (tsim, ctn, lineage)
        # A weak match only counts inside the old subpart; leaving it takes real content overlap.
        same_sub = not gs or (best is not None and subpart(secnum(best['title'])) == subpart(gs))
        fallback = best is None or not ((same_sub and bscore >= LOW) or bparts[1] >= 0.6)
        if fallback and part_docs:
            # No successor: the parent section if it survives (225.7021-2 -> 225.7021), else the
            # nearest surviving section of the same subpart, else the part's first doc.
            sub = [c for c in part_docs if gs and subpart(secnum(c['title'])) == subpart(gs)]
            parents = [c for c in sub if gs.startswith(secnum(c['title']) + '-')]
            if parents:
                best = max(parents, key=lambda c: len(secnum(c['title'])))
            elif sub:
                before = [c for c in sub if numkey(c['title']) <= gk]
                best = max(before, key=lambda c: numkey(c['title'])) if before else \
                    min(sub, key=lambda c: numkey(c['title']))
            else:
                best = part_docs[0]
        # The same number surviving elsewhere in the source wins outright: clauses dropped from
        # a part's deviation text still live in the part 52 clause library (252.216-7004).
        twin = gs and next((c for c in by_src.get(g['source'], []) if secnum(c['title']) == gs
                            and not norm_title(c['title']) <= {'reserved'}), None)
        if twin and (fallback or not bparts[2]) and \
                len(gt & norm_title(twin['title'])) / (len(gt | norm_title(twin['title'])) or 1) >= 0.5:
            best, bscore, fallback = twin, 1.0, False
        if g['id'] in MANUAL:
            best, fallback = next(c for c in part_docs if c['id'] == MANUAL[g['id']]), False
        if best is None:
            continue
        aliases[g['id']] = best['id']
        report.append((round(bscore, 3), fallback, g['id'], g['title'][:60], best['id'], best['title'][:60], bparts))

    # Collapse chains (an alias target removed by a later update) and drop live ids.
    for k in list(aliases):
        seen = {k}
        while aliases[k] in aliases and aliases[k] not in seen:
            seen.add(aliases[k])
            aliases[k] = aliases[aliases[k]]
        if k in new_ids:
            del aliases[k]
    OUT.write_text(json.dumps(dict(sorted(aliases.items())), indent=0, ensure_ascii=False) + '\n')
    report.sort()
    for r in report:
        print(('FALLBACK ' if r[1] else '') + f'{r[0]:.3f}  {r[2]} [{r[3]}]  ->  {r[4]} [{r[5]}]  t={r[6] and round(r[6][0],2)} c={r[6] and round(r[6][1],2)} l={r[6] and r[6][2]}')
    print(f'{len(report)} aliases written ({sum(r[1] for r in report)} part fallbacks, '
          f'{sum(1 for r in report if not r[1] and r[0] < 0.6)} below 0.6)', file=sys.stderr)


if __name__ == '__main__':
    main(sys.argv[1])
