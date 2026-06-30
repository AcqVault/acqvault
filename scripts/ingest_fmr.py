#!/usr/bin/env python3
"""
Ingest the DoD 7000.14-R Financial Management Regulation (FMR), Volumes 1-16,
from the PDF-extracted markdown into AcqVault corpus docs (source = 'fmr').

One doc per CHAPTER; `part` = volume (e.g. "1", "2A"). Front matter is dropped:
volume covers, volume/chapter Tables of Contents (dot/ellipsis leaders), and the
"Summary of Major Changes" blocks. Content starts at the first real numbered
section (1.0 ...). PDF page artifacts and running headers/footers are stripped.

Usage:
  python3 scripts/ingest_fmr.py --md <path> --dry       # diagnostics + samples, no write
  python3 scripts/ingest_fmr.py --md <path> --write     # merge into output/documents.json
"""
import re, json, sys, argparse, hashlib
from datetime import datetime, timezone

# Canonical FMR volume titles (verified against the source covers).
VOLUME_TITLES = {
    "1":  "General Financial Management Information, Systems, and Requirements",
    "2A": "Budget Formulation and Presentation",
    "2B": "Budget Formulation and Presentation",
    "3":  "Budget Execution — Availability and Use of Budgetary Resources",
    "4":  "Accounting Policy",
    "5":  "Disbursing Policy",
    "6A": "Reporting Policy",
    "6B": "Form and Content of the DoD Audited Financial Statements",
    "7A": "Military Pay Policy — Active Duty and Reserve Pay",
    "7B": "Military Pay Policy — Retired Pay",
    "8":  "Civilian Pay Policy",
    "9":  "Travel Policy",
    "10": "Contract Payment Policy",
    "11A": "Reimbursable Operations Policy — General",
    "11B": "Reimbursable Operations Policy — Defense Working Capital Funds",
    "12": "Special Accounts, Funds, and Programs",
    "13": "Nonappropriated Funds Policy and Procedures",
    "14": "Administrative Control of Funds and Antideficiency Act Violations",
    "15": "Security Cooperation Policy",
    "16": "Department of Defense Debt Management",
}
VOL_ORDER = ["1","2A","2B","3","4","5","6A","6B","7A","7B","8","9","10","11A","11B","12","13","14","15","16"]

# Real chapter headings start with an uppercase "VOLUME" and carry a colon before the
# title ("VOLUME x, CHAPTER n:"). The line-start check (case-sensitive, in parse()) excludes
# mixed-case prose cross-references ("Volume 10, Chapter 1 of ..."); re.I here only so a
# title-case "Chapter" in a real heading still matches.
CH_RE = re.compile(r'VOLUME\s+0*(\d+[A-C]?)\s*,\s*CHAPTER\s+0*(\d+)\s*[:：]\s*(.*)', re.I)
MONTHS = r'(January|February|March|April|May|June|July|August|September|October|November|December)'
DATE_RE = re.compile(r'^\*?\s*' + MONTHS + r'\s+\d{4}\s*$', re.I)
RUNHDR_RE = re.compile(r'^\s*Volume\s+\d+[A-C]?\s*,\s*Chapter\s+\d+\s*$', re.I)
PAGENO_RE = re.compile(r'^\s*(\*?\s*)?([A-Z]{0,3}-?\d{1,4}|\d{1,2}-\d{1,3})\s*$')
SECTION_RE = re.compile(r'^\s*(\d+)\.0\s+[A-Z“"]')          # real top-level section heading
ANY_SECTION_RE = re.compile(r'^\s*\d+\.0\s+\S')

def norm_vol(v):
    v = v.upper()
    return v

def is_noise(s):
    if s.startswith('<!-- Page'): return True
    if s == '---': return True
    if 'DoD 7000.14-R' in s: return True
    # running header/footer — these always carry the spelled-out regulation name,
    # often combined on one line with a volume code / chapter ref / date.
    if re.search(r'Financial Management Regulation', s, re.I): return True
    if s.strip().lower().startswith('table of contents'): return True
    if DATE_RE.match(s): return True
    if RUNHDR_RE.match(s): return True
    if PAGENO_RE.match(s) and not re.search(r'[A-Za-z]{4,}', s): return True
    if '....' in s or '…' in s: return True            # dot / ellipsis leaders (TOC)
    if re.match(r'^[.…\s]+\d*$', s): return True        # leftover leader fragments
    return False

_HEAD = re.compile(r'^\s*\*?\s*\d+\.0\s+\S')                       # top section "1.0 GENERAL"
_SUBHEAD = re.compile(r'^\s*\*?\s*\d+\.\d+\s+\S')                  # "1.1 Purpose"
_NEWPARA = re.compile(r'^\s*\*?\s*(?:(?:\d+\.)+\d+\.?|\(?[A-Za-z]\)|\(?\d+\)|[-•])\s+\S')
_CAP = re.compile(r'^\s*\*?\s*(Table|Figure|Annex|Exhibit|Section)\b', re.I)

