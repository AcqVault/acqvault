#!/usr/bin/env python3
"""Repair R-DFARS docs whose L-markers were joined with spaces instead of newlines.

Corpus content is stored one logical line per row, each prefixed with its ingest
level marker ("L0:", "L1:"), rows separated by newlines. An older repair pass
rebuilt some sections with ' '.join(...) instead of '\\n'.join(...), so their
markers ended up INSIDE a single line:

    L0:203.903 Policy. L1:(1) Prohibition. 10 U.S.C. 4701 prohibits ...

The renderer only strips a LEADING marker, so every subsequent "L1:" was shown
to the reader as literal text — 37 of them visible on /r-dfars/part-3 alone.
This splits those rows back onto their own lines, restoring both the paragraph
rendering and the per-paragraph citation levels.

Assertion-guarded; --apply to write.
"""
import argparse
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "output" / "documents.json"

INLINE = re.compile(r"\s+(L\d+:)")
LMARK = re.compile(r"^L\d+:")


def has_inline(content):
    return any(re.search(r"L\d+:", LMARK.sub("", ln)) for ln in content.split("\n"))


def fix(content):
    # put every embedded marker back at the start of its own line
    return INLINE.sub(r"\n\1", content)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    docs = json.loads(DOCS.read_text(encoding="utf-8"))
    touched = []
    for d in docs:
        if not d or d.get("source") != "r-dfars":
            continue
        content = d.get("content", "")
        if not has_inline(content):
            continue
        new = fix(content)
        # guards: text must be preserved (only whitespace between marker and
        # previous token changes), and no marker may remain mid-line
        assert not has_inline(new), f"{d['id']}: inline markers survive"
        strip = lambda s: re.sub(r"\s+", "", re.sub(r"L\d+:", "", s))
        assert strip(new) == strip(content), f"{d['id']}: text changed, not just line breaks"
        touched.append((d["id"], content.count("\n") + 1, new.count("\n") + 1))
        if args.apply:
            d["content"] = new

    print(f"{len(touched)} docs had inline L-markers (rows -> proper lines):\n")
    for did, before, after in touched:
        print(f"  {did:26s} {before:3d} line(s) -> {after:3d}")

    if not args.apply:
        print("\n(dry run — pass --apply to write)")
        return
    DOCS.write_text(json.dumps(docs, ensure_ascii=False), encoding="utf-8")
    print("\nWROTE documents.json")


if __name__ == "__main__":
    main()
