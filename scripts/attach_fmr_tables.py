#!/usr/bin/env python3
"""
Recover the FMR's ruled tables from the official combined policy PDF and attach each
to the doc whose page range holds it. Called by scripts/ingest_fmr.py after reflow
(LAYOUT_CONTRACT rule 1b: rewrap first, THEN attach tables — spans are line indices).

Each doc carries `_pages` = [first, last] (1-based) from the ingest, so a table is only
ever tested against the one document its page can belong to.

The safety rules are the corpus-wide ones (scripts/extract_tables.py):
  * document `content` is never modified, only a `tables` field is added;
  * a table is placed only where its cells match the flattened text, on the
    separator-stripped form (ordered first, then the tight unordered fallback);
  * and it is refused unless every word in the span it would replace is reproduced by
    a cell, because the renderers draw the table INSTEAD of that text (rule 7).

pdfplumber over ~3,000 pages is slow, so raw page tables are cached next to the PDF
(<pdf>.tables.json, in the git-ignored _local_archive). Delete it to re-extract.
"""

import importlib.util
import json
import re
from collections import Counter
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("et", BASE / "scripts" / "extract_tables.py")
et = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(et)


def page_tables(pdf_path, pages):
    cache_path = Path(str(pdf_path) + ".tables.json")
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    todo = sorted(p for p in pages if str(p) not in cache)
    if todo:
        import pdfplumber
        with pdfplumber.open(pdf_path) as pdf:
            for n, p in enumerate(todo):
                try:
                    cache[str(p)] = pdf.pages[p - 1].extract_tables()
                except Exception:
                    cache[str(p)] = []
                if n % 200 == 199:
                    cache_path.write_text(json.dumps(cache))
                    print(f"  tables: {n + 1}/{len(todo)} pages")
        cache_path.write_text(json.dumps(cache))
    return cache


_W = re.compile(r"[a-z0-9]+")


def find_span_words(line_words, cells, min_cover=0.9):
    """Fallback for pdftotext -layout text, where a wrapped cell's continuation lands on
    the next physical line BETWEEN its neighbours' text, so neither the ordered nor the
    unordered character match can see the table. Find the run of lines whose words are
    all reproduced by the table's cells (the rule-7 coverage test, by construction) and
    which reproduce at least `min_cover` of the table's words. Only runs that start where
    the previous line does NOT fit are tried, so a match is the whole run, never a tail."""
    need = Counter(w for c in cells for w in _W.findall(c.lower()))
    total = sum(need.values())
    if total < 6:
        return None
    vocab = set(need)
    fits = [bool(ws) and set(ws) <= vocab for ws in line_words]
    best = None
    for s0, ok in enumerate(fits):
        if not ok or (s0 > 0 and fits[s0 - 1]):
            continue
        have, got, e = need.copy(), 0, s0 - 1
        for i in range(s0, len(line_words)):
            ws = line_words[i]
            if not ws:
                e = i if got else e          # blank lines inside a table are fine
                continue
            c = Counter(ws)
            if any(have[w] < n for w, n in c.items()):
                break
            have.subtract(c)
            got += len(ws)
            e = i
        if got >= min_cover * total and (best is None or got > best[0]):
            best = (got, s0, e)
    if not best:
        return None
    s0, e = best[1], best[2]
    while e > s0 and not line_words[e]:
        e -= 1
    return (s0, e)


def attach(docs, pdf_path):
    pages = {p for d in docs for p in range(d["_pages"][0], d["_pages"][1] + 1)}
    cache = page_tables(pdf_path, pages)
    attached = unmatched = refused = 0
    for d in docs:
        lines = [et.norm(et.strip_marker(l)) for l in d["content"].split("\n")]
        hay, owner = et.build_haystack(lines)
        line_words = [_W.findall(l.lower()) for l in lines]
        found = []
        for p in range(d["_pages"][0], d["_pages"][1] + 1):
            for raw in cache.get(str(p), []):
                rows = et.clean_table(raw)
                if not rows:
                    continue
                placed = False
                for cand in (rows, rows[1:] if len(rows) > et.MIN_ROWS else None):
                    if cand is None:
                        continue
                    cells = et.table_cells(cand)
                    span = (et.find_span(lines, cells, hay, owner) or et.find_span_unordered(cells, hay, owner)
                            or find_span_words(line_words, cells))
                    if not span:
                        continue
                    if not et.span_is_covered(lines, span, cells):
                        refused += 1
                        continue
                    found.append({"start": span[0], "end": span[1], "rows": rows})
                    placed = True
                    break
                if not placed:
                    unmatched += 1
        found.sort(key=lambda t: t["start"])
        keep, last = [], -1
        for t in found:                      # drop overlaps (a table split across pages, etc.)
            if t["start"] > last:
                keep.append(t)
                last = t["end"]
        if keep:
            d["tables"] = keep
            attached += len(keep)
    print(f"tables attached: {attached} on {sum(1 for d in docs if d.get('tables'))} docs  "
          f"(unmatched {unmatched}, refused as unsafe {refused})")