def reflow(lines):
    """Rejoin PDF-wrapped prose into paragraphs for readability. Numbered section/subsection
    headings stay on their own line; numbered/lettered paragraphs keep their enumerator and
    absorb their wrapped continuation lines; columnar (tabular) rows are left preformatted."""
    out, para = [], []
    def flush():
        if para:
            out.append(' '.join(x.strip() for x in para)); para.clear()
    for raw in lines:
        s = raw.rstrip()
        st = s.strip()
        if not st:
            flush(); out.append(''); continue
        tabular = len(re.findall(r'\S {2,}\S', s)) >= 2 and not _NEWPARA.match(s)
        is_head = bool(_HEAD.match(s)) or (bool(_SUBHEAD.match(s)) and len(st) < 70) \
            or (st.isupper() and len(st) < 70 and not _CAP.match(s))
        if tabular:
            flush(); out.append(s)
        elif is_head:
            flush(); out.append(st)
        elif _NEWPARA.match(s) or _CAP.match(s):
            flush(); para.append(s)
        else:
            para.append(s)
    flush()
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(out)).strip()

_SMALL = {'of','the','and','for','to','in','a','an','or','with','by','on','at','from','as','per','into'}
_ACR = {'DOD':'DoD','US':'U.S.','USD':'USD','CFO':'CFO','FMR':'FMR','NATO':'NATO','FYDP':'FYDP',
        'BRAC':'BRAC','RDT&E':'RDT&E','O&M':'O&M','IT':'IT','DFAS':'DFAS','DCAA':'DCAA','GPC':'GPC',
        'MWR':'MWR','NAF':'NAF','TDY':'TDY','SNAP':'SNaP','BIRD':'BIRD','AFRH':'AFRH','OMB':'OMB',
        'DTS':'DTS','EFT':'EFT','SF':'SF','UCFR':'UCFR','ADA':'ADA','FMS':'FMS'}
def smartcase(t):
    if not t.isupper():
        return t
    words = t.split()
    out = []
    for i, w in enumerate(words):
        core = re.sub(r'[^A-Za-z&.]', '', w).upper()
        pre = w[:len(w) - len(w.lstrip('(“"'))]
        post = w[len(w.rstrip(').,:;”"')):]
        mid = w[len(pre):len(w) - len(post)] if post else w[len(pre):]
        if core in _ACR:
            cased = _ACR[core]
        elif core.lower() in _SMALL and 0 < i < len(words) - 1:
            cased = mid.lower()
        else:
            cased = mid.capitalize()
        out.append(pre + cased + post)
    return ' '.join(out)

def clean_title(first, follow):
    """Build chapter title from the heading line + up to 2 following lines, until the closing quote."""
    buf = first
    for f in follow:
        if '”' in buf or '"' in buf[1:]:
            break
        buf += ' ' + f.strip()
    # cut at closing curly/straight quote
    m = re.split(r'[”"]', buf, maxsplit=1)
    t = m[0]
    t = re.sub(r'\s+', ' ', t).strip(' :“"')
    t = re.sub(r'\s*\.{2,}.*$', '', t)        # strip any dot-leader tail
    return smartcase(t)

