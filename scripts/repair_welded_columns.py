#!/usr/bin/env python3
"""Restore reading order where PDF column extraction welded two paragraphs together.

THE DEFECT. Some deviation memos extract in an order that interleaves text from two
places. r-dfars-1-201-201-71 stored:

    (iii) Will be used on a repetitive basis and—
    more members of the public (see FAR 1.105); or                  <- (A)'s tail, orphaned
    (A) Imposes a new requirement ... from 10 or that contained in the FAR or DFARS.
                                              ^^^^ (A)'s opening welded to (B)'s tail
    (B) Has any cost or administrative impact on contractors or offerors beyond

The words are all present; the ORDER is wrong. So the document says something the
regulation does not — LAYOUT_CONTRACT.md rule 2, "reading order must be provably
preserved from the source".

THE REPAIR IS SELF-VALIDATING. The source PDF has the correct order, so this looks for a
CONTIGUOUS window of source words whose multiset is exactly equal to the stored body's
multiset. Equality proves the window is the same text — nothing gained, nothing lost —
so if the ORDER differs, the window is the corrected reading and the corpus is wrong.
When no such window exists the document is left alone: an unproven reconstruction of a
regulation is worse than a known-imperfect line break.

Level markers are re-derived from each rebuilt line's own paragraph token, which is what
the renderers do anyway; a line with no token inherits the previous line's level.

    python3 scripts/repair_welded_columns.py            # review
    python3 scripts/repair_welded_columns.py --apply
"""

import argparse
import collections
import json
import re
import sys
from pathlib import Path

import pdfplumber

# Reuse the rewrapper rather than re-implementing it: rebuilding from the PDF yields
# PHYSICAL page lines, and shipping those would fix the reading order while breaking
# LAYOUT_CONTRACT rule 1 (one logical paragraph per stored line).
sys.path.insert(0, str(Path(__file__).resolve().parent))
from rewrap_pdf_lines import rewrap as _rewrap

BASE = Path(__file__).resolve().parent.parent
DOCS = BASE / "output" / "documents.json"
SRC = BASE / "R-DFARS"
REVIEW = BASE / "_local_archive" / "welded-columns-review.txt"

WORD = re.compile(r"\w+")
strip_mark = lambda l: re.sub(r"^L\d+:", "", l)
words = lambda s: WORD.findall(s.lower())

# Page furniture the corpus correctly strips; it must not break window contiguity.
FURNITURE = re.compile(
    r"^\s*(?:Page\s+\d+\s+of\s+\d+"
    r"|Attachment\s+A\d*"
    r"|DARS\s+Tracking\s+Number:.*"
    r"|Class\s+Deviation\s*[—-].*"
    r"|Defense\s+(?:Federal\s+Acquisition\s+Regulation\s+Supplement|FAR\s+Supplement).*"
    r"|DFARS\s+PART\s+\d+.*"
    r"|\d+\s*)$", re.I)

PARA_TOKEN = re.compile(r"^\(([A-Za-z0-9]{1,4})\)")

_cache = {}


def pdf_stream(fn):
    """Furniture-filtered PDF as (word list, per-word line index, line texts)."""
    if fn in _cache:
        return _cache[fn]
    p = SRC / fn
    if not p.exists():
        _cache[fn] = None
        return None
    with pdfplumber.open(p) as pdf:
        raw = "\n".join(pg.extract_text() or "" for pg in pdf.pages).split("\n")
    lines = [l.strip() for l in raw if l.strip() and not FURNITURE.match(l.strip())]
    ws, owner = [], []
    for i, l in enumerate(lines):
        for w in words(l):
            ws.append(w)
            owner.append(i)
    _cache[fn] = (ws, owner, lines)
    return _cache[fn]


def find_window(stream, target):
    """A contiguous source window whose word multiset equals `target` exactly."""
    ws, owner, lines = stream
    n = len(target)
    if n == 0 or n > len(ws):
        return None
    want = collections.Counter(target)
    cur = collections.Counter(ws[:n])
    if cur == want:
        return 0, n
    for i in range(1, len(ws) - n + 1):
        out, inn = ws[i - 1], ws[i + n - 1]
        cur[out] -= 1
        if not cur[out]:
            del cur[out]
        cur[inn] += 1
        if cur == want:
            return i, i + n
    return None


def rebuild(stream, lo, hi):
    """The window's own source lines, in order, trimmed to the window."""
    ws, owner, lines = stream
    out, seen = [], []
    for k in range(lo, hi):
        li = owner[k]
        if not seen or seen[-1] != li:
            seen.append(li)
    for li in seen:
        out.append(lines[li])
    return out


