#!/usr/bin/env python3
"""Corpus health check — every regression class we've actually been bitten by.

Run this after ANY corpus change (re-ingest, re-extract, repair, new source).
refresh.py calls it automatically; run it standalone with:

    python3 scripts/corpus_health.py

Each failing check names the script that fixes it. Exit code 1 on any FAIL so a
pipeline can gate on it. Every check here exists because the problem shipped to
production at least once:

  tofu glyphs ......... 109 private-use chars rendered as boxes (2026-07-17)
  inline L-markers .... 45 docs showed literal "L1:" to readers (2026-07-18)
  page furniture ...... 563 docs had running headers wedged mid-section
  PGI attachments ..... 40 docs swallowed the whole PGI attachment (843K chars)
  PDF line breaks ..... r-dfars 43% / FC 57% of breaks fell mid-sentence
  memo coverage ....... 6 R-DFARS parts were downloaded but never ingested
  [Reserved] swallow .. 45 Part 52 group headers held a child's clause (2026-07-19)
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "output" / "documents.json"

LMARK = re.compile(r"^L\d+:")
# a clause-group container: bare section number, no -N child suffix
RESERVED_GROUP = re.compile(r"^(\d+\.\d+) \[Reserved\]$")
PGI_HEAD = re.compile(r"PGI\s+\d+(\.\d+)?\s*[—–]")
FURNITURE = re.compile(
    r"^(Attachment [A-Z]\d?"
    r"|DARS Tracking Number:.*"
    r"|Revolutionary Federal Acquisition Regulation \(FAR\) Overhaul Part \d+"
    r"|Defense FAR Supplement \(DFARS\) Part \d+"
    r"|Page \d+ of \d+)$"
)
# sources whose text is prose extracted from PDFs and must read as paragraphs.
# FMR is excluded on purpose: 303 of its 304 docs are tabular, so its line
# breaks are table structure, not wrapped prose.
PROSE_SOURCES = {"r-dfars", "far-companion"}
MIDSENT_LIMIT = 5.0          # percent of line breaks that may fall mid-sentence
# expected marker style per source: True = every line carries an L-marker
MARKER_STYLE = {"r-dfars": True, "far-companion": False, "fmr": False}

results = []


def check(name, ok, detail, fix=None):
    results.append((name, ok, detail, fix))


def lines_of(d):
    return [l for l in (d.get("content") or "").split("\n") if l.strip()]


def body_of(d):
    """The doc's content with its leading title line removed."""
    content = d.get("content") or ""
    title = d.get("title") or ""
    if content.startswith(title):
        content = content[len(title):]
    return content.strip()


