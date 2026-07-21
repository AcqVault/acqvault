#!/usr/bin/env python3
"""Render health check — can the RENDERERS read what the corpus contains?

scripts/corpus_health.py validates the DATA. Nothing validated that the code which
DRAWS that data could parse it — so on 2026-07-21 the DFARS PGI passed every corpus
check and shipped anyway with:

  * all 427 section numbers unparsed  -> the contents list drew 27 em-dashes
  * one citation shared by 27 sections -> every Cite button copied "DFARS PGI Part 4"
  * regOrderKey null for every doc      -> ordering fell back to a locale string compare
  * no Browse entry point at all        -> the source was unreachable except by search

Nobody noticed until the owner browsed it and said it "didn't seem like it was even
complete". Every one of those lives in the gap between "the corpus is valid" and "the
renderer can READ the corpus". This gate closes that gap.

UNLIKE corpus_health.py, a FAIL here usually means fix a FUNCTION, not the corpus.
Each failure names the function and file to edit.

    python3 scripts/render_health.py

Requires `node` (it drives the real renderer functions via scripts/render_probe.js).
"""

import json
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent

# ── declarations ──────────────────────────────────────────────────────────────
# How a source titles its units, and therefore what the renderers must be able to parse.
#   'numbered'  every title leads with a section number (FAR-style, or a PGI/FC prefix)
#   'chapter'   "Chapter N: Title"  (FMR)  — no section number exists to parse
#   'part'      "Part N - Title"    (Category Management) — one doc per part
TITLE_STYLE = {
    'rfo': 'numbered', 'r-dfars': 'numbered', 'far-companion': 'numbered',
    'afi-63-138': 'numbered', 'ssp': 'numbered', 'pgi': 'numbered',
    'fmr': 'chapter', 'category-management': 'part',
}

# Not publicly merchandised, so it is exempt from the registry check — but it IS in the
# corpus, so it is NOT exempt from the citation checks. See acqvault-positioning.
HIDDEN_SOURCES = {'compass'}

# Docs that legitimately have no section number. Exempt by ID and require 100% of the
# rest — a percentage floor would hide new failures inside the margin left by old ones.
EXEMPT_NO_NUMBER = {
    'far-companion-0099',   # "FAR Companion"            — the document's own cover
    'far-companion-0100',   # "About the FAR Companion"  — front matter
    'far-companion-0101',   # "FAR Companion Purpose"    — front matter
    'far-companion-0102',   # "FAR Companion (FC)."      — front matter
    'r-dfars-13',           # "DFARS Part 213 — Simplified…" — part-level memo front matter
    'ssp-b-0',              # "Appendix B — Preface"     — appendix front matter
    'ssp-c-0',              # "Appendix C — Preface"     — appendix front matter
    'ssp-e-0',              # "Appendix E — Preface"     — appendix front matter
}

# Sources where regOrderKey legitimately returns null and the locale-numeric fallback is
# the RIGHT answer, not a degradation.
#   far-companion — many entries annotate the SAME FAR section ("FC 5.000 Plain language"
#     and "FC 5.000 Expanding reach beyond the GPE"), so a numeric key ties for all of
#     them and the alphabetical fallback is what actually orders the part. Teaching
#     regOrderKey to strip the "FC " prefix was measured: it reordered 19 parts and
#     replaced a deterministic alphabetical order with corpus order. Reverted on purpose.
ORDER_KEY_LOCALE_OK = {'far-companion'}

# Documented same-number siblings: two real sections that share a number. Allow-listed by
# ID PAIR, never by rule — a rule would re-open the hole this check exists to close.
CITE_DUP_OK = {
    ('r-dfars-5-205-302', 'r-dfars-5-205-302-2'),   # both "205.302 Public Announcement"
}

# Functions carrying a "KEEP IDENTICAL"/"KEEP IN SYNC" comment, and where their copies
# live. Adding a mirror is one line here.
MIRRORS = [
    ('regOrderKey', ['assets/app.js', 'api/_seo.js', 'api/search.js']),
    ('regTitleCmp', ['assets/app.js', 'api/_seo.js', 'api/search.js']),
    ('pairKey',     ['assets/app.js', 'api/_seo.js']),
]

