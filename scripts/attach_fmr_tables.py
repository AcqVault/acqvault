#!/usr/bin/env python3
"""
Recover the FMR's tables from the fetched chapter PDFs.

The FMR came into the corpus as PDF-extracted markdown, so its tables arrived as
prose: 77 chapters carry 504 "Table N-N." captions followed by run-together cells.
scripts/fetch_fmr_pdfs.py caches the chapter PDFs; this reads the ruled tables out of
them and attaches each to its chapter.

The match is far tighter than the corpus-wide passes, because the filename says which
chapter a PDF is — 1__01_02.pdf is volume 1, chapter 2 — so a table is only ever
tested against the one document it can belong to. That removes the main way a
cross-corpus matcher goes wrong.

Everything else follows the rules the other table passes established:
  * document `content` is never modified, only a `tables` field is added;
  * a table is placed only where its cells match the flattened text exactly, on the
    separator-stripped form, so wrapping and hyphenation are not disagreements;
  * and it is refused unless every word in the span it would replace is reproduced by
    a cell, because the renderers draw the table INSTEAD of that text and a table
    that hides half a paragraph is worse than no table.

Usage:
    python3 scripts/attach_fmr_tables.py            # report only
    python3 scripts/attach_fmr_tables.py --write    # apply
"""

import importlib.util
import json
import re
import sys
from pathlib import Path

import pdfplumber

BASE = Path(__file__).resolve().parent.parent
CACHE = BASE / "_local_archive" / "fmr-pdf"
DOCS = BASE / "output" / "documents.json"

# reuse the cleaning, matching and safety rules rather than restating them
_spec = importlib.util.spec_from_file_location("et", BASE / "scripts" / "extract_tables.py")
et = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(et)


def chapter_of(filename):
    """1__01_02.pdf -> ('1', 2). Returns None for glossary/intro files."""
    m = re.match(r"^([^_]+)__[0-9a-zA-Z]+_(\d+)\.pdf$", filename)
    if not m:
        return None
    return m.group(1), int(m.group(2))


def main():
    write = "--write" in sys.argv
    if not CACHE.exists():
        sys.exit("no cached PDFs — run scripts/fetch_fmr_pdfs.py first")

    corpus = json.loads(DOCS.read_text())
    fmr = [d for d in corpus if d.get("source") == "fmr"]
    by_key = {}
    for d in fmr:
        m = re.match(r"^Chapter\s+(\d+)", str(d.get("title", "")))
        if m:
            by_key[(str(d.get("part")), int(m.group(1)))] = d

    attached = unmatched = refused = 0
    per_doc = {}

    for pdf_path in sorted(CACHE.glob("*.pdf")):
        key = chapter_of(pdf_path.name)
        if not key or key not in by_key:
            continue
        doc = by_key[key]
        lines = [et.norm(et.strip_marker(l)) for l in str(doc.get("content", "")).split("\n")]
        hay, owner = et.build_haystack(lines)

        try:
            pdf = pdfplumber.open(pdf_path)
        except Exception:
            continue
        for page in pdf.pages:
            try:
                raws = page.extract_tables()
            except Exception:
                continue
            for raw in raws:
                rows = et.clean_table(raw)
                if not rows:
                    continue
                placed = False
                for candidate in (rows, rows[1:] if len(rows) > et.MIN_ROWS else None):
                    if candidate is None:
                        continue
                    cells = et.table_cells(candidate)
                    span = et.find_span(lines, cells, hay, owner)
                    if not span:
                        continue
                    if not et.span_is_covered(lines, span, cells):
                        refused += 1
                        continue
                    per_doc.setdefault(doc["id"], []).append(
                        {"start": span[0], "end": span[1], "rows": rows})
                    attached += 1
                    placed = True
                    break
                if not placed:
                    unmatched += 1
        pdf.close()

    print(f"chapters with a cached PDF: {sum(1 for p in CACHE.glob('*.pdf') if chapter_of(p.name) in by_key)}")
    print(f"tables attached: {attached}  unmatched: {unmatched}  refused as unsafe: {refused}")
    print(f"documents gaining a table: {len(per_doc)}")

    if not write:
        print("\n(report only — pass --write to apply)")
        return

    for d in corpus:
        tbls = per_doc.get(d.get("id"))
        if not tbls:
            continue
        tbls.sort(key=lambda t: t["start"])
        keep, last = [], -1
        for t in tbls:
            if t["start"] > last:
                keep.append(t)
                last = t["end"]
        d["tables"] = keep

    DOCS.write_text(json.dumps(corpus, ensure_ascii=False))
    print(f"wrote {DOCS}")


if __name__ == "__main__":
    main()
