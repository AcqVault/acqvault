# Board Sim — content audit findings

Four parallel audits, 2026-09-11. Three covered the 96 scenarios' content (0–31, 32–63,
64–95), one the information model. Every regulatory claim was checked against
`output/documents.json`, the live corpus this site serves.

## The headline numbers

| | |
|---|---|
| Board-realistic as written | **89 of 96** (30 / 30 / 29) |
| Would not ship as-is | **54 of 96** (16 / 22 / 16) |
| P0 — wrong law, backwards verdict, or a cite that does not support its claim | **15 — all closed 2026-09-11** |
| P1 — a real defect a candidate would notice | ~45 |

Regulatory accuracy is high where it was checked directly: the auditors verified roughly
100 cited sections verbatim against the corpus and **every one matched**. Almost all defects
are internal contradictions, coach blocks that describe a different question than the card
asks, hints that state the opposite of their own debrief, and a handful of legacy-FAR
constructs the RFO rewrite dropped.

## The systemic defect — one fix pattern, not thirteen

All four audits landed on the same root cause independently.

**`coach` is authored per canonical topic, not per scenario, and inherited from the
scenario's FIRST topic.** There are only **29 distinct coach blocks across 96 scenarios**;
`qtype`, `smes`, `rule` and `cite` co-vary exactly, and **0 of 96 scenarios has a coach
triple unique to it**. Those three fields are **52% of the model answer's characters**.

