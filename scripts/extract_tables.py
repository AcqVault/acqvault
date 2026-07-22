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
# NOT rfo: since the HTML re-ingest the RFO carries the publisher's own tables, which
# are better than anything recoverable from the PDF. Re-running it here would replace
# 56 structured tables with whatever the PDF pass could match.
PDF_SOURCES = {
    "r-dfars": ["R-DFARS"],
    # The PGI ships inside the same deviation PDFs, and 83 of the 95 ruled tables in
    # them sit in that attachment — unreachable until the PGI became a source.
    "pgi": ["R-DFARS"],
    "far-companion": ["FAR Companion"],
    "category-management": ["Category Management"],
    "afi-63-138": ["DAFI 63-138"],
}

# Sources whose text came from a PDF but whose TABLES are hand-built, because the PDF
# flattened them into unusable cell runs (scripts/attach_dafi_tables.py). This pass can
# never match them, so without this set the clear-branch below deletes them — which is
# exactly what happened at 1aac202: adding the PGI to PDF_SOURCES silently dropped the
# DAFI's 5 tables, and Part 2 went back to drawing captions with nothing underneath.
# The existing guard only protects sources OUTSIDE PDF_SOURCES; these are inside it.
HAND_ATTACHED = {"afi-63-138"}

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


def tight(s):
    """Comparison form with every separator removed.

    Matching on words failed too often for reasons that have nothing to do with the
    table being the right one: the flattener hyphenates across a line break, a page
    header lands in the middle of a long table, a cell wraps so a space appears where
    the PDF had none. Dropping everything that is not alphanumeric removes all of
    those as sources of disagreement while still requiring the characters themselves
    to match exactly, in order.
    """
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def build_haystack(lines_norm):
    """Concatenated tight text, plus the line each character came from."""
    hay = []
    owner = []
    for i, line in enumerate(lines_norm):
        t = tight(line)
        if not t:
            continue
        hay.append(t)
        owner.extend([i] * len(t))
    return "".join(hay), owner


FURNITURE = re.compile(
    r"^(Revolutionary Federal Acquisition Regulation \(FAR\) Overhaul Part \d+"
    r"|Defense FAR Supplement \(DFARS\) Part \d+"
    r"|Attachment\s+[A-Z]\d?"
    r"|DARS Tracking Number:.*"
    r"|Page \d+ of \d+"
    r"|\d{1,3})$", re.I)

def span_is_covered(lines_norm, span, cells):
    """Refuse any match where drawing the table would hide text.

    The renderers replace the whole matched run with the table, so every word inside
    that run must be reproduced by a cell. The unordered fallback can otherwise pick
    a region that merely CONTAINS the table's words — one FAR Companion example
    spanned 3.3x the table's own text — and rendering it would quietly delete the
    difference from the page. No table is better than a table that eats a sentence.
    """
    start, end = span
    # Running headers and page numbers land inside a table that crosses a page break.
    # They are page furniture, not regulation text, and replacing the run with the
    # table is the right way to lose them — so they do not count as hidden content.
    kept = [l for l in lines_norm[start:end + 1] if not FURNITURE.match((l or "").strip())]
    span_words = re.findall(r"[a-z0-9]+", " ".join(kept).lower())
    cell_words = re.findall(r"[a-z0-9]+", " ".join(cells).lower())
    from collections import Counter
    have = Counter(cell_words)
    for w in span_words:
        if have[w] <= 0:
            return False
        have[w] -= 1
    return True

def find_span_unordered(cells, hay, owner):
    """Fallback for tables the flattener did not read row by row.

    extract_text() walks a page in visual order, which for a multi-column table with
    wrapped cells is not the row-major order extract_tables() returns. The Category
    Management guide is almost entirely such tables, and not one of its eighteen
    matched in order.

    So: require every substantial cell to be present, and require the region holding
    them to be tight — no wider than three times the table's own text. Order is not
    required, position is. A loose version of this would happily staple a table onto
    whichever paragraph happened to share a few words with it, which in a buying
    guide full of near-identical tier tables is a real risk, so the bar stays high:
    at least three distinct cells of six characters or more, all found.
    """
    probes = sorted({tight(c) for c in cells if len(tight(c)) >= 6}, key=len, reverse=True)
    if len(probes) < 3:
        return None
    positions = []
    for pr in probes:
        i = hay.find(pr)
        if i < 0:
            return None                      # a cell that is nowhere: wrong document
        positions.append((i, i + len(pr) - 1))
    lo = min(p[0] for p in positions)
    hi = max(p[1] for p in positions)
    span_len = hi - lo + 1
    table_len = len(tight(" ".join(cells)))
    if span_len > max(table_len * 3, table_len + 400):
        return None                          # scattered across the document, not a table
    return (owner[lo], owner[hi])


def find_span(doc_lines_norm, cells, hay=None, owner=None):
    """Locate the run of content lines the table was flattened into.

    Returns (start, end) inclusive, or None. Matching happens on the tight form, so a
    table split by a page break still resolves; the span it returns covers the
    intervening lines, which is what we want — the renderer replaces the whole run
    with the table, taking any stray running header out of the reader's way.
    """
    target = tight(" ".join(cells))
    if not target or len(target) < 12:
        return None
    if hay is None:
        hay, owner = build_haystack(doc_lines_norm)
    idx = hay.find(target)
    if idx < 0:
        return None
    return (owner[idx], owner[idx + len(target) - 1])


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
            hay, owner = build_haystack(lines)
            rows_.append((d, lines, hay, owner))
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
                        target = tight(" ".join(cs))
                        if not target or len(target) < 12:
                            continue
                        for doc, lines, hay, owner in prepped[src]:
                            if target not in hay:
                                continue
                            span = find_span(lines, cs, hay, owner)
                            if span and span_is_covered(lines, span, cs):
                                hit = (doc, span, rows)
                                break
                        if hit:
                            break
                    if not hit:
                        for candidate_rows in (rows, rows[1:] if len(rows) > MIN_ROWS else None):
                            if candidate_rows is None:
                                continue
                            cs = table_cells(candidate_rows)
                            for doc, lines, hay, owner in prepped[src]:
                                span = find_span_unordered(cs, hay, owner)
                                if span and span_is_covered(lines, span, cs):
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
        elif "tables" in d and d.get("source") in PDF_SOURCES and d.get("source") not in HAND_ATTACHED:
            # Only clear tables for the sources this pass actually looked at. Without
            # the guard, excluding a source from PDF_SOURCES silently deletes the
            # tables it got from somewhere better — which is exactly what happened to
            # the RFO's 56 HTML tables the first time this ran after that exclusion.
            del d["tables"]

    DOCS.write_text(json.dumps(container if container is not None else docs_list,
                               ensure_ascii=False))
    print(f"patched {DOCS}")


if __name__ == "__main__":
    main()
