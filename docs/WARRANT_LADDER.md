# The Warrant Ladder — what it is, and how to turn it off

An unlisted beta on `/study`: four warrant-authority rungs (SAT $350K / $5M / $25M /
Unlimited) of recall cards, where every answer carries the regulation's own words and a
link to the governing section on this site.

**It is invisible by default.** The section renders only after `?ladder=1` has set
`S.ladderBeta` in the visitor's own browser. Without that link, `/study` is byte-for-byte
what it was.

Beta link: `https://www.acqvault.com/study?ladder=1`

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

Visitors who used the beta keep a harmless `ladderBeta` key and some per-card scheduler
entries in their own localStorage. Those are inert once the pool is gone and are cleared by
the existing "Erase all study progress on this device" control.

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
- **No scenarios, no multiple choice, no post-answer debriefs.** The existing tracks have
  all three; the ladder has none. It is a narrower, more heavily cited thing.