def main():
    docs = [d for d in json.loads(DOCS.read_text(encoding="utf-8")) if d]
    live = [d for d in docs if d.get("source") != "compass"]

    # ── structural ────────────────────────────────────────────────────────────
    ids = [d["id"] for d in docs]
    dups = len(ids) - len(set(ids))
    check("unique ids", dups == 0, f"{dups} duplicate id(s)")

    empty = [d["id"] for d in docs if not (d.get("content") or "").strip()]
    check("no empty docs", not empty, f"{len(empty)} empty: {empty[:3]}")

    # ── tofu / private-use glyphs ─────────────────────────────────────────────
    pua = sum(1 for d in docs for ch in (d.get("content") or "")
              if 0xE000 <= ord(ch) <= 0xF8FF)
    check("no tofu glyphs", pua == 0, f"{pua} private-use char(s) would render as boxes",
          "scripts/scrub_pua_glyphs.py")

    # ── level markers leaking into visible text ───────────────────────────────
    inline = [d["id"] for d in docs
              if any(re.search(r"L\d+:", LMARK.sub("", l)) for l in lines_of(d))]
    check("no inline L-markers", not inline,
          f"{len(inline)} doc(s) would show literal 'L1:' to readers: {inline[:3]}",
          "scripts/fix_inline_lmarkers.py")

    # ── marker style consistent per source ────────────────────────────────────
    style_bad = []
    for d in docs:
        want = MARKER_STYLE.get(d.get("source"))
        if want is None:
            continue
        ls = lines_of(d)
        if want and any(not LMARK.match(l) for l in ls):
            style_bad.append(d["id"])
        if not want and any(LMARK.match(l) for l in ls):
            style_bad.append(d["id"])
    check("marker style consistent", not style_bad,
          f"{len(style_bad)} doc(s) mix marker styles: {style_bad[:3]}")

    # ── memo page furniture wedged into the text ──────────────────────────────
    furn = [d["id"] for d in docs
            if any(FURNITURE.match(LMARK.sub("", l).strip()) for l in lines_of(d))]
    check("no page furniture", not furn,
          f"{len(furn)} doc(s) contain running headers/page numbers: {furn[:3]}",
          "scripts/strip_page_furniture.py")

    # ── swallowed PGI attachments ─────────────────────────────────────────────
    pgi = [d["id"] for d in docs if PGI_HEAD.search(d.get("content") or "")]
    check("no PGI attachments", not pgi,
          f"{len(pgi)} doc(s) swallowed a PGI attachment (out of scope): {pgi[:3]}",
          "scripts/strip_pgi_attachments.py")

    # ── [Reserved] headers that swallowed a child clause ──────────────────────
    # A container titled "52.233 [Reserved]" that carries the full Disputes
    # clause is lying twice: it says reserved while holding text, and it
    # duplicates 52.233-1. The tell is structural — the body is byte-identical
    # to one of its own numbered children, which is what inheritance produces.
    # Genuine reserved leaves are untouched by this: they have no children, so
    # sharing a stock "(Deviation Date)" line with a peer never trips it.
    bodies = defaultdict(list)
    for d in live:
        bodies[body_of(d)].append(d)
    swallow = []
    for d in live:
        m = RESERVED_GROUP.match(d.get("title") or "")
        body = body_of(d)
        if not m or not body:
            continue
        if any(o is not d and (o.get("title") or "").startswith(m.group(1) + "-")
               for o in bodies[body]):
            swallow.append(d["id"])
    check("no [Reserved] header swallowed a clause", not swallow,
          f"{len(swallow)} [Reserved] header(s) hold a child's clause text: {swallow[:3]}",
          "scripts/repair_rfo_reserved_swallow.py")

    # ── largest docs, informational ───────────────────────────────────────────
    # Deliberately NOT a failure: size alone can't tell a swallow from a
    # legitimately huge unit. 252.225-7036 is 160K because it carries 15
    # Alternates; FMR stores one doc per CHAPTER (Housing Allowances is 257K);
    # RFO "Subpart 2.1 Definitions" is 98K of real definitions. The precise
    # swallow detector is the PGI-attachment check above. This just surfaces
    # drift for a human to eyeball.
    biggest = {}
    for d in docs:
        s = d.get("source")
        if len(d.get("content") or "") > biggest.get(s, ("", 0))[1]:
            biggest[s] = (d["id"], len(d["content"]))

    # ── PDF prose reads as paragraphs, not physical page lines ────────────────
    for src in sorted(PROSE_SOURCES):
        mid = tot = 0
        for d in (x for x in docs if x.get("source") == src):
            ls = [LMARK.sub("", l).strip() for l in lines_of(d)]
            for a, b in zip(ls, ls[1:]):
                if not a or not b:
                    continue
                tot += 1
                if not re.search(r"[.;:—)]$", a) and re.match(r"^[a-z]", b):
                    mid += 1
        pct = (mid / tot * 100) if tot else 0.0
        check(f"{src} reads as paragraphs", pct <= MIDSENT_LIMIT,
              f"{pct:.1f}% of line breaks fall mid-sentence (limit {MIDSENT_LIMIT}%)",
              "scripts/rewrap_pdf_lines.py")

    # ── every downloaded memo actually made it into the corpus ────────────────
    BENIGN_NO_SECTIONS = {"48"}   # cover-letter-only memo, no section text
    have = {str(d["part"]) for d in docs if d.get("source") == "r-dfars"}
    missing = []
    for pdf in sorted((REPO / "R-DFARS").glob("DoD_RFO_Deviation_Part-*.pdf")):
        m = re.search(r"Part-(\d+)\.pdf$", pdf.name)
        if not m:
            continue
        part = str(int(m.group(1)))
        if part not in BENIGN_NO_SECTIONS and part not in have:
            missing.append(part)
    check("all memos ingested", not missing,
          f"parts downloaded but NOT in the corpus: {missing}",
          "scripts/ingest_rdfars_missing.py")

    # ── report ────────────────────────────────────────────────────────────────
    by_src = defaultdict(int)
    for d in live:
        by_src[d.get("source")] += 1
    print(f"corpus: {len(live):,} searchable docs  ({dict(by_src)})")
    print("largest doc per source (informational): "
          + ", ".join(f"{s} {n:,}" for s, (_i, n) in sorted(biggest.items())) + "\n")
    failed = 0
    for name, ok, detail, fix in results:
        if ok:
            print(f"  PASS  {name}")
        else:
            failed += 1
            print(f"  FAIL  {name} — {detail}")
            if fix:
                print(f"        fix: python3 {fix}")
    print()
    if failed:
        print(f"{failed} check(s) FAILED — corpus is not ship-ready.")
        return 1
    print("All corpus health checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
