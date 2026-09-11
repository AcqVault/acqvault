# Study redesign — handoff

State as of 2026-09-11. 28 commits shipped this session, working tree clean, all five
gates green, everything pushed to `main`. Last commit `319088c`.

---

## Paste this to pick the work up

> Continue the AcqVault Study redesign. Read `docs/STUDY-REDESIGN-HANDOFF.md` first —
> it has the state, the file map, and the traps. Work in
> `/Users/iz/Documents/Projects/acqvault`.
>
> Ground rules learned the hard way this session:
> - **`assets/app.css` does not load on study pages.** Study CSS is the `STUDY_CSS`
>   template literal in `api/_seo.js`. Shared tokens are `STYLE` in the same file.
> - **Look at every change in a browser before telling me it works.** Three things
>   shipped this session that passed every gate and did not work: a checklist whose
>   guard could never be true, a grid that put a caption in the wrong column, and a
>   `!important` hover rule that killed button press feedback.
> - **Run `python3 scripts/verify_deploy.py` after every deploy.** A stale edge cache
>   served the old bundle to users while the HTML claimed the new version.
> - **Space out automated requests.** Polling loops get this machine blocked by
>   Vercel's bot challenge, and then nothing can be verified.
> - Light theme only. Use the site's own tokens; do not invent a palette.
>
> Next up, in order: (1) verify The Board dashboard and a live card at desktop width —
> both are unverified; (2) the four deck content bugs listed in the handoff; (3) trim
> the padded element checklists.

---

## What shipped

**Correctness**
- Users were served a stale `study.js` that silently hid three shipped features.
  Fixed, plus `scripts/verify_deploy.py` and content-hash asset versions so a version
  can never be forgotten.
- "Which Part Governs?" had never once presented a case — `begin()` called `next()`
  while the intro was on screen and the stale-view guard returned forever.
- Keyboard: reveal/answer dropped focus to `<body>`; then the fix for that killed the
  `1`/`2`/`3` shortcuts by focusing a button. Focus now goes to the card.
- Citations opened in the same tab, so Back restarted the session on a different card.
  All four link types now `target="_blank" rel="noopener"`.
- End-of-session miss list was capped at 5 and rebuilt empty on resume.
- `#ss-begin` rendered a 190×190px arrow. `--ink3`/`--muted2` were undefined on every
  SSR page. Touch targets under 44px. Nav stacked to 120px on phones.

**Study surface**
- Hero collapses once a card is up: question moved from y=884 to y=285 on a 375×812
  screen. 654px of phone chrome recovered in total.
- Element checklists on all 337 recall cards (1,106 elements), ticking never scored.
- "Say why" prompt on reveal; comeback state after a 5+ day gap with new cards
  suppressed behind a backlog.
- Dashboard: shell 880→1180px, topics as one table, session panel carries the
  new/review/overdue split, hierarchy restored so the primary action outweighs its
  alternatives.

---

## File map

| What | Where |
|---|---|
| Study CSS | `api/_seo.js` — `STUDY_CSS` literal, ~line 1500+ |
| Shared tokens | `api/_seo.js` — `STYLE`, `:root` ~line 789 |
| Client runtime | `assets/study.js` (~3,200 lines) |
| Element checklists | `assets/study-elements.json` (337 cards) |
| Deck | `assets/study-deck.json` |
| Source selection | `SRCSEL_CSS` in `_seo.js`, `assets/source-selection.js` |
| Deploy check | `scripts/verify_deploy.py` |
| Gates | `scripts/{corpus,render,deck}_health.py`, `check_sim_citations.py`, `test_vehicle_prune.py` |

`/slip` is a separate unlisted game with a deliberately separate visual system — out
of scope. `/48cons` shares the engine, progress key and stylesheet with `/study`, so
every change reaches it; it must not break.

---

## Open work

**Unverified, flagged by the owner as looking off**
- The Board dashboard at desktop width.
- A live card at desktop width.

**Deck content bugs — content calls, not code**
- `dfb052112b10` / `429b12a0f587` — A&E fee ceiling: the answer puts 10% on estimated
  construction cost, the explanations say 6% "rides on the design fee". Different
  bases; the explanation looks wrong.
- `2681c1606b97` vs `65924aa98b6f` — one card's explanation is the vague formulation
  the other card explicitly corrects.
- `c7957f46f47b` — asks for "two safeguards", lists three.
- `23a76094f31e` — cites "DCMA/DCAA support thresholds", no regulation, no date.
- Seven near-duplicate pairs in `recall_advanced`.

**Known low-severity**
- ~35–40 advanced cards have padded checklists where element 1 is the whole answer.
  Element 1 is always the core element, so a core/supporting split is a render change.
- Content-hashed *filenames* would make the stale-cache race impossible rather than
  detectable. Not done.

**Never wired in**
Three mockup screens were built and published as artifacts but never implemented:
first-run, session-start, card. What shipped is the incumbent markup restyled. The
first-run screen in particular — a five-question cold pretest replacing the
Foundations/The Board choice — is the biggest unbuilt idea, and the research behind it
is strong: learner control is worth roughly nothing for outcomes, and a newcomer
cannot classify themselves.
