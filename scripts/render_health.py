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

import hashlib
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
    # Every one of these carried a KEEP IN SYNC comment and no check behind it.
    # clauseSuppressSet decides which duplicate R-DFARS clause wins, so drift there
    # silently changes search RANKING between the server and the in-app scorer.
    ('clauseSuppressSet',    ['api/search.js', 'assets/app.js']),
    ('displayPartForSource', ['api/_seo.js', 'assets/app.js']),
    ('partWord',             ['api/_seo.js', 'assets/app.js']),
    ('tokenLevel',           ['api/_seo.js', 'assets/app.js']),
]

# Same idea for data. Two mirrors are deliberately NOT here: parseRatingTable takes an
# extra escFn argument server-side, and threshPart is ES5 in the browser file and ES6 in
# _seo.js — so their TEXT can never match. For threshPart the thing that actually has to
# agree is the grouping data, and THRESH_GROUPS below covers that.
CONST_MIRRORS = [
    ('CATEGORY_VEHICLE_TABLES', ['api/_seo.js', 'assets/app.js']),
    ('PART_200_SOURCES',        ['api/_seo.js', 'assets/app.js']),
    ('PAIR_SOURCE',             ['api/_seo.js', 'assets/app.js']),
    ('ALT_BOUNDARY',            ['api/_seo.js', 'assets/app.js']),
    ('ALT_HEAD',                ['api/_seo.js', 'assets/app.js']),
    ('THRESH_GROUPS',           ['api/_seo.js', 'assets/study.js']),
]

