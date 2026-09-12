# Study redesign — handoff

State as of 2026-09-11 (**fifth round**). All six gates green plus two new ones, merged
to `main` and **deployed**; `scripts/verify_deploy.py` agrees after each of the three
pushes. The fourth round ended at `ada0acd`.

**The direction changed this session.** /study is no longer a spaced-repetition
dashboard you land on and pick a mode from. It is a course, in the shape Articulate
Rise turns out: a cover, an outline of numbered lessons grouped into sections, and
lesson pages that are a column of teaching blocks behind a continue gate with a
knowledge check at the end. Lessons are the spine; spaced repetition sits behind
"Review" and is fed by the knowledge checks.

---

## Paste this to pick the work up

> Continue the AcqVault Study redesign. Read `docs/STUDY-REDESIGN-HANDOFF.md` first —
> it has the state, the file map, and the traps. Work in
> `/Users/iz/Documents/Projects/acqvault`.
>
> Ground rules learned the hard way:
> - **`assets/app.css` does not load on study pages.** Study CSS is the `STUDY_CSS`
>   template literal in `api/_seo.js`. Shared tokens are `STYLE` in the same file.
> - **Look at every change in a browser before saying it works.** `node .local/serve.js`
>   serves /study, /48cons and /source-selection from the repo on :4321, re-requiring
>   `api/_seo.js` per request, so an edit is one reload away. Use it instead of the live
>   site while iterating.
> - **Run `python3 scripts/verify_deploy.py` after every deploy.**
> - **Space out automated requests.** Polling loops get this machine blocked by
>   Vercel's bot challenge, and then nothing can be verified.
> - Light theme only. Use the site's own tokens; do not invent a palette.
>
> - **The Browser pane needs a viewport toggle before each screenshot** (resize to
>   `desktop`, then back to a width) or it renders the page at a fraction of its size and
>   returns a blank or tiny image. Chrome (claude-in-chrome) gives full-resolution shots
>   but its screenshot injection started timing out mid-session.
> - The owner's Chrome viewport measured **1084px**. The lesson's third column only
>   appears at 1320+, so at his normal width he sees the two-column layout.
>
> The Board Sim content audit is fully worked and the Rise treatment has reached all three
> pages. Read `docs/BOARD-SIM-CONTENT-FINDINGS.md` for the content calls and the round-5
> section below for the layer. `docs/UI-UX-TOOLING-RESEARCH.md` surveys free tooling for
> whatever comes next; its own conclusion is that this site does not need a CSS framework,
> it needs a space scale, reading affordances on the rulebook pages, and something
> automatically checking that a change did not regress contrast or layout.

---

## Round 5 — the content audit, worked to the end

Every item on the ranked list in `docs/BOARD-SIM-CONTENT-FINDINGS.md` is closed: all 15
P0s, the follow-up citations, the systemic coach defect, the `baits` → `facts` migration,
the dead `level` field, and the scenario picker. That doc carries the detail and the
corpus quote behind each call. Three things from it are worth knowing before touching
this layer again.

**The deck was not reproducible from its sources, and nothing noticed.** `build_deck_v2.py`
overwrites `coach`, `script` and follow-up `h`/`d` from `study-tool/mcq/*.json`, so a
deck-only edit to those fields reverts on the next rebuild. Round 4's Type I/II correction
on `95e08834394b` was deck-only, and the first rebuild this session silently reverted it —
that is how the problem was found rather than theorised. Everything is mirrored into
sources now, and `ACQVAULT_CHECK_CLEAN=1 python3 study-tool/build_deck_v2.py` fails when
the shipped deck is not what its sources rebuild to, naming the cards. **Run it after any
deck edit.**

**Two of the audit's own conclusions were wrong, and the corpus said so.** The construction
magnitude rule was called uncitable; FC 36.101-3 states it plainly, and it is Companion
*guidance* rather than an RFO mandate — so it was attributed, not deleted. And the
recommended `coach` hoist to `deck.coach_subjects` was measured before being built: 48.8KB
of a 1.34MB deck, 3.6%, and no correctness gain. Skipped. The correctness half — a
per-scenario `coach.applies` line — needed no schema change. **Measure the claim before
building to it.**

