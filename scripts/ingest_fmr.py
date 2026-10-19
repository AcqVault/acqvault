#!/usr/bin/env python3
"""
Ingest the DoW 7000.14-R Financial Management Regulation (FMR) into AcqVault corpus
docs (source = 'fmr') from the official combined POLICY PDF
(comptroller.war.gov/Portals/45/documents/fmr/current/Policy/Combined_FMR_Vol_1-16.pdf).

The September 2026 edition separated policy from procedure. Two shapes now coexist:

  * CONSOLIDATED volumes (1-6, 8-16): one volume = one outline of top-level sections
    "N.0 TITLE" (each roughly a former chapter). One doc per top-level SECTION:
    id `fmr-vol-<v>-sec-<n>`, title "Section N.0: Title". The FMR's own cross-references
    cite these as "Volume 5, section 3.0".
  * CHAPTERED volumes (7A, 7B — not part of the restructure): one doc per CHAPTER, as
    before: id `fmr-vol-<v>-ch-<n>`, title "Chapter N: Title". "ARCHIVED" placeholders,
    appendices, comparable grades and definitions are not chapters and are skipped.

Volumes 2A/2B, 6A/6B and 11A/11B merged into 2, 6 and 11. The combined PDF carries
Volume 12 TWICE; the PDF outline points at the second copy (the one with the
Voluntary Separation Incentive Fund in 15.4), so only pages from the outline's
Volume 12 entry onward are used.

Pipeline (LAYOUT_CONTRACT order): pdftotext -layout per page -> strip running
header/footer + TOC pages -> split -> reflow into paragraphs -> THEN attach tables
(scripts/attach_fmr_tables.py, by each doc's page range).

Usage:
  python3 scripts/ingest_fmr.py --pdf <combined.pdf>            # diagnostics, no write
  python3 scripts/ingest_fmr.py --pdf <combined.pdf> --write    # replace fmr in output/documents.json
"""
import re, json, sys, argparse, subprocess
from datetime import datetime, timezone
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent

# Titles as listed in the edition's own Introduction ("VOLUMES" table).
VOLUME_TITLES = {
    "1":  "General Financial Management Information, Systems, and Requirements",
    "2":  "Budget Formulation and Presentation",
    "3":  "Budget Execution — Availability and Use of Budgetary Resources",
    "4":  "Accounting Policy",
    "5":  "Disbursing Policy",
    "6":  "Reporting Policy",
    "7A": "Military Pay Policy — Active Duty and Reserve Pay",
    "7B": "Military Pay Policy — Retired Pay",
    "8":  "Civilian Pay Policy",
    "9":  "Travel Policy",
    "10": "Contract Payment Policy",
    "11": "Reimbursable Operations Policy",
    "12": "Special Accounts, Funds, and Programs",
    "13": "Nonappropriated Funds Policy",
    "14": "Administrative Control of Funds and Antideficiency Act Violations",
    "15": "Security Cooperation Policy",
    "16": "Department of War Debt Management",
}
VOL_ORDER = list(VOLUME_TITLES)
CHAPTERED = {"7A", "7B"}
EDITION = "September 2026"
URL = "https://comptroller.war.gov/FMR/"
SOURCE_LABEL = "DoW Financial Management Regulation"
FILENAME = "DoW 7000.14-R"

MONTHS = r'(January|February|March|April|May|June|July|August|September|October|November|December)'
DATE_RE = re.compile(r'^\s*\*?\s*' + MONTHS + r'\s+\d{4}\s*$', re.I)
HDR_RE = re.compile(r'Financial Management Regulation\s+(?:Volume\s+(\w+)(?:\s*,?\s*(Chapter|Appendix)\s+(\w+))?|Introduction)')
FOOTER_RE = re.compile(r'^\s*\*?\s*[A-Z0-9]{1,4}-\d{1,3}\s*$')
TOPSEC_RE = re.compile(r'^\s{0,16}\*?\s*(\d{1,2})\.0\s+(\S.*)$')
LEADER_RE = re.compile(r'\.{4,}|…')

