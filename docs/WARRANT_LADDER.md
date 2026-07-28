# The Warrant Ladder — what it is, and how to turn it off

Four warrant-authority rungs (SAT $350K / $5M / $25M / Unlimited) of recall cards, where
every answer carries the regulation's own words and a link to the governing section on this
site — plus a rung-scoped board sim for each.

**It lives on `/48cons` only** — the unlisted page for 48 CONS. It is NOT on public
`/study` and has not been since the move; `/study` keeps Foundations, The Board and the
Practice Range. The page is reached by direct link only: no inbound link anywhere on the
site, excluded from `renderSitemap()`, `noindex` on both a meta tag and an `X-Robots-Tag`
header in `vercel.json`, and deliberately absent from `robots.txt` (a `Disallow` line would
advertise the path). **Unlisted is not private** — treat anything on it as public.

`study.js` decides which page it is on by reading `data-mode` off `#study-app`
(`'48cons'` vs anything else) and renders the ladder only in org mode; `resumeSession()`
is gated the same way, so a ladder session saved on `/48cons` can never repaint onto
`/study`. The cards come from the same corpus-built `assets/study-deck.json` as the rest of
the site — **not a forked copy** — so `refresh.py` and `deck_health.py` keep covering them
and a corpus refresh reaches the org page automatically.

The old `?ladder=1` beta unlock is gone; the param is now stripped if an old link carries
it. `LADDER_ENABLED` is the only switch that matters.

## Turning it off

### 1. Hide it from everyone (including people holding the link)

In `assets/study.js`:

```js
var LADDER_ENABLED = false;
```

Then bump `STUDY_V` in `api/_seo.js` and `CACHE` in `sw.js`, and push. Nothing else is
touched — `/48cons` keeps the Board Introduction Builder, and `/study` is unaffected
either way, because the ladder shares no pool with the tracks or the games.

### 2. Remove it outright

```
git revert --no-commit <merge-commit>..HEAD    # or revert the individual ladder commits
python3 study-tool/build_deck_v2.py
```

Then delete `study-tool/deck-ladder*.json`, `scripts/check_ladder_file.py`,
`scripts/test_ladder_gate.py`, and this file. The ladder pool disappears from
`assets/study-deck.json` on the next build; no other deck pool references it.

Visitors who used the beta keep a harmless `ladderBeta` key, some per-card scheduler
entries, and a `ladderBoard` / `ladderBoardRough` record in their own localStorage. Those
are inert once the pool is gone and are cleared by the existing "Erase all study progress
on this device" control.

`deck-ladder-board-*.json` goes with the rest. Note that `assets/study.js` shares
`saveResume`/`resumeSession` with every other mode now, so remove only the `ladder` and
`ladderBoard` branches of the dispatch — deleting the mechanism would take Daily Review,
Deep Study and the Sprint down with it.

## Why the build refuses to ship a bad card

`build_deck_v2.py` FATALs unless every **recall card** (`deck-ladder.json`,
`deck-ladder-<rung>.json`) satisfies all of:

1. the cited section exists — exact match, no prefix fallback
2. it is not `[Reserved]` and not an empty stub (measured on the body, not title+body)
3. `cite.quote` appears **verbatim** in that section
4. any `cite.amount` appears literally inside `cite.quote`
5. any `dod.quote` appears **verbatim** in its R-DFARS section
6. every RFO cite whose section has a substantive DoD supplement carries a `dod` field —
   either the deviation that changes the answer, or the string `"n/a"` meaning it was read
   and does not

⚠ **The board sims are gated by rules 1–3 only.** `ladder_board_gate` verifies every one
of the 101 `cites` the same way — exact section, not `[Reserved]`, quote verbatim — but the
board schema has no `dod` field at all, so rule 6 never applied to them. This document
previously said "every card", which was not true of the 47 boards.

That gap is real, not theoretical: **40 of the 83 board RFO cites, across 27 distinct
sections, rest on a section R-DFARS supplements** — and the first SME read found one live
(a board cited RFO 15.403-2 without its DoD carve-out, the same failure rule 6 exists to
stop). It is now a **ratchet**: `_board_dod_overlay` prints the count on every build and
FATALs if it grows past `_BOARD_DOD_BASELINE`. Making it fatal outright today would block
every deck build behind 27 sections of review; printing it unbounded would be the
validate-then-discard pattern that keeps biting this repo. **Lower the baseline as boards
are reviewed. When it reaches 0, make it fatal and delete the baseline.**

