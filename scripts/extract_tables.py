#!/usr/bin/env python3
"""
Recover the tables the text extractor flattened.

extract_documents.py reads the source PDFs with pdfplumber's ``page.extract_text()``,
which walks a table cell by cell and emits the contents as ordinary lines. A two-column
approval-authority table therefore reaches the corpus as an alternating list —

    L0:$900,000 or below
    L0:Contracting officer.
    L0:>$900,000 - $20,000,000
    L0:Advocate for competition.

— where nothing tells the reader which authority belongs to which threshold. The
geometry that would say so is still in the PDF: ``page.extract_tables()`` recovers
RFO Table 6-1 as a clean 5x2 grid, identical to the one acquisition.gov publishes.

This script re-reads the same PDFs, pulls the ruled tables, and attaches them to the
documents whose text they were flattened into. It is deliberately ADDITIVE: the
``content`` of every document is left byte-for-byte alone, so the search index, the
scorer and the "unofficial copy" promise are all untouched. Each table records the
span of content lines it came from, and the renderers draw the table in place of
those lines.

A table is only attached when the cells it recovered match the flattened lines
EXACTLY once whitespace is normalised. A table we cannot place is reported and
dropped, never guessed at — this corpus is a rulebook, and a plausible-looking
table with the wrong cell in the wrong row is worse than no table at all.

Usage:
    python3 scripts/extract_tables.py            # report only, writes nothing
    python3 scripts/extract_tables.py --write    # patch output/documents.json
"""

import json
import re
import sys
from pathlib import Path

import pdfplumber

BASE = Path(__file__).resolve().parent.parent
DOCS = BASE / "output" / "documents.json"

# Sources whose corpus text came from these PDFs via extract_documents.py.
PDF_SOURCES = {
    "rfo": ["RFO"],
    "r-dfars": ["R-DFARS"],
    "far-companion": ["FAR Companion"],
    "category-management": ["Category Management"],
    "afi-63-138": ["DAFI 63-138"],
}

MIN_ROWS = 2
MIN_COLS = 2


def norm(s):
    """Whitespace-insensitive comparison form."""
    return re.sub(r"\s+", " ", str(s or "")).strip()


def strip_marker(line):
    return re.sub(r"^L\d+:\s*", "", line)


def clean_table(raw):
    """Drop pdfplumber's ruling artefacts and stitch wrapped continuation rows.

    A cell whose text wraps produces a follow-on row with an empty first column;
    those belong to the row above, not to a row of their own.
    """
    rows = [[norm(c) for c in r] for r in raw]
    if not rows:
        return None
    ncol = max(len(r) for r in rows)
    rows = [r + [""] * (ncol - len(r)) for r in rows]

    keep = [i for i in range(ncol) if any(r[i] for r in rows)]
    if len(keep) < MIN_COLS:
        return None
    rows = [[r[i] for i in keep] for r in rows]

    merged = []
    for r in rows:
        if not any(r):
            continue
        # continuation: nothing in the key column, but text further along
        if merged and not r[0] and any(r[1:]):
            for i, cell in enumerate(r):
                if cell:
                    merged[-1][i] = (merged[-1][i] + " " + cell).strip()
            continue
        merged.append(list(r))

    if len(merged) < MIN_ROWS:
        return None
    return merged


def table_cells(rows):
    """Cell text in reading order — the order extract_text() flattened them into."""
    return [c for row in rows for c in row if c]


def find_span(doc_lines_norm, cells):
    """Locate the consecutive run of content lines holding exactly these cells.

    Returns (start, end) inclusive, or None. The comparison is on the concatenated
    normalised text, so it does not matter whether the flattener split a cell across
    several lines or packed several cells onto one.
    """
    target = norm(" ".join(cells))
    if not target:
        return None
    n = len(doc_lines_norm)
    for start in range(n):
        if not doc_lines_norm[start]:
            continue
        # cheap reject: the run must begin with the table's first words
        acc = ""
        for end in range(start, n):
            if doc_lines_norm[end]:
                acc = (acc + " " + doc_lines_norm[end]).strip()
            if len(acc) > len(target):
                break
            if acc == target:
                return (start, end)
    return None


def main():
    write = "--write" in sys.argv
    docs = json.loads(DOCS.read_text())
    if isinstance(docs, dict):
        container, docs_list = docs, docs.get("documents")
    else:
        container, docs_list = None, docs

    by_source = {}
    for d in docs_list:
        by_source.setdefault(d.get("source"), []).append(d)

    # pre-normalise every candidate document once
    prepped = {}
    for src, lst in by_source.items():
        rows_ = []
        for d in lst:
            lines = [norm(strip_marker(l)) for l in str(d.get("content", "")).split("\n")]
            # a flat haystack so a table can reject most documents without a line walk
            rows_.append((d, lines, norm(" ".join(lines))))
        prepped[src] = rows_

    attached, unmatched, skipped = 0, 0, 0
    found_tables = {}

    for src, dirs in PDF_SOURCES.items():
        if src not in prepped:
            continue
        pdfs = []
        for dname in dirs:
            pdfs += sorted((BASE / dname).glob("*.pdf"))
        for pdf_path in pdfs:
            try:
                pdf = pdfplumber.open(pdf_path)
            except Exception as e:
                print(f"  ! cannot open {pdf_path.name}: {e}")
                continue
            for pno, page in enumerate(pdf.pages):
                try:
                    raws = page.extract_tables()
                except Exception:
                    continue
                for raw in raws:
                    rows = clean_table(raw)
                    if not rows:
                        skipped += 1
                        continue
                    cells = table_cells(rows)
                    hit = None
                    for candidate_rows in (rows, rows[1:] if len(rows) > MIN_ROWS else None):
                        if candidate_rows is None:
                            continue
                        cs = table_cells(candidate_rows)
                        target = norm(" ".join(cs))
                        if not target:
                            continue
                        for doc, lines, hay in prepped[src]:
                            if target not in hay:
                                continue
                            span = find_span(lines, cs)
                            if span:
                                hit = (doc, span, rows)
                                break
                        if hit:
                            break
                    if not hit:
                        unmatched += 1
                        continue
                    doc, (s, e), rows = hit
                    found_tables.setdefault(doc["id"], []).append(
                        {"start": s, "end": e, "rows": rows,
                         "page": pno, "pdf": pdf_path.name}
                    )
                    attached += 1
            pdf.close()
            print(f"  {pdf_path.name}: running total attached={attached} "
                  f"unmatched={unmatched}", flush=True)

    print(f"\nattached={attached}  unmatched={unmatched}  rejected_as_noise={skipped}")
    print(f"documents gaining a table: {len(found_tables)}")

    if not write:
        print("\n(report only — pass --write to patch output/documents.json)")
        out = BASE / "output" / "tables-report.json"
        out.write_text(json.dumps(found_tables, indent=1))
        print(f"wrote {out}")
        return

    for d in docs_list:
        tbls = found_tables.get(d.get("id"))
        if tbls:
            # overlapping spans would make the renderer skip text twice
            tbls = sorted(tbls, key=lambda t: t["start"])
            keep, last_end = [], -1
            for t in tbls:
                if t["start"] > last_end:
                    keep.append({"start": t["start"], "end": t["end"], "rows": t["rows"]})
                    last_end = t["end"]
            d["tables"] = keep
        elif "tables" in d:
            del d["tables"]

    DOCS.write_text(json.dumps(container if container is not None else docs_list,
                               ensure_ascii=False))
    print(f"patched {DOCS}")


if __name__ == "__main__":
    main()
