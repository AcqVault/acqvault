#!/usr/bin/env python3
"""Cut PGI guidance out of R-DFARS REGULATION documents.

scripts/strip_pgi_attachments.py handled the big case: a deviation memo's whole PGI
attachment absorbed into whichever clause preceded it. Four documents escaped it,
because the check that guards this (corpus_health "no PGI in regulation docs") matches

    PGI\\s+\\d+(\\.\\d+)?\\s*[—–]

i.e. it requires an EM-DASH after the number, which is how the 2026-07 sample happened
to be punctuated. These four use a plain heading instead —

    PGI 209.105-1 Obtaining information.

— so the gate reported PASS on 16,575 characters of guidance sitting inside rule
documents. That is the exact hazard the Guidance badge and the clay colour exist to
prevent: on an R-DFARS page this text carries neither, so it reads as regulation.

SAFE BECAUSE IT LOSES NOTHING. Every PGI section in the removed tails is already its own
document in the `pgi` source (verified per-section before cutting; a bodiless parent
heading like "PGI 209.171" is allowed to be absent, since the PGI ingest correctly keeps
only sections that have a body). The text is not deleted — it is already indexed where
it belongs, with the Guidance badge on it.

    python3 scripts/strip_pgi_tails.py            # review
    python3 scripts/strip_pgi_tails.py --apply
"""

import json
import re
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DOCS = BASE / "output" / "documents.json"
REVIEW = BASE / "_local_archive" / "pgi-tails-review.txt"

# A real PGI section heading at the start of a line, whatever punctuation follows the
# number. Deliberately NOT anchored on a dash — that assumption is the whole bug.
# One line only — with \s the match runs into the next line's "L1:" marker and an
# ordinary inline reference that merely wraps looks like a heading. KEEP IN SYNC with
# PGI_HEAD in scripts/corpus_health.py.
PGI_HEAD = re.compile(r"^(?:L\d+:)?PGI[ \t]+(\d{3}\.\d[\d.\-]*)[ \t]+[A-Z]")
# a lone attachment banner left behind after "(End of clause)" is furniture too
PGI_BANNER_ONLY = re.compile(r"^(?:L\d+:)?PGI[ \t]+PART\b", re.I)
# the attachment banner that usually precedes the first heading
PGI_BANNER = re.compile(r"^(?:L\d+:)?PGI\s+PART\b", re.I)


def main():
    apply = "--apply" in sys.argv
    docs = json.loads(DOCS.read_text(encoding="utf-8"))

    pgi_nums = set()
    for d in docs:
        if d.get("source") == "pgi":
            m = re.match(r"^PGI\s+([\d.\-]+)", d.get("title", ""))
            if m:
                pgi_nums.add(m.group(1).rstrip("."))

    cuts, refused = [], []
    for d in docs:
        if d.get("source") != "r-dfars":
            continue
        lines = d.get("content", "").split("\n")
        idx = [i for i, l in enumerate(lines)
               if PGI_HEAD.match(l.strip()) or PGI_BANNER_ONLY.match(l.strip())]
        if not idx:
            continue
        start = idx[0]
        # include the "PGI PART …" banner immediately above the first heading
        while start > 0 and PGI_BANNER.match(lines[start - 1].strip()):
            start -= 1
        tail = lines[start:]
        head = lines[:start]

        # every section in the tail must already exist as its own PGI document
        nums = [PGI_HEAD.match(l.strip()).group(1).rstrip(".")
                for l in tail if PGI_HEAD.match(l.strip())]
        missing = [n for n in nums if n not in pgi_nums
                   # a parent heading with no body of its own is legitimately not a doc
                   and not any(p.startswith(n + "-") for p in pgi_nums)]
        if missing:
            refused.append((d["id"], missing))
            continue
        if not [l for l in head if l.strip()]:
            refused.append((d["id"], ["would empty the document"]))
            continue
        # A table's span is a LINE INDEX. Cutting lines it points into leaves the table
        # describing text the document no longer holds — which is what happened to
        # 252.225-7964 the first time this ran. Refuse and handle it deliberately.
        if any(t.get("end", 0) > start for t in (d.get("tables") or [])):
            refused.append((d["id"], ["a table span reaches into the cut"]))
            continue
        cuts.append((d, head, tail, nums))

    REVIEW.parent.mkdir(parents=True, exist_ok=True)
    with REVIEW.open("w", encoding="utf-8") as fh:
        fh.write(f"PGI TAILS CUT FROM R-DFARS DOCS — {len(cuts)} cut, {len(refused)} refused\n\n")
        for d, head, tail, nums in cuts:
            kept, gone = len("\n".join(head)), len("\n".join(tail))
            fh.write(f"{d['id']}  {d['title']}\n")
            fh.write(f"    keeps {kept} chars, removes {gone}\n")
            fh.write(f"    sections removed (all present in the pgi source): {', '.join(nums)}\n")
            fh.write(f"    last line kept    : {head[-1][:90] if head else ''}\n")
            fh.write(f"    first line removed: {tail[0][:90]}\n\n")
        for did, why in refused:
            fh.write(f"REFUSED {did}: {why}\n")

    print(f"review: {REVIEW.relative_to(BASE)}")
    print(f"  {len(cuts)} document(s) to cut, {len(refused)} refused")
    total = 0
    for d, head, tail, nums in cuts:
        removed = len("\n".join(tail))
        total += removed
        print(f"    {d['id']:<32} -{removed:>6} chars  ({', '.join(nums)})")
    for did, why in refused:
        print(f"    REFUSED {did}: {why}")
    print(f"  total guidance removed from rule documents: {total:,} chars")

    if not apply:
        print("\n(review only — re-run with --apply)")
        return 0

    for d, head, tail, nums in cuts:
        while head and not head[-1].strip():
            head.pop()
        d["content"] = "\n".join(head)
    DOCS.write_text(json.dumps(docs, ensure_ascii=False), encoding="utf-8")
    print(f"\napplied {len(cuts)} cut(s)")
    print("next: python3 scripts/gen_doc_hashes.py && python3 scripts/corpus_health.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