Rule 6 exists because the first pass shipped fifteen cards that cited the RFO correctly and
quoted it exactly and were still wrong for an Air Force reader: the architect-engineer fee
ceiling is 6% government-wide and **10%** for the Army, Navy and Air Force; certified cost
or pricing data is $2.5M government-wide and **$10M** for DoD after 30 Jun 2026; DoD letter
contracts follow 217.7404-3(a) *instead of* 16.603-2(c).

The DoD-supplement lookup was wrong three separate times before it covered all three
numbering forms — exact mirror (`6.104-2` → `206.104-2`), hyphenated suffix (`6.103` →
`206.103-170`), and appended digits with no hyphen (`15.103-2` → `215.103-270`). If you
touch `_dod_supplements`, keep all three.

Numbering only reaches supplements that mirror. `206.104-71` displaces FAR 6.104-2 and
`244.301-70` displaces FAR 44.301-3, and no arithmetic connects those digits, so rule 6
also consults an explicit table, `_DOD_EXTRA`. Populate it from
`scripts/reverse_dod_index.py`, which scans R-DFARS for a FAR section named inside
deviation language and reports anything the numbering already covers as already handled.

**Read a candidate before promoting it.** The scan finds sentences, and a supplement cites
FAR as often to say "comply with this" as to say "ignore this" — 219.208-2 names FAR 6.104
as the justification you must complete, which is the opposite of displacing it. Pairs that
are real but deliberately ungated live in `_DOD_REVIEWED_NO_GATE` with the reason, so a
clean run means reviewed rather than unseen. The script exits non-zero when something is
genuinely new.

## Known limits

- **PGI is not in the corpus.** Eight cards carry a DoD supplement that defers to PGI for
  the operative procedure. The quoted supplement text is real; the procedure behind it
  cannot be checked here.
- **A supplement that changes the answer without naming the section it changes is invisible
  to everything.** R-DFARS 235.170, "Contracting methods and contract type", bears on FAR
  16.102, "Negotiating contract type", and cites no FAR section at all — the link is subject
  matter, not text, so neither the numbering nor `reverse_dod_index.py` can see it. (16.102
  itself is covered, via the mirrored 216.102; the risk is what 235.170 adds on top.) Title
  similarity across 2,154 R-DFARS documents is too noisy to gate on, so this class stays a
  reading problem. A clean gate run is not coverage of it.
- **The rungs are not regulatory.** No section of the RFO or R-DFARS defines a "$5M warrant"
  or a "$25M warrant" — those are local appointment levels that vary by unit. The rungs are
  an organizing device only, and no card asserts a rule applies "at" a tier.
- **Little multiple choice.** Only 33 of the 195 cards carry distractors, because four
  250-character options is a reading test rather than a recall one. The existing tracks
  lean on MCQ much harder.

## The board sims

Each rung also carries scenarios — 47 in total (SAT 14, $5M 14, $25M 10, Unlimited 9) in
`deck.ladder_boards`, gated by `ladder_board_gate()`. A scenario carries `cites` as a
**list**, because it rests on several rules at once; that missing multi-cite support is why
scenarios were deferred as long as they were.

They are graded but never scheduled: scenarios stay out of `grade()` and `INTERVALS`,
because 47 narrative items would flood Daily Review with things nobody answers in twelve
seconds. Their record lives in `S.ladderBoard` and reads back on the rung card.

**Nothing in board prep is timed, and that is deliberate.** An earlier build ran a clock
that counted up while you answered and compared it to how long the model script takes to
say, and held the hint back for ten seconds so that reaching for it meant something. Both
came out at the owner's call: a counter ticking on screen changes how you answer, and
rehearsal is where you should be free to take as long as the thought needs. Taking a hint
still caps the verdict at "getting there" — that is a grading rule, not a clock. If you are
tempted to add a timer here, this paragraph is the reason not to. (The 90-second clock in
Which Part Governs stays; there the clock is the game.)

The bottom-line-up-front box is deliberately one line and deliberately never persisted; its
only job is to be echoed back verbatim above the model answer, before your memory of what
you said reshapes to match what you just read.

Four Unlimited scenarios have no recall cards on their own rung (UCAs & Letter Contracts,
OCI, Contract Modifications & Scope, Acquisition Planning), so they end without the
"study the cards behind this" bridge. That is expected, not a bug.
