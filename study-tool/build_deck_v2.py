#!/usr/bin/env python3
"""Build assets/study-deck.json v2:
  - merge hand-authored MCQ distractors (study-tool/mcq/distractors-*.json) into existing cards
  - append new authored cards (study-tool/mcq/new-cards-*.json) with stable sha1 ids
  - validate: no dupe ids, distractors != answer, 3 distractors per authored set

Card contract for the runtime (assets/study.js):
  a card WITH "d": [3 wrong answers] renders as multiple choice;
  a card WITHOUT "d" renders produce-then-reveal (long board-probe narratives stay reveal-style
  on purpose — four 250-char options is a reading test, not a knowledge check).
  "x" = post-answer debrief narrative (the rule + the trap); "ref" = where the reference lives.
  Scenarios get a "coach" block {qtype, smes, rule} resolved from coach-topics.json via the
  topic-normalization table below — study.js builds the "how you should have answered"
  walkthrough and the hint ladder from it.
"""
import json, hashlib, sys, os, re, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DECK = os.path.join(ROOT, 'assets', 'study-deck.json')
MCQ = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mcq')

def load(p):
    with open(p) as f: return json.load(f)

def card_id(c):
    return hashlib.sha1((c['type'] + '|' + c['topic'] + '|' + c['q']).encode()).hexdigest()[:12]

deck = load(DECK)

# ---- 1. merge distractors ----
distractors = {}
for name in ('distractors-basic.json', 'distractors-thresholds.json',
             'distractors-advanced-1.json', 'distractors-advanced-2.json'):
    d = load(os.path.join(MCQ, name))
    dupes = set(d) & set(distractors)
    if dupes: sys.exit(f'FATAL: duplicate distractor ids across files: {dupes}')
    distractors.update(d)

by_id = {}
for pool in ('recall_basic', 'recall_advanced', 'thresholds'):
    for c in deck[pool]:
        by_id[c['id']] = c

unknown = [i for i in distractors if i not in by_id]
if unknown: sys.exit(f'FATAL: distractor ids not in deck: {unknown}')

applied = 0
for cid, opts in distractors.items():
    c = by_id[cid]
    if len(opts) != 3: sys.exit(f'FATAL: {cid} has {len(opts)} distractors, need 3')
    if len(set(opts)) != 3: sys.exit(f'FATAL: {cid} has duplicate distractors')
    if c['a'] in opts: sys.exit(f'FATAL: {cid} distractor equals the answer')
    c['d'] = opts
    applied += 1

# ---- 2. append new cards (idempotent: the committed deck may already contain them) ----
def add_cards(path, pool, level):
    added = 0
    for nc in load(os.path.join(MCQ, path)):
        card = {'type': 'recall', 'level': level, 'topic': nc['topic'], 'q': nc['q'], 'a': nc['a']}
        cid = card_id(card)
        if cid in by_id:
            # already in the baseline deck from a prior build — refresh its authored fields
            ex = by_id[cid]
            for k in ('d', 'x', 'ref'):
                if nc.get(k): ex[k] = nc[k]
            continue
        card['id'] = cid
        if 'd' in nc:
            if len(nc['d']) != 3 or len(set(nc['d'])) != 3 or nc['a'] in nc['d']:
                sys.exit(f'FATAL: bad distractor set on new card: {nc["q"][:60]}')
            card['d'] = nc['d']
        if nc.get('x'): card['x'] = nc['x']
        if nc.get('ref'): card['ref'] = nc['ref']
        deck[pool].append(card)
        by_id[cid] = card
        added += 1
    return added

nb = add_cards('new-cards-basic.json', 'recall_basic', 'basic')
na = add_cards('new-cards-advanced.json', 'recall_advanced', 'advanced')

# ---- 2b. merge answer debriefs (x = narrative, ref = where the reference lives) ----
explains = {}
for name in ('x-basic.json', 'x-thresholds.json', 'x-advanced-1.json', 'x-advanced-2.json'):
    d = load(os.path.join(MCQ, name))
    dupes = set(d) & set(explains)
    if dupes: sys.exit(f'FATAL: duplicate explain ids across files: {dupes}')
    explains.update(d)
