# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: the warrant-board candidate with a date.** A US federal contracting
professional (1102 series, largely US Air Force) preparing for a warrant board —
the oral exam that grants signature authority up to a dollar ceiling. High stakes,
career-gating, real deadline, real anxiety. Owner-confirmed: success is that this
person walks in prepared.

Two further audiences, confirmed as needing to be served from the same first
screen rather than split into separate products:

- **New to contracting, told to go study.** No mental model of the domain yet;
  cannot tell "Foundations" from "The Board" because they do not yet know what a
  board is.
- **The returning user resuming a habit.** Already has progress in this browser and
  wants to get back to drilling in one action.

Real scene: a phone on a lunch break, a CAC-locked government desktop, or a couch
the night before a board. Rarely a quiet desk with unlimited time.

## Product Purpose

A free, public drill-and-review tool that gets acquisition professionals ready to
answer for the rules under pressure. Knowledge checks, threshold sprints,
board-style scenarios with follow-ups, and a full source-selection simulation.
Success = the user passes their warrant board.

## Positioning

**The deck is welded to a live regulation corpus, and the weld is machine-checked
every time the corpus moves.** Every debrief cites the governing text and links one
click away to that exact section *on this same site* — not to an external URL that
may have drifted. `scripts/deck_health.py` is a ship gate: it proves every deck
quote appears verbatim in the section it cites and that every deck link resolves to
a real part and anchor, and it blocks the deploy when they do not.

A general flashcard app cannot truthfully claim this. Neither can a regulation site
without a deck. The mechanism is the join between the two.

## Operating Context

- **The warrant board itself** — an oral board where a panel asks and the candidate
  answers out loud. Drilling silently is not the same skill; saying it out loud is.
- Source documents the audience lives in daily: the Revolutionary FAR Overhaul
  (RFO), DoD class deviations (R-DFARS), the DoD Source Selection Procedures, PGI,
  DFARS, the DoD FMR, SF 1402 (the warrant certificate itself).
- Government machines are locked down; the site already ships no CDN assets, no web
  fonts from third parties, and a `script-src 'self'` CSP.
- Offline matters: a service worker caches the shell and corpus. Study must keep
  working with no network.

## Capabilities and Constraints

- **No accounts, ever** — owner-confirmed as a permanent principle. All progress
  lives in `localStorage` (`acq-study-v1`, plus `acq-mycards-v1` for user-authored
  cards). Export/Import JSON is the only way to move progress between browsers, and
  therefore has to be genuinely discoverable, not buried.
- Spaced repetition: Leitner, 5 boxes, `INTERVALS = [0,1,3,7,21]` days.
  `SESSION_CAP = 25` cards per daily session. Unseen cards are always due.
- Content: 75 basic recall + 222 advanced recall + 40 thresholds + 96 board
  scenarios, plus game corpora. Two tracks — Foundations (15 topics) and The Board
  (41 topics). **41 topics in one grid is a confirmed cognitive-load problem.**
- Delivery: `/study`, `/48cons`, `/source-selection` and `/slip` are all
  server-rendered by `api/study.js` dispatching into `api/_seo.js`, because Vercel's
  Hobby plan caps the project at 12 serverless functions.
- **Study CSS is `STUDY_CSS` in `api/_seo.js` (~lines 1495–2097), injected inline by
  `shell()`. `assets/app.css` does not load on study pages.** Shared design tokens
  live in `STYLE` (`api/_seo.js` ~786–1096) and are duplicated by name in
  `assets/app.css`; a token rename must happen in both.
- `assets/study-deck.json` is ~1.3 MB and is fetched before the first screen can
  render. Anything shown before it resolves must not depend on it.
- The client runtime `assets/study.js` (~3,160 lines) drives ~15 distinct states
  through one `#study-app` container and a 3-level history-depth machine.

## Brand Commitments

- Name: **AcqVault**. Study sub-brand: "AcqVault · Study".
- Standing claims on the surface: *Free · no account · progress stays on your
  device · works offline*. These are true and must remain true.
- **`/48cons` is a one-off** for the 48th Contracting Squadron — owner-confirmed.
  Keep it unlisted, keep it working, do not design the product around it. It shares
  the engine, the progress key and the stylesheet, so any visual change reaches it:
  it must not break.
- `/slip` is a separate unlisted game with a deliberately separate visual system and
  is explicitly out of scope.
- The site's voice is a contracting officer's: short form over FPDS's shouted full
  sentences, no explaining basics to professionals, never overstating authority.
  Guidance (PGI) is never described as binding.

## Evidence on Hand

- `assets/study-deck.json` — 686 unique item ids; 374 quotes verified verbatim
  against the cited section; 1,077 deck links verified to resolve; 14 threshold rows
  verified to cite a subsection that states their figure.
- `assets/source-selection.js` — 11 citations verified verbatim.
- Corpus: 6,365 documents across 8 live sources, refreshed and gated by
  `refresh.py`.
- Gates that already exist and must keep passing: `scripts/corpus_health.py`,
  `scripts/render_health.py`, `scripts/deck_health.py`,
  `scripts/check_sim_citations.py`.
- **No usage analytics are on hand in this work.** `api/_analytics.js` records
  counts, but no funnel or drop-off data was consulted. The claim that users "may
  not find it intuitive" is the owner's own observation, not a measured finding, and
  must not be written up as data.

## Product Principles

1. **Cite or say nothing.** Every answer carries the governing text and a link to
   it. A claim the corpus cannot support does not ship.
2. **The board is oral.** Features should push the user toward saying the answer out
   loud and grading themselves honestly, not toward recognizing an option.
3. **Honest self-grading over score inflation.** Picking from multiple choice caps
   the grade below what recalling cold earns.
4. **No account, no lock-in, no server-side progress.** The user's data stays theirs
   and stays on their device.
5. **Guidance is not a requirement.** Never render procedural guidance as binding.
