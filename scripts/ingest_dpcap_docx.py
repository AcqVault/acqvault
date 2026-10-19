#!/usr/bin/env python3
"""Rebuild R-DFARS + DFARS PGI parts from DPCAP's own class-deviation docx files.

WHY THIS EXISTS
The r-dfars and pgi docs were first built from the DoD RFO deviation PDFs that
acquisition.gov's "FAR part deviation guide" hub mirrors (R-DFARS/*.pdf). DPCAP
has since REVISED most of those deviations (Revision 1/2/3) and issued a new one
(Part 270) — and the acquisition.gov hub never picked any of it up. The
authoritative listing is DPCAP's own page:

    https://www.acq.osd.mil/dpap/dars/dfars_far_overhaul_class_deviations.html

Each part there has a TAB_A signed memo (PDF), a TAB_A1 DFARS docx and a TAB_A2
PGI docx. The docx is a PDF->Word conversion, which is BETTER structured than
the PDF text we used before:

  * paragraph style Style1/Style2/Style3 = part / subpart / section heading
  * leading TAB count = paragraph depth (one tab = (a), two = (1), ...)
  * a hard-wrapped physical line is a separate paragraph that ends with a space
    and whose continuation has no leading tab; a blank paragraph ends a logical
    paragraph
  * real Word tables

So this script never guesses from page images: it rejoins wrapped lines into one
logical paragraph per stored line, sets L-levels from tab depth (falling back to
the paragraph token), keeps docx tables as `tables` spans (rule 1b order: the
lines are final before spans are computed), and writes docs in the EXISTING
schema, replacing that part's old r-dfars and pgi docs wholesale.

Clause placement follows docs/CORPUS_INVARIANTS.md "The r-dfars part-52 clause
library": a memo's 252.2xx clause copy lives in the clause's SUBJECT part (part
"5" holds 252.205-7000). Part "52" is the legacy pre-deviation library and is
never touched here.

Usage:
    python3 scripts/ingest_dpcap_docx.py --listing            # print the DPCAP table
    python3 scripts/ingest_dpcap_docx.py 201 205 270          # dry run: review file
    python3 scripts/ingest_dpcap_docx.py --revised --apply    # every part whose
                                                              # listing != deviations.json
    python3 scripts/ingest_dpcap_docx.py --selftest           # parse-rule self-check
Downloads are sequential, 1.5 s apart, cached in _local_archive/dpcap-docx/.
"""
import argparse
import hashlib
import html as htmllib
import json
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "output" / "documents.json"
DEVS = REPO / "output" / "deviations.json"
CACHE = REPO / "_local_archive" / "dpcap-docx"
MEMO_DIR = REPO / "R-DFARS" / "dpcap"      # signed TAB_A memos (not globbed by the hub check)
REVIEW = CACHE / "review.json"                  # gitignored archive, not a corpus artefact

LISTING_URL = "https://www.acq.osd.mil/dpap/dars/dfars_far_overhaul_class_deviations.html"
CLASSDEV = "https://www.acq.osd.mil/dpap/dars/"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
DELAY = 1.5

_session = requests.Session()
_session.headers["User-Agent"] = UA


# ── listing ──────────────────────────────────────────────────────────────────

LINK = re.compile(
    r'<a href="(classdev/DFARS_RFO/Part-(\d+)/[^"]+)"\s+title="([^"]*)"[^>]*>.*?</a>\s*'
    r'(?:<br\s*/?>)?\s*\((\d{1,2} [A-Z][a-z]+ \d{4})\)', re.S)
DEV = re.compile(r"Class Deviation (\d{4}-O\d{4})(?:,\s*Revision (\d+))?")


def parse_listing(html):
    """DPCAP listing HTML -> {dfars_part: {dars, revision, date, memo, a1, a2}}.

    Keyed by the DFARS part as DPCAP numbers its folders (201..270), except the
    two FAR-only memos (Part-48, Part-52) which keep their FAR number.
    Imported by refresh.py's freshness check — keep it dependency-free.
    """
    out = {}
    for href, folder, title, date in LINK.findall(html):
        title = htmllib.unescape(title)
        m = DEV.search(title)
        if not m:
            continue            # line-out documents carry no deviation number
        e = out.setdefault(folder, {"dfars_part": folder})
        kind = ("a1" if title.startswith("Attachment 1,") else
                "a2" if title.startswith("Attachment 2,") else
                "memo" if title.startswith("Class Deviation") else None)
        if not kind:
            continue
        e[kind] = CLASSDEV + href
        if kind == "memo":
            e["dars"] = m.group(1)
            e["revision"] = int(m.group(2) or 0)
            e["date"] = date
    return out


