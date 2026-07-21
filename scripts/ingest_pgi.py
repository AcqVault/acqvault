#!/usr/bin/env python3
"""
Extract the PGI attachments from the R-DFARS deviation PDFs.

Every DoD deviation memo bundles two attachments: the regulation (A1) and the
Procedures, Guidance, and Information (A2). scripts/strip_pgi_attachments.py
correctly truncated the PGI out of the regulation documents — its headings
("PGI 225.1—BUY AMERICAN—SUPPLIES") don't start with a bare section number, so the
original splitter never treated them as a boundary and absorbed an entire PGI
attachment into whichever clause happened to precede it.

That fix left the PGI itself nowhere: 2.0 million characters across 42 of the 46
deviation PDFs — 55% of their text — indexed in no source. It is also the half a
contracting officer reaches for most often, because it is the procedural companion
to the rule.

This script reads it back out, chunked on PGI section headings.

STATUS: PROTOTYPE — the measurement is trustworthy, the structure is NOT yet.
Run against all 46 PDFs it recovers 1,984,222 characters in 397 sections across 42
parts, which is the number that sizes the gap. But the structure it produces is not
good enough to put in front of a researcher:

  * 6 sections exceed 60K characters, so headings are still being missed and whole
    runs are being absorbed into the section above (PGI 225.771 swallows 506K).
  * The tiering is thin — 21,990 lines land at L0 against ~8,000 across L1-L4 —
    because a PDF wraps a paragraph across lines and every continuation line looks
    like a fresh top-level one.

Shipping it in this state would reproduce the exact defect the RFO re-ingest just
fixed: a flat, hard-to-follow wall of text. The RFO escaped that because
acquisition.gov publishes it as structured HTML; there is no HTML for the DEVIATED
PGI in these memos, and substituting the standard DFARS PGI would be the wrong
text. So this needs a real heading grammar and a line-rewrapping pass first —
scripts/rewrap_pdf_lines.py is the starting point.

It writes a SEPARATE file, not documents.json. Adding a source touches scattered
enumerations (index.html, app.js liveSources/PARTS_BY_SOURCE/SOURCE_LABELS/
SOURCE_URLS, api/_seo.js SOURCES+STYLE, vercel.json, output/library.json) and
changes a visible claim on the home page, so the wiring is a decision for the
owner; the extraction is not.

Usage:
    python3 scripts/ingest_pgi.py            # build _local_archive/pgi-preview.json
"""

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber

BASE = Path(__file__).resolve().parent.parent
SRC = BASE / "R-DFARS"
OUT = BASE / "_local_archive" / "pgi-preview.json"   # gitignored: a preview, not a corpus artefact

# The attachment boundary, and the section headings inside it.
PGI_HEAD = re.compile(r"^PGI\s+\d+(\.\d+)?\s*[—–]")
PGI_SEC = re.compile(r"^PGI\s+(\d+\.\d[\w.\-]*)\s*(.*)$")
# A heading is "PGI 204.201 Unique procurement instrument identifiers"; a wrapped
# cross-reference is "PGI 204.303-70 (b)(2)) for a list of applicable codes". Both
# start a line with PGI and a section number, so the number alone cannot decide it.
# What separates them is what follows: a heading continues with a capitalised title
# word, never a paragraph token or lower-case prose.
TITLE_AFTER = re.compile(r"^[A-Z][A-Za-z].{2,}")


def is_heading(rest, prev_line):
    if rest and not TITLE_AFTER.match(rest):
        return False
    # a heading starts a block: the previous kept line ended a sentence
    if prev_line and not re.search(r"[.:;]$", prev_line.strip()):
        return False
    return True

# Running headers, tracking numbers and bare page numbers repeat on every page.
FURNITURE = re.compile(
    r"^(Revolutionary Federal Acquisition Regulation \(FAR\) Overhaul Part \d+"
    r"|Defense FAR Supplement \(DFARS\) Part \d+"
    r"|Attachment\s+[A-Z]\d?"
    r"|DARS Tracking Number:.*"
    r"|Page \d+ of \d+"
    r"|PGI\s+\d+(\.\d+)?\s*[—–].*"
    r"|\d{1,3})$"
)

# Paragraph tokens, deepest last — the same tiering the rest of the corpus uses.
LEVELS = [
    (re.compile(r"^\(([a-z])\)\s"), 1),
    (re.compile(r"^\((\d{1,2})\)\s"), 2),
    (re.compile(r"^\(([ivx]{1,4})\)\s"), 3),
    (re.compile(r"^\(([A-Z])\)\s"), 4),
]


def level_for(line):
    for pat, lvl in LEVELS:
        if pat.match(line):
            return lvl
    return 0


def part_of(name):
    m = re.search(r"Part[_-](\d+)", name, re.I)
    return str(int(m.group(1))) if m else None


def main():
    pdfs = sorted(SRC.glob("*.pdf"))
    docs = []
    skipped = []

    for pdf_path in pdfs:
        part = part_of(pdf_path.name)
        with pdfplumber.open(pdf_path) as pdf:
            lines = []
            for page in pdf.pages:
                lines += (page.extract_text() or "").split("\n")

        start = None
        for i, raw in enumerate(lines):
            if PGI_HEAD.match(raw.strip()) or PGI_SEC.match(raw.strip()):
                start = i
                break
        if start is None:
            skipped.append(pdf_path.name)
            continue

        # split the attachment on PGI section headings
        current = None
        prev = ""
        for raw in lines[start:]:
            line = raw.strip()
            if not line or FURNITURE.match(line):
                continue
            m = PGI_SEC.match(line)
            if m and not is_heading(m.group(2).strip(), prev):
                m = None
            if m:
                if current:
                    docs.append(current)
                num, rest = m.group(1), m.group(2).strip()
                title = f"PGI {num} {rest}".strip().rstrip(".")
                current = {
                    "num": num,
                    "title": title,
                    "part": part,
                    "lines": [],
                    "file": pdf_path.name,
                }
                continue
            if current is None:
                # Text before the first heading we accept must not vanish. Opening a
                # part-level section keeps it addressable instead of silently
                # dropping it, which is what a stricter heading rule would otherwise
                # do to everything above the first match.
                current = {
                    "num": f"{part}-intro",
                    "title": f"PGI Part {part} — introductory text",
                    "part": part,
                    "lines": [],
                    "file": pdf_path.name,
                }
            current["lines"].append(f"L{level_for(line)}:{line}")
            prev = line
        if current:
            docs.append(current)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    out = []
    for d in docs:
        if not d["lines"]:
            continue
        content = d["title"] + "\n\n" + "\n".join(d["lines"])
        out.append({
            "title": d["title"],
            "content": content,
            "part": d["part"],
            "id": hashlib.sha1(f"pgi-{d['num']}".encode()).hexdigest()[:16],
            "source": "pgi",
            "source_label": "DFARS PGI",
            "filename": d["file"],
            "status": "Active deviation",
            "indexed_at": now,
        })

    OUT.write_text(json.dumps(out, ensure_ascii=False))
    chars = sum(len(d["content"]) for d in out)
    print(f"PGI sections extracted: {len(out)}")
    print(f"characters: {chars:,}")
    print(f"parts covered: {len(sorted({d['part'] for d in out if d['part']}))}")
    print(f"PDFs with no PGI attachment: {len(skipped)}")
    short = [d for d in out if len(d["content"]) < 120]
    print(f"sections under 120 chars: {len(short)}")
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
