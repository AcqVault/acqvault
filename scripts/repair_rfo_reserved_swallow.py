#!/usr/bin/env python3
"""Repair RFO Part 52 clause-group headers that swallowed their first child clause.

Upstream, acquisition.gov nests the Part 52 clause groups as container articles:

    <article id="FAR_52_233"><h2>52.233 [Reserved]</h2>
        <article id="FAR_52_233_1"><h3>52.233-1 Disputes</h3> …the clause…

The container carries NO text of its own — the group number itself is reserved
and the substance lives in the -1/-2/-3 children. But the ingest rule in
refresh.py block_lines() says "child headings encountered before any text are
skipped (containers inherit their first child's text)", so the container walked
past its child's <h3> and absorbed that child's entire body.

Result: 35 docs titled "52.NNN [Reserved]" that carry a full clause. "52.233
[Reserved]" holds the whole Disputes clause (4,943 chars) — the same text that
already lives correctly under "52.233-1 Disputes".

Same mis-split class as the PGI-swallow (scripts/strip_pgi_attachments.py) and
the FC wrapped-heading fix (scripts/repair_fc_wrapped_titles.py).

WHICH WAY IS IT WRONG? Verified both directions before writing this, because a
"[Reserved]" doc with a body could equally mean the TITLE is wrong (section not
really reserved). It is not: for all 35, the live page's container <h2> reads
"[Reserved]" verbatim and has zero own paragraphs before its first child
article, and pdfs/rfo.pdf prints "52.202 [Reserved]" immediately followed by
"52.202-1 Definitions". Both sources agree — the title is right, the body is
misattached. This script asserts the PDF half of that on every run.

NOTHING IS DELETED. A doc is only touched when its body is byte-identical to a
sibling child's body, which is the proof the text survives at its correct
address. Docs failing that test are reported and skipped, never guessed at.

SCOPE: 45 docs, not the 35 first reported. The reported set used a >400-char
filter; below it sit 10 more group headers (52.201, 52.204, 52.207, 52.208,
52.211, 52.213, 52.236, 52.239, 52.240, 52.251) that inherited exactly one line,
"(Deviation Date)", from their child. Same bug, trivial payload — confirmed
upstream that those containers also carry zero text of their own. They are
included so the invariant can be stated without an arbitrary size cutoff: a
[Reserved] group container has no body at all. The signature is structural (an
exact sibling twin), and it separates cleanly — 45 docs with a twin, 59 already
correctly empty, nothing in between.

The recurrence fix lives in refresh.py (block_lines no longer lets a [Reserved]
container inherit a child's text) and in scripts/corpus_health.py.

DRY RUN by default; --write applies.
"""
import json
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "output" / "documents.json"
PDF = REPO / "pdfs" / "rfo.pdf"
WRITE = "--write" in sys.argv

# A clause-group container: a bare section number, no -N child suffix.
GROUP_RESERVED = re.compile(r"^(\d+\.\d+) \[Reserved\]$")


def body_of(doc):
    """The doc's content with its leading title line removed."""
    content = doc.get("content") or ""
    title = doc.get("title") or ""
    if content.startswith(title):
        content = content[len(title):]
    return content.strip()


def pdf_reserved_groups():
    """Group numbers the source PDF prints as '<num> [Reserved]' headings."""
    text = "\n".join(p.get_text() for p in fitz.open(PDF))
    return {m.group(1) for m in
            re.finditer(r"(?m)^\s*(\d+\.\d+)\s+\[Reserved\]\s*$", text)}


def main():
    docs = json.loads(DOCS.read_text(encoding="utf-8"))
    rfo = [d for d in docs if d.get("source") == "rfo"]
    reserved_in_pdf = pdf_reserved_groups()

    bodies = {}                                   # child body -> [titles]
    for d in rfo:
        bodies.setdefault(body_of(d), []).append(d)

    repairs, skipped = [], []
    for d in rfo:
        m = GROUP_RESERVED.match(d.get("title") or "")
        if not m:
            continue
        num = m.group(1)
        body = body_of(d)
        if not body:
            continue                              # already correct — nothing swallowed

        # The text must already live under a -N child of this same group.
        owners = [o for o in bodies.get(body, [])
                  if o is not d and (o.get("title") or "").startswith(num + "-")]
        if not owners:
            skipped.append((d, "no sibling child holds this text verbatim"))
            continue
        if num not in reserved_in_pdf:
            skipped.append((d, "source PDF does not print this group as [Reserved]"))
            continue
        repairs.append((d, owners[0], body))

    print(f"{len(repairs)} swallowed clause-group headers to repair")
    if skipped:
        print(f"{len(skipped)} SKIPPED (not provably safe — left alone):")
        for d, why in skipped:
            print(f"   [{d['id']}] {d['title']} — {why}")
    print()
    for d, owner, body in repairs:
        print(f"[{d['id']}] {d['title']}  ({len(body):,} chars)")
        print(f"   text stays at: {owner['title']}  [{owner['id']}]")

    if not WRITE:
        print("\ndry run — add --write to apply.")
        return 0

    before_ids = [d["id"] for d in docs]
    before_titles = {d["id"]: d.get("title") for d in docs}
    before_content = {d["id"]: d.get("content") for d in docs}
    targets = {d["id"] for d, _o, _b in repairs}
    # Snapshot every displaced body next to the id that must still hold it.
    preserved = [(owner["id"], body) for _d, owner, body in repairs]

    for d, _owner, _body in repairs:
        d["content"] = d["title"]                 # how a real reserved doc is stored

    by_id = {d["id"]: d for d in docs}

    # 1. No doc added, dropped, reordered or renamed; no title touched.
    assert [d["id"] for d in docs] == before_ids, "document set changed"
    assert all(d.get("title") == before_titles[d["id"]] for d in docs), "a title changed"
    # 2. Every doc we did NOT target is byte-identical.
    assert all(d.get("content") == before_content[d["id"]]
               for d in docs if d["id"] not in targets), "an untargeted doc changed"
    # 3. Every repaired doc now reads exactly as a reserved doc does.
    assert all(by_id[i]["content"] == by_id[i]["title"] for i in targets), \
        "a repaired doc is not title-only"
    # 4. THE POINT: every character removed still lives, verbatim, at its true address.
    for owner_id, body in preserved:
        assert body_of(by_id[owner_id]) == body, \
            f"{owner_id}: displaced text no longer matches its owner"
        assert body and body in by_id[owner_id]["content"], \
            f"{owner_id}: displaced text missing from owner content"

    DOCS.write_text(json.dumps(docs, ensure_ascii=False), encoding="utf-8")
    moved = sum(len(b) for _i, b in preserved)
    print(f"\nwrote {len(repairs)} repaired headers to {DOCS}")
    print(f"{moved:,} chars of duplicated clause text cleared; 0 chars lost (asserted)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
