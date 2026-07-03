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
import json, hashlib, sys, os

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
scen = deck['scenarios']
no_ask = [s['id'] for s in scen if not s.get('ask')]
no_script = [s['id'] for s in scen if not s.get('script')]
fu_total = sum(len(s.get('follow_ups') or []) for s in scen)
fu_helped = sum(1 for s in scen for f in (s.get('follow_ups') or []) if isinstance(f, dict) and f.get('h') and f.get('d'))
print(f'board sim: {len(scen)} scenarios (+{new_sc} new) · asks {len(scen)-len(no_ask)}/{len(scen)} · scripts {len(scen)-len(no_script)}/{len(scen)}')
print(f'follow-ups: {fu_total} total · {fu_helped} with hint+debrief')
if no_ask: print(f'  MISSING ask: {no_ask[:6]}')
if no_script: print(f'  MISSING script: {no_script[:6]}')
