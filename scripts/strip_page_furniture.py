#!/usr/bin/env python3
"""Remove memo page furniture that landed INSIDE R-DFARS regulation text.

When a page break falls mid-section, the PDF's running header gets extracted
along with the regulation and ends up wedged between paragraphs, e.g. 203.903
reads "…will be deemed to have made a disclosure. Attachment A1 DARS Tracking
Number: 2026-O0031 Revolutionary Federal Acquisition Regulation (FAR) Overhaul
Part 3 Defense FAR Supplement (DFARS) Part 203 Page 6 of 14 (5) Contracting
officer actions…".

Only whole lines that are EXACTLY a furniture element are dropped, so regulation
text that merely mentions one of these phrases is untouched. Assertion-guarded;
--apply to write.
"""
import argparse
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "output" / "documents.json"

LMARK = re.compile(r"^L\d+:")
FURNITURE = re.compile(
    r"^(Attachment [A-Z]\d?"
    r"|DARS Tracking Number:.*"
    r"|Revolutionary Federal Acquisition Regulation \(FAR\) Overhaul Part \d+"
    r"|Defense FAR Supplement \(DFARS\) Part \d+"
    r"|Page \d+ of \d+)$"
)
# NOTE: a bare number line is deliberately NOT treated as furniture — only 13
# exist and some are real values inside regulation text (e.g. "637"), so the
# risk of deleting content outweighs removing a stray page number.


def clean(content):
    kept, removed = [], 0
    for ln in content.split("\n"):
        bare = LMARK.sub("", ln).strip()
        if bare and FURNITURE.match(bare):
            removed += 1
            continue
        kept.append(ln)
    return "\n".join(kept), removed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    docs = json.loads(DOCS.read_text(encoding="utf-8"))
    touched, total_lines = [], 0
    for d in docs:
        # every source: the memo-specific patterns can't match non-memo text, and
        # "Page N of M" furniture also turns up in FMR chapters.
        if not d:
            continue
        content = d.get("content", "")
        new, removed = clean(content)
        if not removed:
            continue
        assert new.strip(), f"{d['id']}: would empty the doc"
        # marker style must survive: r-dfars lines are all L-marked, FMR/FC have
        # none — assert the new first line matches the ORIGINAL style, don't
        # assume a marker exists.
        had = bool(LMARK.match(content.split("\n")[0]))
        assert bool(LMARK.match(new.split("\n")[0])) == had, f"{d['id']}: marker style changed"
        touched.append((d["id"], removed, len(d["content"]) - len(new)))
        total_lines += removed
        if args.apply:
            d["content"] = new

    print(f"{len(touched)} docs carry embedded page furniture ({total_lines} lines):\n")
    for did, lines, chars in sorted(touched, key=lambda x: -x[1]):
        print(f"  {did:26s} {lines:2d} line(s), -{chars} chars")

    if not args.apply:
        print("\n(dry run — pass --apply to write)")
        return
    DOCS.write_text(json.dumps(docs, ensure_ascii=False), encoding="utf-8")
    print("\nWROTE documents.json")


if __name__ == "__main__":
    main()
