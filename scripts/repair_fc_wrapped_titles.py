#!/usr/bin/env python3
"""Repair FAR Companion titles that were cut off at a PDF line wrap.

FC headings wrap across physical lines in the source PDF:

    FC 8.401 Periodic Table of Acquisition Innovations (PTAI) procedures for FAR part 8 RFQ
    streamlining.

The original ingest took only the FIRST physical line as the title, so 16 docs
carry a heading that stops mid-sentence ("...for FAR part 8 RFQ"). It shows as a
truncated section heading on /far-companion part pages, and it defeats the
renderer's title-echo dedup (isTitleEcho in api/_seo.js + assets/app.js), so the
full heading prints again as body text under the cut-off heading.

Same bug class as the e8bfde3 line-rewrap fix, but for titles rather than body.

Titles are reconstructed FROM THE SOURCE PDF, not from the stored content: find
the heading's opening line, then follow its wraps until the line ending in the
terminating period. A doc is only touched when that reconstruction succeeds AND
extends the existing title. That is what keeps the cover page ("FAR Companion"),
the table-of-contents dot-leader entry, and already-correct titles untouched —
they have no wrapped-heading match, so they are skipped rather than special-cased.

Anchors are id-based on both render paths (SSR falls back to d.id since
far-companion has anchor:null; the client builds `sec-${hit.id}`), so retitling
does not move any link target.

DRY RUN by default; --write applies.
"""
import json
import re
import sys

import fitz  # PyMuPDF

DOCS = 'output/documents.json'
PDF = 'FAR Companion/far-companion.pdf'
WRITE = '--write' in sys.argv

MAX_TITLE = 200  # a heading longer than this is body prose that ran together


def norm(s):
    """Collapse whitespace and drop any leading ingest level marker."""
    return re.sub(r'\s+', ' ', re.sub(r'^L\d+:\s*', '', s or '')).strip()


def load_pdf_lines():
    text = '\n'.join(p.get_text() for p in fitz.open(PDF))
    return [re.sub(r'[ \t]+', ' ', l).strip() for l in text.split('\n')]


def reconstruct(title, lines):
    """Find `title` as a heading in the PDF and follow its wraps to the period.

    Returns the full heading, or None when the title does not appear as the start
    of a heading that terminates in a period within a few lines (cover text, TOC
    entries and body prose all fall out here).
    """
    probe = title[:60].lower()
    squashed_probe = probe.replace(' ', '')
    for i, line in enumerate(lines):
        low = line.lower()
        if not low.startswith(probe) or not low.replace(' ', '').startswith(squashed_probe):
            continue
        acc = [line]
        if line.endswith('.'):
            return ' '.join(acc)
        # A wrapped heading finishes within a line or two; anything longer is body.
        for nxt in lines[i + 1:i + 4]:
            nxt = nxt.strip()
            if not nxt:
                break
            acc.append(nxt)
            if nxt.endswith('.'):
                return ' '.join(acc)
        return None
    return None


def main():
    docs = json.load(open(DOCS))
    lines = load_pdf_lines()

    before_ids = [d['id'] for d in docs]
    before_content = {d['id']: d.get('content') for d in docs}

    repairs = []
    for d in docs:
        if d.get('source') != 'far-companion':
            continue
        title = norm(d.get('title'))
        first = norm((d.get('content') or '').split('\n')[0])
        # Only consider docs whose own first content line already runs past the
        # title — that is the signature of the wrap-truncation.
        if not title or not first:
            continue
        if first == title or not first.lower().startswith(title.lower()) or len(first) <= len(title):
            continue

        full = reconstruct(title, lines)
        if not full or full == title:
            continue

        assert full.lower().startswith(title.lower()), \
            f'{d["id"]}: reconstruction does not extend the title'
        assert len(full) <= MAX_TITLE, f'{d["id"]}: reconstructed title too long ({len(full)})'
        assert norm(first).lower().startswith(full.lower()[:len(title) + 5]), \
            f'{d["id"]}: reconstruction disagrees with stored content'

        repairs.append((d, title, full))

    print(f'{len(repairs)} truncated titles to repair\n')
    for d, old, new in repairs:
        print(f'[{d["id"]}] part {d.get("part")}')
        print(f'   old: {old}')
        print(f'   new: {new}\n')

    if not WRITE:
        print('dry run — add --write to apply.')
        return

    for d, _old, new in repairs:
        d['title'] = new

    # Titles only: no doc added or dropped, no id renamed, no content byte moved.
    assert [d['id'] for d in docs] == before_ids, 'document set changed'
    assert all(d.get('content') == before_content[d['id']] for d in docs), 'content changed'

    json.dump(docs, open(DOCS, 'w'), ensure_ascii=False)
    print(f'wrote {len(repairs)} repaired titles to {DOCS}')


if __name__ == '__main__':
    main()
