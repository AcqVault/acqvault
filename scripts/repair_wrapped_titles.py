#!/usr/bin/env python3
"""Rejoin section headings that the PDF wrapped across two lines.

THE DEFECT. The deviation memos wrap a long heading onto a second line:

    252.209-7008 Notice of Prohibition Relating to Organizational Conflict of
    Interest—Major Defense Acquisition Program.

The ingest took only the FIRST line as the title, so the corpus stores a heading that
stops on a dangling preposition. Two user-visible consequences:

  1. The title is copied VERBATIM into every citation, so the Cite button hands a
     contracting professional "R-DFARS 252.209-7008 — Notice of Prohibition Relating to
     Organizational Conflict of" — a citation that ends mid-phrase.
  2. The renderer strips a title ECHO from the top of the body by accumulating stored
     lines until they equal the title (titleEchoLines, assets/app.js). With a
     half-title it matches only the first line, so the remainder — "Interest—Major
     Defense Acquisition Program." — renders as a stray sentence of body text above
     the real content.

THE REPAIR. Join the continuation line back onto the title. **Only the `title` field is
written; `content` is left byte-identical**, which is what makes this safe: no
regulation text moves, and fixing the title makes titleEchoLines strip BOTH lines, so
the stray sentence stops rendering as body for free.

Per docs/CORPUS_INVARIANTS.md "When writing a corpus-rewriting script": writes a review
file first, applies only behind --apply, asserts content preservation, and keeps the
on-disk JSON format byte-exact.

    python3 scripts/repair_wrapped_titles.py            # review only
    python3 scripts/repair_wrapped_titles.py --apply    # write documents.json
"""

import json
import re
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DOCS = BASE / "output" / "documents.json"
REVIEW = BASE / "_local_archive" / "wrapped-titles-review.txt"

# A heading that stops on one of these words is unfinished. The leading \s matters:
# without it "3.501 Buying-in" matches on the "in" of a hyphenated word.
DANGLE = re.compile(
    r"\s(of|the|and|for|to|in|on|a|an|or|with|by|from|under|that|as|is|are|its|their|"
    r"between|through|within|into|upon)\s*$", re.I)

# A continuation line is short, is not a numbered paragraph, and is not the body
# starting. "As prescribed in …" is the clause's first BODY line, never a heading tail.
BODY_START = re.compile(r"^(As prescribed|TABLE\b|Table\b|\(|L\d+:\s*\()", re.I)


def strip_marker(line):
    return re.sub(r"^L\d+:\s*", "", line)


def continuation_for(doc):
    """Return the heading tail for this doc, or None."""
    title = doc.get("title", "").strip()
    if not DANGLE.search(title):
        return None
    lines = doc.get("content", "").split("\n")
    if len(lines) < 2:
        return None
    # line[0] must be the title echo; otherwise we are not looking at a wrapped heading
    if strip_marker(lines[0]).strip().rstrip(".") != title.rstrip("."):
        return None
    tail = strip_marker(lines[1]).strip()
    if not tail or BODY_START.match(tail):
        return None
    # A tail is a heading fragment, not a sentence: no interior sentence break, and it
    # should not itself read like prose running on for a whole line of a paragraph.
    if len(tail) > 140 or ". " in tail:
        return None
    # ⚠ A tail must read like WORDS. Under 252.227-7037 the next stored line is
    # "252.227-7015 252.232-7003" — a list of cross-referenced clause numbers, not the
    # rest of the heading — which would have produced the title "Validation of
    # Restrictive Markings on 252.227-7015 252.232-7003". Require real words and refuse
    # a tail that is mostly digits.
    if not re.search(r"[A-Za-z]{3,}", tail):
        return None
    if sum(c.isdigit() for c in tail) > 0.3 * len(tail):
        return None
    return tail


def main():
    apply = "--apply" in sys.argv
    raw = DOCS.read_text(encoding="utf-8")
    docs = json.loads(raw)

    fixes, skipped = [], []
    for d in docs:
        title = d.get("title", "").strip()
        if not DANGLE.search(title):
            continue
        tail = continuation_for(d)
        if tail is None:
            skipped.append((d.get("id"), title))
            continue
        joined = re.sub(r"\s+", " ", f"{title} {tail}").strip().rstrip(".")
        fixes.append((d["id"], title, joined))

    REVIEW.parent.mkdir(parents=True, exist_ok=True)
    with REVIEW.open("w", encoding="utf-8") as fh:
        fh.write(f"REJOINED HEADINGS — {len(fixes)} fix(es), {len(skipped)} left alone\n\n")
        for i, (did, old, new) in enumerate(fixes, 1):
            fh.write(f"{i:>3}. {did}\n     was: {old}\n     now: {new}\n\n")
        fh.write("\nLEFT ALONE (no recoverable continuation in the stored text)\n\n")
        for did, old in skipped:
            fh.write(f"     {did}: {old}\n")
    print(f"review written: {REVIEW.relative_to(BASE)}")
    print(f"  {len(fixes)} heading(s) rejoined, {len(skipped)} left alone")
    for did, old, new in fixes[:5]:
        print(f"    {did}\n      was: {old}\n      now: {new}")

    if not apply:
        print("\n(review only — re-run with --apply to write documents.json)")
        return 0

    before = {d["id"]: d.get("content") for d in docs}
    by_id = {d["id"]: d for d in docs}
    for did, _old, new in fixes:
        by_id[did]["title"] = new

    # THE INVARIANT: this script may only ever touch `title`. If any content moved, the
    # repair is not what it claims to be — refuse to write.
    for d in docs:
        if d.get("content") != before[d["id"]]:
            print(f"\nABORT: content changed for {d['id']} — this script must only edit titles")
            return 1

    # Byte-exact on-disk format (see CORPUS_INVARIANTS) or the diff becomes the whole file.
    DOCS.write_text(json.dumps(docs, ensure_ascii=False), encoding="utf-8")
    print(f"\napplied {len(fixes)} title fix(es) to {DOCS.relative_to(BASE)}")
    print("next: python3 scripts/gen_doc_hashes.py && python3 scripts/corpus_health.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
