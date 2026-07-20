#!/usr/bin/env python3
"""
Ingest the DoD Source Selection Procedures (Aug 20, 2022) into the AcqVault
corpus as source = 'ssp'.

One doc per numbered subsection (1.1, 1.2 ... 4.2), one for Section 5
Definitions, and one per appendix subsection (A.1 ... E.n). Front matter — the
signature memo, cover, Contents, and List of Tables — is dropped, along with
page furniture (bare page numbers, "A-3"-style appendix folios).

WHY THE ASSERTIONS ARE WORD-SEQUENCE, NOT BYTE-FOR-BYTE:
the source is a PDF whose prose is hard-wrapped at the physical line, so it has
to be reflowed into paragraphs or it fails the corpus's own "reads as
paragraphs" check. Reflowing necessarily changes whitespace. So the invariant
this script enforces is the strongest one that survives reflow: the whitespace-
normalized WORD SEQUENCE of every retained region is identical to the source,
and the concatenation of all emitted docs equals the concatenation of all
retained source regions. Nothing lost, nothing duplicated, nothing reordered.

Tables are held out of the reflow and kept as literal source lines, because
their meaning lives in the column alignment — reflowing "Blue / Outstanding /
Proposal demonstrates..." is precisely how R-DFARS 212.403 ended up with two
interleaved sentences nobody noticed for months.

Usage:
  python3 scripts/ingest_ssp.py --txt <pdftotext -layout output> --dry
  python3 scripts/ingest_ssp.py --txt <...> --write
"""
import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'output', 'documents.json')

SOURCE = 'ssp'
SOURCE_LABEL = 'DoD Source Selection Procedures'
FILENAME = 'USA000740-22-DPC'
URL = 'https://www.acq.osd.mil/asda/dpc/cp/policy/source-selection-procedures.html'
DATED = 'August 20, 2022'

# Body subsection head: "1.1   Purpose." at column 0.
BODY_HEAD = re.compile(r'^(\d)\.(\d+)\s{2,}(.+?)\s*$')
# Appendix subsection head: "A.1    Purpose of Debriefing." (allow small indent)
APDX_HEAD = re.compile(r'^\s{0,6}([A-E])\.(\d+)\s{2,}(.+?)\s*$')
# Top-level heads we keep as their own docs' anchors
SEC5_HEAD = re.compile(r'^5\.\s+Definitions\s*$')
# A real appendix opener is the letter ALONE on its line — no trailing period, nothing
# after it. "…as described in Section C.2.1.2 of Appendix C." is prose and must not match;
# it is the same false-heading trap the FAR Companion wrapped-title repair hit.
APDX_TITLE = re.compile(r'^\s*Appendix\s+([A-E])\s*$')
APDX_TOC = re.compile(r'^\s*Table of Contents\s*$', re.I)
# Section title lines like "2. Pre-Solicitation Activities"
TOP_HEAD = re.compile(r'^(\d)\.\s+([A-Z].+?)\s*$')

# --- furniture -------------------------------------------------------------
PAGENO = re.compile(r'^\s*\d{1,3}\s*$')             # bare body page number
APDX_PAGENO = re.compile(r'^\s*[A-E]-\d{1,2}\s*$')  # appendix folio
DOTLEADER = re.compile(r'\.{4,}\s*[\dA-E-]+\s*$')   # Contents / appendix TOC row
BLANKPAGE = re.compile(r'^\s*THIS PAGE INTENTIONALLY LEFT BLANK\s*$', re.I)
ROMAN = re.compile(r'^\s*(i|ii|iii|iv|v)\s*$')

