#!/usr/bin/env python3
"""
Repair citation numbers split by a stray space — "PGI 204.202- 74" -> "PGI 204.202-74".

WHY THIS MATTERS BEYOND TIDINESS: the cross-reference linker matches a section
number as one token. A number broken after its hyphen does not match, so every
one of these is a DEAD cross-reference in both the server-rendered reader and the
in-app one — the same class of defect as the xref outage, just narrower. On
r-dfars part-4, 100 references linked and "PGI 204.202- 74" rendered as flat text.
It fails safe (no link) rather than linking to the truncated section, which is
why it went unnoticed.

The break is a PDF hyphenation/line-wrap artifact preserved by ingest, so this is
whitespace-only: no word is added, removed, or reordered. Asserted below.

⚠ WHY THIS IS NOT A BLANKET REGEX. The same shape is produced by a WELDED TABLE
COLUMN, where a Code cell lands inside the number:

    Standard weighted guidelines method (PGI 215.404- 2 971(b)(3)(i)

That is "PGI 215.404-971(b)(3)(i)" with the table's Code value 2 welded in — the
sibling row "Technology incentive (PGI 215.404-971(b)(3)(ii)) 6" proves the
reading. Joining it blindly yields 215.404-2971, a section that does not exist.
Resolution alone cannot separate the two cases: BOTH 215.404-2 and 215.404-971
exist in the corpus. So a candidate is REFUSED when another digit group resumes
after whitespace AND the wide reading resolves to a real section — that shape
belongs to repair_welded_columns.py, not here.

Usage:
    python3 scripts/repair_split_citations.py --dry-run
    python3 scripts/repair_split_citations.py --apply
"""
import argparse
import json
import re
import sys
from pathlib import Path

BASE = Path(__file__).parent.parent
DOCS = BASE / "output" / "documents.json"

# number . number - <whitespace> digits
CAND = re.compile(r"(\d{1,3}\.\d{1,4})-([ \t]+|\n)(\d+)")


def section_index(docs):
    """Every section number the corpus can actually resolve, per source."""
    idx = set()
    for d in docs:
        title = (d.get("title") or "").strip()
        m = re.match(r"((?:PGI\s+)?\d{1,3}\.\d{1,4}(?:-\d+)*)", title)
        if m:
            idx.add((d.get("source"), m.group(1).replace("PGI ", "")))
    return idx


def plan(docs, idx):
    joins, refused = [], []
    for d in docs:
        content = d.get("content") or ""
        for m in CAND.finditer(content):
            head, tail = m.group(1), m.group(3)
            after = content[m.end():m.end() + 14]
            narrow = f"{head}-{tail}"
            # Another digit group resuming after whitespace is the welded-column
            # shape. Only refuse when that WIDE reading names a real section —
            # otherwise the following digits are just the next list item
            # ("35. FAR 52.232- 28 36. FAR 15.408-2"), and the join is correct.
            nxt = re.match(r"\s+(\d+)", after)
            if nxt:
                wide = f"{head}-{nxt.group(1)}"
                if (d.get("source"), wide) in idx:
                    refused.append((d.get("source"), d.get("title", "")[:44],
                                    m.group(0).replace("\n", "\\n"), after.replace("\n", " ")))
                    continue
            joins.append((d.get("id"), d.get("source"), d.get("title", "")[:44], narrow))
    return joins, refused


def repair_content(content, idx, source):
    def sub(m):
        head, tail = m.group(1), m.group(3)
        after = content[m.end():m.end() + 14]
        nxt = re.match(r"\s+(\d+)", after)
        if nxt and (source, f"{head}-{nxt.group(1)}") in idx:
            return m.group(0)          # welded column — leave for the other script
        return f"{head}-{tail}"
    return CAND.sub(sub, content)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not (args.apply or args.dry_run):
        ap.error("choose --dry-run or --apply")

    raw = json.loads(DOCS.read_text())
    docs = raw if isinstance(raw, list) else raw["documents"]
    idx = section_index(docs)
    joins, refused = plan(docs, idx)

    print(f"split citations to join : {len(joins)}")
    print(f"refused (welded column) : {len(refused)}")
    for r in refused:
        print(f"   REFUSED  {r[0]:9} {r[1]}  '{r[2]}' followed by '{r[3].strip()}'")
        print("            -> belongs to repair_welded_columns.py, not a whitespace join")

    if args.dry_run:
        by_src = {}
        for _, src, _, _ in joins:
            by_src[src] = by_src.get(src, 0) + 1
        print("\nby source:", dict(sorted(by_src.items(), key=lambda kv: -kv[1])))
        print("\n(dry run — nothing written)")
        return

    changed = 0
    for d in docs:
        before = d.get("content") or ""
        after = repair_content(before, idx, d.get("source"))
        if after != before:
            # Whitespace-only: the word multiset must be identical once the
            # repaired numbers are re-split. Cheaper and stricter: compare the
            # texts with ALL whitespace removed.
            if re.sub(r"\s+", "", before) != re.sub(r"\s+", "", after):
                sys.exit(f"FATAL: {d.get('id')} would change more than whitespace — refusing")
            d["content"] = after
            changed += 1

    DOCS.write_text(json.dumps(raw, ensure_ascii=False, separators=(",", ":")))
    print(f"\napplied: {changed} documents rewritten, {len(joins)} citations rejoined")


if __name__ == "__main__":
    main()
