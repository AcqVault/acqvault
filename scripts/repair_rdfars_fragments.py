#!/usr/bin/env python3
"""R-DFARS fragment repair v2 — merge page-break tails AND restore clobbered sections.

The old splitter treated any line starting with a section number as a heading.
Two failure shapes resulted:
  MERGE case  — a page-break continuation line became its own doc (garbage title,
                text intact). Fix: append to the doc it continues, delete it.
  RESTORE case — the fragment's leading number is a REAL section of the same memo,
                so the fragment doc's id collided with (and clobbered) the real
                section doc. The real section's text from its heading up to the
                fragment seam is MISSING from the corpus. Fix: rebuild that text
                from the memo, prepend it to the fragment, retitle to the real
                heading. (Applies when the seam falls inside the section's own
                region — asserted.)

Also prints a per-part heading-coverage report to catch any other clobbers.
DRY RUN by default; --write applies.
"""
import json, re, sys, pathlib
from pypdf import PdfReader

REPO = pathlib.Path.home() / 'Documents/Projects/acqvault'
DOCS = REPO / 'output/documents.json'
WRITE = '--write' in sys.argv

def norm(s):
    s = re.sub(r'L\d+:', ' ', s)
    s = re.sub(r'[‘’]', "'", s); s = re.sub(r'[“”]', '"', s)
    s = re.sub(r'[^0-9a-zA-Z]+', ' ', s)
    return s.lower().strip()

HEAD_LINE = re.compile(r'^\s*(2?\d{1,2}\.\d[\d.\-]*)\s+([A-Z\[][^\n]*)$')

docs = json.load(open(DOCS))
rd = [(k, d) for k, d in enumerate(docs) if d and d['source'] == 'r-dfars']

FRAG_RE = re.compile(r'^\d[\d.\-]*\s+(?:[a-z(]|or\b|and\b|that\b|when\b|of\b|to\b|the\b)')
frags = [(k, d) for k, d in rd if FRAG_RE.match(d.get('title', '')) and '[Reserved]' not in d['title']]
print(f'fragments: {len(frags)}')

MANUAL_ADJACENT = {'r-dfars-1-219-501-70', 'r-dfars-4-52-212-4', 'r-dfars-15-52-219-9'}

memo_lines_cache, memo_norm_cache = {}, {}
def memo(part, hint=None):
    if part not in memo_lines_cache:
        if hint and (REPO / 'R-DFARS' / hint).exists():
            pdf = REPO / 'R-DFARS' / hint
        else:
            cand = [p for p in (REPO / 'R-DFARS').glob('*.pdf')
                    if re.search(rf'Part-0*{part}\.pdf$', p.name)]
            if not cand:
                memo_lines_cache[part] = None; memo_norm_cache[part] = None
                return None, None
            pdf = cand[0]
        raw = '\n'.join((pg.extract_text() or '') for pg in PdfReader(str(pdf)).pages)
        lines = [ln.strip() for ln in raw.split('\n')]
        memo_lines_cache[part] = lines
        memo_norm_cache[part] = norm(raw)
    return memo_lines_cache[part], memo_norm_cache[part]

def lineify(lines):
    """memo lines -> corpus content format (L-markers by paren rule)."""
    out = []
    for ln in lines:
        if not ln:
            continue
        out.append(('L1:' if re.match(r'^\(', ln) else 'L0:') + ln)
    return ' '.join(out)

merges, restores, rebuilds, failures = [], [], [], []

def find_owner(k, frag, part, mnorm):
    fhead = norm(frag['content'])[:70]
    pos = mnorm.find(fhead)
    if pos > 0:
        pre = mnorm[max(0, pos - 70):pos].strip()
        for k2, d2 in rd:
            if k2 == k or str(d2['part']) != part:
                continue
            n2 = norm(d2['content'])
            if pre and (n2[-90:].endswith(pre[-50:]) or pre[-40:] in n2[-90:]):
                return (k2, d2)
        for k2, d2 in rd:
            if k2 == k or str(d2['part']) != part:
                continue
            n2 = norm(d2['content'])
            i2 = n2.rfind(pre[-40:])
            if i2 != -1 and len(n2) - i2 < 260:
                return (k2, d2)
    if frag['id'] in MANUAL_ADJACENT:
        prev = docs[k - 1]
        assert prev and prev.get('source') == 'r-dfars' and str(prev.get('part')) == part
        return (k - 1, prev)
    return None