Consequences, measured:
- **13+ scenarios carry a `qtype`/`rule`/`cite` that does not contain the rule the scenario
  turns on**, and several are contradicted by their own `script`'s opening sentence —
  e.g. `c23dfef26d5e` (Part 13 coach on a bona fide needs card whose script opens "This is a
  fiscal-law question"), `457016c02cef`, `f40d9fc54cb7`, `99533bc58727`, `62e1e0c2b3b7`,
  `d84503ac71ff`, `6b6384cdbb14`, `e9abca37a7c6`, `bf80a26beb90`, `9ebdcf249c43`.
- A wrong `coach.rule` is wrong on **3–5 cards at once**.
- It is authored in `study-tool/mcq/coach-topics.json` (30 keys) and baked in at build time,
  so **fixing `assets/study-deck.json` alone is overwritten by the next deck rebuild.**

Recommended shape (from the model review): hoist to `deck.coach_subjects` — 29 shared
objects — with each scenario carrying `coach: "<subject-key>"` plus an optional
per-scenario `coach.applies` naming how the rule bites *here*. That makes the subject a
first-class object the UI can group and filter by, and shrinks a 1.3 MB file that blocks
first render.

## P0 — wrong law (15) — ALL CLOSED

All 15 are fixed as of 2026-09-11. Each was re-verified verbatim against
`output/documents.json` before the edit; the corpus quote that decided it is noted inline.

**Where each fix had to land.** `build_deck_v2.py:230` does `sc['coach'] = coach_for(sc['topics'])`
unconditionally, and `script` / follow-up `h`,`d` come from `scenario-upgrades-*.json` and
`scenario-followups-*.json`. Those were edited in the build sources AND in the deck, so a rebuild
reproduces them. `facts`, `key_moves` and `board_answer` are deck-only and survive a rebuild.


1. `760c637d2966` `coach.rule` — minor-modification test given as "form, fit, and function".
   The card's own facts and follow-up say it is not. RFO 2.101(3)(ii): modifications that do
   not significantly alter the function or essential physical characteristics.
2. `df05a1cf3a0d` `coach.rule` — "purchase orders to the $350K SAT — reserved for small
   business". Its own `board_answer` says RFO 12.201-1 runs to $9M.
3. `df05a1cf3a0d` follow-up + facts — "the MPT-to-SAT band is reserved for small business".
   Legacy FAR 19.203(c)/13.003(b)(1); the RFO has no reservation band (19.104-1(a)).
4. `4cb5ceacd90a` facts/script/board_answer — ratification tiered by dollars ("$95K ≤ SAT →
   COCO"). RFO 1.405(b)(2) sets no dollar tier; its own follow-up says so.
5. `b034ddbb2029` script vs follow-up — who approves the OCI mitigation. Script says the PCO;
   the follow-up says the approval sits one level up, and contradicts itself in three lines.
6. `4907e4079ef8` follow-up 3 — the debrief never reaches the post-employment rules its own
   question asks about (RFO 3.104-3(d) / 41 U.S.C. 2104 one-year compensation ban).
7. `643ccd35960e` coach + follow-up — "The PIA reaches attempts and appearances". It reaches
   knowing disclosure. Appearance is RFO 3.101-1 / 18 U.S.C. 208 / 5 CFR 2635.502, none named.
8. `95e08834394b` script + follow-up — "textbook Type I" on facts of documentary silence.
   RFO 52.236-2(a)(1) needs an affirmative indication; silence is (a)(2). **FIXED.**
9. `385df91a2aa9` `coach.rule` — schedules listed as a mandatory rung. RFO 8.103(a) has four;
   8.104 is "should", HCA exception available. Its own follow-up says "four rungs, not seven".
10. `bfcb0cd1824f` follow-up — "a BAA could have covered this". RFO 35.102(a) excludes
    development tied to a specific system; this SOW has deliverable prototypes.
11. `7120cb3d8b78` key_moves/script — limited-rights legends on Government-funded work called
    "nonconforming markings". R-DFARS 227.7103-12(b)(1) calls them **unjustified**; the two
    have different remedies, and the label routes to the wrong procedure.
12. `4f318705f708` key_moves — a novation lane that does not exist on the facts. The buyer took
    the *supplier's* assets; RFO 42.903(a) creates no successor interest in the prime.
13. `f40d9fc54cb7` coach — cited to the Contract Disputes Act / Part 33 on a partial-T4C
    settlement card whose own script opens "This is an RFO Part 49 question".
14. `f9eb9f7bedb1` key_moves/script — **the audit was wrong on this one; corrected on the way in.**
    The magnitude rule is *not* uncitable: **FC 36.101-3, "Disclose the magnitude of the construction
    project"** says to "Disclose the target price range (not the Independent Government Estimate) in
    the solicitation." So the content stands. The real defect was attribution — the card asserted it
    as a Part 36 mandate when it is Companion **guidance**, and asserted the bond and LD rules with
    no section at all. Fixed by attributing, not deleting: FC 36.101-3 named as guidance,
    RFO 36.101-6(a)-(b) for where the IGE actually lives, RFO 28.102-1(a) for the Miller Act
    performance-and-payment pair over $150K, and RFO 11.401(b) / 11.402(b) for "liquidated damages
    are not punitive and are not negative performance incentives … a reasonable forecast of just
    compensation", per day of delay for construction.
15. `c4521547f681` follow-ups — SBIR rights inverted: "Government purposes" used during the
    20-year window (it is limited/restricted rights, R-DFARS 227.7104-2(a)(2)(i)) and left
    vague after it (GPR, which do not expire, (a)(2)(ii)).

## P1 themes (~45 findings, full detail in the audit transcripts)

- **Hints that state the opposite of their own debrief** — `994ae910af13` ("There's a dollar
  band where you can" → "There is no dollar band"), `0f4c23c21c0d` ("A shelf life and a
  report" → "RFO 10.001 sets no currency period").
- **`ask` states facts the scenario contradicts** — `3ce08a3a44ae` ("unbilled" vs. billing),
  `c34aeab9c4f4` ("award by Friday" vs. "POs today, setup Monday"), `d958c1fe7efa`
  ("$10M sole source" on a scenario with no dollar value).
- **Uncitable claims** on a site whose first principle is cite-or-say-nothing —
  `35844b460455` ("As of January 2026, SBA moved the program…"), `182bb3002d18` and
  `bcd3199183a2` (six numeric DAF clearance rungs, `coach.links` empty).
- **Thresholds stated without their date fence** — `f02f6a5c96ef`, `f1c0af926c37`
  (E.O. 14402 justification asserted with no $100M DoD threshold).
- **Acronym-expander artifacts, reader-visible** — "a the Competition in Contracting Act
  (CICA)", "a the Contract Disputes Act (CDA)", "a the Procurement Integrity Act (PIA)",
  and "MA-indefinite-delivery/indefinite-quantity (IDIQ)" where the expander ate a compound.
  Worth a guard in the expander against a preceding article and hyphenated compounds.
- **"SAMO"** used as a mnemonic in two scenarios and expanded nowhere.

## How the 15 were closed

- **#1** `coach-topics.json` → Commercial Products. RFO 2.101 "Commercial product" (3)(ii): "A minor
  modification does not significantly alter the function or essential physical characteristics of an
  item or component or change the purpose of a process." "Form, fit, and function" is a different test.
- **#2 / #3** `coach-topics.json` → Simplified Acquisition, plus the follow-up on `df05a1cf3a0d`.
  RFO 13.000 confines Part 13 to noncommercial at or below the SAT and 13.001(a) gates it on no
  commercial product/service and no Part 8 required source; RFO 12.001(c) sets the $9M commercial
  simplified ceiling (12.201-1). The reserved MPT-to-SAT band is legacy FAR 19.203(c)/13.003(b)(1) —
  RFO 19.104-1(a) runs the Rule of Two above the MPT with no upper band. `qtype` was reframed too,
  because "the right lane by dollar band" was itself teaching the wrong first move.
- **#4** `4cb5ceacd90a` facts/script/board_answer. RFO 1.405(b)(2): the HCA may ratify and agencies
  may delegate, "Agencies cannot delegate this authority below the level of the chief of the
  contracting office." No dollar tier anywhere. The card's own follow-up already said so.
- **#5** `b034ddbb2029` script. RFO 9.506(b)-(c): on a significant potential OCI the CO submits the
  written analysis and recommended course of action to the chief of the contracting office **before**
  the solicitation issues, and that official approves, modifies, or rejects in writing.
- **#6** `4907e4079ef8` follow-up 3. Now names both rules: RFO 3.104-3(c) / 41 U.S.C. 2103 for the
  employment-contact report and disqualification during the procurement, and 3.104-3(d) /
  41 U.S.C. 2104 for the one-year compensation ban with its role and $10M triggers.
- **#7** `643ccd35960e` follow-up 1. RFO 3.104-3(a)/(b) / 41 U.S.C. 2102 reach **knowingly**
  disclosing and **knowingly** obtaining. Appearance is RFO 3.101-1 / 18 U.S.C. 208 / 5 CFR 2635.502
  — a real problem under a different authority, now said that way.
- **#9** `coach-topics.json` → Required Sources. RFO 8.103(a) is four rungs and ends at AbilityOne.
  8.104 is separate: when 8.103 can't fill the need, OFPP-designated "required use" contracts or BPAs
  unless the HCA excepts, and otherwise "should consider" other existing governmentwide vehicles.
- **#10** `bfcb0cd1824f` follow-up 2. RFO 35.102(a) scopes the BAA to basic and applied research and
  "that part of development not related to developing a specific system or hardware procurement" —
  which is exactly what deliverable prototypes for a specific capability are not. Answer flipped.
- **#11** `7120cb3d8b78` key_moves + script. R-DFARS 227.7103-12(b)(1) names this exact case: a
  limited rights legend on data developed under a Government contract at Government expense or with
  mixed funding **is an unjustified marking**. (a) nonconforming is a format problem. The card now
  teaches the distinction, because the label routes the procedure — and the old script's "60 days to
  justify" was also wrong: the 60 days in (b)(2) runs from the CO's instruction to correct.
- **#12** `4f318705f708` key_moves + script. RFO 42.903(a) recognizes a successor only where the
  **contractor** transferred all its assets, or the entire portion performing the contract. The buyer
  took the *supplier's* assets; the prime is unchanged. There is nothing to novate, and the card now
  says so instead of walking the candidate into a lane that does not exist.
- **#13** `f40d9fc54cb7` — fixed at the root rather than by overwriting the block. The card is a
  partial-T4C Part 49 question tagged `["REAs & Claims", "Terminations"]`, and `coach_for()` walks
  topics **in order**, so it inherited the CDA/Part 33 coach. Topics reordered to
  `["Terminations", "REAs & Claims"]`; the Terminations coach now resolves on rebuild. Safe: scenario
  ids are hashed from topics only for `scenario-new.json` entries, and this is not one, so no
  learner progress was orphaned.
- **#14** see the corrected entry above — attributed, not deleted.
- **#15** `c4521547f681` both follow-ups, inverted back. R-DFARS 227.7104-2(a)(2)(i): during the
  protection period the Government has **limited** rights in the data and **restricted** rights in
  the software, and (b) bars release except as authorized for those. (a)(2)(ii): on expiration it
  gets government purpose rights, and "These government purpose rights do not expire." Period runs
  20 years from award (227.7101).

**Blast radius, as designed.** 19 of 96 scenarios changed: the 13 targeted, plus 6 that share a
corrected coach subject (`380ad1822833`, `99533bc58727`, `c23dfef26d5e`, `c34aeab9c4f4`,
`e9abca37a7c6`, `f02f6a5c96ef`). All six gates green; `#5` and `#14` checked in a browser on
`.local/serve.js`.

## Already fixed in this pass

- All 8 `vol2-bank` scenarios backfilled with `key_moves` + `baits`; no scenario now renders
  a model answer without a decision step, and `deck_health.py` fails the build if one does.
- `95e08834394b` Type I → Type II (P0 #8 above).
- Follow-up debriefs can now carry their own `cite`/`links`; **48 of 230 currently show the
  subject template's citation discussing a part the debrief never mentions.** The renderer
  is ready, the 48 rows are not authored.
- Topic crumbs normalised for display.
- Hint ladder no longer halves on scenarios without facts/baits.

## Not done, ranked — all closed 2026-09-11

1. ~~The 15 P0s.~~ **Done.** See above.
2. ~~The 48 follow-up citations.~~ **Done, and measured down.** Comparing the parts a
   debrief names against the parts its inherited cite names: **19** follow-ups had NO
   overlap at all, and 38 named at least one part the inherited cite does not. The 19 are
   authored in `study-tool/mcq/scenario-followup-cites.json`; the rest inherit something
   at least partly right. Only the cite string is authored — the build resolves links
   through the same `cite_links()` the coach cites use and FATALs on an unresolvable one,
   so links can never drift from the citation. Deck links 1077 → 1097.
3. ~~Hoist `coach` to subject objects + add `coach.applies`.~~ **The `applies` half done;
   the hoist deliberately skipped.** Measured first: hoisting saves 48.8KB of a 1.34MB
   deck — 3.6% — and fixes no correctness on its own, for a schema migration through the
   build and the renderer. The correctness half needed no migration. The mismatches split
   two ways: three carried the right subject *second* and were fixed by topic ORDER
   (`coach_for()` walks topics in order) — `99533bc58727`, `c23dfef26d5e`, `457016c02cef`;
   six carried the right subject and a rule that is true but is not what the card turns
   on, which order cannot fix, and those carry an `applies` line in
   `study-tool/mcq/coach-applies.json`.
4. ~~Migrate `baits` → `facts` on 57 scenarios.~~ **Done on 65.** 384 facts, 275 of them
   new, in `study-tool/mcq/scenario-facts.json`. 93 of 96 scenarios now carry the stack;
   the three that do not are `style:"opener"` perspective questions with no planted facts.
   Authored under one rule — introduce no new law, redistribute only what the card already
   says — and `deck_health.py` now enforces it.
5. ~~`level` is `"advanced"` on all 96 and unused.~~ **Deleted**, from the deck and the build.
6. ~~A scenario picker / "replay the ones I marked rough".~~ **Done.** Any / Rough / Unseen
   chips with live counts in the Board Sim exits row, persisted in `S.boardPick`.

## P1 themes — what was done

- **Hints that state the opposite of their own debrief** — both fixed (`994ae910af13`
  "there's a dollar band" against a debrief that says there is none; `0f4c23c21c0d`
  "a shelf life" against RFO 10.001 setting no currency period).
- **`ask` states facts the scenario contradicts** — `3ce08a3a44ae` ("unbilled" on a card
  about a contractor billing) and `c34aeab9c4f4` ("award by Friday" vs. POs today) fixed.
  `d958c1fe7efa` had invented a $10M value the scenario never states and leaned on it three
  times; the teaching point is proportionality and now cites RFO 10.001(e) instead.
- **Uncitable claims** — `35844b460455`'s 8(a) eligibility claim has no support anywhere in
  `output/documents.json` and now teaches the durable half: verify program status at the
  source, never recite it from memory. `182bb3002d18` / `bcd3199183a2`'s six clearance rungs
  are also absent — `compass` carries the DAF Approval Authority Matrix by reference, not
  its figures, and has no reader route — so they are **attributed to the matrix and marked
  policy-memo-driven rather than deleted**, since they are very likely right and only
  uncitable from here.
- **Acronym-expander artifacts** — fixed at the expander, not in the strings. It prepended
  "the" into a slot a determiner already filled ("a the Procurement Integrity Act (PIA)")
  and expanded the tail of an acronym compound ("MA-indefinite-delivery/…(IDIQ)"). Both
  fixed, the glossary now owns `MA-IDIQ`, the ten baked strings are repaired, and
  `deck_health.py` scans every deck string for both shapes.
- **"SAMO"** — added to the glossary as a literal term, so the one scenario using it bare
  now expands it. The recall card that asks the reader to *recite* SAMO is deliberately
  left unexpanded in its question; expanding it there would give away the answer, which is
  the expander's documented field rule.
- **Thresholds stated without their date fence** — `f02f6a5c96ef` / `f1c0af926c37` not
  separately re-audited; both now carry a fact stack drawn from their own text.

## New gates

Three, each verified to fail when the thing it guards is reintroduced:

- `ACQVAULT_CHECK_CLEAN=1 python3 study-tool/build_deck_v2.py` — **is the shipped deck what
  its sources rebuild to?** This is the one that matters most. `build_deck_v2.py` overwrites
  `coach`, `script` and follow-up `h`/`d` from `study-tool/mcq/*.json`, so a deck-only edit
  to those fields silently reverts, and **it had already happened**: the Type I/II
  correction on `95e08834394b` from the previous round was deck-only, and the first rebuild
  of this session reverted it. That is how it was found.
- `deck_health.py` — no acronym-expander artifacts in any deck string.
- `deck_health.py` — every section number in a scenario fact's `why` appears somewhere else
  on that same scenario. A citation that lives only on a fact is either a fabrication or a
  citation that belongs in the card proper.

## Still open

- Nothing on the ranked list. The remaining known items are in
  `docs/STUDY-REDESIGN-HANDOFF.md` under "Open work" — chiefly that the Rise treatment has
  only reached `/study`, and seven near-duplicate pairs in `recall_advanced`.
- `compass` (48 docs of DAF guidance) is in the corpus but has no reader route and is
  excluded from the offline search index. That is deliberate — it links out to CAC-gated
  DAF pages — but it does mean DAF clearance policy can never carry a working citation.