_PUA_MAP = {'': '•', '': '•', '': '•', '': '—', '': '—'}


def _scrub_pua(text):
    for bad, good in _PUA_MAP.items():
        text = text.replace(bad, good)
    return text


_SMALL = {'of','the','and','for','to','in','a','an','or','with','by','on','at','from','as','per','into'}
_ACR = {'DOD':'DoD','DOW':'DoW','US':'U.S.','USD':'USD','CFO':'CFO','FMR':'FMR','NATO':'NATO','FYDP':'FYDP',
        'BRAC':'BRAC','RDT&E':'RDT&E','O&M':'O&M','IT':'IT','DFAS':'DFAS','DCAA':'DCAA','GPC':'GPC',
        'MWR':'MWR','NAF':'NAF','TDY':'TDY','PDT':'PDT','SNAP':'SNaP','BIRD':'BIRD','AFRH':'AFRH','OMB':'OMB',
        'DTS':'DTS','EFT':'EFT','SF':'SF','UCFR':'UCFR','ADA':'ADA','FMS':'FMS','SC':'SC','DWCF':'DWCF',
        'DOWEA':'DoWEA','T&A':'T&A','IPA':'IPA','JROTC':'JROTC','GPP&E':'GPP&E','ADVANA':'Advana','FM':'FM',
        'HPO':'HPO','AIP':'AIP','CSP':'CSP','FLPB':'FLPB','AVB':'AvB','FSA':'FSA','MIA':'MIA','FICA':'FICA',
        'SGLI':'SGLI','AD':'AD','IDT':'IDT','SROTC':'SROTC','IRR':'IRR','RR':'RR','CP':'CP','COLA':'COLA',
        'CONUS':'CONUS','OCONUS':'OCONUS','TLA':'TLA','TDRL':'TDRL','SSB':'SSB','VSI':'VSI','FITW':'FITW',
        'RSFPP':'RSFPP','SBP':'SBP','RCSBP':'RCSBP','ACMSS':'ACMSS','CRSC':'CRSC','DVA':'DVA','NONDOW':'Non-DoW',
        'USW':'USW'}


def smartcase(t):
    letters = re.sub(r'[^A-Za-z]', '', t)
    if not letters or sum(c.isupper() for c in letters) / len(letters) < 0.8:
        return t
    words = t.split()
    out = []
    for i, w in enumerate(words):
        pre = w[:len(w) - len(w.lstrip('(“"[\''))]
        post = w[len(w.rstrip(').,:;”"]\'')):]
        mid = w[len(pre):len(w) - len(post)] if post else w[len(pre):]
        # hyphenated / slashed compounds are cased part by part ("NON-DOW", "BUDGET/FAMILY")
        parts = re.split(r'([-/–])', mid)
        cased = []
        for k, p in enumerate(parts):
            core = re.sub(r'[^A-Za-z&]', '', p).upper()
            if p in '-/–':
                cased.append(p)
            elif core in _ACR:
                cased.append(p.upper().replace(core, _ACR[core]) if core else p)
            elif core.lower() in _SMALL and ((len(parts) == 1 and 0 < i < len(words) - 1) or k > 0):
                cased.append(p.lower())
            else:
                cased.append(p.capitalize())
        out.append(pre + ''.join(cased) + post)
    return ' '.join(out)


# ── reflow ────────────────────────────────────────────────────────────────────
_HEAD = re.compile(r'^\s*\*?\s*\d+\.0\s+\S')
_SUBHEAD = re.compile(r'^\s*\*?\s*\d+\.\d+\s+\S')
_NEWPARA = re.compile(r'^\s*\*?\s*(?:(?:\d+\.)+\d+\.?|\(?[A-Za-z]\)|\(?\d+\)|[-•])\s+\S')
_CAP = re.compile(r'^\s*\*?\s*(Table|Figure|Annex|Exhibit|Section)\b', re.I)


def _gaps(s):
    """End columns of interior runs of 2+ spaces — where a column of text starts."""
    lead = len(s) - len(s.lstrip())
    return {m.end() for m in re.finditer(r' {2,}', s) if m.start() > lead}