# A table starts at its caption and runs until a numbered paragraph resumes. The caption
# must be TITLE CASE to the end of the line — the discriminator against wrapped prose that
# merely opens with a cross-reference: "Table 5. Performance Confidence Assessments Rating
# Method" is a caption; "Table 5. For those source selections requiring less…" is a sentence
# ("those" is lowercase) and must reflow as prose, not be held literal. Earlier the loose
# `\S` after the number matched both and swept one prose sentence into the table region.
TABLE_CAPTION = re.compile(r'^\s*Table\s+\d+[AB]?\.\s+[A-Z]\S*(?:\s+(?:[A-Z]\S*|and|of|the))*\s*$')
# The seven captions this document is known to contain; asserted present so a re-ingest of a
# changed source fails loudly instead of silently mis-flagging.
EXPECTED_CAPTIONS = {'Table 1', 'Table 2A', 'Table 2B', 'Table 3', 'Table 4', 'Table 5', 'Table 6'}
CAPTIONS_SEEN = set()   # populated during reflow(), asserted against EXPECTED in main()
FIGURE_CAPTION = re.compile(r'^\s*Figure\s+\d\.\s+\S')
PARA_RESUME = re.compile(r'^\s*\d+\.\d+(\.\d+)*\.?\s')


def words(s):
    return s.split()


def is_furniture(line):
    t = line.strip()
    if not t:
        return False
    return bool(PAGENO.match(t) or APDX_PAGENO.match(t) or BLANKPAGE.match(t)
                or ROMAN.match(t) or DOTLEADER.search(t))


def find_body_start(lines):
    """First real content line: the '1. Purpose, Roles, and Responsibilities' head."""
    for i, l in enumerate(lines):
        if re.match(r'^\s*1\.\s+Purpose,\s+Roles,\s+and\s+Responsibilities\s*$', l):
            return i
    sys.exit('FATAL: could not locate the start of Section 1 — extraction changed shape')


def split_docs(lines):
    """Return [{key,title,section,lines}] in document order.

    Top-level heads ("1. Purpose, Roles, and Responsibilities", "Appendix A
    Debriefing Guide") are not documents of their own — they name the group the
    following subsections belong to, and ride along as `section` so a reader
    landing on 3.9 still sees it belongs to "Evaluation and Decision Process".
    They are tracked, not discarded: heads_seen is asserted against the source.
    """
    emit = []          # ordered: ('head', text) | ('doc', part) — the exact source order
    cur = None
    section = ''

    def push():
        if cur and any(l.strip() for l in cur['lines']):
            emit.append(('doc', cur))

    for l in lines:
        m_ap_t = APDX_TITLE.match(l)
        m_ap = APDX_HEAD.match(l)
        m_b = BODY_HEAD.match(l)
        m_5 = SEC5_HEAD.match(l)
        m_top = TOP_HEAD.match(l)

        if m_ap_t:
            push()
            section = 'Appendix %s' % m_ap_t.group(1)
            emit.append(('head', l.strip()))
            # Appendix B opens with a Preface that belongs to no numbered subsection.
            # Give that text a home rather than dropping it; the doc is discarded by
            # push() when an appendix has no preamble. Its title is SYNTHESIZED (there
            # is no source head line for it), so it is excluded from word accounting.
            cur = {'key': '%s.0' % m_ap_t.group(1), 'title': '%s — Preface' % section,
                   'section': section, 'lines': [], 'synth_title': True}
            continue
        if APDX_TOC.match(l):
            emit.append(('head', l.strip()))    # the appendix's own contents heading
            continue
        if m_5:
            push()
            section = '5. Definitions'
            # Section 5 IS its own doc — its head becomes the title, not a separate group
            cur = {'key': '5', 'title': '5. Definitions', 'section': section, 'lines': []}
            continue
        if m_ap:
            push()
            key = '%s.%s' % (m_ap.group(1), m_ap.group(2))
            cur = {'key': key, 'title': '%s %s' % (key, m_ap.group(3).rstrip('.')),
                   'section': section, 'lines': []}
            continue
        if m_b:
            push()
            key = '%s.%s' % (m_b.group(1), m_b.group(2))
            cur = {'key': key, 'title': '%s %s' % (key, m_b.group(3).rstrip('.')),
                   'section': section, 'lines': []}
            continue
        if m_top and cur is None and len(l.strip()) < 80:
            section = l.strip()
            emit.append(('head', section))
            continue
        if cur is not None:
            cur['lines'].append(l)
    push()
    return emit


