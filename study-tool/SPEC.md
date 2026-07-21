# AcqVault Study Tool — build spec (frame-out for the build session)

**Status:** framed 2026-07-02 by the Fable session that rebuilt both Field Guides. Content decks are DONE
(this folder). What remains is the page build. Owner has approved this design direction in conversation.
Read `~/.claude/.../memory/acqvault-site.md` WORKING RULES before touching anything.

## What it is
A free, no-login, client-side study/drill tool for contracting professionals — its own page at **/study**,
peer to /library, same theme. Two audiences via a **Basic / Advanced selector**:
- **Basic** = new 1102s: Vol. 1 recall cards only (foundations).
- **Advanced** = warrant-board prep: Vol. 2 recall + board-probe cards + scenario drills + threshold sprint.

## The decks (in this folder — the hard part, already authored/extracted)
| file | cards | what |
|---|---|---|
| deck-recall-basic.json | 30 | Vol. 1 Quick Checks (q/a, tagged by section) |
| deck-recall-advanced.json | 194 | Vol. 2 retrieval prompts + board-probe follow-ups (q/a, tagged by topic; `style:"board-probe"` = phrased as a panel question) |
| deck-scenarios-guide.json | 36 | Vol. 2 Layer-B drills (29, with facts[] bait/governs verdicts + board_answer) + Scenario Bank (7-8, with frameworks[]) |
| deck-scenarios-new-1.json / -2.json | 58 | NEW spot-the-framework scenarios, 2/topic, all 29 topics: {scenario, frameworks[], baits[], key_moves[], follow_ups[]} |
| deck-thresholds.json | 40 | rapid-fire threshold Q/A |

Total ≈ 358 items. KNOWN CLEANUP: 5 cards in deck-recall-advanced.json have `note:"answers-combined"`
(cost/pricing topic — the per-question answer split failed); hand-split them during build.
Regeneration: the extractor script pattern is in the 2026-07-02 session transcript; guide sources are
`~/Documents/Projects/AF-Contracting-Study-Guides/Phase-{1,2}*/source*/guide.html`.

## Modes (four, named — the commercial-tool idiom)
1. **Daily Review** — the default. Leitner-style spaced repetition over the selected track's recall+threshold
   cards. 5 boxes; intervals ≈ 0/1/3/7/21 days. Self-grade buttons: Missed / Shaky / Got it
   (miss → box 1, shaky → stay, got → +1 box). Session = all due cards, capped ~25, shuffled,
   **interleaved across topics** (never serve consecutive same-topic cards when avoidable).
2. **Topic Focus** — pick a topic from the readiness dashboard, drill its cards regardless of due dates.
3. **Threshold Sprint** — deck-thresholds only, rapid, optional 10s-per-card timer, streak counter.
4. **Board Sim** (Advanced only) — serves one scenario: show scenario → user answers OUT LOUD (UI says so)
   → reveal: for guide drills the facts[] bait/governs debrief then board_answer; for spot scenarios the
   frameworks/baits/key_moves; then reveal follow_ups one at a time (Enter/tap = next probe), mimicking the
   panel. Self-grade at the end feeds the topic readiness meter (not the Leitner scheduler).

## Card interaction (recall/threshold)
Question → user produces the answer mentally/aloud → tap/space to **reveal** → self-grade (3 buttons,
keyboard 1/2/3). NO multiple choice for recall — production, then comparison. This is deliberate and
owner-agreed; don't "improve" it into MCQ.

## Readiness dashboard
Landing view after track selection: one row per topic (29 advanced / Vol-1 sections basic), mastery bar =
weighted Leitner-box distribution of its cards + scenario self-grades. Click row → Topic Focus. Show
"due today: N" prominently → Daily Review CTA.

## Persistence (client-side ONLY — hard rule, no accounts/server state)
- localStorage key `acq-study-v1`: per-card {box, due, lapses}, per-scenario grades, streak, settings
  (track, timer on/off).
- Export/Import buttons (JSON download / file picker) so progress survives browser wipes — CAC users
  especially. Card identity: stable id = hash of (type+topic+q) — generate ids INTO the deck files at
  build time so shuffling/editing decks doesn't orphan progress.