**DAF clearance policy has no in-site citation, by design — stop chasing it.** The
Contracting Compass and the Approval Authority Matrix are behind CAC on a DAF SharePoint
and are not coming to this site. The 48 `compass` docs in the corpus are summaries that
link out to those pages, which is why compass has no reader route and is excluded from
the offline index. The six clearance approval rungs are attributed to the matrix in prose
and carry a confirm-the-current-matrix instruction; that is the answer. The build labels
those seven cards unlinked **by design** and only lists a card as `UNLINKED` when it is an
unexpected gap worth chasing.

**Three fixes in the sweep were defects, not decoration**, and each was found by looking:
a cover `<h1>` that repeated the marketing hero's verbatim (invisible on screen, doubled in
print, because `@media print` restores the hero); `barHtml()` hardcoding "lessons" on a page
that has none; and "64 due today" on an untouched rung, because `isDue()` is true at box 0
and every unseen card counted as a backlog. Hiding the hero and widening the shell also had
to be split (`.st-hero-off`), since the ladder interior needs the first without the second.

New in the layer: `coach.applies` (rendered under the default rule, `.bs-applies`), the
Board Sim scenario filter (`.st-pick`, Any/Rough/Unseen with live counts, persisted in
`S.boardPick`), and three new source files under `study-tool/mcq/` — `coach-applies.json`,
`scenario-facts.json`, `scenario-followup-cites.json`.

---

## Round 4 — the Board Simulator, and a content audit

**Layout**, the same moves as the course: pinned chrome (Exit / Board Sim / topics /
N of 96), hero collapsed, a stage stepper (Scenario → Debrief → Follow-up 1..n →
Self-grade — the sequence was previously invisible), and a right rail that keeps the
scenario and the panel's question in view from the debrief on. They used to vanish after
stage 0, so you answered follow-ups about a scenario you could no longer read.

**Pedagogy.** The self-grade is the most board-predictive signal the tool collects and was
made under the worst conditions: straight after a perfect seven-step model answer AND a
verbatim script, asking "How did the whole exchange go?" The walkthrough steps now render
twice from one source — model answer, and a tickable checklist beside the grade. The
script is behind `<details>`. Three or more hints caps the grade at Getting there, the way
`/48cons` always did. `logScenario` gives grading an end-of-thing moment.