def _tabular_flags(lines):
    """A line is tabular when it has an interior column gap that lines up (±1) with a gap
    on an adjacent line. pdftotext -layout also stretches some justified prose lines
    ("UNMATCHED        DISBURSEMENTS"), but those gaps are isolated, so they reflow."""
    g = [_gaps(l) if l.strip() else set() for l in lines]
    flags = []
    for i, gi in enumerate(g):
        hit = False
        if gi:
            for j in (i - 1, i + 1):
                if 0 <= j < len(g) and any(abs(a - b) <= 1 for a in gi for b in g[j]):
                    hit = True
                    break
        flags.append(hit)
    return flags


def reflow(lines):
    """Rejoin PDF-wrapped prose into paragraphs. Numbered headings stay on their own line;
    numbered/lettered paragraphs keep their enumerator and absorb their wrapped
    continuation lines; columnar (tabular) rows are left preformatted."""
    out, para = [], []
    flags = _tabular_flags(lines)

    def flush():
        if para:
            out.append(re.sub(r' {2,}', ' ', ' '.join(x.strip() for x in para))); para.clear()
    for raw, tabular in zip(lines, flags):
        s = raw.rstrip()
        st = s.strip()
        if not st:
            flush(); out.append(''); continue
        tabular = tabular and not _NEWPARA.match(s)
        is_head = bool(_HEAD.match(s)) or (bool(_SUBHEAD.match(s)) and len(st) < 70) \
            or (st.isupper() and len(st) < 70 and not _CAP.match(s))
        if tabular:
            flush(); out.append(s)
        elif is_head:
            st = re.sub(r' {2,}', ' ', st)
            flush(); out.append(re.sub(r'^(\*?\s*[\d.]+) ', r'\1    ', st) if _HEAD.match(s) or _SUBHEAD.match(s) else st)
        elif _NEWPARA.match(s) or _CAP.match(s):
            flush(); para.append(s)
        else:
            para.append(s)
    flush()
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(out)).strip()


# ── page handling ─────────────────────────────────────────────────────────────
def load_pages(pdf):
    txt = subprocess.run(['pdftotext', '-layout', str(pdf), '-'], check=True,
                         capture_output=True, text=True).stdout
    return _scrub_pua(txt).split('\f')


def outline_vol12_page(pdf):
    """1-based page the PDF outline gives for VOLUME 12 (the copy to keep)."""
    import pypdf
    r = pypdf.PdfReader(str(pdf))
    for x in r.outline:
        if not isinstance(x, list) and re.match(r'\s*VOLUME 12\b', x.title or ''):
            return r.get_destination_page_number(x) + 1
    raise SystemExit('outline has no VOLUME 12 entry')


def page_info(text):
    """-> (volume, chapter-or-None, kind, body_lines) or None for a page with no running head."""
    lines = text.split('\n')
    head = lines[:5]
    m = None
    for h in head:
        m = HDR_RE.search(h)
        if m:
            break
    if not m:
        return None
    vol = m.group(1)
    kind = (m.group(2) or '').lower() or ('volume' if vol else 'intro')
    ch = m.group(3)
    # strip the header zone: leading lines that are the reg id, the running head, the date
    i = 0
    while i < min(6, len(lines)):
        s = lines[i].strip()
        if not s or '7000.14' in s or 'Financial Management Regulation' in s or DATE_RE.match(s) \
                or re.fullmatch(r'2B|[A-Z]?\d{1,2}[A-Z]?(,?\s*(Chapter|Appendix)\s+\w+)?', s) \
                or re.fullmatch(r'Volume\s+\w+(\s*,?\s*(Chapter|Appendix)\s+\w+)?', s):
            i += 1
            continue
        break
    body = lines[i:]
    while body and not body[-1].strip():
        body.pop()
    if body and FOOTER_RE.match(body[-1]):
        body.pop()
    while body and not body[-1].strip():
        body.pop()
    return vol, ch, kind, body


