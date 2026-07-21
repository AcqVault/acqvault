#!/usr/bin/env python3
"""
Move the DAFI tables into the corpus so both readers can draw them.

DAFI 63-138's five tables — the SADA thresholds by S-CAT, the certification levels,
the requirements approval authorities — were hand-rebuilt in assets/app.js because
the PDF flattens them into unusable runs of cells. The in-app reader shows the
rebuilt table and skips the flattened text. The server-rendered part pages, which are
what a search engine indexes and what a link drops you onto, had no such code: they
printed the caption "Table 2.1." and then nothing. Eight captions on Part 2, zero
tables.

Rather than copy 7KB of table data into the SSR renderer and hope the two stay in
step, the tables move into the corpus as the `tables` field every source now uses.
Both renderers pick them up through the same generic path, and the client's bespoke
DAFI table code stops firing on its own: spliceBrowseTables replaces the span before
normalizeBrowseLines ever sees the caption line.

Note on the no-hidden-text rule the other table passes enforce: it is deliberately
not applied here. The span covers the caption and the flattened cells, and the
flattened cells are precisely the garbage the hand-rebuilt table exists to replace.
Hiding them is the intent, and is already what the in-app reader does today.

Usage:
    python3 scripts/attach_dafi_tables.py            # report only
    python3 scripts/attach_dafi_tables.py --write    # apply
"""

import json
import re
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DOCS = BASE / "output" / "documents.json"
TABLES = Path(sys.argv[sys.argv.index("--tables") + 1]) if "--tables" in sys.argv else None

# KEEP IN SYNC with dafiTableKey() in assets/app.js
CAPTIONS = [
    (re.compile(r"^Table\s+2\.1\.\s+United States Air Force", re.I), "2.1"),
    (re.compile(r"^Table\s+2\.2\.\s+United States Space Force", re.I), "2.2"),
    (re.compile(r"^Table\s+2\.3\.\s+Certification Levels", re.I), "2.3"),
    (re.compile(r"^Table\s+3\.1\.\s+USAF Requirements", re.I), "3.1"),
    (re.compile(r"^Table\s+3\.2\.\s+USSF Requirements", re.I), "3.2"),
]
# KEEP IN SYNC with dafiParagraphMatch() — a numbered DAFI paragraph ends the table
DAFI_PARA = re.compile(r"^(\d+(?:\.\d+){1,4})\.?\s+\S")


def strip_marker(line):
    return re.sub(r"^L\d+:", "", line or "")


def main():
    write = "--write" in sys.argv
    if not TABLES:
        sys.exit("pass --tables <dafi_tables.json>")
    data = json.loads(TABLES.read_text())
    corpus = json.loads(DOCS.read_text())

    attached = 0
    for d in corpus:
        if d.get("source") != "afi-63-138":
            continue
        lines = str(d.get("content", "")).split("\n")
        found = []
        for i, raw in enumerate(lines):
            t = strip_marker(raw).strip()
            key = next((k for pat, k in CAPTIONS if pat.match(t)), None)
            if not key or key not in data:
                continue
            # the table runs to the next numbered DAFI paragraph
            # …or to the next table caption. 2.1/2.2 and 3.1/3.2 sit back to back with
            # no numbered paragraph between them, so stopping only at a paragraph let
            # the first span swallow the second table entirely.
            end = len(lines) - 1
            for j in range(i + 1, len(lines)):
                nxt = strip_marker(lines[j]).strip()
                if DAFI_PARA.match(nxt) or any(pat.match(nxt) for pat, _ in CAPTIONS):
                    end = j - 1
                    break
            spec = data[key]
            rows = [spec["headers"]] + [[c.replace("\n", " ") for c in r] for r in spec["rows"]]
            found.append({"start": i, "end": end, "rows": rows})
        if not found:
            continue
        # never let two spans overlap — the renderer would skip text twice
        found.sort(key=lambda t: t["start"])
        keep, last = [], -1
        for t in found:
            if t["start"] > last:
                keep.append(t)
                last = t["end"]
        print(f"  {d['title'][:52]:54} {len(keep)} table(s)")
        attached += len(keep)
        if write:
            d["tables"] = keep

    print(f"\ntables attached: {attached}")
    if write:
        DOCS.write_text(json.dumps(corpus, ensure_ascii=False))
        print(f"wrote {DOCS}")
    else:
        print("(report only — pass --write to apply)")


if __name__ == "__main__":
    main()
