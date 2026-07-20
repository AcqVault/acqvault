#!/usr/bin/env python3
"""Stop RFO container sections from carrying a byte-identical copy of a child.

The general case of the bug fixed narrowly in 1fb0260. `block_lines()` in
refresh.py let a container article skip its child's heading and absorb that
child's paragraphs, so the parent ends up holding a verbatim copy of a numbered
descendant's body:

    Subpart 2.1 Definitions      ≡  2.101 Definitions        (98,503 chars)
    1.402 Contracting officers   ≡  1.402-1 Authority
    Subpart 1.1 Framework        ≡  1.101 Framework

1fb0260 fixed the 45 where the title also CONTRADICTED the body
("52.233 [Reserved]" holding the Disputes clause). This handles the 418 where
the title merely matches, so the duplication reads as plausible — which is
exactly why it survived four corpus audits and got written into
docs/CORPUS_INVARIANTS.md twice as a non-bug.

WHY THIS IS A BUG, NOT A FEATURE: upstream, these containers have NO text of
their own. Checked every container across parts 1/3/15/33/52 that has a child
article: 46 have zero own paragraphs (their whole stored body is inherited), 6
genuinely own prose ahead of their first child. The 6 must not be touched.

DETECTION IS BY BODY IDENTITY ONLY — never by size, title or "looks duplicated".
A doc is touched only when its body is byte-identical to that of a doc whose
section number is a strict descendant of its own. Validated against upstream
ground truth over parts 1/3/15/33/52: 46/46 inherited caught, 6/6 self-owning
spared, zero false positives, zero false negatives. Rerun that validation with:

    python3 scripts/repair_rfo_container_inheritance.py --validate

NOTHING IS DELETED. The body survives verbatim at the child that owns it, which
is the very condition for touching the parent. Anchors are untouched, so deck
citations like {"t": "RFO 1.402", "u": "/rfo/part-1#FAR_1_402"} still land — on
a heading whose child renders directly beneath it on the same part page.

DRY RUN by default; --write applies.
"""
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "output" / "documents.json"
WRITE = "--write" in sys.argv
VALIDATE = "--validate" in sys.argv

NUM = re.compile(r"^(Subpart\s+[\d.]+|[\d.]+(?:-\d+)*)")


def body_of(d):
    """The doc's content with its leading title line removed."""
    content = d.get("content") or ""
    title = d.get("title") or ""
    if content.startswith(title):
        content = content[len(title):]
    return content.strip()


def number_of(title):
    m = NUM.match(title or "")
    return m.group(1) if m else None


def is_descendant(child_num, parent_num):
    """True when child_num sits strictly under parent_num in the FAR numbering.

    A plain string prefix is WRONG here and quietly corrupts the result:
    "52.204-10" prefixes "52.204-1" but is its SIBLING, not its child. Trusting
    the prefix emptied reserved leaf docs (52.204-1, 52.211-1, 52.236-1 …) and
    credited their "(Deviation Date)" line to the -10 next door. Caught by
    re-parsing the upstream pages against the repaired corpus, which is the
    check worth keeping.

    The two real relationships:
      Subpart 2.1  → 2.101      subpart digits continue into the section number
      1.402        → 1.402-1    a numbered child appends "-N"
    """
    if not child_num or not parent_num or child_num == parent_num:
        return False
    kid = child_num.replace("Subpart ", "")
    if parent_num.startswith("Subpart "):
        # Which subpart does this section belong to? FAR numbers a section as
        # the subpart digits plus two more, so 2.101 → Subpart 2.1 while
        # 3.1000 → Subpart 3.10. Prefix matching alone can't tell those apart
        # and would put 2.101 under Subpart 2.10.
        m = re.match(r"^(\d+)\.(\d+)", kid)
        if not m:
            return False
        part, digits = m.group(1), m.group(2)
        if len(digits) <= 2:
            return False
        return "{}.{}".format(part, digits[:-2]) == parent_num[len("Subpart "):]
    return kid.startswith(parent_num + "-")


def find_inherited(docs):
    """Containers whose body is a verbatim copy of a numbered descendant's.

    Inheritance CHAINS exist — Subpart 3.1 Safeguards ≡ 3.101 Standards of
    conduct ≡ 3.101-1 General, 24 of them. The owner must therefore be the
    DEEPEST descendant carrying the body, never merely the first one found:
    an intermediate link is itself a container we are about to empty, so
    crediting it would lose the text. The deepest holder has no same-body
    descendant of its own, so by construction it is never a repair target.
    """
    rfo = [d for d in docs if d.get("source") == "rfo"]
    by_body = {}
    for d in rfo:
        b = body_of(d)
        if b:
            by_body.setdefault(b, []).append(d)
    found = []
    for d in rfo:
        num = number_of(d.get("title"))
        body = body_of(d)
        if not num or not body:
            continue
        owners = [o for o in by_body[body]
                  if o is not d and is_descendant(number_of(o.get("title")), num)]
        if owners:
            deepest = max(owners, key=lambda o: (
                len(number_of(o["title"]).replace("Subpart ", "")),
                number_of(o["title"])))
            found.append((d, deepest, body))
    return found