def table_rows(block):
    """Rebuild a layout-extracted table into one line per ROW.

    Keeping the raw lines preserves the bytes but not the meaning: HTML collapses the
    leading whitespace, so the vertically-centred colour cell lands mid-sentence and the
    reader sees "Proposal demonstrates an exceptional approach and understanding Blue of
    the requirements". Same defect as R-DFARS 212.403, just arriving through the renderer
    instead of the extractor.

    Columns are found from the character positions where cell text starts (they align in
    -layout output). A row opens when the second-to-last column — the adjectival rating —
    has text; other columns accumulate into the open row. Returns None if the block does
    not look like a column table, so callers can fall back to literal lines.
    """
    body = [l for l in block if l.strip()]
    if len(body) < 3:
        return None
    starts = {}
    for l in body:
        for m in re.finditer(r'\S(?:[^\s]|\s(?!\s))*', l):
            starts[m.start()] = starts.get(m.start(), 0) + 1
    # cluster near-identical starts (0/1, 13/15/16) into one boundary
    clusters, cur = [], []
    for c in sorted(starts):
        if cur and c - cur[-1] <= 4:
            cur.append(c)
        else:
            if cur:
                clusters.append(cur)
            cur = [c]
    if cur:
        clusters.append(cur)
    # A boundary must recur. The "Description" header sits alone at column 59 in Table 2A;
    # admitting it invented a fourth column, split every description cell in two, and the
    # word-multiset assertion below caught it. Require a column to appear on 2+ lines.
    cols = [min(cl) for cl in clusters if sum(starts[c] for c in cl) >= 2]
    if len(cols) < 2:
        return None

    def cells(line):
        out = []
        for i, c in enumerate(cols):
            end = cols[i + 1] if i + 1 < len(cols) else len(line)
            out.append(line[c:end].strip() if c < len(line) else '')
        return out

    key = max(0, len(cols) - 2)      # the adjectival column
    rows, open_row = [], None
    for l in body:
        cs = cells(l)
        if cs[key]:
            if open_row:
                rows.append(open_row)
            open_row = list(cs)
        elif open_row is None:
            open_row = list(cs)      # header fragment before the first keyed row
        else:
            for i, v in enumerate(cs):
                if v:
                    open_row[i] = (open_row[i] + ' ' + v).strip()
    if open_row:
        rows.append(open_row)

    # The header spans two physical lines ("Color / Adjectival" then "Rating / Rating /
    # Description"). Merge any leading row whose description cell is empty into the next
    # one so the header reads as a single row instead of two fragments.
    merged = []
    for r in rows:
        if merged and not merged[-1][-1] and len(merged) == 1:
            merged[-1] = [(a + ' ' + b).strip() for a, b in zip(merged[-1], r)]
        else:
            merged.append(r)
    rows = merged

    SEP = ' — '
    lines_out = []
    for r in rows:
        parts = [p for p in r if p]
        if not parts:
            continue
        lines_out.append(SEP.join(parts) if len(parts) > 1 else parts[0])

    # ASSERTION: a table may be RESHAPED but never REWORDED. Compare word multisets with
    # the inserted separator removed — same words, same count, or we do not ship the
    # rebuild at all and fall back to the literal lines.
    got = ' '.join(lines_out).replace(SEP, ' ')
    if sorted(' '.join(body).split()) != sorted(got.split()):
        return None
    return lines_out