# Every place a source key must appear for the source to be fully wired. Derived by
# grepping the repo — see docs/ADDING_A_SOURCE.md.
def registry_sites(probe):
    idx = (BASE / 'index.html').read_text(encoding='utf-8')
    css = (BASE / 'assets/app.css').read_text(encoding='utf-8')
    appjs = (BASE / 'assets/app.js').read_text(encoding='utf-8')
    searchjs = (BASE / 'api/search.js').read_text(encoding='utf-8')
    vercel = (BASE / 'vercel.json').read_text(encoding='utf-8')
    library = json.loads((BASE / 'output/library.json').read_text(encoding='utf-8'))

    def find_all(pattern, text):
        return set(re.findall(pattern, text))

    lib_ids = set()
    def walk(node):
        if isinstance(node, dict):
            v = node.get('id')
            if isinstance(v, str) and v.startswith('src-'):
                lib_ids.add(v[4:])
            for x in node.values():
                walk(x)
        elif isinstance(node, list):
            for x in node:
                walk(x)
    walk(library)
    # the library card for DAFI is id "src-dafi-63-138" while the source key is
    # "afi-63-138" — a real wart, aliased rather than silently tolerated
    if 'dafi-63-138' in lib_ids:
        lib_ids.add('afi-63-138')

    tagvar_map = {}
    m = re.search(r"const tagVar = \{([^}]*)\}", appjs)
    if m:
        tagvar_map = dict(re.findall(r"'([a-z0-9-]+)'\s*:\s*'([a-z0-9-]+)'", m.group(1)))
    tagvar = set(tagvar_map)

    return {
        'app.js SOURCE_SHORT':       set(probe['registries']['SOURCE_SHORT']),
        'app.js SOURCE_FULL':        set(probe['registries']['SOURCE_FULL']),
        'app.js SOURCE_URLS':        set(probe['registries']['SOURCE_URLS']),
        'app.js PARTS_BY_SOURCE':    set(probe['registries']['PARTS_BY_SOURCE']),
        'app.js reader tagVar':      set(tagvar),
        '_seo.js SOURCES':           set(probe['registries']['SEO_SOURCES']),
        'search.js SRC_LABEL':       find_all(r"'([a-z0-9-]+)'\s*:", (re.search(r"const SRC_LABEL = \{([^}]*)\}", searchjs) or re.match('', '')).group(1) if re.search(r"const SRC_LABEL = \{([^}]*)\}", searchjs) else ''),
        # app.css names its colour tokens by ABBREVIATION (--dfars-*, --fc-*, --cm-*),
        # and the reader's tagVar map is what translates a source key to one. So the
        # real invariant is: every source has a tagVar entry AND that token exists in
        # the stylesheet. Comparing source keys straight against the CSS would just
        # report the abbreviations as permanently missing.
        'app.css token for each source': {
            s for s in tagvar if f"--{tagvar_map.get(s, s)}-solid:" in css
        },
        'index.html filter pills':   find_all(r'class="fpill"[^>]*data-source="([^"]+)"', idx),
        'index.html browse pills':   find_all(r'data-bsource="([^"]+)"', idx),
        'index.html browse menu':    find_all(r'data-action="choose-browse-source" data-arg="([^"]+)"', idx),
        'index.html coverage chips': find_all(r'data-action="go-browse-source" data-arg="([^"]+)"', idx),
        'index.html library card':   find_all(r'class="lib-src" data-src="([^"]+)"', idx),
        'output/library.json':       lib_ids,
        'vercel.json routes':        set(re.findall(r'[a-z0-9-]+', (re.search(r'\(([a-z0-9|+-]*rfo[a-z0-9|+-]*)\)', vercel) or re.match('', '')).group(1) if re.search(r'\(([a-z0-9|+-]*rfo[a-z0-9|+-]*)\)', vercel) else '')),
    }


# ── mirror parity (pure python, no node needed) ───────────────────────────────
def _strip(src):
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"(?m)^\s*//.*$", "", src)
    return re.sub(r"\s+", "", src)


