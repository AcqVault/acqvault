#!/usr/bin/env python3
"""
Remove the stray space a text extractor leaves at a formatting-run boundary:
"(a) General . Exchanges", "e.g. , incentives", "( RFO 1.102 )".

Every ingest path made it the same way — an italic/bold/link run flattened with a
space separator — so it shows up in the HTML-sourced RFO and Compass and in the
PDF/docx-sourced R-DFARS and PGI alike. parse_rfo_html.py calls tidy() at parse
time; this script applies it to the rest of the corpus. corpus_health.py rejects
any document still carrying the pattern.

Usage:
    python3 scripts/repair_punct_spacing.py           # report
    python3 scripts/repair_punct_spacing.py --apply   # rewrite documents.json
"""

import json
import re
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "output" / "documents.json"

# A space before , ; : ) — or before a sentence-ending period — that is followed by
# whitespace, end, or more closing punctuation. ".02" and "...." leaders never match.
BEFORE = re.compile(r"(?<=\S) +([,;:)])(?=\s|$|[,;:).])|(?<=[^\s.]) +(\.)(?=\s|$)", re.M)
AFTER_OPEN = re.compile(r"\( +(?=\S)")


def tidy(text):
    return BEFORE.sub(lambda m: m.group(1) or m.group(2), AFTER_OPEN.sub("(", text))


def found(text):
    return [m.group() for m in BEFORE.finditer(text)] + AFTER_OPEN.findall(text)


def main():
    corpus = json.loads(DOCS.read_text())
    changed = 0
    for d in corpus:
        new = tidy(d["content"])
        if new != d["content"]:
            assert new.count("\n") == d["content"].count("\n")   # table spans index lines
            changed += 1
            d["content"] = new
    print(f"{changed} documents carry run-boundary spacing")
    if "--apply" in sys.argv and changed:
        DOCS.write_text(json.dumps(corpus, ensure_ascii=False))
        print(f"rewrote {DOCS}")


if __name__ == "__main__":
    assert tidy("(a) General . Exchanges ( e.g. , part) at 2.101 ).") == \
        "(a) General. Exchanges (e.g., part) at 2.101)."
    assert tidy("between .02 and Log ....... 4") == "between .02 and Log ....... 4"
    main()
