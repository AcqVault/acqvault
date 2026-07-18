#!/usr/bin/env python3
"""Restore individual R-DFARS sections the original ingest dropped.

The site audit (2026-07-17) found sections missing from parts that WERE ingested:
  - Five leading sections skipped entirely (xxx.001 Definitions/Applicability +
    242.001-70) — the old splitter missed the first heading of the attachment.
  - Three same-number siblings where the memo has TWO sections sharing a number
    and only one was kept: 233.170 ("Limited information disclosure" vs
    "Protested acquisitions…"), 233.205-70 ("Limitations on payment" vs "Disputes
    clause"), and 205.302 (a clean "$9M threshold" version vs the detailed
    reporting version). The two 205.302 texts have contradictory "(ii)" content,
    so they can't be merged — both are surfaced as distinct docs instead.

Non-destructive: every restore is an ADD. Existing docs (and their anchors/URLs)
are untouched; siblings that would collide on id get a numeric suffix. Uses the
same parser as ingest_rdfars_missing.py so schema/format match exactly.
Assertion-guarded; writes a review file unless --merge.
"""
import argparse
import importlib.util
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "output" / "documents.json"
REVIEW = REPO / "output" / "_rdfars_restores.json"

spec = importlib.util.spec_from_file_location("ing", REPO / "scripts" / "ingest_rdfars_missing.py")
ing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ing)

# (part, section_num, substring that must appear in the intended section's content)
# — the substring disambiguates same-number siblings and guards against grabbing
# the wrong occurrence.
MANIFEST = [
    (10, "210.001", "market research appropriate"),
    (22, "222.001", "Labor advisor"),
    (39, "239.001", "national security"),
    (42, "242.001-70", "Interagency agreements"),
    (44, "244.001", "Acceptable purchasing system"),
    (33, "233.170", "Limited information disclosure"),
    (33, "233.205-70", "Limitations on payment"),
    (5, "205.302", "threshold for DoD awards is $9 million"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--merge", action="store_true")
    args = ap.parse_args()

    docs = json.loads(DOCS.read_text(encoding="utf-8"))
    existing_ids = {d["id"] for d in docs if d}

    restores = []
    for part, sec, needle in MANIFEST:
        parsed = [d for d in ing.parse_part(part) if d["section_num"] == sec and needle.lower() in d["content"].lower()]
        assert parsed, f"could not extract {sec} (part {part}) matching {needle!r}"
        assert len(parsed) == 1, f"ambiguous match for {sec}: {len(parsed)} candidates"
        d = parsed[0]
        # if the base id already holds a DIFFERENT section, suffix this sibling
        base = d["id"]
        if base in existing_ids or any(x["id"] == base for x in restores):
            n = 2
            while f"{base}-{n}" in existing_ids or any(x["id"] == f"{base}-{n}" for x in restores):
                n += 1
            d["id"] = f"{base}-{n}"
        restores.append(d)

    # assertions
    ids = [d["id"] for d in restores]
    assert len(ids) == len(set(ids)), "duplicate ids among restores"
    for d in restores:
        assert d["content"].startswith(("L0:", "L1:")) and len(d["content"]) > 80, f"thin/bad content: {d['id']}"
        assert d["id"] not in existing_ids, f"id already in corpus: {d['id']}"
    print(f"{len(restores)} sections to restore:")
    for d in restores:
        print(f"  {d['section_num']:16s} id={d['id']:26s} len={len(d['content']):5d}  {d['title'][:48]}")

    if not args.merge:
        REVIEW.write_text(json.dumps(restores, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\nWrote review file: {REVIEW}  (run with --merge to apply)")
        return

    docs.extend(restores)
    DOCS.write_text(json.dumps(docs, ensure_ascii=False), encoding="utf-8")
    print(f"\nMERGED: +{len(restores)} docs")


if __name__ == "__main__":
    main()