## Page & architecture (follow the /library pattern)
- `api/study.js` → server-rendered shell via a `renderStudyPage()` in `api/_seo.js` (SEO text: what it is,
  free/no-login/works-offline; JSON-LD; canonical /study). Rewrite in `vercel.json`:
  `{ "source": "/study", "destination": "/api/study" }`. Add /study to the sitemap.
- Interactivity in a NEW asset `assets/study.js` (+ styles appended to app.css or a study.css) — vanilla JS,
  no framework, no build step, self-hosted everything. Decks merged into ONE `output/study-deck.json`
  (or /assets/study-deck.json) fetched at load; ~150KB raw, fine.
- Offline: decks + assets ride the existing service worker (cache-first for /assets and /output). If deck
  goes under /output, **bump the SW CACHE version** per the deploy ritual.
- Link it: footer ("Study") + a small entry point where the owner approves (nav placement = owner taste —
  show before/after and get sign-off).

## Theme (match the site exactly — see WORKING RULES; owner sign-off on visible design)
Federal-ink navy hero band (158deg #173a60→#0f2540→#0a1c33) + brass thread top rule; brass accents
(#87651c on white, #e4c477 on navy); Source Serif 4 display / Inter body; warm neutrals (#f7f6f2 --off);
white/off/navy bands only; NO blue accents, NO new colors; WCAG AA everywhere. Card faces echo the
Vol. 2 PDF components (scenario = navy card w/ brass eyebrow; debrief facts w/ bait=red / governs=green
labels — reuse the guide's visual language).

## Copy rules
"Acquisition community," RFO/R-DFARS framing only, MPT $15K / SAT $350K, no AI anywhere, and a footer
disclaimer mirroring the guides: unofficial training aid — verify against the RFO/R-DFARS.

## Deploy (per the standing ritual)
Branch → node --check on new JS → ?v= params on new assets → commit as the AcqVault author (product files
only) → ff-merge → push → live-verify with browser-UA + ?cb= probes. Design sign-off from the owner on the
page's look BEFORE pushing (before/after screenshots in-conversation).

## Explicitly out of scope (owner's product direction)
Accounts, server-side progress, leaderboards, AI-generated questions or grading, real alerts/notifications.

## Nice-to-haves if cheap (defer freely)
Print-a-summary of weak topics; a "10 random from everything" shuffle mode; per-card "open the guide"
noting the topic's Vol. 2 page number.

---
## STATUS UPDATE 2026-07-02 (post-build): SHIPPED + 3 TWEAK ROUNDS LIVE
Built same-day by the framing session (commits 8835873 → 37dead1 → dc2a2bf → 193ae3e; assets/study.js?v=4).
Deviations from the spec above, all owner-directed:
- ALL knowledge checks are 4-option MULTIPLE CHOICE (owner reversed the no-MCQ stance for engagement);
  produce-then-reveal survives only as fallback when <3 distractors exist. Future idea: user toggle
  MCQ vs. blank-card.
  **SUPERSEDED 2026-07-21 — owner-directed REORDERING (not a removal, and not a revert to line 41).**
  Every recall/Deep Study card now OPENS produce-first: question, "Answer it out loud, then check
  yourself", `Reveal`. Where authored distractors exist, `Show me the options` (key `o`) sits beside
  Reveal as a costed escape hatch — taking it CAPS that card at Shaky (grade 2: box held, never
  promoted) however clean the pick, and the debrief says why. Nothing was deleted; the multiple
  choice is still one keystroke away, it just no longer advances your schedule. Rationale: a board
  supplies no options, so recognising the right string among four is not the skill under test.
  Threshold Sprint is DELIBERATELY EXEMPT — it is a timed recognition game in the Practice Range,
  not a learning loop. Implemented as one shared `produceFirstCard()` in assets/study.js.
- Landing ALWAYS shows the track selector with a "Continue — you were here" badge (never auto-locks
  into the remembered track).
- In-tool back-button history via pushState depths 0/1/2 (track → dashboard → activity).
- NEW mode "Deep Study": endless random MCQ across all topics, reshuffles when exhausted, grades feed
  the Leitner scheduler.
- Threshold Sprint is MCQ with streak; Board Sim has a ~6-hint ladder with a 4s cooldown between hints.
- Deck lives at assets/study-deck.json?v=1 (356 cards, fact-title suffixes cleaned). This folder's
  deck-*.json are the editable sources; regenerate + re-merge if editing.
OPEN: owner authorized authoring MORE questions from the guide volumes if the deck needs depth.
