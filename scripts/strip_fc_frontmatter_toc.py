#!/usr/bin/env python3
"""Strip the table-of-contents dot leaders out of the FAR Companion front-matter doc.

far-companion-0100 was ingested as one 11,969-char blob holding the FC's whole
table of contents. 56 of its 76 lines are dot leaders ("Disclaimer ......... 4"),
so anyone whose search hit this doc got a screenful of dots — and its title was
literally "FAR Companion Purpose ...........................".

It is NOT pure noise, which is why this strips rather than deletes: the same blob
carries the version change log (which FC parts shipped in v1.0 vs v2.0) and the
"About the FAR Companion" section — EO 14275, OMB M-25-26, and the statement that
the FC is non-regulatory, contains no mandates, and is not a basis for protests.
That is some of the most citable prose in the document.

Also drops the running-header furniture ("4 Federal Acquisition Regulation (FAR)
Companion"), including where the PDF glued it onto the front of a real line —
scripts/strip_page_furniture.py only removes lines that are ENTIRELY furniture.

DRY RUN by default; --write applies.
"""
import json
import re
import sys

DOCS = 'output/documents.json'
DOC_ID = 'far-companion-0100'
NEW_TITLE = 'About the FAR Companion'
WRITE = '--write' in sys.argv

# "Disclaimer ....................... 4"
TOC_LINE = re.compile(r'\.{4,}')
# The running header, with or without a leading page number.
FURNITURE = re.compile(r'^\s*\d{0,3}\s*Federal Acquisition Regulation \(FAR\) Companion\s*')

# Must survive the strip — the reason this doc is kept at all.
MUST_KEEP = [
    'Executive Order 14275',
    'OMB Memorandum M-25-26',
    'is non-regulatory, contains no mandates',
    'Version Change Log',
]


def main():
    docs = json.load(open(DOCS))
    before_ids = [d['id'] for d in docs]

    target = next((d for d in docs if d['id'] == DOC_ID), None)
    if target is None:
        sys.exit(f'{DOC_ID} not found — already removed?')

    original = target['content']
    kept = []
    dropped_toc = dropped_furniture = trimmed = 0

    for line in original.split('\n'):
        if not line.strip():
            continue
        if TOC_LINE.search(line):
            dropped_toc += 1
            continue
        stripped = FURNITURE.sub('', line, count=1)
        if not stripped.strip():
            dropped_furniture += 1
            continue
        if stripped != line:
            trimmed += 1
        kept.append(stripped.strip())

    new_content = '\n'.join(kept)

    # Every retained line must have existed in the original — this only removes.
    for line in kept:
        assert line in original.replace('\n', '\n'), f'invented text: {line[:60]}'
    for phrase in MUST_KEEP:
        assert phrase in new_content, f'lost required content: {phrase}'
    assert len(new_content) < len(original), 'nothing was stripped'

    print(f'{DOC_ID}')
    print(f'   title : {target["title"][:70]!r}')
    print(f'        -> {NEW_TITLE!r}')
    print(f'   chars : {len(original):,} -> {len(new_content):,}')
    print(f'   dropped {dropped_toc} TOC lines, {dropped_furniture} furniture lines, '
          f'trimmed furniture off {trimmed} lines')
    print(f'   kept {len(kept)} lines of real content')

    if not WRITE:
        print('\ndry run — add --write to apply.')
        return

    target['content'] = new_content
    target['title'] = NEW_TITLE

    assert [d['id'] for d in docs] == before_ids, 'document set changed'
    json.dump(docs, open(DOCS, 'w'), ensure_ascii=False)
    print(f'\nwrote {DOCS}')


if __name__ == '__main__':
    main()
