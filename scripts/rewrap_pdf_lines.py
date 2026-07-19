#!/usr/bin/env python3
"""Rejoin regulation text that PDF extraction split mid-sentence.

RFO was extracted with one logical paragraph per stored line. R-DFARS and the
FAR Companion were extracted straight from PDFs, so every stored line is a
PHYSICAL line of the page — chopped wherever the column ended:

    Before awarding a multiyear contract, the head of the agency must compare the cost of
    that contract to the cost of an annual procurement approach, using a present value
    analysis. Only award the multiyear contract if the analysis shows that it will result in a

The renderer emits one <p> per stored line, so those fragments get paragraph
spacing between them, can't reflow to the reader's screen, and a wrapped line
that happens to start with "(" — e.g. "(Comptroller/Chief Financial Officer)" —
gets mis-tagged as a new lettered paragraph, which then feeds the paragraph
citation levels.

This joins a line to the previous one ONLY when the previous line was left
hanging (no terminal punctuation) and the next line is clearly a continuation.
It never joins across a heading, a new enumerated item, a tabular row, or a
dot-leader table-of-contents line.

NOT applied to FMR: 303 of its 304 docs contain tabular rows, so joining there
would destroy tables. Its lower mid-sentence rate is table structure, not prose.

Only whitespace/line breaks change — an assertion compares the whitespace-
stripped text before and after, per doc. --apply to write.
"""
import argparse
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "output" / "documents.json"
SOURCES = {"r-dfars", "far-companion"}

LMARK = re.compile(r"^(L\d+:)")
# a new enumerated item starts its own paragraph: "(a)", "(1)", "(iv)", "(A)"
NEW_ITEM = re.compile(r"^\([a-zA-Z0-9]{1,4}\)")
# a numbered section/paragraph heading: "217.103-170 Multiyear…", "13.201 …"
NUM_HEAD = re.compile(r"^\d+\.\d[\d.\-]*\s")
# structural headings
GROUP_HEAD = re.compile(r"^(SUBPART|PART|PGI|ATTACHMENT)\b", re.I)
# a shouted heading line ("BUY AMERICAN—SUPPLIES")
CAPS_HEAD = re.compile(r"^[A-Z][A-Z0-9 ,.&/()—–-]{8,}$")
# tabular row (columns padded with runs of spaces) or a dot-leader TOC line
TABULAR = re.compile(r"\S {3,}\S")
DOTLEADER = re.compile(r"\.{3,}")
# the previous line is finished if it ends in sentence/clause punctuation
CLOSED = re.compile(r"[.;:?!)\"”'—–]$")


def is_heading(t):
    return bool(NUM_HEAD.match(t) or GROUP_HEAD.match(t) or CAPS_HEAD.match(t))


def unsafe(t):
    return bool(TABULAR.search(t) or DOTLEADER.search(t))


def rewrap(content):
    # out entries are [prefix, text]; prefix is the line's ORIGINAL level marker
    # or "" when the source stores no markers (FAR Companion has none — adding
    # them would be a format change, not a line-break change).
    out = []
    joins = 0
    for raw in content.split("\n"):
        m = LMARK.match(raw)
        lvl = m.group(1) if m else ""
        txt = LMARK.sub("", raw).strip()
        if not txt:
            continue
        if not out:
            out.append([lvl, txt])
            continue
        prev = out[-1]
        if (not CLOSED.search(prev[1])
                and not NEW_ITEM.match(txt)
                and not is_heading(txt)
                and not is_heading(prev[1])
                and not unsafe(txt)
                and not unsafe(prev[1])):
            prev[1] += " " + txt      # continuation of the same paragraph
            joins += 1
        else:
            out.append([lvl, txt])
    return "\n".join(l + t for l, t in out), joins


def norm(s):
    """text with all whitespace and level markers removed — must be identical
    before and after, proving only line breaks changed."""
    return re.sub(r"\s+", "", re.sub(r"L\d+:", "", s))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    docs = json.loads(DOCS.read_text(encoding="utf-8"))
    touched, total_joins = 0, 0
    for d in docs:
        if not d or d.get("source") not in SOURCES:
            continue
        content = d.get("content", "")
        if not content:
            continue
        new, joins = rewrap(content)
        if not joins:
            continue
        assert norm(new) == norm(content), f"{d['id']}: text changed, not just line breaks"
        assert new.strip(), f"{d['id']}: would empty the doc"
        # marker style must match the source exactly (all-marked or unmarked)
        had = bool(LMARK.match(content.split("\n")[0]))
        assert bool(LMARK.match(new.split("\n")[0])) == had, f"{d['id']}: marker style changed"
        assert sum(1 for l in new.split("\n") if LMARK.match(l)) == (len(new.split("\n")) if had else 0), \
            f"{d['id']}: inconsistent markers after rewrap"
        touched += 1
        total_joins += joins
        if args.apply:
            d["content"] = new

    print(f"docs rewrapped: {touched}")
    print(f"line joins:     {total_joins:,}")
    if not args.apply:
        print("\n(dry run — pass --apply to write)")
        return
    DOCS.write_text(json.dumps(docs, ensure_ascii=False), encoding="utf-8")
    print("\nWROTE documents.json")


if __name__ == "__main__":
    main()