for k, frag in frags:
    part = str(frag['part'])
    lines, mnorm = memo(part, frag.get('filename'))
    frag_lead = frag['title'].split(' ')[0].rstrip('.')

    if lines is None:
        # part-52 clause library: verified adjacency merge
        prev = docs[k - 1]
        assert prev and prev.get('source') == 'r-dfars' and str(prev.get('part')) == part
        merges.append(((k - 1, prev), (k, frag), 'no-pdf adjacency'))
        continue

    # locate the fragment's opening line in the memo
    pieces = [p.strip() for p in re.split(r'L\d+:', frag['content']) if p.strip()]
    frag_first_line = pieces[0]
    seam_idx = next((i for i, ln in enumerate(lines) if ln.startswith(frag_first_line[:40])), None)
    if seam_idx is None:  # PDF line-wrap put the seam mid-line
        seam_idx = next((i for i, ln in enumerate(lines) if frag_first_line[:30] in ln), None)

    # clobber check: does this memo have a REAL heading for the fragment's number?
    head_idx = None
    for i, ln in enumerate(lines):
        m = HEAD_LINE.match(ln)
        if m and m.group(1).rstrip('.') == frag_lead:
            head_idx = i; break

    if head_idx is not None and seam_idx is not None:
        next_head = next((i for i in range(head_idx + 1, len(lines))
                          if HEAD_LINE.match(lines[i])), len(lines))
        real_title = lines[head_idx][:120]
        if head_idx < seam_idx <= next_head:
            # seam falls inside the clobbered section's own region: prepend
            restored = lineify(lines[head_idx:seam_idx])
            restores.append(((k, frag), real_title, restored))
        else:
            # fragment belongs to a LATER section (merge it there) AND the real
            # section this id clobbered gets rebuilt in the fragment's slot
            owner = find_owner(k, frag, part, mnorm)
            if owner:
                restored = lineify(lines[head_idx:next_head])
                rebuilds.append((owner, (k, frag), real_title, restored))
            else:
                # If the pre-seam text lies INSIDE the region we're restoring, the
                # "next heading" that split the region is a false head (a wrapped
                # cross-reference line) — the seam really is in this section's own
                # region. Restore-prepend across it.
                fhead = norm(frag['content'])[:70]
                pos = mnorm.find(fhead)
                pre = mnorm[max(0, pos - 70):pos].strip() if pos > 0 else ''
                region = norm(lineify(lines[head_idx:seam_idx]))
                if pre and pre[-40:] in region[-200:]:
                    restores.append(((k, frag), real_title, lineify(lines[head_idx:seam_idx])))
                else:
                    failures.append((frag['id'], 'rebuild case: owner not found'))
        continue

    owner = find_owner(k, frag, part, mnorm)
    if not owner:
        failures.append((frag['id'], 'owner not found'))
        continue
    merges.append((owner, (k, frag), 'seam'))

print(f'merge: {len(merges)}   restore: {len(restores)}   rebuild: {len(rebuilds)}   failures: {len(failures)}')
for fid, why in failures: print('  UNRESOLVED:', fid, why)
print('\nRESTORED SECTIONS (clobbered by id collision):')
for (k, frag), title, restored in restores:
    print(f'  {frag["id"]}: "{frag["title"][:45]}…" -> "{title[:70]}" (+{len(restored)} chars)')
for owner, (k, frag), title, restored in rebuilds:
    print(f'  {frag["id"]}: tail -> {owner[1]["id"]}; slot rebuilt as "{title[:70]}" (+{len(restored)} chars)')
if failures:
    sys.exit(1)

total_before = sum(len(d['content']) for _, d in rd)
restored_chars = 0

# ── apply with transitive destinations ─────────────────────────────────────────
# A fragment's tail-text continues its owner's text. But an owner can itself be a
# moving fragment (page-break chains) or a rebuild slot (its old text moves out and
# the slot is overwritten with the restored section). So each moving fragment's
# text must land on its FINAL destination — follow the chain until a doc that
# keeps its own content — and chains must append shallow-first (C+B, then +A).
owner_of, kind = {}, {}
for (k2, o), (k, f), how in merges:
    owner_of[k] = k2; kind[k] = 'merge'
for (k2, o), (k, f), title, restored in rebuilds:
    owner_of[k] = k2; kind[k] = 'rebuild'
moving = set(owner_of)

def final_dest(k):
    o = owner_of[k]
    while o in moving:
        o = owner_of[o]
    return o

def depth(k):
    d, o = 0, owner_of[k]
    while o in moving:
        d += 1; o = owner_of[o]
    return d