# Every place a source key must appear for the source to be fully wired. Derived by
# grepping the repo — see docs/ADDING_A_SOURCE.md.
def registry_sites(probe):
    idx = (BASE / 'index.html').read_text(encoding='utf-8')
    css = (BASE / 'assets/app.css').read_text(encoding='utf-8')
    appjs = (BASE / 'assets/app.js').read_text(encoding='utf-8')
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

    for name, files in CONST_MIRRORS:
        bodies = {}
        for f in files:
            src = (BASE / f).read_text(encoding='utf-8')
            m = re.search(r'(?:const|var)\s+' + name + r'\s*=\s*(.*?);\s*?\n(?=\s*(?:const|var|let|function|//|/\*|\n))',
                          src, re.S)
            if m is None:
                fail(f"mirror parity — {name} not found in {f}",
                     f"fix: the CONST_MIRRORS table in {Path(__file__).name} is stale, or it was renamed")
                bodies = None
                break
            bodies[f] = _strip(m.group(1))
        if not bodies:
            continue
        if len(set(bodies.values())) > 1:
            ref = files[0]
            drifted = [f for f in files[1:] if bodies[f] != bodies[ref]]
            fail(f"mirror parity — {name} differs between {ref} and {', '.join(drifted)}",
                 "fix: these carry a KEEP IN SYNC comment; make them match or delete the comment AND the entry")
        else:
            print(f"  PASS  {name} identical across {len(files)} copies")


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

    # 8. every stylesheet the server emits is brace-balanced
    #
    # The CSS lives inside JS template literals (STYLE, STUDY_CSS, SRCSEL_CSS, and the
    # shared CHROME_CSS), where nothing type-checks it. Hoisting the chrome bar into a
    # shared constant once cut the block one "}" short: the @media at the end of it never
    # closed, and because that constant is interpolated at the TOP of SRCSEL_CSS the
    # unterminated block swallowed every rule after it. /source-selection rendered with no
    # styling at all, the page still returned 200, and every existing gate passed. Node
    # parses the file fine — the damage is in the string. Count the braces.
    SEO = (BASE / 'api' / '_seo.js').read_text(encoding='utf-8')
    css_bad = 0
    for name in ('STYLE', 'STUDY_CSS', 'SRCSEL_CSS', 'CHROME_CSS'):
        m = re.search(r'const ' + name + r' = (?:\(pad, top\) => )?`(.*?)`;', SEO, re.S)
        if not m:
            fail(f'{name} not found in api/_seo.js',
                 'the brace-balance check cannot see it; did the constant get renamed?')
            css_bad += 1
            continue
        body = m.group(1)
        # interpolations are other literals checked on their own; blank them out
        body = re.sub(r'\$\{[^}]*\}', '', body)
        opens, closes = body.count('{'), body.count('}')
        if opens != closes:
            css_bad += 1
            fail(f'{name} is not brace-balanced: {opens} "{{" vs {closes} "}}"',
                 'an unclosed rule or @media swallows every rule after it and the page '
                 'renders unstyled while still returning 200')
    if not css_bad:
        print('  PASS  STYLE, STUDY_CSS, SRCSEL_CSS and CHROME_CSS are brace-balanced')

    # 9. the server modules actually parse
    #
    # render_probe already refuses to run on a broken api/_seo.js, but nothing checked
    # the SHIPPED client scripts: a syntax error in assets/study.js serves a blank /study
    # with a 200 and every gate green. This also turns _seo.js's failure from
    # "could not extract the renderer functions" into the actual SyntaxError.
    import subprocess as _sp
    for mod in ('api/_seo.js', 'assets/study.js', 'assets/source-selection.js', 'assets/app.js'):
        f = BASE / mod
        if not f.exists():
            continue
        if mod.startswith('api/'):
            chk = _sp.run(['node', '-e', f'require({str(f)!r})'], capture_output=True, text=True)
        else:
            # browser files are not modules; wrap them so node parses without running
            chk = _sp.run(['node', '-e',
                           f'new Function(require("fs").readFileSync({str(f)!r}, "utf8"))'],
                          capture_output=True, text=True)
        if chk.returncode != 0:
            errs = [l.strip() for l in (chk.stderr or '').splitlines()
                    if 'Error' in l and 'node:internal' not in l]
            fail(f'{mod} does not parse: ' + (errs[0] if errs else 'see node output'),
                 'every other check here is a regex over the source and will pass a file '
                 'that cannot load at all')
            break
    else:
        print('  PASS  api/_seo.js and the shipped scripts parse')

    # 10. every renderer actually returns a page
    #
    # A parse gate cannot see `const counts` declared below the line that reads it: the
    # file parsed, /study threw at request time, and every regex check here stayed green.
    # Twelve renderers, called for real.
    smoke = _sp.run(['node', str(BASE / 'scripts' / 'render_smoke.js'), str(BASE / 'api' / '_seo.js')],
                    capture_output=True, text=True, cwd=str(BASE))
    if smoke.returncode != 0:
        fail('a renderer threw or returned no page: ' + (smoke.stderr or '').strip().replace('\n', '; '),
             'the page would serve a 500 in production while every other check here passes')
    else:
        print('  PASS  all 12 renderers return a page')

    # 11. index.html's "N+ questions" floor is still true
    #
    # /study computes this figure; index.html is static and cannot, so the claim is a
    # hardcoded floor. A floor is fine — it just has to stay a floor. It had 32 of
    # headroom when this was written.
    idx = (BASE / 'index.html').read_text()
    m = re.search(r'(\d[\d,]*)\+\s*questions', idx)
    if m:
        claimed = int(m.group(1).replace(',', ''))
        deck = json.loads((BASE / 'assets' / 'study-deck.json').read_text())
        real = sum(len(deck.get(k) or []) for k in
                   ('recall_basic', 'recall_advanced', 'thresholds', 'scenarios'))
        if real < claimed:
            fail(f'index.html claims {claimed}+ questions but the deck holds {real}',
                 'lower the claim in index.html, or add cards - a floor that is no longer '
                 'a floor is a false statement on the home page')
        else:
            print(f'  PASS  index.html\'s {claimed}+ questions floor holds ({real} in the deck)')

    # 12. a hand-versioned asset that changed also got its ?v= bumped
    #
    # /assets/* ships `immutable` for 30 days, so a changed file behind an unchanged
    # ?v= is pinned at the edge and returning visitors keep the old bytes. Content
    # hashes handle the server-rendered pages; index.html's tokens are hand-maintained
    # and were missed twice — verify_deploy catches it, but only AFTER the deploy.
    man_path = BASE / 'scripts' / 'asset-versions.json'
    idx_html = (BASE / 'index.html').read_text()
    live = {}
    for mm in re.finditer(r'/assets/([A-Za-z0-9._-]+\.(?:js|css|json))\?v=(\d+)', idx_html):
        f = BASE / 'assets' / mm.group(1)
        if f.exists():
            live[mm.group(1)] = {'v': int(mm.group(2)),
                                 'sha': hashlib.sha256(f.read_bytes()).hexdigest()[:12]}
    man = json.loads(man_path.read_text()) if man_path.exists() else {}
    unbumped = [n for n, cur in live.items()
                if n in man and cur['sha'] != man[n]['sha'] and cur['v'] <= man[n]['v']]
    if unbumped:
        fail('changed without a ?v= bump in index.html: ' + ', '.join(sorted(unbumped)),
             'bump the token, then refresh scripts/asset-versions.json - /assets/* is '
             'immutable for 30 days, so the old bytes stay pinned at the edge')
    else:
        stale_man = [n for n, cur in live.items() if man.get(n) != cur]
        if stale_man:
            man_path.write_text(json.dumps(live, indent=2, sort_keys=True) + '\n')
            print(f'  PASS  hand-versioned assets bumped (manifest refreshed: {", ".join(sorted(stale_man))})')
        else:
            print(f'  PASS  all {len(live)} hand-versioned assets match their ?v=')

    # 13. no custom property is defined as itself
    #
    # Twice now a bulk hex -> var() substitution has rewritten the token's OWN
    # definition, leaving --brass: var(--brass). The property then resolves to
    # nothing, the colour silently falls back to the initial value, and every
    # gate stays green because the page still renders. Cheap to check, so check it.
    circ = []
    for path in ('assets/app.css', 'api/_seo.js'):
        text = (BASE / path).read_text()
        for name, ref in re.findall(r'(--[\w-]+)\s*:\s*var\(\s*(--[\w-]+)\s*\)', text):
            if name == ref:
                circ.append(f'{path}: {name} (defined as itself)')
        # var(--x, var(--x)) reads as "has a fallback" and has none. A bulk hex -> var()
        # substitution rewrote the FALLBACK too and quietly deleted 53 of them, on the
        # very tokens that had once been undefined on every SSR page.
        for tok in set(re.findall(r'var\(\s*(--[\w-]+)\s*,\s*var\(\s*\1\s*\)\s*\)', text)):
            n = len(re.findall(r'var\(\s*' + re.escape(tok) + r'\s*,\s*var\(\s*' + re.escape(tok) + r'\s*\)\s*\)', text))
            circ.append(f'{path}: {tok} falls back to itself x{n}')
    if circ:
        fail('custom properties defined as themselves: ' + ', '.join(circ),
             'a token that resolves to itself renders as the initial value with no '
             'error - give it a literal, or point it at a different token')
    else:
        print('  PASS  no custom property resolves to itself')

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