unknown_x = [i for i in explains if i not in by_id]
if unknown_x: sys.exit(f'FATAL: explain ids not in deck: {unknown_x}')
x_applied = ref_applied = 0
for cid, e in explains.items():
    c = by_id[cid]
    if e.get('x'): c['x'] = e['x']; x_applied += 1
    if e.get('ref'): c['ref'] = e['ref']; ref_applied += 1

# ---- 2c. scenario coaching (qtype / smes / default rule per canonical topic) ----
COACH = load(os.path.join(MCQ, 'coach-topics.json'))
# normalize the freeform scenario topic tags to canonical coach keys
NORM = {
    'authority & ratification': 'Authority, Unauthorized Commitments & Ratification',
    'authority.': 'Authority, Unauthorized Commitments & Ratification',
    'authority/waiver': 'Authority, Unauthorized Commitments & Ratification',
    'unauthorized commitments & ratification': 'Authority, Unauthorized Commitments & Ratification',
    'certified cost or pricing data': 'Certified Cost or Pricing Data & Proposal Analysis',
    'price analysis': 'Certified Cost or Pricing Data & Proposal Analysis',
    'clearance': 'Clearance — Independent Review & Approval',
    'construction & services': 'Construction & Service Contracting',
    'differing site conditions': 'Construction & Service Contracting',
    'contractor performance/service administration': 'Construction & Service Contracting',
    'competition': 'Competition (CICA)',
    'd&a mechanics': 'IDIQ Ordering & Fair Opportunity',
    'fair opportunity exceptions': 'IDIQ Ordering & Fair Opportunity',
    'interagency': 'Interagency Acquisitions & the Economy Act',
    'modifications & scope': 'Contract Modifications & Scope',
    'modifications/descoping': 'Contract Modifications & Scope',
    'scope.': 'Contract Modifications & Scope',
    'pia': 'Procurement Integrity',
    'source selection integrity': 'Procurement Integrity',
    'r&d contracting': 'R&D Contracting — BAAs, SBIR & OTs',
    'rea mechanics': 'REAs & Claims',
    'required sources': 'Required Sources of Supplies & Services',
    'responsibility': 'Contractor Qualifications — Responsibility',
    'simplified acquisition': 'Simplified Acquisition Procedures',
    'source selection': 'Contracting by Negotiation — Source Selection',
    't4c (partial).': 'Terminations',
    'terminations': 'Terminations',
    'excusable delay': 'Terminations',
    'reprocurement.': 'Terminations',
    'acquisition planning': 'Acquisition Planning & Strategy',
    'acquisition planning.': 'Acquisition Planning & Strategy',
    'documentation.': 'Acquisition Planning & Strategy',
    'contract structure/type.': 'Contract Types',
    'options structure': 'Options',
    'fiscal law (purpose, incremental funding)': 'Contract Finance & Fiscal Law',
    'fiscal law (severable services, time)': 'Contract Finance & Fiscal Law',
    'protests (the one you’re preventing).': 'Protests',
    "protests (the one you're preventing).": 'Protests',
}
def coach_for(topics):
    for t in topics or []:
        if t in COACH: return COACH[t]
        key = NORM.get(t.strip().lower())
        if key and key in COACH: return COACH[key]
    return COACH['_generic']

# ---- 2d. board-sim realism upgrades: panel ask + model-answer script + follow-up help ----
# scenario-upgrades-*.json: id → { ask, script, fu: [{h, d}, ...] } where fu[i] pairs with
# the scenario's existing follow_ups[i] (string) to form {q, h, d} objects.
# scenario-new.json: complete new scenarios (owner's board samples not previously covered).
upgrades = {}
for name in ('scenario-upgrades-1.json', 'scenario-upgrades-2.json', 'scenario-upgrades-3.json'):
    u = load(os.path.join(MCQ, name))
    dupes = set(u) & set(upgrades)
    if dupes: sys.exit(f'FATAL: duplicate upgrade ids across files: {dupes}')
    upgrades.update(u)
