#!/usr/bin/env python3
"""Repair two R-DFARS mega-docs that swallowed the PGI attachment.

The original part-4 and part-47 ingest failed to detect the "PGI 2xx" headings
that begin the Procedures, Guidance, and Information attachment (they don't
start with a bare section number), so everything after the regulation section
got absorbed into it:

  204.206 "Contracting officer's signature" — 106K chars: a scrap of PGI 204.206
    plus the entire PGI 204 attachment. The real regulation text (the photocopy/
    facsimile "considered an original signature" rule) was absent.
  247.372 "DD Form 1654…" — 12K chars: the "See PGI 247.372" pointer buried under
    the full PGI 247 text.

PGI is out of scope for AcqVault (guidance, not regulation) and is indexed
nowhere else, so the fix is to REPLACE each doc's content with the clean
regulation text (extracted by the shared parser, identified by a distinctive
phrase). id/title/anchor are preserved. Assertion-guarded; --apply to write.
"""
import argparse
import importlib.util
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "output" / "documents.json"

spec = importlib.util.spec_from_file_location("ing", REPO / "scripts" / "ingest_rdfars_missing.py")
ing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ing)

# id -> (part, section_num, distinctive phrase in the CLEAN regulation text)
FIXES = {
    "r-dfars-4-204-206": (4, "204.206", "considered an original signature"),
    "r-dfars-47-247-372": (47, "247.372", "See PGI 247.372"),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    docs = json.loads(DOCS.read_text(encoding="utf-8"))
    by_id = {d["id"]: d for d in docs if d}

    for doc_id, (part, sec, needle) in FIXES.items():
        assert doc_id in by_id, f"target doc missing: {doc_id}"
        clean = [d for d in ing.parse_part(part)
                 if d["section_num"] == sec and needle.lower() in d["content"].lower()]
        assert len(clean) == 1, f"expected 1 clean {sec}, got {len(clean)}"
        new_content = clean[0]["content"]
        # the clean regulation text must be dramatically smaller than the blob,
        # and must not itself contain a swallowed PGI attachment
        old_len = len(by_id[doc_id]["content"])
        assert len(new_content) < old_len, f"{doc_id}: replacement not smaller"
        assert new_content.count("PGI 2") <= 2, f"{doc_id}: replacement still PGI-heavy"
        print(f"{doc_id}: {old_len:,} -> {len(new_content):,} chars")
        print(f"   new: {new_content[:150]!r}")
        if args.apply:
            by_id[doc_id]["content"] = new_content

    if not args.apply:
        print("\n(dry run — pass --apply to write)")
        return
    DOCS.write_text(json.dumps(docs, ensure_ascii=False), encoding="utf-8")
    print("\nWROTE documents.json")


if __name__ == "__main__":
    main()