def is_toc_page(body):
    top = [l.strip() for l in body[:4]]
    if any(t.lower().startswith('table of contents') for t in top):
        return True
    return sum(1 for l in body if LEADER_RE.search(l)) >= 3


def join_pages(pbs):
    """[(page, body_lines)] -> [(page, line)]. Concatenated so a paragraph broken across a
    page reflows as one, but a paragraph that ended at the foot of a page stays separate
    from the next."""
    out = []
    for pg, body in pbs:
        b = list(body)
        while b and not b[0].strip():
            b.pop(0)
        if out and b:
            prev = out[-1][1].rstrip()
            if re.search(r'[.:;!?”")]$', prev) or TOPSEC_RE.match(b[0]) or _NEWPARA.match(b[0]):
                out.append((pg, ''))
        out.extend((pg, l) for l in b)
    return out


def clean_body(lines):
    return [l for l in lines if not LEADER_RE.search(l)]


def doc(vid, vol, title, content, pages):
    return {
        "id": vid,
        "source": "fmr",
        "source_label": SOURCE_LABEL,
        "part": vol,
        "title": title,
        "content": content,
        "filename": FILENAME,
        "status": "Current",
        "date": EDITION,
        "url": URL,
        "indexed_at": datetime.now(timezone.utc).isoformat(),
        "_pages": pages,          # stripped before write; used by the table pass
    }


def split_sections(vol, items):
    """items: [(page_no, line)] for one consolidated volume, TOC pages removed.
    Split at sequential top-level headings 1.0, 2.0, ... ."""
    heads, want = [], 1
    for k, (pg, ln) in enumerate(items):
        m = TOPSEC_RE.match(ln)
        if not m or int(m.group(1)) != want:
            continue
        t = m.group(2).strip()
        letters = re.sub(r'[^A-Za-z]', '', t)
        if not letters or sum(c.isupper() for c in letters) / len(letters) < 0.8:
            continue
        heads.append(k)
        want += 1
    docs = []
    for n, k in enumerate(heads, start=1):
        end = heads[n] if n < len(heads) else len(items)
        block = items[k:end]
        # heading may wrap onto the next line(s) (all caps, no blank between)
        m = TOPSEC_RE.match(block[0][1])
        title_parts, j = [m.group(2).strip()], 1
        while j < len(block) and block[j][1].strip() and block[j][1].strip().isupper() \
                and not re.match(r'^\s*\d+\.\d', block[j][1]) and len(title_parts) < 3:
            title_parts.append(block[j][1].strip()); j += 1
        title = re.sub(r'\s+', ' ', ' '.join(title_parts)).strip()
        title = re.sub(r'(\w)([-/]) (\w)', r'\1\2\3', title)       # 'INTERMEDIATE- LEVEL' wrap
        body = [f"{n}.0    {title}"] + [ln for _, ln in block[j:]]
        content = reflow(clean_body(body))
        pages = [block[0][0], block[-1][0]]
        docs.append(doc(f"fmr-vol-{vol.lower()}-sec-{n}", vol,
                        f"Section {n}.0: {smartcase(title)}", content, pages))
    return docs


def chapter_title(lines, ch):
    """'VOLUME 7A, CHAPTER 5: “HEALTH PROFESSIONS ... PAY”' (may wrap) -> smart-cased title."""
    for i, l in enumerate(lines):
        if re.search(r'CHAPTER\s+0*' + ch + r'\s*:', l):
            buf = l.split(':', 1)[1]
            for f in lines[i + 1:i + 4]:
                if re.search(r'[”"]', buf.strip()[1:]):
                    break
                buf += ' ' + f.strip()
            t = re.split(r'[”"]', buf.strip().lstrip('“"'), maxsplit=1)[0]
            return smartcase(re.sub(r'\s+', ' ', t).strip(' :“"'))
    return f"Chapter {ch}"