sc_by_id = {s['id']: s for s in deck['scenarios']}
unknown_u = [i for i in upgrades if i not in sc_by_id]
if unknown_u: sys.exit(f'FATAL: upgrade ids not in deck: {unknown_u}')
asks = scripts = fu_upgraded = 0
for sid, u in upgrades.items():
    s = sc_by_id[sid]
    if u.get('ask'): s['ask'] = u['ask']; asks += 1
    if u.get('script'): s['script'] = u['script']; scripts += 1
    if u.get('fu'):
        # normalize: baseline follow-ups may be strings (v1) or already-converted objects (rerun)
        old_q = [f['q'] if isinstance(f, dict) else f for f in (s.get('follow_ups') or [])]
        if len(u['fu']) != len(old_q):
            sys.exit(f'FATAL: fu count mismatch on {sid}: {len(u["fu"])} authored vs {len(old_q)} existing')
        s['follow_ups'] = [{'q': q, 'h': f.get('h'), 'd': f.get('d')} for q, f in zip(old_q, u['fu'])]
        fu_upgraded += len(old_q)

# ---- 2e. authored follow-ups for scenarios that shipped without any (drill + bank) ----
# scenario-followups-*.json: id → [{q, h, d}, ...] — set authoritatively. Must not overlap
# with upgrades' zip-style 'fu' (those pair with pre-existing spot-scenario follow-ups).
followups = {}
for name in ('scenario-followups-1.json', 'scenario-followups-2.json'):
    f = load(os.path.join(MCQ, name))
    dupes = set(f) & set(followups)
    if dupes: sys.exit(f'FATAL: duplicate followup ids across files: {dupes}')
    followups.update(f)
overlap = [i for i in followups if i in upgrades and upgrades[i].get('fu')]
if overlap: sys.exit(f'FATAL: followup ids collide with upgrades fu: {overlap}')
unknown_f = [i for i in followups if i not in sc_by_id]
if unknown_f: sys.exit(f'FATAL: followup ids not in deck: {unknown_f}')
fu_added = 0
for sid, fus in followups.items():
    for f in fus:
        if not (f.get('q') and f.get('h') and f.get('d')):
            sys.exit(f'FATAL: incomplete follow-up on {sid}: {str(f)[:60]}')
    sc_by_id[sid]['follow_ups'] = fus
    fu_added += len(fus)

new_sc = 0
for ns in load(os.path.join(MCQ, 'scenario-new.json')):
    card = dict(ns)
    card['type'] = 'scenario'
    card['level'] = 'advanced'
    cid = hashlib.sha1(('scenario|' + '|'.join(card.get('topics', [])) + '|' + card['scenario']).encode()).hexdigest()[:12]
    card['id'] = cid
    if cid in sc_by_id:
        sc_by_id[cid].update(card)  # rerun: refresh authored content in place
        continue
    if cid in by_id: sys.exit(f'FATAL: new scenario id collision with a recall card {cid}')
    deck['scenarios'].append(card)
    sc_by_id[cid] = card
    new_sc += 1

coached = generic = 0
for sc in deck['scenarios']:
    c = coach_for(sc.get('topics'))
    sc['coach'] = c
    if c is COACH['_generic']: generic += 1
    else: coached += 1

# ---- 2f. authoritative deep links — every card points at the live rulebook ----
# Cards carry "links": [{t, u}] resolved from cite tokens ("RFO 13.201", "R-DFARS 217.74",
# "RFO Part 6") against output/documents.json. URLs are the server-rendered part pages with
# per-section anchors (/rfo/part-13#FAR_13_201) — instant, cached, land exactly on the section.
# Precedence per card: authority-links.json "cards"[id] > tokens in the card's own ref >
# authority-links.json "topics"[topic]. Scenario coaches resolve their cite the same way.
docs = load(os.path.join(ROOT, 'output', 'documents.json'))
sec_idx, part_ok = {}, set()
SEC_TITLE = re.compile(r'^(?:SUBPART\s+|Subpart\s+)?(\d{1,3}\.[\d.-]+)')
for d in docs:
    src = d.get('source')
    if src not in ('rfo', 'r-dfars'): continue
    part = str(d.get('part') or '').strip()
    if part: part_ok.add((src, part))
    m = SEC_TITLE.match(d['title'])
    if m:
        key = (src, m.group(1).rstrip('.-'))
        if key not in sec_idx: sec_idx[key] = d