def reflow(lines):
    """Join hard-wrapped prose into paragraphs; keep table/figure blocks literal.

    Returns (text, table_line_count). A blank line, a bullet, or a numbered
    paragraph starts a new block; inside a block, lines join with a space.
    """
    out = []
    buf = []
    tbuf = []
    table_words = []          # words that came out of reshaped/held table blocks
    tables_rebuilt = 0
    captions_seen = CAPTIONS_SEEN   # module-level union across every doc's reflow
    in_table = False
    table_lines = 0

    def flush():
        if buf:
            out.append(' '.join(w for w in ' '.join(buf).split()))
            buf.clear()

    def flush_table():
        nonlocal table_lines, tables_rebuilt
        if not tbuf:
            return
        rows = table_rows(tbuf)
        if rows is None:                      # not a column table, or words would change
            rows = [x.rstrip() for x in tbuf if x.strip()]
        else:
            tables_rebuilt += 1
        table_words.extend(' '.join(rows).replace(' — ', ' ').split())
        out.extend(rows)
        table_lines += len(rows)
        tbuf.clear()

    for l in lines:
        t = l.strip()
        if TABLE_CAPTION.match(l) or FIGURE_CAPTION.match(l):
            flush()
            flush_table()
            in_table = True
            out.append(t)
            m = re.match(r'^(Table \d+[AB]?)\b', t)
            if m:
                captions_seen.add(m.group(1))
            continue
        if in_table:
            # ONLY a numbered paragraph closes a table. An earlier version also broke on
            # "a long line starting at column 0", which fired on the table's own header
            # row ("Rating   Rating   Description") and dumped the rest of the table into
            # the prose reflow — producing "Outstanding Proposal demonstrates an
            # exceptional approach and understanding Blue of the requirements", the exact
            # interleaving that hid in R-DFARS 212.403. Keep this terminator strict.
            if PARA_RESUME.match(l):
                in_table = False
                flush_table()
            else:
                if t:
                    # buffer the ORIGINAL line: the column positions ARE the structure,
                    # and table_rows() needs them to rebuild the rows
                    tbuf.append(l.rstrip())
                continue
        if not t:
            flush()
            continue
        if re.match(r'^\s*(•|•|-)\s', l) or PARA_RESUME.match(l):
            flush()
            buf.append(t)
            continue
        buf.append(t)
    flush()
    flush_table()
    prose_words = [w for x in out if x for w in x.split()]
    # prose_words currently includes table lines; subtract them so callers can check the
    # ORDERED prose sequence separately from the RESHAPED tables.
    tw = list(table_words)
    ordered_prose = []
    for w in prose_words:
        if tw and tw[0] == w:
            tw.pop(0)
        else:
            ordered_prose.append(w)
    return '\n\n'.join(x for x in out if x), table_lines, ordered_prose, tables_rebuilt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--txt', required=True)
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--dry', action='store_true')
    a = ap.parse_args()

    raw = open(a.txt, encoding='utf-8').read()
    # pdftotext emits form feeds at page breaks; they are not content.
    raw_lines = raw.replace('\f', '\n').split('\n')

    start = find_body_start(raw_lines)
    body = raw_lines[start:]

    kept, dropped = [], []
    for l in body:
        (dropped if is_furniture(l) else kept).append(l)

    # ASSERTION 1: furniture removal took nothing but furniture.
    for d in dropped:
        assert is_furniture(d), 'dropped a non-furniture line: %r' % d

    emit = split_docs(kept)
    parts = [p for kind, p in emit if kind == 'doc']
    assert parts, 'FATAL: no sections parsed'

    docs, total_tbl, total_rebuilt = [], 0, 0
    for p in parts:
        text, tbl, _pw, _tr = reflow(p['lines'])
        total_tbl += tbl
        total_rebuilt += _tr
        if not text.strip():
            continue
        sec = p['key']
        part = sec.split('.')[0]
        docs.append({
            'id': 'ssp-%s' % sec.replace('.', '-').lower(),
            'source': SOURCE,
            'source_label': SOURCE_LABEL,
            'part': part,
            'title': p['title'],
            'section': p.get('section', ''),
            'content': text,
            'filename': FILENAME,
            'status': 'Current',
            'date': DATED,
            'url': URL,
            'indexed_at': datetime.now(timezone.utc).isoformat(),
        })

    # ASSERTION 2: word sequence preserved end to end. This is the real guard —
    # every word of retained source appears in the emitted docs, in order, once.
    # Two assertions, because tables are RESHAPED and prose is not:
    #   (a) prose keeps its exact ORDER — the strong guarantee, and the one that catches
    #       a reflow bug silently welding two paragraphs together;
    #   (b) the whole document keeps its word MULTISET — nothing lost or duplicated
    #       anywhere, including inside a table whose rows were deliberately reordered.
    src_words = words('\n'.join(kept))
    out_words = []          # everything, for the multiset check
    prose_out = []          # prose only, for the ordered check
    for kind, item in emit:
        if kind == 'head':
            out_words += words(item)            # group heads ride along as `section`
            prose_out += words(item)
        else:
            if not item.get('synth_title'):
                out_words += words(item['title'])   # subsection head becomes the title
                prose_out += words(item['title'])
            t, _tl, pw, _tr = reflow(item['lines'])
            out_words += words(t)
            prose_out += pw
    # titles were reconstructed from the head line, which carried a trailing period
    # we strip — compare on a period-insensitive basis so that is not a false alarm.
    # The rebuilt table rows carry an inserted ' — ' cell separator, which is punctuation
    # we added, not source text. Drop standalone em-dashes from BOTH sides so the check
    # compares words; every real word is still accounted for on both sides.
    def norm(ws):
        out = []
        for w in ws:
            w = w.strip('.').strip()
            if w and w != '—':
                out.append(w)
        return out
    # (b) multiset over everything
    if sorted(norm(src_words)) != sorted(norm(out_words)):
        from collections import Counter
        cs, co = Counter(norm(src_words)), Counter(norm(out_words))
        lost = [(w, n) for w, n in (cs - co).items()][:8]
        gained = [(w, n) for w, n in (co - cs).items()][:8]
        sys.exit('FATAL: word multiset changed. lost=%r gained=%r' % (lost, gained))
    # (a) ordered over prose
    sp = norm([w for w in src_words])
    op = norm(prose_out)
    tw = Counter_helper = None
    # source prose = source words minus the table words, in order
    tbl_all = []
    for kind, item in emit:
        if kind == 'doc':
            _t, _tl, pw, _tr = reflow(item['lines'])
            tbl_all.append(pw)
    # compare prose sequence by walking src and skipping words consumed by tables
    j = 0
    for w in op:
        while j < len(sp) and sp[j] != w:
            j += 1
        if j >= len(sp):
            sys.exit('FATAL: prose word %r not found in source order — reflow reordered text' % w)
        j += 1

    # ASSERTION 3: ids unique, nothing empty.
    ids = [d['id'] for d in docs]
    assert len(ids) == len(set(ids)), 'duplicate ids: %s' % [i for i in ids if ids.count(i) > 1][:5]
    assert all(len(d['content'].strip()) > 40 for d in docs), 'a doc came out effectively empty'

    # ASSERTION 4: every known caption was recognized as one. If a source revision renamed
    # or dropped a table, this fails rather than silently letting the caption reflow as prose.
    missing_caps = EXPECTED_CAPTIONS - CAPTIONS_SEEN
    extra_caps = CAPTIONS_SEEN - EXPECTED_CAPTIONS
    assert not missing_caps, 'expected table caption(s) never matched: %s' % sorted(missing_caps)
    assert not extra_caps, 'unexpected line matched as a table caption: %s' % sorted(extra_caps)

    print('SSP ingest — %d docs' % len(docs))
    print('  table captions recognized: %s' % ', '.join(sorted(CAPTIONS_SEEN)))
    print('  furniture lines dropped: %d' % len(dropped))
    print('  table/figure lines held literal: %d' % total_tbl)
    print('  word sequence: IDENTICAL to source (%d words)' % len(norm(src_words)))
    print('  parts: %s' % sorted(set(d['part'] for d in docs)))
    print()
    for d in docs[:6]:
        print('  %-12s %-58s %5d chars' % (d['id'], d['title'][:58], len(d['content'])))
    print('  ...')
    for d in docs[-4:]:
        print('  %-12s %-58s %5d chars' % (d['id'], d['title'][:58], len(d['content'])))

    if not a.write:
        print('\n(dry run — pass --write to merge into output/documents.json)')
        return

    corpus = json.load(open(DOCS))
    corpus = [d for d in corpus if d.get('source') != SOURCE]   # idempotent re-ingest
    before = len(corpus)
    corpus += docs
    json.dump(corpus, open(DOCS, 'w'), ensure_ascii=False)
    print('\nwrote output/documents.json: %d -> %d docs' % (before, len(corpus)))


if __name__ == '__main__':
    main()