def parse(pdf):
    pages = load_pages(pdf)
    v12 = outline_vol12_page(pdf)
    vol_items = {}                 # consolidated: vol -> [(page, line)]
    chap_pages = {}                # chaptered: (vol, ch) -> [(page, body)]
    for idx, text in enumerate(pages):
        pg = idx + 1
        info = page_info(text)
        if not info:
            continue
        vol, ch, kind, body = info
        if vol not in VOLUME_TITLES:
            continue
        if vol == '12' and pg < v12:
            continue               # the superseded duplicate copy of Volume 12
        if is_toc_page(body):
            continue
        if vol in CHAPTERED:
            if kind == 'chapter':
                chap_pages.setdefault((vol, ch), []).append((pg, body))
            continue
        vol_items.setdefault(vol, []).append((pg, body))

    docs = []
    for vol, pbs in vol_items.items():
        docs.extend(split_sections(vol, join_pages(pbs)))

    for (vol, ch), pbs in chap_pages.items():
        all_lines = [l for _, b in pbs for l in b]
        title = chapter_title(all_lines, ch)
        if title.upper() == 'ARCHIVED':
            continue
        lines = [l for _, l in join_pages(pbs)]
        banner = re.compile(r'^\s*CHAPTER\s+0*' + re.escape(ch) + r'\s*$')
        bi = max((i for i, l in enumerate(lines) if banner.match(l)), default=None)
        start = None
        rng = range(bi + 1, len(lines)) if bi is not None else range(len(lines))
        for i in rng:
            if TOPSEC_RE.match(lines[i]):
                start = i; break
        if start is None:
            continue
        body = [l for l in clean_body(lines[start:])
                if l.strip().upper() not in ('TABLE OF CONTENTS', 'SUMMARY OF MAJOR CHANGES')]
        content = reflow(body)
        if len(content) < 120:
            continue
        docs.append(doc(f"fmr-vol-{vol.lower()}-ch-{ch}", vol, f"Chapter {ch}: {title}",
                        content, [pbs[0][0], pbs[-1][0]]))

    def key(d):
        n = re.search(r'-(?:ch|sec)-(\d+)$', d['id'])
        return (VOL_ORDER.index(d['part']), int(n.group(1)))
    docs.sort(key=key)
    return docs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf', required=True)
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--no-tables', action='store_true')
    ap.add_argument('--out', default=None, help='also dump the candidate docs here')
    a = ap.parse_args()
    docs = parse(a.pdf)

    from collections import Counter
    byvol = Counter(d['part'] for d in docs)
    lens = sorted(len(d['content']) for d in docs)
    print(f"FMR docs: {len(docs)}  | total content chars: {sum(lens):,}")
    print("docs per volume:", {v: byvol.get(v, 0) for v in VOL_ORDER})
    if lens:
        print(f"content len min/median/max: {lens[0]} / {lens[len(lens)//2]} / {lens[-1]}")

    if not a.no_tables:
        sys.path.insert(0, str(BASE / 'scripts'))
        import attach_fmr_tables
        attach_fmr_tables.attach(docs, a.pdf)
    for d in docs:
        d.pop('_pages', None)
    if a.out:
        Path(a.out).write_text(json.dumps(docs, ensure_ascii=False))
        print("wrote candidate ->", a.out)

    if a.write:
        p = BASE / 'output' / 'documents.json'
        corpus = json.loads(p.read_text())
        old = [d for d in corpus if d.get('source') == 'fmr']
        at = next((i for i, d in enumerate(corpus) if d.get('source') == 'fmr'), len(corpus))
        rest = [d for d in corpus if d.get('source') != 'fmr']
        at -= sum(1 for d in corpus[:at] if d.get('source') == 'fmr')
        corpus = rest[:at] + docs + rest[at:]          # same place in the file: a readable diff
        p.write_text(json.dumps(corpus, ensure_ascii=False))
        old_ids, new_ids = {d['id'] for d in old}, {d['id'] for d in docs}
        print(f"merged into {p}; corpus now {len(corpus)} docs "
              f"(fmr {len(old)} -> {len(docs)}; kept {len(old_ids & new_ids)}, "
              f"added {len(new_ids - old_ids)}, removed {len(old_ids - new_ids)})")


if __name__ == '__main__':
    main()