for d in docs:  # second pass: the doc living in the section's own part wins a duplicate number
    src = d.get('source')
    if src not in ('rfo', 'r-dfars'): continue
    m = SEC_TITLE.match(d['title'])
    if not m: continue
    num = m.group(1).rstrip('.-')
    want = num.split('.')[0]
    if src == 'r-dfars' and want.startswith('2') and len(want) == 3: want = str(int(want) - 200)
    if str(d.get('part') or '').strip() == want:
        sec_idx[(src, num)] = d

def find_sec(src, num):
    num = num.rstrip('.')
    d = sec_idx.get((src, num))
    if d: return d
    # prefix match: "217.74" → 217.7400 Scope; shortest extension wins
    cands = [(k[1], v) for k, v in sec_idx.items() if k[0] == src and k[1].startswith(num)]
    if not cands: return None
    cands.sort(key=lambda kv: (len(kv[0]), kv[0]))
    return cands[0][1]

def sec_link(src, num):
    d = find_sec(src, num)
    if not d: return None
    part = str(d.get('part') or '').strip()
    if not part: return None
    frag = d.get('anchor') or d['id']  # SEO pages render id=anchor, falling back to the doc id
    return {'t': ('RFO ' if src == 'rfo' else 'R-DFARS ') + num,
            'u': '/' + src + '/part-' + part + '#' + str(frag)}

def part_link(src, part):
    part = str(part).strip()
    label_part = part
    if src == 'r-dfars' and len(part) == 3 and part.startswith('2'):
        part = str(int(part) - 200)  # cites say "227"; the corpus stores DFARS parts as 27
    if (src, part) not in part_ok: return None
    return {'t': ('RFO' if src == 'rfo' else 'R-DFARS') + ' Part ' + label_part,
            'u': '/' + src + '/part-' + part}

# ---- 2f-L. ladder pool (warrant-level track) — STRICT build-time citation gate ----
# Every ladder card carries a cite that is corpus-verified under stricter rules than
# cite_links: EXACT section lookup only (find_sec's shortest-extension prefix match is
# deliberately NOT used here — "6.30" must fail, not silently resolve to 6.301), the
# section must be real prose (not [Reserved]/stub), the quote must appear verbatim
# (whitespace-normalized), and any asserted dollar amount must live inside the quote
# itself (bare amounts recur in unrelated statute names — the quote is the anchor).
# On success each card ships with cite.link resolved the same way sec_link builds URLs,
# so the runtime never needs the corpus.
LADDER_RUNGS = ('sat', '5m', '25m', 'unlimited')

def _norm(t):
    t = re.sub(r'\bL\d+:', ' ', t)     # strip ingest level markers
    return re.sub(r'\s+', ' ', t).strip()

