#!/usr/bin/env python3
"""Rejoin wrapped headings whose continuation is NOT in the stored content.

scripts/repair_wrapped_titles.py fixes the case where the heading's second line was
stored as the first CONTENT line. For 14 more documents the ingest consumed the whole
heading, so the tail exists only in the source PDF — this script goes and gets it.

Same discipline: review file first, --apply to write, ONLY the `title` field is touched
(asserted), and a tail must read like words. Same trap guarded: under 252.203-7002 the
next PDF line is a TABLE ROW ("10 USC / Whistleblower Rights 4701"), and under
252.227-7037 it is a list of clause numbers — neither is a heading tail.

    python3 scripts/repair_wrapped_titles_pdf.py            # review
    python3 scripts/repair_wrapped_titles_pdf.py --apply
"""

import json
import re
import sys
from pathlib import Path

import pdfplumber

BASE = Path(__file__).resolve().parent.parent
DOCS = BASE / "output" / "documents.json"
SRC = BASE / "R-DFARS"
REVIEW = BASE / "_local_archive" / "wrapped-titles-pdf-review.txt"

DANGLE = re.compile(
    r"\s(of|the|and|for|to|in|on|a|an|or|with|by|from|under|that|as|is|are|its|their|"
    r"between|through|within|into|upon)\s*$", re.I)

_cache = {}


def pdf_lines(path):
    if path not in _cache:
        with pdfplumber.open(path) as pdf:
            _cache[path] = "\n".join(pg.extract_text() or "" for pg in pdf.pages).split("\n")
    return _cache[path]


def good_tail(tail):
    """A heading tail reads like words and completes a phrase."""
    t = tail.strip()
    if not t or len(t) > 120:
        return False
    if t.startswith("("):                       # a numbered paragraph = body started
        return False
    if re.match(r"^(As prescribed|See PGI|Follow the procedures|TABLE|Table)\b", t, re.I):
        return False
    if not re.search(r"[A-Za-z]{3,}", t):       # must contain real words
        return False
    if sum(c.isdigit() for c in t) > 0.25 * len(t):   # table rows / clause-number lists
        return False
    if re.search(r"\b\d{1,3}\.\d{2,}", t):      # another section number = a new heading
        return False
    return True


def find_tail(doc):
    fn = doc.get("filename", "")
    path = SRC / fn
    if not path.exists():
        return None, "no source pdf"
    title = doc["title"].strip()
    # The PDF may or may not carry the "PGI " prefix the corpus stores.
    probes = [title, re.sub(r"^PGI\s+", "", title)]
    lines = pdf_lines(path)
    for i, line in enumerate(lines):
        ls = line.strip()
        for probe in probes:
            if ls == probe or (ls.startswith(probe) and len(ls) - len(probe) < 3):
                parts = []
                for j in range(i + 1, min(len(lines), i + 3)):
                    nxt = lines[j].strip()
                    if not good_tail(nxt):
                        break
                    parts.append(nxt)
                    if nxt.endswith("."):       # heading complete
                        break
                if parts:
                    return " ".join(parts), None
                return None, "next line is not a heading tail"
    return None, "title line not found in pdf"


def main():
    apply = "--apply" in sys.argv
    docs = json.loads(DOCS.read_text(encoding="utf-8"))
    targets = [d for d in docs if DANGLE.search(d.get("title", "").strip())]

    fixes, skipped = [], []
    for d in targets:
        tail, why = find_tail(d)
        if not tail:
            skipped.append((d["id"], d["title"], why))
            continue
        joined = re.sub(r"\s+", " ", f"{d['title'].strip()} {tail}").strip().rstrip(".")
        # If the join STILL dangles, or runs past any real heading length, the stored
        # "title" was never a heading — 216.506-702 is a mis-ingested PARAGRAPH, and
        # joining it just produces a 250-character title that also ends mid-phrase.
        if DANGLE.search(joined) or len(joined) > 170:
            skipped.append((d["id"], d["title"], "not a heading (join still dangles or over-long)"))
            continue
        fixes.append((d["id"], d["title"], joined))

    REVIEW.parent.mkdir(parents=True, exist_ok=True)
    with REVIEW.open("w", encoding="utf-8") as fh:
        fh.write(f"PDF-SOURCED HEADING REJOINS — {len(fixes)} fix(es), {len(skipped)} left alone\n\n")
        for i, (did, old, new) in enumerate(fixes, 1):
            fh.write(f"{i:>3}. {did}\n     was: {old}\n     now: {new}\n\n")
        fh.write("\nLEFT ALONE\n\n")
        for did, old, why in skipped:
            fh.write(f"     {did}: {old}\n        reason: {why}\n")
    print(f"review: {REVIEW.relative_to(BASE)}")
    print(f"  {len(fixes)} rejoined, {len(skipped)} left alone")
    for did, old, new in fixes:
        print(f"    {did}\n      now: {new}")
    for did, old, why in skipped:
        print(f"    SKIP {did} — {why}")

    if not apply:
        print("\n(review only — re-run with --apply)")
        return 0

    before = {d["id"]: d.get("content") for d in docs}
    by_id = {d["id"]: d for d in docs}
    for did, _old, new in fixes:
        by_id[did]["title"] = new
    for d in docs:
        if d.get("content") != before[d["id"]]:
            print(f"ABORT: content changed for {d['id']}")
            return 1
    DOCS.write_text(json.dumps(docs, ensure_ascii=False), encoding="utf-8")
    print(f"\napplied {len(fixes)} title fix(es)")
    print("next: python3 scripts/gen_doc_hashes.py && python3 scripts/corpus_health.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