# A '/' starts a REGEX only after an operator, an opening bracket, or a keyword.
# After a value — an identifier, a number, or a closing bracket — it is DIVISION.
# regOrderKey contains `Math.floor(parseInt(sec[2], 10) / 100)`, and treating that
# slash as a regex made the matcher run past the end of the function and silently
# compare 20,000 characters of unrelated code. A mirror check that reads the wrong
# text is worse than no mirror check.
_RX_OK_BEFORE = re.compile(r"[({\[,;:!&|?+\-*%~^=<>]$")
_RX_OK_KEYWORD = re.compile(r"\b(return|typeof|case|in|of|new|delete|void|instanceof|do|else)$")


def _is_regex_start(src, i):
    before = src[:i].rstrip()
    if not before:
        return True
    return bool(_RX_OK_BEFORE.search(before) or _RX_OK_KEYWORD.search(before))


def _slice_function(src, name):
    m = re.search(r"(?:^|\n)[ \t]*(?:async\s+)?function\s+%s\s*\(" % re.escape(name), src)
    if not m:
        return None
    i = src.index('{', m.start())
    depth, j = 0, i
    in_str, esc, line_c, block_c, rx, cls = None, False, False, False, False, False
    while j < len(src):
        c, n = src[j], src[j + 1] if j + 1 < len(src) else ''
        if line_c:
            if c == '\n':
                line_c = False
        elif block_c:
            if c == '*' and n == '/':
                block_c = False
                j += 1
        elif rx:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif cls:
                if c == ']':
                    cls = False
            elif c == '[':
                cls = True
            elif c == '/':
                rx = False
        elif in_str:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == in_str:
                in_str = None
        else:
            if c == '/' and n == '/':
                line_c = True
                j += 1
            elif c == '/' and n == '*':
                block_c = True
                j += 1
            elif c == '/' and _is_regex_start(src, j):
                rx = True
            elif c in '"\'`':
                in_str = c
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    return src[m.start():j + 1]
        j += 1
    return None


def check_mirrors(fail):
    for name, files in MIRRORS:
        bodies = {}
        for f in files:
            src = (BASE / f).read_text(encoding='utf-8')
            body = _slice_function(src, name)
            if body is None:
                fail(f"mirror parity — {name}() not found in {f}",
                     f"fix: the MIRRORS table in {Path(__file__).name} is stale, or the function was renamed")
                bodies = None
                break
            bodies[f] = _strip(body)
        if not bodies:
            continue
        distinct = set(bodies.values())
        if len(distinct) > 1:
            ref = files[0]
            drifted = [f for f in files[1:] if bodies[f] != bodies[ref]]
            fail(f"mirror parity — {name}() differs between {ref} and {', '.join(drifted)}",
                 f"fix: these carry a KEEP IDENTICAL comment; make them match or delete the comment AND the MIRRORS entry")
        else:
            print(f"  PASS  {name}() identical across {len(files)} copies")