def parse(md_path):
    lines = open(md_path, encoding='utf-8', errors='replace').read().split('\n')
    # locate every chapter-heading occurrence
    heads = []
    for i, ln in enumerate(lines):
        m = CH_RE.search(ln)
        if m and ln.lstrip().startswith('VOLUME'):   # case-sensitive: excludes prose "Volume ..."
            heads.append((i, norm_vol(m.group(1)), m.group(2), m.group(3)))
    heads.append((len(lines), None, None, None))  # sentinel

    # build spans grouped by (vol,ch); keep the longest (= real chapter, not cover/TOC entry)
    spans = {}
    for idx in range(len(heads) - 1):
        start, vol, ch, rest = heads[idx]
        end = heads[idx + 1][0]
        key = (vol, ch)
        body = lines[start:end]
        length = sum(len(x) for x in body)
        if key not in spans or length > spans[key][0]:
            spans[key] = (length, start, end, rest)

    docs = []
    diag = []
    for (vol, ch), (length, start, end, rest) in spans.items():
        if vol not in VOLUME_TITLES:
            continue
        block = lines[start:end]
        # title from heading line + following lines
        title = clean_title(block[0].split(':',1)[-1] if ':' in block[0] else rest,
                            block[1:4])
        if not title:
            title = f"Chapter {ch}"
        # drop heading line(s), then strip noise
        kept = []
        for ln in block[1:]:
            s = ln.rstrip()
            if not s.strip():
                kept.append('')
                continue
            if is_noise(s.strip()):
                continue
            kept.append(s)
        # Find where the real body starts. The reliable marker: a centered "CHAPTER n"
        # banner sits immediately before the body (after the heading + the chapter TOC,
        # whose wrapped entries otherwise look like real section headings). Anchor at the
        # first top-level section ("*?n.0 ...") after this chapter's banner. Fall back to a
        # prose-nearby heuristic (FMR prose lines wrap to ~90 chars) if no banner is found.
        TOPSEC = re.compile(r'^\s*\*?\s*\d+\.0\b')
        banner = re.compile(r'^\s*CHAPTER\s+0*' + re.escape(ch) + r'\b\s*$', re.I)
        cap = re.compile(r'^\s*\*?\s*(Table|Figure)\b', re.I)
        def is_heading(s):
            return bool(re.match(r'^\s*\*?\s*\d+(?:\.\d+)+\.?\s+\S', s)) or bool(re.match(r'^\s*\*?\s*\d+\.0\s+\S', s))
        anchor = None
        banner_idx = None
        for i, s in enumerate(kept):
            if banner.match(s):
                banner_idx = i  # keep the last banner for this chapter
        if banner_idx is not None:
            for j in range(banner_idx + 1, len(kept)):
                if TOPSEC.match(kept[j]):
                    anchor = j; break
            if anchor is None:
                anchor = banner_idx + 1
        if anchor is None:
            # no banner: first top-level section with real prose (not table captions) nearby
            def prose_near(i):
                seen = 0
                for j in range(i + 1, min(i + 12, len(kept))):
                    t = kept[j].strip()
                    if not t:
                        continue
                    if len(t) > 60 and not is_heading(kept[j]) and not cap.match(kept[j]):
                        return True
                    seen += 1
                    if seen > 10:
                        break
                return False
            for i, s in enumerate(kept):
                if TOPSEC.match(s) and prose_near(i):
                    anchor = i; break
            if anchor is None:
                for i, s in enumerate(kept):
                    if TOPSEC.match(s):
                        anchor = i; break
        body_lines = kept[anchor:] if anchor is not None else kept
        # drop stray front-matter headers if any slipped past
        body_lines = [s for s in body_lines
                      if s.strip().upper() not in ('TABLE OF CONTENTS', 'SUMMARY OF MAJOR CHANGES')]
        text = reflow(body_lines)
        if len(text) < 120:
            diag.append((vol, ch, 'SHORT', len(text), title))
            continue
        docs.append({
            "id": f"fmr-vol-{vol.lower()}-ch-{ch}",
            "source": "fmr",
            "source_label": "DoD Financial Management Regulation",
            "part": vol,
            "title": f"Chapter {ch}: {title}",
            "content": text,
            "filename": "DoD 7000.14-R",
            "status": "Current",
            "date": "",
            "url": "https://comptroller.war.gov/FMR/",
            "indexed_at": datetime.now(timezone.utc).isoformat(),
        })
    # sort by volume order then chapter number
    docs.sort(key=lambda d: (VOL_ORDER.index(d['part']) if d['part'] in VOL_ORDER else 99,
                             int(re.sub(r'\D','',d['id'].split('-ch-')[1]) or 0)))
    return docs, diag

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--md', required=True)
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--dry', action='store_true')
    ap.add_argument('--out', default='/tmp/fmr_docs.json')
    a = ap.parse_args()
    docs, diag = parse(a.md)

    # diagnostics
    from collections import Counter, defaultdict
    byvol = Counter(d['part'] for d in docs)
    lens = [len(d['content']) for d in docs]
    print(f"FMR docs: {len(docs)}  | total content chars: {sum(lens):,}  (~{sum(lens)//1024}KB raw text)")
    print("chapters per volume:", {v: byvol.get(v,0) for v in VOL_ORDER})
    if lens:
        lens_s = sorted(lens)
        print(f"content len min/median/max: {lens_s[0]} / {lens_s[len(lens_s)//2]} / {lens_s[-1]}")
    if diag:
        print(f"skipped (short/no content): {len(diag)} -> {diag[:8]}")
    json.dump(docs, open(a.out,'w'), ensure_ascii=False)
    print("wrote candidate ->", a.out)

    if a.write:
        DOCS='output/documents.json'
        corpus=json.load(open(DOCS))
        corpus=[d for d in corpus if d.get('source')!='fmr']  # idempotent
        corpus.extend(docs)
        json.dump(corpus, open(DOCS,'w'), ensure_ascii=False)
        print(f"merged into {DOCS}; corpus now {len(corpus)} docs")

if __name__=='__main__':
    main()