def ladder_gate(items):
    out = {r: [] for r in LADDER_RUNGS}
    seen = set()
    for it in items:
        tag = (it.get('q') or '(no q)')[:60]
        for f in ('rung', 'type', 'topic', 'q', 'a', 'cite'):
            if not it.get(f): sys.exit(f'FATAL: ladder {tag}: missing required field "{f}"')
        cite = it['cite']
        for f in ('src', 'sec', 'quote'):
            if not cite.get(f): sys.exit(f'FATAL: ladder {tag}: missing required field "cite.{f}"')
        if it['rung'] not in LADDER_RUNGS:
            sys.exit(f'FATAL: ladder {tag}: unknown rung "{it["rung"]}"')
        # 1. exists — exact section index hit ONLY, no prefix fallback
        d = sec_idx.get((cite['src'], cite['sec']))
        if not d:
            sys.exit(f'FATAL: ladder {tag}: no such section {cite["src"]} {cite["sec"]} (exact match required)')
        # 2. not reserved / empty
        # Measure the BODY, not the whole doc: a raw length floor on title+body rejects
        # short-but-complete rules (RFO 13.102 is 174 chars of substance and was excluded
        # by one character under the old 200-char total). Heading-only stubs and [Reserved]
        # sections leave a body of ~0 once the title echo is stripped, so they still fail.
        _body = _norm(d['content'])
        _t = _norm(d['title'])
        if _body.lower().startswith(_t.lower()):
            _body = _body[len(_t):].strip(' .')
        if '[Reserved]' in d['title'] or len(_body) < 40:
            sys.exit(f'FATAL: ladder {tag}: section {cite["src"]} {cite["sec"]} is [Reserved]/empty — not citable')
        # 3. quote verbatim in the section
        if _norm(cite['quote']) not in _norm(d['content']):
            sys.exit(f'FATAL: ladder {tag}: quote not verbatim in {cite["src"]} {cite["sec"]}: "{cite["quote"][:80]}"')
        # 4. asserted amount must sit inside the quote itself
        if cite.get('amount') and cite['amount'] not in cite['quote']:
            sys.exit(f'FATAL: ladder {tag}: amount {cite["amount"]} not inside the quote')
        card = {'type': it['type'], 'topic': it['topic'], 'q': it['q'], 'a': it['a']}
        cid = card_id(card)
        if cid in seen: sys.exit(f'FATAL: ladder {tag}: duplicate generated id {cid}')
        seen.add(cid)
        card['id'] = cid
        card['rung'] = it['rung']
        part = str(d.get('part') or '').strip()
        if not part: sys.exit(f'FATAL: ladder {tag}: section {cite["src"]} {cite["sec"]} has no part — link unbuildable')
        frag = d.get('anchor') or d['id']
        card['cite'] = dict(cite)
        card['cite']['link'] = {'t': ('RFO ' if cite['src'] == 'rfo' else 'R-DFARS ') + cite['sec'],
                                'u': '/' + cite['src'] + '/part-' + part + '#' + str(frag)}
        out[it['rung']].append(card)
    return out

# ACQVAULT_LADDER_FILE: test hook (scripts/test_ladder_gate.py) — pins to a single file.
# Default authors one file per rung (deck-ladder-*.json) so batches never race the same file;
# plain deck-ladder.json is still picked up. Sorted for a stable build.
_here = os.path.dirname(os.path.abspath(__file__))
_pin = os.environ.get('ACQVAULT_LADDER_FILE')
_ladder_paths = [_pin] if _pin else sorted(
    glob.glob(os.path.join(_here, 'deck-ladder.json')) +
    glob.glob(os.path.join(_here, 'deck-ladder-*.json')))
if not _ladder_paths: sys.exit('FATAL: ladder: no deck-ladder*.json authoring file found')
_ladder_items = []
for _p in _ladder_paths: _ladder_items.extend(load(_p)['items'])
deck['ladder'] = ladder_gate(_ladder_items)

SRC_WORD = {'RFO': 'rfo', 'R-DFARS': 'r-dfars'}
def cite_links(cite):
    """Parse a cite string ('RFO 6.103/6.104 · R-DFARS 217.74 · Vol. 2, Competition') into
    resolved links. Non-rulebook tokens (guides, statutes, forms) resolve to nothing."""
    out, seen = [], set()
    def push(l):
        if l and l['u'] not in seen: seen.add(l['u']); out.append(l)
    for tok in re.split(r'\s*[;·]\s*', cite or ''):
        m = re.match(r'^(RFO|R-DFARS)\b\s*(.*)$', tok.strip())
        if not m:
            if tok.strip() == 'DoD FMR': push({'t': 'DoD FMR', 'u': '/fmr'})
            continue
        src, body = SRC_WORD[m.group(1)], m.group(2)
        if not body:
            push({'t': m.group(1), 'u': '/' + src})
            continue
        secs = re.findall(r'\d{1,3}\.[\d.-]+', body)
        for s in secs: push(sec_link(src, s))
        if not secs:
            for p in re.findall(r'\d{1,3}', body): push(part_link(src, p))
    return out

