#!/usr/bin/env python3
"""Strip swallowed PGI attachments out of R-DFARS section/clause docs.

Every DoD deviation memo bundles the regulation (Attachment A1) with a
Procedures, Guidance, and Information attachment (Attachment A2). PGI headings
look like "PGI 225.1—BUY AMERICAN—SUPPLIES" — they don't start with a bare
section number, so the original splitter never saw them as a boundary and
absorbed the ENTIRE PGI attachment into whichever section or clause happened to
precede it. 40 docs carry one, from 1.4K to 106K chars.

PGI is guidance, not regulation — it is not one of AcqVault's six sources and is
indexed nowhere else, so its presence here is an ingest error that also makes
the host doc wrong (e.g. a Buy American clause whose text runs on into PGI 225).

Fix: truncate each doc at its first PGI attachment heading, then drop the page
furniture (running headers / "Attachment A2" / page numbers) left dangling at
the new end. The regulation text before the boundary is untouched.

Assertion-guarded; writes nothing unless --apply.
"""
import argparse
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "output" / "documents.json"

# a PGI ATTACHMENT heading ("PGI 225.1—BUY AMERICAN"), not an inline cross
# reference ("see PGI 210.070, for the …") — the em/en dash heading form is the tell
PGI_HEAD = re.compile(r"^PGI\s+\d+(\.\d+)?\s*[—–]")
# a PGI section heading that follows the part heading ("PGI 225.101 General.")
PGI_SEC = re.compile(r"^PGI\s+\d+\.\d")
FURNITURE = re.compile(
    r"^(Revolutionary Federal Acquisition Regulation \(FAR\) Overhaul Part \d+"
    r"|Defense FAR Supplement \(DFARS\) Part \d+"
    r"|Attachment [A-Z]\d?"
    r"|DARS Tracking Number:.*"
    r"|Page \d+ of \d+"
    r"|\d{1,3})$"
)
LMARK = re.compile(r"^L\d+:")


def strip_doc(content):
    """Return (new_content, cut_chars) or (None, 0) if no PGI attachment."""
    lines = content.split("\n")
    cut_at = None
    for i, ln in enumerate(lines):
        bare = LMARK.sub("", ln).strip()
        if PGI_HEAD.match(bare):
            cut_at = i
            break
    if cut_at is None:
        return None, 0
    kept = lines[:cut_at]
    # drop page furniture (and any blank L-markers) dangling at the new end
    while kept:
        bare = LMARK.sub("", kept[-1]).strip()
        if not bare or FURNITURE.match(bare):
            kept.pop()
        else:
            break
    new = "\n".join(kept)
    return new, len(content) - len(new)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    docs = json.loads(DOCS.read_text(encoding="utf-8"))
    total_cut, touched = 0, []
    for d in docs:
        if not d or d.get("source") != "r-dfars":
            continue
        new, cut = strip_doc(d.get("content", ""))
        if new is None:
            continue
        # guards: never empty a doc, never lose the leading section number,
        # never leave a PGI attachment behind
        assert new.strip(), f"{d['id']}: would empty the doc"
        assert LMARK.match(new.split("\n")[0]), f"{d['id']}: broken L-format"
        first = LMARK.sub("", new.split("\n")[0]).strip()
        assert first.startswith(str(d.get("section_num") or "").strip() or first[:1]), \
            f"{d['id']}: first line no longer the section heading: {first[:60]!r}"
        assert not PGI_HEAD.search(new), f"{d['id']}: PGI attachment still present"
        touched.append((d["id"], len(d["content"]), len(new), cut))
        total_cut += cut
        if args.apply:
            d["content"] = new

    touched.sort(key=lambda x: -x[3])
    print(f"{len(touched)} docs carry a swallowed PGI attachment:\n")
    for did, before, after, cut in touched:
        print(f"  {did:26s} {before:7,} -> {after:6,}  (-{cut:,})")
    print(f"\nTOTAL PGI text removed: {total_cut:,} chars")

    if not args.apply:
        print("\n(dry run — pass --apply to write)")
        return
    DOCS.write_text(json.dumps(docs, ensure_ascii=False), encoding="utf-8")
    print("\nWROTE documents.json")


if __name__ == "__main__":
    main()