def fetch_listing():
    CACHE.mkdir(parents=True, exist_ok=True)
    r = _session.get(LISTING_URL, timeout=60)
    r.raise_for_status()
    (CACHE / "listing.html").write_text(r.text, encoding="utf-8")
    return parse_listing(r.text)


def download(url, dest):
    """Sequential, cached, polite. Returns the local path."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  GET {url}")
    r = _session.get(url, timeout=120)
    r.raise_for_status()
    dest.write_bytes(r.content)
    time.sleep(DELAY)
    return dest


def as_docx(path):
    """A few attachments are legacy .doc; macOS textutil converts them losslessly
    enough for text (styles are lost, so headings fall back to the text shape)."""
    if path.suffix.lower() == ".docx":
        return path
    out = path.with_suffix(".docx")
    if not out.exists():
        subprocess.run(["textutil", "-convert", "docx", "-output", str(out), str(path)], check=True)
    return out


# ── docx -> logical paragraphs ───────────────────────────────────────────────

FURNITURE = re.compile(          # same shapes corpus_health.py rejects
    r"^(Attachment\s+[A-Z]?\d?"
    r"|DARS Tracking Number:.*"
    r"|Revolutionary Federal Acquisition Regulation \(FAR\) Overhaul Part \d+"
    r"|Defense FAR Supplement \(DFARS\) Part \d+"
    r"|Page \d+ of \d+)$", re.I)
DASH = r"\s*[—–-]+\s*"
PART_H = re.compile(rf"^(?:PGI\s+)?(?:SUB)?PART\s+(2\d\d){DASH}(.+)$|^PGI\s+(2\d\d){DASH}([A-Z].+)$", re.I)
SUBPART_H = re.compile(rf"^(?:PGI\s+)?SUBPART\s+(2\d\d\.\d+)(?:{DASH}|\s+(?=\[))(.+)$"
                       rf"|^PGI\s+(2\d\d\.\d{{1,2}}){DASH}(.+)$", re.I)
HEAD_STYLE = re.compile(r"style3|section|heading", re.I)
STANDALONE = re.compile(r"^\((?:[A-Z]{3,4}\.? ?\d{4}|DEVIATION[^)]*)\)$", re.I)
NUM = r"(2\d\d\.\d+(?:-\d+)*)"
SEC_H = re.compile(rf"^{NUM}\.?\s+([A-Z\[“\"].*)$")
PGI_SEC_H = re.compile(rf"^PGI\s+{NUM}\.?\s+([A-Z\[“\"].*)$")
TOKEN = re.compile(r"^\(([a-z]|\d{1,2}|[ivx]{1,5}|[A-Z])\)")
NEW_PARA_LINE = re.compile(r"^\((?:End of (?:clause|provision)|[A-Z]{3,4}\.? ?\d{4}|DEVIATION[^)]*)\)", re.I)
TERMINAL = re.compile(r"[.:;—)]$")


def token_level(text):
    m = TOKEN.match(text)
    if not m:
        return 0
    t = m.group(1)
    if t.isdigit():
        return 2
    if re.fullmatch(r"[ivx]+", t) and t not in ("v", "x") or len(t) > 1:
        return 3
    return 4 if t.isupper() else 1


def clean(s):
    return re.sub(r"\s+", " ", s).strip()      # \s covers nbsp, en/em spaces, soft breaks


def body_items(path):
    """docx body in order: ('p', raw_text, style) and ('tbl', rows)."""
    import docx
    from docx.oxml.ns import qn
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    d = docx.Document(str(path))
    for el in d.element.body.iterchildren():
        if el.tag == qn("w:p"):
            p = Paragraph(el, d)
            yield "p", p.text.replace(" ", " "), (p.style.name if p.style is not None else "")
        elif el.tag == qn("w:tbl"):
            rows = []
            for r in Table(el, d).rows:
                cells, seen = [], set()
                for c in r.cells:            # merged cells repeat — keep each once
                    if id(c._tc) in seen:
                        continue
                    seen.add(id(c._tc))
                    cells.append(clean(c.text.replace("\n", " ")))
                if any(cells):
                    rows.append(cells)
            if rows:
                yield "tbl", rows, None


def heading(text, pgi, style="", family=""):
    """-> ('part'|'subpart'|'sec', num, title) or None. Text shape decides, not
    the style: the docx styles are inconsistent across parts (Style3, Section,
    'DFARS Heading 2', plain Normal...)."""
    m = PART_H.match(text)
    if m:
        return ("part", m.group(1) or m.group(3), clean(m.group(2) or m.group(4)))
    m = SUBPART_H.match(text)
    if m:
        return ("subpart", m.group(1) or m.group(3), clean(m.group(2) or m.group(4)))
    m = (PGI_SEC_H if pgi else SEC_H).match(text)
    if not m and pgi and HEAD_STYLE.search(style or ""):
        m = SEC_H.match(text)        # a few A2s drop the "PGI" prefix on Style3 headings
    if m and len(m.group(2)) <= 250:
        return ("sec", m.group(1), clean(m.group(2)))
    # Source typo: Part 222's A1 heads a section "22.1704  Postaward." (its own
    # paragraph below reads 222.1704(a)). Recover the family digit, nothing else.
    m = family and re.match(rf"^(?:PGI\s+)?({family[1:]}\.\d+(?:-\d+)*)\.?\s+([A-Z\[].{{0,120}})$", text)
    if m:
        return ("sec", "2" + m.group(1), clean(m.group(2)))
    return None


def logical(path, pgi, family=""):
    """Rejoin hard-wrapped physical lines. Returns a list of
    ('head', kind, num, title) | ('para', level, text) | ('tbl', rows)."""
    out, cur = [], None          # cur = [level, text]

    def flush():
        nonlocal cur
        if cur and cur[1]:
            out.append(("para", cur[0], clean(cur[1])))
        cur = None

    # A soft line break inside a paragraph is a physical line of its own (the
    # converter emits some wrapped lines, and some clause title blocks, that way).
    items = []
    for kind, raw, style in body_items(path):
        if kind == "p":
            items.extend(("p", ln, style) for ln in raw.split("\n"))
        else:
            items.append((kind, raw, style))
    force_new = False
    i = 0
    while i < len(items):
        kind, raw, style = items[i]
        i += 1
        if kind == "tbl":
            flush()
            out.append(("tbl", raw))
            continue
        tabs = len(raw) - len(raw.lstrip("\t"))
        text = clean(raw)
        if not text or FURNITURE.match(text):
            if not text:
                flush()
            continue
        # A heading may only open where no paragraph is open, or where the open
        # one has ended a sentence — a wrapped cross-reference that happens to
        # start a line with "225.7002-1 for ..." is not a heading.
        h = heading(text, pgi, style, family) if tabs == 0 else None
        if h and (cur is None or TERMINAL.search(cur[1].rstrip())):
            flush()
            k, num, title = h
            # a long heading wraps onto a second physical line
            while (k == "sec" and not title.endswith(".") and i < len(items)
                   and items[i][0] == "p" and not items[i][1].startswith("\t")):
                nxt = clean(items[i][1])
                if (not nxt or len(nxt) > 120 or nxt.startswith("(") or nxt.startswith("As prescribed")
                        or heading(nxt, pgi, "", family)):
                    break
                title = f"{title} {nxt}"
                i += 1
            out.append(("head", k, num, title))
            continue
        starts_new = (cur is None or tabs > 0 or force_new or NEW_PARA_LINE.match(text)
                      or (TOKEN.match(text) and TERMINAL.search(cur[1].rstrip())))
        force_new = bool(STANDALONE.match(text))   # "(DEVIATION 2026-O0048)" / "(OCT 2024)" stand alone
        if starts_new:
            flush()
            cur = [min(tabs, 4) if tabs else token_level(text), text]
        else:
            sep = "" if re.search(r"[A-Za-z]-$", cur[1]) else " "
            cur[1] = cur[1].rstrip() + sep + text
    flush()
    return out


# ── logical paragraphs -> corpus docs ────────────────────────────────────────

def _slug(num):
    return re.sub(r"[^0-9a-z]+", "-", num.lower()).strip("-")


def build_part(e, a1, a2, now):
    """One DPCAP part -> (r-dfars docs, pgi docs) in the existing schema."""
    dfars = e["dfars_part"]
    part = str(int(dfars) - 200)
    memo_name = e["memo"].rsplit("/", 1)[1]
    memo_url = e["memo"].replace(" ", "%20")
    stray = []

    def sections(path, pgi):
        secs, cur, subpart = [], None, ""
        for it in logical(path, pgi, dfars):
            if it[0] == "head":
                _, k, num, title = it
                if k == "part":
                    subpart = ""
                    continue
                if k == "subpart":
                    subpart = f"SUBPART {num} — {title.upper()}"
                    continue
                if not (num.startswith(dfars + ".") or num.startswith("252.")):
                    stray.append(num)
                cur = {"num": num, "head": f"{num} {title}", "title": title.rstrip(".").strip(),
                       "subpart": subpart, "lines": [], "tables": []}
                secs.append(cur)
                continue
            if cur is None:          # text ahead of the first section must not vanish
                cur = {"num": f"{dfars}-intro", "head": None,
                       "title": f"Part {dfars} — introductory text", "subpart": subpart,
                       "lines": [], "tables": [], "intro": True}
                secs.append(cur)
            if it[0] == "para":
                cur["lines"].append(f"L{it[1]}:{it[2]}")
            else:
                rows = it[1]
                start = len(cur["lines"]) + 1          # +1: content line 0 is the heading
                cur["lines"].extend("L0:" + " ".join(c for c in r if c) for r in rows)
                if len(rows) >= 2:
                    width = max(len(r) for r in rows)
                    cur["tables"].append({"start": start, "end": start + len(rows) - 1,
                                          "rows": [r + [""] * (width - len(r)) for r in rows]})
        return secs

    rd, seen = [], {}
    for s in sections(a1, False):
        if s.get("intro"):
            if s["lines"]:
                print(f"  ⚠ {dfars} A1: {len(s['lines'])} line(s) before the first section — dropped: {s['lines'][0][:80]}")
            continue
        base = f"r-dfars-{part}-{_slug(s['num'])}"
        seen[base] = seen.get(base, 0) + 1
        doc_id = base if seen[base] == 1 else f"{base}-{seen[base]}"
        doc = {
            "title": f"{s['num']} {s['title']}",
            "content": "\n".join([f"L0:{s['head']}"] + s["lines"]),
            "part": part,
            "source_label": "R-DFARS",
            "id": doc_id,
            "source": "r-dfars",
            "filename": memo_name,
            "status": "active",
            "indexed_at": now,
            "url": memo_url,
            "citation": f"R-DFARS {s['num']} — {s['title']}",
            "subpart": s["subpart"],
            "section_num": s["num"],
        }
        if s["tables"]:
            doc["tables"] = s["tables"]
        rd.append(doc)

    pg, seen = [], {}
    if a2:
        for s in sections(a2, True):
            if not s["lines"]:
                continue                  # same rule as ingest_pgi.py: no body, no doc
            title = (f"PGI {s['num']} {s['title']}" if not s.get("intro")
                     else f"PGI Part {dfars} — introductory text")
            key = f"pgi-{s['num']}"
            seen[key] = seen.get(key, 0) + 1
            if seen[key] > 1:
                key = f"{key}-{seen[key]}"
            doc = {
                "title": title,
                "content": "\n".join([title] + s["lines"]),
                "part": part,
                "id": hashlib.sha1(key.encode()).hexdigest()[:16],
                "source": "pgi",
                "source_label": "DFARS PGI",
                "filename": memo_name,
                "status": "Guidance",
                "indexed_at": now,
                "url": memo_url,
            }
            if s["tables"]:
                doc["tables"] = s["tables"]
            pg.append(doc)
    if stray:
        print(f"  ⚠ {dfars}: section numbers outside the {dfars}/252 family: {stray}")
    return rd, pg


# ── deviations.json ──────────────────────────────────────────────────────────

def effective_text(date):            # "5 August 2026" -> "August 5, 2026"
    return datetime.strptime(date, "%d %B %Y").strftime("%B %-d, %Y")


def update_deviation(devs, e):
    """Revisions are "effective immediately" per their memos, so the memo date
    is the effective date."""
    part = str(int(e["dfars_part"]) - 200)
    row = next((d for d in devs if str(d.get("rfo_part")) == part), None)
    if row is None:
        row = {"rfo_part": part, "dfars_part": e["dfars_part"],
               "subject": "Class Deviation—Revolutionary Federal Acquisition Regulation (FAR) Overhaul"}
        devs.append(row)
        devs.sort(key=lambda d: int(d["rfo_part"]))
    row["dars"] = e["dars"]
    if e["revision"]:
        row["revision"] = e["revision"]
    else:
        row.pop("revision", None)
    row["effective"] = effective_text(e["date"])
    row["pdf_url"] = e["memo"].replace(" ", "%20")
    return row


# FAR-only memos DPCAP lists with no DFARS attachment. Part 48 is tracked in
# deviations.json; Part 52 is not (its row would link the deviations index to the
# legacy pre-deviation clause library), so its current number lives here.
FAR_ONLY = {"52": {"dars": "2026-O0038", "revision": 0}}


def stale_parts(listing, devs):
    """DFARS parts whose DPCAP listing disagrees with deviations.json (number or
    revision) or that deviations.json lacks. Part-48/Part-52 are FAR-only memos
    with no DFARS text, so they are compared but never re-ingested."""
    by_part = {str(d["rfo_part"]): d for d in devs}
    by_part.update(FAR_ONLY)
    out = []
    for folder, e in sorted(listing.items(), key=lambda kv: int(kv[0])):
        if "memo" not in e:
            continue
        part = str(int(folder) - 200) if int(folder) >= 200 else folder
        have = by_part.get(part)
        if not have or have.get("dars") != e["dars"] or int(have.get("revision") or 0) != e["revision"]:
            out.append(folder)
    return out


def _selftest():
    """The parse rules that decide document boundaries, pinned."""
    assert heading("201.101-70  Framework.", False) == ("sec", "201.101-70", "Framework.")
    assert heading("SUBPART 217.72 [RESERVED]", False)[0] == "subpart"
    assert heading("PGI 222.1—BASIC LABOR POLICIES", True) == ("subpart", "222.1", "BASIC LABOR POLICIES")
    assert heading("PGI 234.201(a)(3) for conducting a cost-benefit", True) is None
    assert heading("225.7002-1 for exceptions", False) is None
    assert heading("201.201-71  Local provisions.", True) is None             # bare number in PGI ...
    assert heading("201.201-71  Local provisions.", True, "Style3")[1] == "201.201-71"  # ... unless styled
    assert heading("22.1704  Postaward.", False, family="222") == ("sec", "222.1704", "Postaward.")
    assert [token_level(t) for t in ("(b) x", "(12) x", "(iv) x", "(A) x", "text")] == [1, 2, 3, 4, 0]
    html = ('<a href="classdev/DFARS_RFO/Part-201/x_TAB_A.pdf" title="Class Deviation 2026-O0002, '
            'Revision 1 &#8211; X" target="_blank">t</a>\n<br />(5 August 2026)')
    e = parse_listing(html)["201"]
    assert (e["dars"], e["revision"], e["date"]) == ("2026-O0002", 1, "5 August 2026")
    assert effective_text("5 August 2026") == "August 5, 2026"
    print("selftest ok")


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("parts", nargs="*", help="DFARS part numbers, e.g. 201 270")
    ap.add_argument("--revised", action="store_true", help="every part the listing shows as newer")
    ap.add_argument("--listing", action="store_true", help="print the DPCAP table and stop")
    ap.add_argument("--apply", action="store_true", help="write documents.json + deviations.json")
    ap.add_argument("--selftest", action="store_true", help="run the parser self-check and stop")
    args = ap.parse_args()
    if args.selftest:
        return _selftest()

    listing = fetch_listing()
    devs = json.loads(DEVS.read_text(encoding="utf-8"))
    if args.listing:
        stale = set(stale_parts(listing, devs))
        for k, e in sorted(listing.items(), key=lambda kv: int(kv[0])):
            print(f"{k:>4} {e.get('dars')} rev{e.get('revision')} {e.get('date'):>18}"
                  f"{'  A1' if 'a1' in e else '    '}{' A2' if 'a2' in e else '   '}"
                  f"{'  <- newer than deviations.json' if k in stale else ''}")
        return

    parts = [str(p) for p in args.parts]
    if args.revised:
        parts += [p for p in stale_parts(listing, devs) if int(p) >= 200 and p not in parts]
    if not parts:
        sys.exit("nothing to do — name parts or pass --revised")

    now = datetime.now(timezone.utc).isoformat()
    corpus = json.loads(DOCS.read_text(encoding="utf-8"))
    new_docs, report = {}, []
    for dfars in parts:
        e = listing.get(dfars)
        if not e or "a1" not in e:
            sys.exit(f"part {dfars}: no A1 docx on the DPCAP listing")
        print(f"part {dfars}: {e['dars']} rev{e['revision']} ({e['date']})")
        a1 = as_docx(download(e["a1"], CACHE / e["a1"].rsplit("/", 1)[1]))
        a2 = as_docx(download(e["a2"], CACHE / e["a2"].rsplit("/", 1)[1])) if "a2" in e else None
        download(e["memo"], MEMO_DIR / e["memo"].rsplit("/", 1)[1])
        rd, pg = build_part(e, a1, a2, now)
        part = str(int(dfars) - 200)
        old_rd = [d for d in corpus if d and d.get("source") == "r-dfars" and str(d.get("part")) == part]
        old_pg = [d for d in corpus if d and d.get("source") == "pgi" and str(d.get("part")) == part]
        ids = [d["id"] for d in rd + pg]
        assert len(ids) == len(set(ids)), f"duplicate ids in part {dfars}"
        for d in rd:
            assert all(re.match(r"^L\d:", l) for l in d["content"].split("\n")), d["id"]
        gone = sorted({d["id"] for d in old_rd + old_pg} - set(ids))
        report.append({"dfars_part": dfars, "dars": e["dars"], "revision": e["revision"],
                       "r_dfars": [len(old_rd), len(rd)], "pgi": [len(old_pg), len(pg)],
                       "removed_ids": gone,
                       "added_ids": sorted(set(ids) - {d["id"] for d in old_rd + old_pg})})
        print(f"  r-dfars {len(old_rd)} -> {len(rd)}   pgi {len(old_pg)} -> {len(pg)}   "
              f"ids gone: {len(gone)}")
        new_docs[part] = (rd, pg, e)

    REVIEW.write_text(json.dumps({"report": report, "docs": {p: v[0] + v[1] for p, v in new_docs.items()}},
                                 ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nreview file: {REVIEW.relative_to(REPO)}")
    if not args.apply:
        print("(dry run — pass --apply to write documents.json and deviations.json)")
        return

    # Replace each part's docs IN PLACE (first old doc's position), so the source
    # order of the file — and therefore the diff — stays as small as it can.
    out, placed = [], set()
    for d in corpus:
        key = (d.get("source"), str(d.get("part"))) if d else None
        part = key[1] if key else None
        if key and key[0] in ("r-dfars", "pgi") and part in new_docs:
            if key not in placed:
                rd, pg, _ = new_docs[part]
                out.extend(rd if key[0] == "r-dfars" else pg)
                placed.add(key)
            continue
        out.append(d)
    for part, (rd, pg, _) in new_docs.items():      # a brand-new part (270)
        for src, docs in (("r-dfars", rd), ("pgi", pg)):
            if (src, part) not in placed and docs:
                last = max((i for i, d in enumerate(out) if d and d.get("source") == src), default=len(out) - 1)
                out[last + 1:last + 1] = docs
    DOCS.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    for _, _, e in new_docs.values():
        update_deviation(devs, e)
    DEVS.write_text(json.dumps(devs, indent=0), encoding="utf-8")
    print(f"applied: documents.json {len(corpus)} -> {len(out)} docs; deviations.json updated")


if __name__ == "__main__":
    main()