AUTH = load(os.path.join(MCQ, 'authority-links.json'))
bad_topics = [t for t in AUTH.get('topics', {}) if not cite_links(AUTH['topics'][t])]
if bad_topics: sys.exit(f'FATAL: authority-links topics resolve to nothing: {bad_topics}')
bad_cards = [i for i in AUTH.get('cards', {}) if i not in by_id]
if bad_cards: sys.exit(f'FATAL: authority-links card ids not in deck: {bad_cards}')

n_override = n_ref = n_topic = 0
unlinked = []
for pool in ('recall_basic', 'recall_advanced', 'thresholds'):
    for c in deck[pool]:
        if c['id'] in AUTH.get('cards', {}):
            links = cite_links(AUTH['cards'][c['id']])
            if not links: sys.exit(f'FATAL: authority-links card cite resolves to nothing: {c["id"]}')
            n_override += 1
        else:
            links = cite_links(c.get('ref', ''))
            if links: n_ref += 1
            else:
                tcite = AUTH.get('topics', {}).get(c.get('topic', ''))
                links = cite_links(tcite) if tcite else []
                if links: n_topic += 1
        if links: c['links'] = links
        else:
            c.pop('links', None)
            unlinked.append(c['id'] + ' [' + (c.get('topic') or c.get('type', '?')) + '] ' + c.get('ref', '(no ref)'))

for key, co in COACH.items():
    co['links'] = cite_links(co.get('cite', ''))

# ---- 2g. first-use acronym expansion — never assume the reader's level ----
# Each card/scenario is its own reading unit: the first use of a glossary acronym becomes
# "simplified acquisition threshold (SAT)"; later uses stay short. Units that already contain
# the expansion phrase (mnemonic drills whose answer spells the term, hand-written intros)
# are skipped, which also makes this step idempotent across rebuilds.
# Field rules: MCQ cards expand q+x only (expanding the correct answer would make it the
# longest option — a giveaway); production/reveal cards expand a+x, never q (the question
# may be asking FOR the definition); scenarios expand all prose in reading order.
GLOSS = load(os.path.join(MCQ, 'glossary.json'))['terms']

def _acro_re(acro):
    return re.compile(r'(?<![(\w])' + re.escape(acro) + r"(s\b|'s|’s|\b)")

_SENT_END = re.compile(r'(?:^|[.!?…]["”)\]]?\s+|\n\s*)$')
def _expand_in(text, acro, term):
    m = _acro_re(acro).search(text)
    if not m: return None
    suffix = m.group(1)
    exp = term['x']
    if term.get('literal'):
        repl = exp
    elif suffix == 's':
        repl = term.get('plural', exp + 's') + ' (' + acro + 's)'
    elif suffix in ("'s", '’s'):
        repl = exp + suffix + ' (' + acro + ')'
    else:
        repl = exp + ' (' + acro + ')'
    before = text[:m.start()]
    if term.get('the') and not term.get('literal') and not re.search(r'\b[Tt]he\s+$', before):
        repl = 'the ' + repl
    # article agreement: "a UAC" → "an unauthorized commitment (UAC)" and the reverse
    art = re.search(r'\b([Aa]n?)(\s+)$', before)
    if art:
        want = 'an' if repl[0].lower() in 'aeiou' else 'a'
        if art.group(1).lower() != want:
            fixed = want if art.group(1).islower() else want.capitalize()
            before = before[:art.start(1)] + fixed + art.group(2)
    if _SENT_END.search(before) and repl[0].islower():
        repl = repl[0].upper() + repl[1:]
    return before + repl + text[m.end():]

def _unit_expand(fields, stats, scan_extra=''):
    """fields: ordered (obj, key) text slots to EDIT; scan_extra: additional unit text
    (answers, options) checked for existing explanations but never edited."""
    combined = (' '.join((o.get(k) or '') for o, k in fields) + ' ' + scan_extra).lower()
    norm = combined.replace(' & ', ' and ')
    for acro, term in GLOSS.items():
        core = term['x'].lower()
        if term.get('literal'): core = core.split('(')[-1].rstrip(')').strip().lower()
        if core in norm: continue                     # expansion already written out
        al = acro.lower()
        if '(' + al + ')' in norm or '(' + al + 's)' in norm: continue  # already glossed
        for o, k in fields:
            t = o.get(k)
            if not t: continue
            t2 = _expand_in(t, acro, term)
            if t2 is not None:
                o[k] = t2
                stats[0] += 1
                break