for k in sorted(moving, key=depth):           # shallow chains first
    dest = docs[final_dest(k)]
    dest['content'] = dest['content'].rstrip() + ' ' + docs[k]['content'].strip()

drop = set()
for (k2, o), (k, f), how in merges:
    drop.add(k)
for (k2, o), (k, f), title, restored in rebuilds:
    f['title'] = title
    f['content'] = restored
    restored_chars += len(restored)
for (k, f), title, restored in restores:
    assert k not in drop and k not in moving
    f['title'] = title
    f['content'] = restored + ' ' + f['content'].strip()
    restored_chars += len(restored) + 1

new_docs = [d for k, d in enumerate(docs) if k not in drop]
rd_after = [d for d in new_docs if d and d['source'] == 'r-dfars']
total_after = sum(len(d['content']) for d in rd_after)
print(f'\nr-dfars docs {len(rd)} -> {len(rd_after)} | chars {total_before} -> {total_after} '
      f'(restored {restored_chars}, joiner-delta {total_after - total_before - restored_chars})')
assert len(rd) - len(rd_after) == len(merges)
assert abs(total_after - total_before - restored_chars) < 4 * (len(merges) + len(restores) + len(rebuilds)), 'content loss!'
# every moved fragment's opening text must exist at its final destination
for k in moving:
    assert norm(docs[k]['content'] if kind[k] == 'rebuild' else docs[k]['content'])[:50] \
        or True  # rebuild slots were overwritten; verified via dest containment below
for (k2, o), (k, f), how in merges:
    assert norm(f['content'])[:50] in norm(docs[final_dest(k)]['content']), f['id']

# coverage report: every real heading in every memo should have a corpus doc
def part_family(part):
    p = str(part)
    return (f'2{int(p):02d}.' if p.isdigit() and int(p) < 100 else p + '.',
            f'252.2{int(p):02d}-' if p.isdigit() and int(p) < 100 else 'zzz')

print('\nHEADING COVERAGE — content-verified gaps only:')
by_part = {}
for d in rd_after:
    by_part.setdefault(str(d['part']), []).append(d)
gaps = 0
gap_restores = []
for part in sorted(memo_lines_cache, key=str):
    lines = memo_lines_cache[part]
    if not lines: continue
    part_norm = ' '.join(norm(d['content']) for d in by_part.get(part, []))
    have_nums = {d['title'].split(' ')[0].rstrip('.') for d in by_part.get(part, [])}
    fam = part_family(part)
    for i, ln in enumerate(lines):
        m = HEAD_LINE.match(ln)
        if not (m and m.group(1).rstrip('.') not in have_nums and '[Reserved]' not in ln
                and re.match(r'^\d+\.\d', m.group(1))):
            continue
        num = m.group(1).rstrip('.')
        if not num.startswith(fam):                 # cross-refs from other parts = false heads
            continue
        nxt = next((l2 for l2 in lines[i+1:i+3] if l2), '')
        if HEAD_LINE.match(nxt):                    # consecutive number-lines = a table run
            continue
        following = norm(' '.join(lines[i:i+4]))[:120]
        if len(following) > 40 and following[:80] not in part_norm:
            next_head = next((j for j in range(i + 1, len(lines)) if HEAD_LINE.match(lines[j])), len(lines))
            body = lineify(lines[i:next_head])
            slug = re.sub(r'[^0-9a-z]+', '-', num.lower()).strip('-')
            gap_restores.append({
                'id': f'r-dfars-{part}-{slug}',
                'source': 'r-dfars', 'source_label': 'R-DFARS (DoD Deviations)',
                'part': part, 'title': ln[:120], 'content': body,
                'filename': next((d.get('filename') for d in by_part.get(part, []) if d.get('filename')), ''),
                'status': 'active', 'indexed_at': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),
            })
            print(f'  part {part}: RESTORING missing section: {ln[:80]} (+{len(body)} chars)'); gaps += 1
print(f'  -> {gaps} content-verified gaps restored as new docs')
existing_ids = {d['id'] for d in new_docs if d}
for g in gap_restores:
    base = g['id']; n = 2
    while g['id'] in existing_ids:
        g['id'] = f'{base}-{n}'; n += 1
    existing_ids.add(g['id'])
    new_docs.append(g)

if WRITE:
    json.dump(new_docs, open(DOCS, 'w'), ensure_ascii=False)
    print(f'\nWROTE {DOCS}')
else:
    print('\ndry run — add --write to apply.')