def relevel(new_lines, old_lines):
    """Re-derive L-markers from each line's paragraph token; keep the source's style."""
    had = any(l.startswith("L") and ":" in l[:4] for l in old_lines)
    if not had:
        return new_lines
    depth = {1: "L1:", 2: "L2:", 3: "L3:", 4: "L4:"}
    out, last = [], "L0:"
    for i, t in enumerate(new_lines):
        m = PARA_TOKEN.match(t)
        if i == 0:
            lvl = "L0:"                      # title echo
        elif m:
            tok = m.group(1)
            if tok.isdigit():
                lvl = depth[2]
            elif tok.isupper():
                lvl = depth[4]
            elif re.fullmatch(r"i{1,3}|iv|v|vi{0,3}|ix|x", tok):
                lvl = depth[3]
            else:
                lvl = depth[1]
            last = lvl
        else:
            lvl = "L0:"                      # a continuation of the line above
        out.append(lvl + t)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only", help="restrict to one document id")
    args = ap.parse_args()

    docs = json.loads(DOCS.read_text(encoding="utf-8"))
    repairs, refused = [], []

    for d in docs:
        if d.get("source") not in ("r-dfars", "pgi"):
            continue
        if args.only and d["id"] != args.only:
            continue
        if d.get("tables"):
            continue                          # line-index spans; never renumber under them
        lines = d["content"].split("\n")
        has_orphan = any(l.startswith("L0:") and re.match(r"^[a-z]", strip_mark(l).strip())
                         for l in lines[1:])
        if not has_orphan:
            continue
        stream = pdf_stream(d.get("filename", ""))
        if not stream:
            refused.append((d["id"], "no source pdf"))
            continue
        body = words(" ".join(strip_mark(l) for l in lines))
        win = find_window(stream, body)
        if not win:
            refused.append((d["id"], "no source window matches this text exactly"))
            continue
        lo, hi = win
        src_words = stream[0][lo:hi]
        if src_words == body:
            continue                          # order already correct
        raw_lines = rebuild(stream, lo, hi)
        # A compound split at the page break ("indefinite-delivery indefinite-" /
        # "quantity contract") must rejoin WITHOUT a space, or the repair trades a
        # reading-order defect for "indefinite- quantity".
        joined = []
        for t in raw_lines:
            if joined and joined[-1].endswith("-") and re.match(r"^[a-z]", t):
                joined[-1] = joined[-1] + t.split(" ", 1)[0]
                rest = t.split(" ", 1)[1:] 
                if rest:
                    joined.append(rest[0])
            else:
                joined.append(t)
        rebuilt = relevel(joined, lines)
        # order first, then paragraphs — the same order a fresh ingest must follow
        wrapped, _ = _rewrap("\n".join(rebuilt))
        new_lines = wrapped.split("\n")
        # The whole point: same words, corrected order. A repair that would change the
        # words is not a repair — refuse it and say so rather than abort the run or,
        # worse, write a reconstruction of a regulation that nothing verified.
        # A fill-in form or a ruled table extracts as visual-order fragments in BOTH
        # arrangements — 252.217-7026's "TABLE Line Items / ______ Stock Number …" is
        # no more readable reordered than as stored. Reading order is a PROSE property;
        # reshuffling table cells is churn, not repair.
        if re.search(r"_{3,}", "\n".join(new_lines)):
            refused.append((d["id"], "tabular/fill-in content — reading order is not a prose defect here"))
            continue
        # ⚠ MULTISET EQUALITY IS NOT ENOUGH ON ITS OWN. A window can match the words
        # while being OFFSET onto a neighbouring clause when a phrase repeats: for
        # 252.222-7004 the matching window began at the PREVIOUS clause's "(End of
        # clause)", and the rebuild hoisted that line to the top of the document. The
        # window must therefore start where the section starts — anchor on the title.
        if words(strip_mark(new_lines[0]) if new_lines else "")[:6] != words(strip_mark(lines[0]))[:6]:
            refused.append((d["id"], "matching window does not start at this section's heading"))
            continue
        after = collections.Counter(words(" ".join(strip_mark(l) for l in new_lines)))
        if after != collections.Counter(body):
            delta_add = list((after - collections.Counter(body)).elements())[:4]
            delta_del = list((collections.Counter(body) - after).elements())[:4]
            refused.append((d["id"], f"rebuild would change the words (+{delta_add} -{delta_del})"))
            continue
        repairs.append((d, lines, new_lines))

    REVIEW.parent.mkdir(parents=True, exist_ok=True)
    with REVIEW.open("w", encoding="utf-8") as fh:
        fh.write(f"WELDED-COLUMN REPAIRS — {len(repairs)} document(s), {len(refused)} left alone\n\n")
        for d, old, new in repairs:
            fh.write(f"{d['id']}  {d['title']}\n")
            fh.write("  BEFORE\n")
            for l in old:
                fh.write(f"    {strip_mark(l)[:110]}\n")
            fh.write("  AFTER\n")
            for l in new:
                fh.write(f"    {strip_mark(l)[:110]}\n")
            fh.write("\n")
        fh.write("\nLEFT ALONE\n")
        for did, why in refused:
            fh.write(f"  {did}: {why}\n")

    print(f"review: {REVIEW.relative_to(BASE)}")
    print(f"  {len(repairs)} document(s) with corrected reading order")
    for d, old, new in repairs:
        print(f"    {d['id']:<34} {d['title'][:46]}")
    print(f"  {len(refused)} left alone (no exact source window / no pdf)")

    if not args.apply:
        print("\n(review only — re-run with --apply)")
        return 0

    by_id = {d["id"]: d for d in docs}
    for d, old, new in repairs:
        by_id[d["id"]]["content"] = "\n".join(new)
    DOCS.write_text(json.dumps(docs, ensure_ascii=False), encoding="utf-8")
    print(f"\napplied {len(repairs)} repair(s)")
    print("next: python3 scripts/gen_doc_hashes.py && python3 scripts/corpus_health.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