_exp_stats = [0]
for pool in ('recall_basic', 'recall_advanced', 'thresholds'):
    for c in deck[pool]:
        if c.get('d'):
            fields, extra = [(c, 'q'), (c, 'x')], c['a'] + ' ' + ' '.join(c['d'])
        else:
            fields, extra = [(c, 'a'), (c, 'x')], c.get('q') or ''
        _unit_expand(fields, _exp_stats, extra)
for sc in deck['scenarios']:
    fields = [(sc, 'scenario'), (sc, 'ask')]
    for f in (sc.get('facts') or []): fields += [(f, 'fact'), (f, 'why')]
    fields += [(sc, 'board_answer'), (sc, 'script')]
    for f in (sc.get('follow_ups') or []):
        if isinstance(f, dict): fields += [(f, 'q'), (f, 'h'), (f, 'd')]
    _unit_expand(fields, _exp_stats)
for key, co in COACH.items():
    _unit_expand([(co, 'qtype'), (co, 'smes'), (co, 'rule')], _exp_stats)

# ---- 2h. quick rounds (The Combination daily word · Which Part Governs) ----
GAMES = load(os.path.join(MCQ, 'games.json'))
PN = GAMES['part_names']
combo = GAMES['combination']
if len({c['w'] for c in combo}) != len(combo): sys.exit('FATAL: duplicate combination words')
for gc in combo:
    if not re.match(r'^[A-Z]{5}$', gc.get('w', '')): sys.exit(f'FATAL: combination word must be 5 caps: {gc.get("w")}')
    if not gc.get('def'): sys.exit(f'FATAL: combination word {gc["w"]} missing def')
    if not gc.get('cat'): sys.exit(f'FATAL: combination word {gc["w"]} missing cat (category hint)')
    gc['links'] = cite_links(gc.get('cite', ''))
    if gc.get('cite') and not gc['links']: sys.exit(f'FATAL: combination {gc["w"]} cite resolves to nothing')

def part_cite(label):
    m = re.match(r'^Part (\d+)$', label)
    if m: return 'RFO Part ' + m.group(1)
    m = re.match(r'^R-DFARS (\d+)$', label)
    if m: return 'R-DFARS ' + m.group(1)
    sys.exit(f'FATAL: governs label not parseable: {label}')

gov = GAMES['governs']
if len({g['s'] for g in gov}) != len(gov): sys.exit('FATAL: duplicate governs situations')
if any(g.get('lv') not in (None, 'b') for g in gov): sys.exit("FATAL: governs lv must be 'b' or absent")
if sum(1 for g in gov if g.get('lv') == 'b') < 20: sys.exit('FATAL: basic governs pool too small (<20)')
for gg in gov:
    if gg['p'] not in PN: sys.exit(f'FATAL: governs part not in part_names: {gg["p"]}')
    if len(gg.get('d', [])) != 3 or len(set(gg['d'])) != 3 or gg['p'] in gg['d']:
        sys.exit(f'FATAL: bad governs distractors: {gg["s"][:50]}')
    for dd in gg['d']:
        if dd not in PN: sys.exit(f'FATAL: governs distractor not in part_names: {dd}')
    links = cite_links(part_cite(gg['p']))
    if not links: sys.exit(f'FATAL: governs part unresolvable: {gg["p"]}')
    gg['link'] = links[0]
# accept-list for Combination guesses — Wordle's own allowed-words list (+ our answers),
# committed at study-tool/mcq/wordlist5.txt; shipped as one concatenated string (5 chars/word)
with open(os.path.join(MCQ, 'wordlist5.txt')) as f:
    wl = [w.strip() for w in f if w.strip()]
