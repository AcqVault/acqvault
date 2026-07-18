#!/usr/bin/env python3
"""Ingest the six R-DFARS deviation memos that were never split into the corpus.

Parts 24, 34, 35, 40, 41, 50 (DFARS 224/234/235/240/241/250) have source PDFs in
R-DFARS/ and entries in output/deviations.json, but zero docs in
output/documents.json — so their regulation text (CMMC/NIST safeguarding, EVMS,
R&D, extraordinary actions, etc.) is unsearchable and unbrowsable. This splits
each memo's attachment into section docs matching the existing r-dfars schema.

Only the 2XX.yyy regulation sections are ingested. The 252.2xx clause texts in
these same memos already live under part 52, so headings outside the part family
are used ONLY as body terminators, never turned into docs (that would duplicate).

Writes new docs to a review file by default; pass --merge to fold them into
documents.json (deduping by id). Assertion-guarded throughout.
"""
import argparse
import datetime
import json
import re
from pathlib import Path

from pypdf import PdfReader

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "output" / "documents.json"
REVIEW = REPO / "output" / "_rdfars_new_docs.json"
PARTS = [24, 34, 35, 40, 41, 50]

# a numbered section heading: "240.270-1  Scope." — number then a Capitalized/[ title
HEAD = re.compile(r"^\s*(2?\d{1,2}\.\d[\d.\-]*)\s+([A-Z\[][^\n]*)$")
# subpart / part grouping heading: "SUBPART 240.2—SECURITY…", "PART 240—INFORMATION…"
GROUP = re.compile(r"^\s*(SUBPART|PART)\s+(2\d\d[\d.\-]*)\s*[—-]\s*(.+)$", re.I)
# page furniture that must be stripped from bodies
FURNITURE = re.compile(
    r"^\s*(DARS Tracking Number:.*"
    r"|Revolutionary Federal Acquisition Regulation \(FAR\) Overhaul Part \d+"
    r"|Defense FAR Supplement \(DFARS\) Part \d+"
    r"|Attachment [A-Z]\d?"
    r"|Page \d+ of \d+"               # "Page 25 of 55" footers
    r"|\d{1,3}"                       # bare page numbers
    r")\s*$"
)


def is_boundary_line(ln):
    return bool(GROUP.match(ln) or (HEAD.match(ln) and re.match(r"^\d+\.\d", ln)))


def full_title(lines, idx, first_title):
    """Reassemble a section title that wrapped across PDF lines. Only continues
    when the RAW heading line has no sentence-ending punctuation (a complete
    one-line title like "235.001  Definitions." must NOT absorb the definition
    text that follows). Appends until a line ends in '.' or a boundary/
    subsection/furniture line stops it; DFARS titles wrap to 2-3 lines at most."""
    if lines[idx].rstrip().endswith((".", ":", ";")):
        return first_title
    title = first_title
    j = idx + 1
    while j < len(lines) and j <= idx + 2 and not title.rstrip().endswith("."):
        nxt = lines[j].strip()
        if not nxt or nxt.startswith("(") or is_boundary_line(nxt) or FURNITURE.match(nxt):
            break
        title = f"{title} {nxt}"
        j += 1
        if nxt.rstrip().endswith("."):
            break
    return title


def family(part):
    return f"2{part:02d}."           # part 24 -> "224."


def lineify(lines):
    """memo lines -> corpus content format (L1 for paren-led lines, else L0)."""
    return "\n".join(("L1:" if ln.startswith("(") else "L0:") + ln for ln in lines if ln)


def clean_title(raw):
    t = re.sub(r"\s+", " ", raw).strip().rstrip(".").strip()
    return t


def parse_part(part):
    pdf = REPO / "R-DFARS" / f"DoD_RFO_Deviation_Part-{part}.pdf"
    raw = "\n".join((pg.extract_text() or "") for pg in PdfReader(str(pdf)).pages)
    lines = [ln.strip() for ln in raw.split("\n")]
    fam = family(part)

    # Boundary = any heading (family section, other-family section, or group
    # header). Family sections become docs; everything else only terminates a
    # body so 2XX text never bleeds into the 252.x clauses that follow.
    boundaries = []  # (index, kind, number, title)
    for i, ln in enumerate(lines):
        g = GROUP.match(ln)
        if g:
            boundaries.append((i, "group", g.group(2).rstrip("."), clean_title(g.group(3))))
            continue
        m = HEAD.match(ln)
        if m and re.match(r"^\d+\.\d", m.group(1)):
            num = m.group(1).rstrip(".")
            kind = "sec" if num.startswith(fam) else "other"
            boundaries.append((i, kind, num, clean_title(m.group(2))))

    docs = []
    cur_subpart = ""
    for bi, (idx, kind, num, title) in enumerate(boundaries):
        if kind == "group":
            cur_subpart = f"{'SUBPART' if title else 'PART'} {num} — {title}".strip()
            # normalize casing style to match existing docs (upper heading text)
            cur_subpart = re.sub(r"\s+", " ", cur_subpart).strip()
            continue
        if kind == "other":
            continue
        # family section: body runs to the next boundary of ANY kind
        end = boundaries[bi + 1][0] if bi + 1 < len(boundaries) else len(lines)
        body = [ln for ln in lines[idx:end] if ln and not FURNITURE.match(ln)]
        if not body:
            continue
        slug = re.sub(r"[^0-9a-z]+", "-", num.lower()).strip("-")
        title_text = clean_title(full_title(lines, idx, title))
        docs.append({
            "title": f"{num} {title_text}",
            "content": lineify(body),
            "part": str(part),
            "source_label": "R-DFARS",
            "id": f"r-dfars-{part}-{slug}",
            "source": "r-dfars",
            "filename": f"DoD_RFO_Deviation_Part-{part}.pdf",
            "status": "active",
            "indexed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "url": f"https://www.acquisition.gov/sites/default/files/page_file_uploads/DoD_RFO_Deviation_Part-{part}.pdf",
            "citation": f"R-DFARS {num} — {title_text}",
            "subpart": cur_subpart,
            "section_num": num,
        })
    return docs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--merge", action="store_true", help="fold new docs into documents.json")
    args = ap.parse_args()

    all_new = []
    for part in PARTS:
        d = parse_part(part)
        print(f"part {part} (DFARS {family(part)[:-1]}): {len(d)} sections")
        all_new.extend(d)

    # assertions
    ids = [d["id"] for d in all_new]
    assert len(ids) == len(set(ids)), "duplicate ids within new docs"
    for d in all_new:
        assert d["content"].startswith(("L0:", "L1:")), f"bad content head: {d['id']}"
        assert d["title"] and d["section_num"], f"missing title/num: {d['id']}"
        assert "—" not in d["content"] or True  # em-dashes allowed in body
    print(f"\nTOTAL new docs: {len(all_new)} (all ids unique, all well-formed)")

    if not args.merge:
        REVIEW.write_text(json.dumps(all_new, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"Wrote review file: {REVIEW}  (run with --merge to apply)")
        return

    docs = json.loads(DOCS.read_text(encoding="utf-8"))
    existing = {d["id"] for d in docs if d}
    collide = [d["id"] for d in all_new if d["id"] in existing]
    assert not collide, f"id collision with existing corpus: {collide[:5]}"
    before = len(docs)
    docs.extend(all_new)
    DOCS.write_text(json.dumps(docs, ensure_ascii=False), encoding="utf-8")
    print(f"MERGED: {before} -> {len(docs)} docs (+{len(all_new)})")


if __name__ == "__main__":
    main()
