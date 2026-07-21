#!/usr/bin/env python3
"""Scrub private-use-area (PUA) glyphs from the corpus.

Symbol/Wingdings fonts in the source PDFs mapped em-dashes and list bullets into
the Unicode private-use area; those code points have no glyph in a normal font,
so they render as tofu boxes (▯) in the browser. This maps each observed PUA
code point back to its plain-text equivalent, verified by context:

  U+F8E7, U+F0BE  →  "—"  (em dash introducing an enumerated list: "unless— (1)")
  U+F0D8, U+F0B7, U+F0FC  →  "•"  (list bullets flattened into the paragraph)
  U+F8FD  →  "×"  (multiplication in the loss-ratio worked example at 32.503-6;
           the arithmetic settles it rather than the shape: $2,700,000 × 83.3% = $2,249,100,
           then × 80.0% = $1,799,280)

Idempotent and assertion-guarded: run it after any FMR/R-DFARS re-ingest.
documents.json is the maintained artifact for both sources (refresh.py never
rewrites them), so editing it in place is the canonical fix.
"""
import json
import re
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "output" / "documents.json"

# code point -> replacement
PUA_MAP = {
    "": "—",  # em dash
    "": "—",  # em dash
    "": "•",  # bullet
    "": "•",  # bullet
    "": "•",  # bullet
    "": "×",  # multiplication sign (acquisition.gov HTML)
}
# any remaining PUA char after mapping is a miss we want to hear about
PUA_RANGE = re.compile(r"[-]")


def scrub(text):
    if not text:
        return text, 0
    n = 0
    for bad, good in PUA_MAP.items():
        if bad in text:
            n += text.count(bad)
            text = text.replace(bad, good)
    return text, n


def main():
    docs = json.loads(DOCS.read_text(encoding="utf-8"))
    total, touched, by_src = 0, 0, {}
    leftover = []
    for d in docs:
        if not d:
            continue
        hit = 0
        for field in ("content", "title"):
            if field in d and isinstance(d[field], str):
                d[field], n = scrub(d[field])
                hit += n
        # Recovered tables hold their own copy of the cell text, so a glyph scrubbed
        # out of `content` survives in `tables` and still renders as a box.
        for tbl in d.get("tables") or []:
            for r_i, row in enumerate(tbl.get("rows") or []):
                for c_i, cell in enumerate(row):
                    if isinstance(cell, str):
                        row[c_i], n = scrub(cell)
                        hit += n
        if hit:
            touched += 1
            total += hit
            by_src[d.get("source", "?")] = by_src.get(d.get("source", "?"), 0) + hit
        # detect anything still in the PUA block
        for field in ("content", "title"):
            v = d.get(field)
            if isinstance(v, str) and PUA_RANGE.search(v):
                leftover.append((d.get("id"), field))
        for tbl in d.get("tables") or []:
            for row in tbl.get("rows") or []:
                for cell in row:
                    if isinstance(cell, str) and PUA_RANGE.search(cell):
                        leftover.append((d.get("id"), "tables"))

    if leftover:
        print("ERROR: PUA characters still present after scrub — unmapped code points:")
        for did, field in leftover[:20]:
            print(f"  {did} ({field})")
        sys.exit(1)

    if total == 0:
        print("No PUA glyphs found — corpus already clean.")
        return

    # match the on-disk format exactly (default separators, no trailing newline)
    # so the commit diff is only the character replacements.
    DOCS.write_text(json.dumps(docs, ensure_ascii=False), encoding="utf-8")
    print(f"Scrubbed {total} PUA glyph(s) across {touched} doc(s): {by_src}")
    print("Verified: 0 private-use-area characters remain.")


if __name__ == "__main__":
    main()