def main():
    if not shutil.which('node'):
        print("SKIP  node not found — render_health cannot drive the renderers")
        return 1

    probe_out = subprocess.run(
        ['node', str(BASE / 'scripts' / 'render_probe.js')],
        capture_output=True, cwd=str(BASE))
    if probe_out.returncode != 0:
        print("FAIL  render_probe.js could not extract the renderer functions:")
        print(probe_out.stderr.decode()[:1400])
        return 1
    probe = json.loads(probe_out.stdout)
    docs = probe['docs']

    failures = []

    def fail(msg, fix):
        failures.append((msg, fix))

    live = {d['source'] for d in docs} - HIDDEN_SOURCES
    print(f"corpus: {len(docs):,} docs across {len(live)} live sources\n")

    # 1. every source appears in every registry
    missing_any = False
    for site, keys in registry_sites(probe).items():
        missing = sorted(live - keys)
        if missing:
            missing_any = True
            fail(f"registry — {site} is missing: {', '.join(missing)}",
                 "fix: add the source there; see docs/ADDING_A_SOURCE.md")
    if not missing_any:
        print("  PASS  every live source appears in every registry site")

    # 2. titles parse to a section number
    for src in sorted(live):
        if TITLE_STYLE.get(src) != 'numbered':
            continue
        bad = [d for d in docs if d['source'] == src and not d['num']
               and d['id'] not in EXEMPT_NO_NUMBER]
        if bad:
            ids = ', '.join(d['id'] for d in bad[:3])
            fail(f"parse coverage — {len(bad)} {src} doc(s) yield an EMPTY section number, "
                 f"so the contents list draws \"—\": {ids}",
                 "fix: add a branch to parseBrowseTitle() in assets/app.js")
    if not any('parse coverage' in m for m, _ in failures):
        print("  PASS  every numbered source's titles parse to a section number")

    # 3. citations are unique within a part
    groups = defaultdict(lambda: defaultdict(list))
    for d in docs:
        if d['source'] in HIDDEN_SOURCES:
            continue
        groups[(d['source'], d['part'])][d['cite']].append(d['id'])
    collisions = []
    for (src, part), by_cite in groups.items():
        for cite, ids in by_cite.items():
            if len(ids) > 1 and tuple(sorted(ids)) not in CITE_DUP_OK:
                collisions.append((src, part, cite, ids))
    if collisions:
        src, part, cite, ids = max(collisions, key=lambda x: len(x[3]))
        fail(f"citation uniqueness — {len(collisions)} citation(s) shared by more than one "
             f"section; worst is {len(ids)}x \"{cite[:58]}\" in {src} part {part}",
             "fix: a shared citation means a parse fell through — check generateCitation() in assets/app.js")
    else:
        print("  PASS  citations are unique within every part")

    # 4. the parsed number appears in the citation
    disagree = [d for d in docs if d['num'] and d['source'] not in HIDDEN_SOURCES
                and d['num'].replace('PGI ', '').rstrip('.').lower() not in d['cite'].lower()
                and d['type'] != 'subpart']
    if disagree:
        fail(f"parse/cite agreement — {len(disagree)} doc(s) whose citation omits the section "
             f"number the reader can see, e.g. \"{disagree[0]['title'][:44]}\" -> \"{disagree[0]['cite'][:44]}\"",
             "fix: parseBrowseTitle() and generateCitation() have independent regexes — align them")
    else:
        print("  PASS  every citation contains the section number the reader sees")

    # 5. ordering key resolves
    for src in sorted(live):
        if TITLE_STYLE.get(src) != 'numbered' or src in ORDER_KEY_LOCALE_OK:
            continue
        nulls = [d for d in docs if d['source'] == src and d['orderKey'] is None
                 and d['id'] not in EXEMPT_NO_NUMBER]
        if nulls:
            fail(f"order key — regOrderKey() returns null for {len(nulls)} {src} doc(s), so "
                 f"section ordering silently degrades to a locale string compare",
                 "fix: regOrderKey() in assets/app.js AND api/_seo.js AND api/search.js")
    if not any('order key' in m for m, _ in failures):
        print("  PASS  regOrderKey() resolves for every numbered source")

    # 6. the in-app part label matches the crawlable one.
    # A source may deliberately override its labels server-side (the SSP names its
    # appendices "Appendix A — Debriefing Guide" rather than "Part A"); that override is
    # the point, not a drift, so exempt any source declaring one.
    overridden = {s for s in live
                  if any(d['partSsr'] != f"Part {d['part']}" and d['partSsr'] != d['partInApp']
                         and not d['partSsr'].startswith(('Part ', 'Volume '))
                         for d in docs if d['source'] == s)}
    mism = sorted({(d['source'], d['part'], d['partInApp'], d['partSsr'])
                   for d in docs
                   if d['partInApp'] != d['partSsr'] and d['source'] not in overridden})
    if mism:
        s, p, a, b = mism[0]
        fail(f"part label parity — {len(mism)} (source, part) pair(s) where the in-app reader "
             f"and the crawlable page disagree, e.g. {s} part {p}: app says \"{a}\", SSR says \"{b}\"",
             "fix: partLabel() in api/_seo.js vs partWord()/displayPartForSource() in assets/app.js")
    else:
        print("  PASS  the in-app part label matches the server-rendered one")

    # 7. mirrored functions really are identical
    check_mirrors(fail)

    print()
    if failures:
        for msg, fix in failures:
            print(f"  FAIL  {msg}\n        {fix}")
        print(f"\n{len(failures)} render health check(s) FAILED.")
        return 1
    print("All render health checks passed.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