def validate():
    """Check the detector against upstream HTML, if page snapshots are present.

    Ground truth is whether the article has paragraphs of its own BEFORE its
    first child article. If it does, its body is its own and emptying it would
    destroy text; if it does not, the whole body was inherited.

    EVERY article is checked, including childless leaves. An earlier version
    skipped leaves as "can't be containers" — which is precisely where the
    prefix-matching bug hid, since 52.204-1 is a leaf that got emptied in
    favour of its sibling 52.204-10. A validation that only looks where you
    expect the bug does not validate anything.

    Needs /tmp/rfo<part>.html snapshots; skips parts without one.
    """
    from bs4 import BeautifulSoup

    docs = json.loads(DOCS.read_text(encoding="utf-8"))
    by_anchor = {d.get("anchor"): d for d in docs if d.get("source") == "rfo"}
    flagged = {d["id"] for d, _o, _b in find_inherited(docs)}

    tp = tn = fp = fn = 0
    misses = []
    for part in (1, 3, 15, 33, 52):
        snap = Path(f"/tmp/rfo{part}.html")
        if not snap.exists():
            print(f"  part {part}: no snapshot, skipped")
            continue
        soup = BeautifulSoup(snap.read_text(encoding="utf-8"), "html.parser")
        for art in soup.find_all("article", id=re.compile(r"^FAR_")):
            if "topic" not in " ".join(art.get("class") or []):
                continue
            doc = by_anchor.get(art.get("id"))
            if not doc or not body_of(doc):
                continue
            own = []
            for el in art.find_all(["p", "li", "article"], recursive=True):
                if el.name == "article":
                    break
                text = " ".join(el.get_text(" ", strip=True).split())
                if text:
                    own.append(text)
            inherited = not own
            hit = doc["id"] in flagged
            if hit and inherited:
                tp += 1
            elif not hit and not inherited:
                tn += 1
            elif hit:
                fp += 1
                misses.append(("FALSE POSITIVE", doc["title"]))
            else:
                fn += 1
                misses.append(("false negative", doc["title"]))
    print(f"\ninherited, correctly flagged : {tp}")
    print(f"self-owning, correctly spared: {tn}")
    print(f"FALSE POSITIVES              : {fp}")
    print(f"false negatives              : {fn}")
    for kind, title in misses:
        print(f"   {kind}: {title}")
    assert fp == 0, "detector would empty a doc that owns its text — refusing"
    assert fn == 0, "detector misses a known inherited container"
    print("\ndetector matches upstream ground truth exactly.")
    return 0


def main():
    if VALIDATE:
        return validate()

    docs = json.loads(DOCS.read_text(encoding="utf-8"))
    repairs = find_inherited(docs)

    subparts = sum(1 for d, _o, _b in repairs if d["title"].startswith("Subpart"))
    total = sum(len(b) for _d, _o, b in repairs)
    print(f"{len(repairs)} containers holding a copy of a child "
          f"({subparts} subpart, {len(repairs) - subparts} section)")
    print(f"{total:,} duplicated chars\n")
    for d, owner, body in sorted(repairs, key=lambda r: -len(r[2]))[:15]:
        print(f"[{d['id']}] {d['title'][:58]}  ({len(body):,})")
        print(f"   text stays at: {owner['title'][:58]}")
    if len(repairs) > 15:
        print(f"   … and {len(repairs) - 15} more")

    if not WRITE:
        print("\ndry run — add --write to apply (--validate checks the detector).")
        return 0

    before_ids = [d["id"] for d in docs]
    before_titles = {d["id"]: d.get("title") for d in docs}
    before_content = {d["id"]: d.get("content") for d in docs}
    before_anchors = {d["id"]: d.get("anchor") for d in docs}
    targets = {d["id"] for d, _o, _b in repairs}
    preserved = [(owner["id"], body) for _d, owner, body in repairs]

    for d, _owner, _body in repairs:
        d["content"] = d["title"]

    by_id = {d["id"]: d for d in docs}

    # 1. No doc added, dropped, reordered, renamed or re-anchored; no title moved.
    assert [d["id"] for d in docs] == before_ids, "document set changed"
    assert all(d.get("title") == before_titles[d["id"]] for d in docs), "a title changed"
    assert all(d.get("anchor") == before_anchors[d["id"]] for d in docs), "an anchor moved"
    # 2. Every doc we did NOT target is byte-identical.
    assert all(d.get("content") == before_content[d["id"]]
               for d in docs if d["id"] not in targets), "an untargeted doc changed"
    # 3. Every repaired container is now exactly its own heading.
    assert all(by_id[i]["content"] == by_id[i]["title"] for i in targets), \
        "a repaired container is not title-only"
    # 4. THE POINT: every displaced body still lives, verbatim, at its owner.
    for owner_id, body in preserved:
        assert owner_id not in targets, "an owner was itself emptied — would lose text"
        assert body_of(by_id[owner_id]) == body, \
            f"{owner_id}: displaced text no longer matches its owner"

    DOCS.write_text(json.dumps(docs, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {len(repairs)} repaired containers to {DOCS}")
    print(f"{total:,} chars of duplication cleared; 0 chars lost (asserted)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