if any(not re.match(r'^[A-Z]{5}$', w) for w in wl): sys.exit('FATAL: wordlist5.txt has a non-5-cap entry')
wlset = set(wl)
bad_ans = [c['w'] for c in combo if c['w'] not in wlset]
if bad_ans: sys.exit(f'FATAL: combination answers missing from wordlist5.txt: {bad_ans}')
deck['games'] = {'part_names': PN, 'combination': combo, 'governs': gov, 'dict': ''.join(sorted(wlset))}

# ---- 3. final validation + stats ----
ids = [c['id'] for pool in ('recall_basic', 'recall_advanced', 'scenarios', 'thresholds') for c in deck[pool]]
if len(ids) != len(set(ids)): sys.exit('FATAL: duplicate ids in final deck')

deck['version'] = 6
from datetime import date
deck['generated'] = date.today().isoformat()

with open(DECK, 'w') as f:
    json.dump(deck, f, ensure_ascii=False, separators=(',', ':'))

recall = deck['recall_basic'] + deck['recall_advanced']
mcq_n = sum(1 for c in recall if 'd' in c)
thr_mcq = sum(1 for c in deck['thresholds'] if 'd' in c)
all_q = recall + deck['thresholds']
x_n = sum(1 for c in all_q if c.get('x'))
ref_n = sum(1 for c in all_q if c.get('ref'))
mcq_no_x = [c['id'] for c in all_q if 'd' in c and not c.get('x')]
print(f'deck v{deck["version"]} written: {len(deck["recall_basic"])} basic (+{nb}) · '
      f'{len(deck["recall_advanced"])} advanced (+{na}) · '
      f'{len(deck["thresholds"])} thresholds · {len(deck["scenarios"])} scenarios')
print(f'authored distractor sets applied: {applied} existing + {nb+na} new')
print(f'MCQ-ready recall cards: {mcq_n}/{len(recall)} · thresholds {thr_mcq}/{len(deck["thresholds"])}')
print(f'debriefs: x on {x_n}/{len(all_q)} · ref on {ref_n}/{len(all_q)}')
print(f'MCQ cards MISSING x: {len(mcq_no_x)}{" — " + ",".join(mcq_no_x[:8]) if mcq_no_x else ""}')
print(f'scenario coaching: {coached} topic-matched · {generic} generic fallback')
n_linked = sum(1 for c in all_q if c.get('links'))
sec_linked = sum(1 for c in all_q if any('#' in l['u'] for l in c.get('links', [])))
print(f'authority links: {n_linked}/{len(all_q)} cards linked ({sec_linked} section-precise) · '
      f'via ref {n_ref} · topic fallback {n_topic} · hand override {n_override} · UNLINKED {len(unlinked)}')
for u in unlinked: print('  UNLINKED', u)
coach_unlinked = [k for k, co in COACH.items() if not co.get('links')]
if coach_unlinked: print(f'coach cites without links: {coach_unlinked}')
print(f'acronym expansions applied this build: {_exp_stats[0]}')
scen = deck['scenarios']
no_ask = [s['id'] for s in scen if not s.get('ask')]
no_script = [s['id'] for s in scen if not s.get('script')]
fu_total = sum(len(s.get('follow_ups') or []) for s in scen)
fu_helped = sum(1 for s in scen for f in (s.get('follow_ups') or []) if isinstance(f, dict) and f.get('h') and f.get('d'))
print(f'board sim: {len(scen)} scenarios (+{new_sc} new) · asks {len(scen)-len(no_ask)}/{len(scen)} · scripts {len(scen)-len(no_script)}/{len(scen)}')
print(f'follow-ups: {fu_total} total · {fu_helped} with hint+debrief')
if no_ask: print(f'  MISSING ask: {no_ask[:6]}')
if no_script: print(f'  MISSING script: {no_script[:6]}')
print('ladder: ' + ' · '.join(f'{r} {len(deck["ladder"][r])}' for r in LADDER_RUNGS)
      + f' — all {sum(len(v) for v in deck["ladder"].values())} cites corpus-verified (exact-section, verbatim-quote)')
