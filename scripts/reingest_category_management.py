#!/usr/bin/env python3
"""
Re-read the Category Management Buying Guide so its tables survive.

This guide is mostly tables — tier tables, vehicle tables, pathway comparisons — and
none of them could be recovered by matching text, for a reason that is structural
rather than fixable in the matcher: extract_text() reads a page in visual order, so
for side-by-side columns a wrapped cell's second line lands after the OTHER columns'
first lines. The cell is never contiguous in the flattened text, so only 34% of cells
could be found at all, and a table that cannot be located cannot be drawn without
either duplicating the prose or hiding some of it.

So the pages are re-read instead of re-matched. For each page pdfplumber gives the
ruled tables and their bounding boxes; the prose is whatever text falls OUTSIDE those
boxes. That yields clean paragraphs and structured tables with no overlap between
them, which is what the corpus wanted in the first place.

Documents keep their existing ids — the guide chunks by category ("Part 6 -
Information Technology") and those titles are stable — so nothing pinned breaks.

Usage:
    python3 scripts/reingest_category_management.py            # report only
    python3 scripts/reingest_category_management.py --write    # apply
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber

BASE = Path(__file__).resolve().parent.parent
PDF = BASE / "Category Management" / "category-management-buying-guide.pdf"
DOCS = BASE / "output" / "documents.json"

# The guide's category sections, in the order they appear.
CATEGORIES = [
    "Overview", "Buying Pathway", "Facilities & Construction", "Human Capital",
    "Industrial Products and Services", "Information Technology", "Medical",
    "Office Management", "Professional Services", "Security & Protection",
    "Transportation & Logistics Services", "Travel",
]


def norm(s):
    return re.sub(r"\s+", " ", str(s or "")).strip()


def clean_rows(raw):
    rows = [[norm(c) for c in r] for r in raw]
    if not rows:
        return None
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    keep = [i for i in range(width) if any(r[i] for r in rows)]
    if len(keep) < 2:
        return None
    rows = [[r[i] for i in keep] for r in rows]

    merged = []
    for r in rows:
        if not any(r):
            continue
        if merged and not r[0] and any(r[1:]):
            for i, cell in enumerate(r):
                if cell:
                    merged[-1][i] = (merged[-1][i] + " " + cell).strip()
            continue
        merged.append(list(r))
    return merged if len(merged) >= 2 else None


def page_content(page):
    """Prose outside the ruled tables, plus the tables themselves."""
    boxes = []
    tables = []
    for t in page.find_tables():
        rows = clean_rows(t.extract())
        if rows:
            boxes.append(t.bbox)
            tables.append(rows)

    def outside(obj):
        for x0, top, x1, bottom in boxes:
            if (obj["x0"] >= x0 - 1 and obj["x1"] <= x1 + 1
                    and obj["top"] >= top - 1 and obj["bottom"] <= bottom + 1):
                return False
        return True

    text = (page.filter(outside).extract_text() or "") if boxes else (page.extract_text() or "")
    return [l.strip() for l in text.split("\n") if l.strip()], tables


def main():
    write = "--write" in sys.argv
    pdf = pdfplumber.open(PDF)

    # assign each page to the category section that most recently started
    current = CATEGORIES[0]
    per_cat = {c: {"lines": [], "tables": []} for c in CATEGORIES}
    for page in pdf.pages:
        lines, tables = page_content(page)
        head = " ".join(lines[:3])
        for c in CATEGORIES:
            if re.search(re.escape(c), head, re.I):
                current = c
                break
        bucket = per_cat[current]
        for rows in tables:
            start = len(bucket["lines"])
            for r in rows:
                bucket["lines"].append(" ".join(c for c in r if c))
            bucket["tables"].append({"start": start, "end": len(bucket["lines"]) - 1,
                                     "rows": rows})
        bucket["lines"].extend(lines)
    pdf.close()

    corpus = json.loads(DOCS.read_text())
    existing = {d["title"]: d for d in corpus if d.get("source") == "category-management"}
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    rebuilt = 0
    total_tables = 0
    for i, cat in enumerate(CATEGORIES, start=1):
        title = f"Part {i} - {cat}"
        prev = existing.get(title)
        if not prev:
            print(f"  ! no existing doc titled {title!r} — skipping to keep ids stable")
            continue
        b = per_cat[cat]
        if not b["lines"]:
            continue
        # the tables were appended before the prose of each page; offset for the title
        content = title + "\n\n" + "\n".join(b["lines"])
        shift = 2
        tbls = [{"start": t["start"] + shift, "end": t["end"] + shift, "rows": t["rows"]}
                for t in b["tables"]]
        total_tables += len(tbls)
        old_len = len(prev.get("content", ""))
        print(f"  {title:44} {old_len:>6} -> {len(content):>6} chars, {len(tbls)} table(s)")
        if write:
            prev["content"] = content
            prev["indexed_at"] = now
            if tbls:
                prev["tables"] = tbls
            elif "tables" in prev:
                del prev["tables"]
        rebuilt += 1

    print(f"\nsections rebuilt: {rebuilt}, tables recovered: {total_tables}")
    if write:
        DOCS.write_text(json.dumps(corpus, ensure_ascii=False))
        print(f"wrote {DOCS}")
    else:
        print("(report only — pass --write to apply)")


if __name__ == "__main__":
    main()
