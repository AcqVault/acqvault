# The Warrant Ladder — what it is, and how to turn it off

A public beta on `/study`: four warrant-authority rungs (SAT $350K / $5M / $25M /
Unlimited) of recall cards, where every answer carries the regulation's own words and a
link to the governing section on this site — plus a rung-scoped board sim for each.

**It is public**, labelled Beta in muted ink. It was originally unlisted behind
`?ladder=1`; that link still works and still sets `S.ladderBeta`, but the flag is now only
a record that someone arrived that way, not a gate. `LADDER_ENABLED` is the only switch
that matters.

## Turning it off

### 1. Hide it from everyone (including people holding the link)

In `assets/study.js`:

```js
var LADDER_ENABLED = false;
```

Then bump `study.js?v=` in `api/_seo.js` and `CACHE` in `sw.js`, and push. Nothing else on
`/study` is touched — tracks, Daily Review, Threshold Sprint, Board Sim and the games are
unaffected, because the ladder shares no pool with them.

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

`build_deck_v2.py` FATALs unless every card satisfies all of:

1. the cited section exists — exact match, no prefix fallback
2. it is not `[Reserved]` and not an empty stub (measured on the body, not title+body)
3. `cite.quote` appears **verbatim** in that section
4. any `cite.amount` appears literally inside `cite.quote`
5. any `dod.quote` appears **verbatim** in its R-DFARS section
6. every RFO cite whose section has a substantive DoD supplement carries a `dod` field —
   either the deviation that changes the answer, or the string `"n/a"` meaning it was read
   and does not

Rule 6 exists because the first pass shipped fifteen cards that cited the RFO correctly and
quoted it exactly and were still wrong for an Air Force reader: the architect-engineer fee
ceiling is 6% government-wide and **10%** for the Army, Navy and Air Force; certified cost
or pricing data is $2.5M government-wide and **$10M** for DoD after 30 Jun 2026; DoD letter
contracts follow 217.7404-3(a) *instead of* 16.603-2(c).

The DoD-supplement lookup was wrong three separate times before it covered all three
numbering forms — exact mirror (`6.104-2` → `206.104-2`), hyphenated suffix (`6.103` →
`206.103-170`), and appended digits with no hyphen (`15.103-2` → `215.103-270`). If you
touch `_dod_supplements`, keep all three.

## Known limits

- **PGI is not in the corpus.** Eight cards carry a DoD supplement that defers to PGI for
  the operative procedure. The quoted supplement text is real; the procedure behind it
  cannot be checked here.
- **Supplements that do not mirror the section number are invisible to the gate.** R-DFARS
  235.170 supplements FAR 16.102 and no number-mapping finds it. Those were caught by
  reading, not by tooling.
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

The floor clock counts up and never cuts you off — it exists to catch the six-second reply,
not to rush you. The bottom-line-up-front box is deliberately one line and deliberately
never persisted; its only job is to be echoed back verbatim above the model answer, before
your memory of what you said reshapes to match what you just read.

Four Unlimited scenarios have no recall cards on their own rung (UCAs & Letter Contracts,
OCI, Contract Modifications & Scope, Acquisition Planning), so they end without the
"drill the cards behind this" bridge. That is expected, not a bug.