**Owner's decisions, do not relitigate:** model answer stays BEFORE the follow-ups; no
answer-capture notes at the end; no audio recording. (The `/48cons` BLUF-before-reveal
field is the one thing arguably distinct from those — captured *before*, not after — but
he has pushed back on capture twice. Ask, don't add.)

**The audit.** Four agents: three on scenario content (0–31 / 32–63 / 64–95), one on the
information model. Results in `docs/BOARD-SIM-CONTENT-FINDINGS.md`.

- 89 of 96 board-realistic; **54 would not ship as-is**; **15 P0s** (14 open).
- ~100 cited sections verified verbatim against the corpus — every one matched. The
  defects are internal contradictions, not bad citation.
- **Systemic root cause, reached independently by all four:** `coach` is authored per
  canonical topic and inherited from the scenario's FIRST topic. 29 distinct blocks across
  96 scenarios; `qtype`/`smes`/`rule`/`cite` co-vary exactly; **0 of 96 has a unique
  triple**; those three fields are **52% of the model answer's characters**. 13+ cards
  carry a rule that does not govern the card, several contradicted by their own script's
  opening line, and a wrong rule is wrong on 3–5 cards at once.
- **It is baked from `study-tool/mcq/coach-topics.json` at build time — fixing
  `assets/study-deck.json` alone is overwritten by the next rebuild.**

**Fixed this round:** all 8 `vol2-bank` scenarios backfilled with `key_moves` + `baits`
(lifted from their own `script` and bait-titled `frameworks` — no new law); `deck_health.py`
now fails the build if any scenario carries neither `key_moves` nor `board_answer`; the
Type I/II call on `95e08834394b` (silence is 52.236-2(a)(2), not Type I — I had authored
that error myself); topic crumbs normalised for display only; the hint ladder no longer
halves on scenarios without facts/baits; follow-ups can carry their own `cite`/`links`
(**48 of 230 currently show a citation discussing a part the debrief never mentions** —
renderer ready, rows unauthored).

**Also:** the home hero promised an AI feature that no longer exists in any code path.
Now "No summaries and no paraphrase — the text itself". Two internal leftovers untouched:
`api/_analytics.js:301` reports an "AI asks" stat that can only be zero, and
`assets/saved.js:258` has a stale "AI answer mode" comment.

---

## What the course layer is

| Concept | Where it comes from |
|---|---|
| Course | `S.track` — `basic` = Basic (Vol. 1, 15 lessons), `advanced` = Advanced (both volumes, 44 lessons) |
| Section | Hand-authored: `VOL1` / `VOL2` in `assets/study.js` |
| Lesson | A **(level, topic)** pair, cards pulled live from `recallPool()` |
| Teaching block | One card: `q` → heading, `a` → key point, `x` → body, `ref`/`links` → source line |
| Knowledge check | The same cards' `q`/`a`/`d` as MCQs, capped at `KC_MAX` (6) per lesson |
| Completion | `S.lessons[level + '|' + topic]` = the day it was finished |

**A lesson is keyed on (level, topic), never topic alone.** Vol. 1 and Vol. 2 both carry
"Competition (CICA)", "Small Business Programs" and "Authority, Unauthorized Commitments
& Ratification", and Advanced contains both volumes. Keying on topic collapsed them into
one lesson and silently dropped the Vol. 2 cards.

Every knowledge-check answer calls `grade()`, so walking the course schedules the cards.
Review is never empty for somebody who has only ever taken lessons.

`scripts/course_outline_health.py` fails if the hand-authored outline and the deck drift —
a topic missing from the outline is content no lesson shows; a topic listed twice in one
volume is a colliding lesson key. Both are silent at runtime.

---

## Round 3 — correctness found by auditing, not by looking

Three parallel audits (offline/first-paint, unhandled states, course-vs-incumbent
consistency) found things no amount of screenshotting would have:

- **A stale asset shipped.** `study-elements.json` was bumped to `?v=3` in one commit and
  rewritten in the next without a bump. `/assets/*` is `immutable` for 30 days and `sw.js`
  is cache-first on it with eviction only on a `CACHE` rename — so those fixes reached
  nobody who had already loaded `?v=3`, permanently for SW clients. `verify_deploy.py`
  cannot catch this: the origin serves the right bytes; the staleness is client-side.
  **The deck and elements tokens are content hashes now**, emitted once as
  `data-deck`/`data-elements` on `#study-app`. The class is gone.
- **The course inflated readiness.** A correct multiple-choice pick graded `3` in a
  knowledge check and `2` in Review — the same card. `mastery()` is `box/5`, so walking
  44 lessons inflated the "% overall" a candidate reads to decide if they are board-ready.
  Capped, and the cap is now stated where it happens.
- **No end-of-course state, and no resume.** 44 lessons ended with the same panel as
  lesson 3; a reload mid-check dropped you on the track picker having lost all five
  questions, in a view full of citation links. Both fixed.
- **Forward navigation repainted the outline at depth 2** (history entries carried only
  `{st}`); the check asked **the same fixed six questions forever** (`slice(0,6)` on deck
  order, so 54 Advanced cards could be read but never asked).

Measured, not assumed: a `crossorigin` deck preload downloads 1.3 MB **twice**. The local
harness now mirrors `vercel.json`'s immutable caching so that test tells the truth.

## Round 2 — the polish pass

Reference model is a course platform's object graph, not a deck's. A lesson holds typed
items — a **Reading** (own minutes, ticks when done) and a **Knowledge check** (question
count) — each section says what it contains, and a previous/next bar means you can always
see what follows and can leave without finishing the check.

What made it read as generated was repetition, not aesthetics, and the fixes were specific:
an uppercase eyebrow over every element ("KEY POINT" ×8 a lesson, "DESCRIBED IN" ×8,
"Section n" ×13); outline metadata identical on all 44 rows; a progress ring that rendered
0% as a dead grey donut; and a marketing hero stacked on the course cover, which was also
the page's second `<h1>`. The answer carries itself as a serif lead now, minutes live on
the section line where they actually differ, the ring is a hairline meter, and `.st-rise`
collapses the hero the way a card session already did.

Accessibility work from that pass, worth not regressing: `:focus-visible` on every control
in the layer (it had none, and fell through to a global ring measuring 2.16:1 on the
cover's navy); a named radiogroup with a roving tabindex; focus handed to the check panel
whenever the node holding it is destroyed; `role="status"` on the verdict; and sidebar /
next-lesson navigation routed through `goDepth` so Back steps lesson by lesson.

`node <skill>/scripts/detect.mjs --json api/_seo.js assets/study.js` reports two findings
inside the layer, both `transition:width` on a progress bar. That is what a progress bar
should animate; the incumbent `.st-prog` does the same. Everything else it reports is
incumbent `st-` CSS, outside that scope.

## What shipped earlier

**The desktop bug the owner flagged.** The dashboard hung 150px left of the hero and off
the viewport edge. `.st-guilloche` is absolutely positioned at `right:-150px` inside
`.lband--room`, which was `overflow:hidden` — hidden clips but still makes a scroll
container, so the decorative overflow was 150px of scrollable width and a click was enough
to scroll it, permanently. `overflow:clip` clips without a scroll container. Applied to
`.lhero` too, which has the same shape.

**The course layer**, as above, plus the landing page carrying two study modules and, beside
them, the two simulators as peers — Source Selection (its own page) and Board Sim, which was
three taps down inside the advanced dashboard and is track-independent anyway.

**`.st-sim-go`** set position/top/transform but no inset, so on /study the simulator card's
arrow rendered over the description text instead of in the 54px gutter the padding reserves.
Only the /48cons variant ever set `right`. Pre-existing; narrowing the cards made it obvious.

**Four deck content bugs**, each checked against the corpus this site serves:
- A&E fee ceiling (`dfb052112b10`, `429b12a0f587`) — the 6% is measured against estimated
  **construction** cost (RFO 15.404-9(c)(4)(ii)), not the design fee. Same base as the DoD
  10% in R-DFARS 236.202-371; different ceiling, not a different basis.
- UCA clock (`2681c1606b97`) — one obligation trigger, at 50% of the NTE, per
  R-DFARS 217.7404-3(a). Not "when obligations hit the caps".
- T&M (`c7957f46f47b`) — RFO 16.601-3 sets exactly two limitations. Surveillance is real but
  lives in 16.601-2(a): a condition of running the contract, not a limitation on choosing it.
- DCAA vs DCMA (`23a76094f31e`) — now cites PGI 215.406 and dates the threshold: TINA moved
  to $10M for new contracts and orders awarded on or after 30 Jun 2026.

**Six element checklists** where element 1 said "Named all four elements" without naming
them — an unusable standard under a CORE tag that reads "grade against this".

**`verify_deploy.py` now follows references out of the JS bundles it verifies.** It only ever
scanned page HTML, and `assets/study.js` fetches `study-deck.json?v=N` and
`study-elements.json?v=N` from its own source under the same immutable caching. A deck edit
behind a forgotten bump was invisible to the check. It now covers five more assets.

---

## Traps

- **`assets/app.css` does not load on study pages.** `STUDY_CSS` in `api/_seo.js`.
- **Card ids are `sha1(type|topic|q)`.** Editing a question mints a new card and orphans
  every learner's progress and that card's checklist. Fix answers and explanations instead.
- **A deck-only edit to `coach`, `script` or a follow-up's `h`/`d` reverts on rebuild.**
  Those come from `study-tool/mcq/*.json`. Fix the source, then rebuild. The
  `ACQVAULT_CHECK_CLEAN` gate catches it; it exists because this bit twice.
- **`assets/study-deck.json` is the canonical store**, not a build artifact.
  `study-tool/build_deck_v2.py` reads it as its base and merges distractors into it. The
  `study-tool/deck-recall-*.json` files are older sources.
- **`DECK_URL` and `ELEMENTS_URL` carry hardcoded `?v=` tokens** inside `assets/study.js`.
  Bump them when that content changes. `verify_deploy.py` catches this now — it did not before.
- **`/48cons` shares the engine, progress key and stylesheet with `/study`.** Every change
  reaches it; it must not break. `/slip` is a separate unlisted game with a deliberately
  separate visual system — out of scope.
- **The Browser pane's click coordinates do not always match its screenshot scale.** A stale
  tab delivered clicks at 2.38× a screenshot coordinate while claiming 1.8×, so buttons
  looked dead when they were fine. Arm a capture-phase click listener, click a known point,
  read back `clientX/clientY`, and derive the factor before trusting a coordinate click.

---

## File map

| What | Where |
|---|---|
| Course outline, lessons, knowledge checks | `assets/study.js` — `VOL1`/`VOL2`, `viewCourse`, `viewLesson` |
| Course CSS | `api/_seo.js` — the `COURSE LAYER` block in `STUDY_CSS` |
| Study CSS | `api/_seo.js` — `STUDY_CSS` literal |
| Shared tokens | `api/_seo.js` — `STYLE`, `:root` |
| Client runtime | `assets/study.js` |
| Element checklists | `assets/study-elements.json` |
| Deck | `assets/study-deck.json` |
| Local preview | `.local/serve.js` — `node .local/serve.js`, then :4321 (gitignored) |
| Deploy check | `scripts/verify_deploy.py` |
| Gates | `scripts/{corpus,render,deck,course_outline}_health.py`, `check_sim_citations.py`, `test_vehicle_prune.py` |
| Rebuild-clean gate | `ACQVAULT_CHECK_CLEAN=1 python3 study-tool/build_deck_v2.py` |
| Visual + a11y harness | `tools/` — `cd tools && npm run visual` (see `tools/README.md`) |
| Per-scenario coach | `study-tool/mcq/coach-applies.json` |
| Scenario bait/governs facts | `study-tool/mcq/scenario-facts.json` |
| Per-follow-up citations | `study-tool/mcq/scenario-followup-cites.json` |

### The local visual + a11y harness

`tools/` holds a Playwright suite that screenshots eight states (study cover, Board Sim
scenario + debrief, /48cons cover / ladder / board sim, source-selection intro + phase)
at 1084, 1320 and 375, and runs axe-core against a checked-in baseline of the site's
current serious/critical violations. It drives `node .local/serve.js`, so it is
localhost-only and deliberately **not** part of `verify_deploy.py`, which checks
production.

Run `cd tools && npm run visual` before pushing anything that touches `STUDY_CSS`,
`assets/study.js` or `assets/source-selection.js`; `npm run visual:update` re-baselines
when the change was intended. Install once with
`cd tools && npm install && npx playwright install chromium`. Nothing in `tools/` ships —
it stays out of the repo root so Vercel keeps treating the site as buildless.

---

## Open work

**Known and deliberately left**
- `S.lessons` keeps orphan keys after a topic rename (inert — `courseProgress` iterates the
  live outline, so it can never over-count; a rename silently un-ticks a lesson instead).
- A knowledge check has no self-explanation prompt and no element checklist; Review has
  both. That is a real difference between a lesson check and a recall drill, not drift.
- The teaching block shows the answer directly above the question that checks it. That is
  what a course platform does, but it makes the check recognition rather than retrieval —
  Review is where retrieval happens, and that split should stay deliberate.
- `viewTrack` claims "Every lesson ends in a knowledge check". True for this deck (0 of 44
  lessons have zero checks) but unguarded if a topic's cards ever lose their distractors.

**The Rise treatment now covers all three pages.** `/48cons` has a cover, an outline of its
four ceilings, a rail, and pinned chrome on the ladder, the board sim and the Introduction
Builder. `/source-selection` keeps its own `ss-` vocabulary — it has a separate stylesheet,
and copying forty `rz-` rules across is how drift starts — but gained the two structural
wins: a nine-phase stepper, and a sticky rail holding the requirement and the offerors,
which had been invisible from phase 1 onward on a page whose whole job is evaluating them.
The navigation *between* the three is still unchanged.

**Course layer, known rough edges**
- "Numbers You Must Know" is one lesson holding all 40 threshold cards. Its knowledge check
  caps at 6. It probably wants splitting.
- The teaching block shows the answer immediately above the question that checks it. That is
  what Rise does, but it makes the check a recognition test rather than retrieval — Review is
  where retrieval happens, and that split should be deliberate rather than incidental.
- Section names in `VOL1`/`VOL2` are hand-authored and are a content call worth a second look.

**Deck content**
- Seven near-duplicate pairs in `recall_advanced`. Not touched.

**Never wired in**
Three mockup screens were built and published as artifacts but never implemented: first-run,
session-start, card. The course layer supersedes some of that, but the first-run idea — a
five-question cold pretest replacing the module choice — is untouched and the research behind
it is strong: learner control is worth roughly nothing for outcomes, and a newcomer cannot
classify themselves.

**Known low-severity**
- Content-hashed *filenames* would make the stale-cache race impossible rather than
  detectable. Not done.
