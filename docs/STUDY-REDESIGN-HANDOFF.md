# Study redesign — handoff

State as of 2026-09-11 (second session). Working tree clean, all six gates green,
everything pushed to `main`.

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
> Next up: the Rise treatment has only reached /study. /48cons and /source-selection
> still have their old shapes, and the "connections" between the three are unchanged.

---

## What the course layer is

| Concept | Where it comes from |
|---|---|
| Course | `S.track` — `basic` = Foundations (Vol. 1, 15 lessons), `advanced` = The Board (both volumes, 44 lessons) |
| Section | Hand-authored: `VOL1` / `VOL2` in `assets/study.js` |
| Lesson | A **(level, topic)** pair, cards pulled live from `recallPool()` |
| Teaching block | One card: `q` → heading, `a` → key point, `x` → body, `ref`/`links` → source line |
| Knowledge check | The same cards' `q`/`a`/`d` as MCQs, capped at `KC_MAX` (6) per lesson |
| Completion | `S.lessons[level + '|' + topic]` = the day it was finished |

**A lesson is keyed on (level, topic), never topic alone.** Vol. 1 and Vol. 2 both carry
"Competition (CICA)", "Small Business Programs" and "Authority, Unauthorized Commitments
& Ratification", and The Board contains both volumes. Keying on topic collapsed them into
one lesson and silently dropped the Vol. 2 cards.

Every knowledge-check answer calls `grade()`, so walking the course schedules the cards.
Review is never empty for somebody who has only ever taken lessons.

`scripts/course_outline_health.py` fails if the hand-authored outline and the deck drift —
a topic missing from the outline is content no lesson shows; a topic listed twice in one
volume is a colliding lesson key. Both are silent at runtime.

---

## What shipped this session

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

---

## Open work

**The Rise treatment has only reached /study.** `/48cons` and `/source-selection` still have
their old shapes, and the navigation between the three is unchanged. This is the largest
remaining piece of what was asked for.

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
