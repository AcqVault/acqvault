# UI/UX tooling research — free, no-build, self-hostable

Research date **2026-09-11**. Every repo below was checked live against the GitHub API
that day: stars, SPDX licence and `pushed_at` are real, not recalled. Anything I could
not verify is marked as such.

Constraints these were judged against: vanilla JS, server-rendered HTML from `api/*`,
**no bundler and no build step for the frontend**, CSS living inside the `STYLE` and
`STUDY_CSS` template literals in `api/_seo.js`, `assets/app.css` not loading on study
pages, light theme only, navy + brass (`--ink-mid:#0f2540`, `--brass:#87651c`), dense
over airy, and a first-render budget already strained by a 1.3MB deck.

The honest headline: **almost nothing should be adopted wholesale.** The site already has
a coherent token layer. What it lacks is (a) a measured, enforced type/space scale, (b)
long-form reading affordances on the rulebook pages, and (c) any automated check that a
change did not regress contrast, a11y or layout. The list below is weighted that way —
one or two things to *copy from*, and mostly things to *measure with*.

---

## A. Claude Code skills / plugins (excluding what he already has)

Already enabled and therefore excluded: impeccable, taste, frontend-design, ui-ux-pro-max,
emil-design-eng, apple-design, artifact-design, dataviz, design:*, figma:*.

### 1. AccessLint skills — `AccessLint/skills`
- https://github.com/AccessLint/skills — MIT (stated in README; GitHub API returns no
  licence file detected, so the MIT claim is the README's, not a detected `LICENSE`)
- ~98 stars, last pushed 2026-08-25
- Free, no API key, no cap. Ships a **local** MCP server; the hosted accesslint.com
  connector is a separate, optional product. Verified from the repo README.
- Five skills that map to a real workflow rather than one blob: `accessibility-scan`,
  `accessibility-inspect` (keyboard / screen-reader), `accessibility-audit` (WCAG-EM),
  `accessibility-fix`, `accessibility-diff` (regression).
- **Fit:** excellent. It works on rendered HTML, so the CSS-in-template-literal thing is
  invisible to it. Point it at `node .local/serve.js` on :4321.
- **AcqVault payoff:** the Board Simulator's stage stepper and right rail, and the study
  lesson continue-gate, are the two places where a keyboard-only user is most likely to
  get stranded. `accessibility-diff` is the one that matters long-term — it tells you the
  redesign did not regress what round 3 fixed.
- **Cost: trivial** (`claude plugin marketplace add accesslint/skills`).

### 2. a11y specialist skills — `masuP9/a11y-specialist-skills`
- https://github.com/masuP9/a11y-specialist-skills — MIT, ~56 stars, pushed 2026-09-11
  (actively maintained as of the research date)
- Free, no key. Complements #1: this one is a **reviewer persona** (WCAG 2.2 AA
  conformance reasoning, severity-graded findings) rather than a scanner.
- **Fit:** good. Prose/markup review, no runtime assumptions.
- **AcqVault payoff:** `/rfo/part-N` and the other rulebook readers — heading order,
  table semantics, and citation-link naming are exactly what an automated scanner passes
  and a conformance reviewer fails.
- **Cost: trivial.** Some skill overlap with #1; if you only want one, take #1.

### 3. Playwright skill — `lackeyjb/playwright-skill`
- https://github.com/lackeyjb/playwright-skill — MIT, ~3,116 stars, pushed 2026-08-14
- Free; Playwright itself is Apache-2.0 and runs entirely locally.
- **Fit:** this is the direct fix for a trap already written into
  `STUDY-REDESIGN-HANDOFF.md` — "the Browser pane needs a viewport toggle before each
  screenshot or it returns a blank or tiny image", and Chrome's screenshot injection
  timing out mid-session. A local Playwright loop screenshots at a declared viewport
  deterministically, including the owner's measured **1084px** and the 1320px
  three-column breakpoint, with no bot challenge and no Vercel rate limit.
- **AcqVault payoff:** every engine. It also unblocks `toHaveScreenshot()` baselines
  (see §C) so one coherent sweep across /study, /48cons, /source-selection and the Board
  Sim can be proven rather than eyeballed.
- **Cost: moderate** — needs `npx playwright install` once (a real, non-trivial download).

> **Rejected skills, named:** `maxrihter/claude-skill-visual-regression` (MIT, but **1
> star**, pushed 2026-07-09 — it is a thin wrapper over `toHaveScreenshot()`; write the
> six lines yourself). `mrKanoh/claude-wcag-accessibility-skill` (4 stars, stale since
> 2026-04). `airowe/claude-a11y-skill` (16 stars, no licence file, half of it is
> `eslint-plugin-jsx-a11y` — React-only, useless here). `tendera01-spec/accessibility-audit-toolkit`
> (0 stars, EU BFSG/VPAT focus, wrong jurisdiction). `OneRedOak/claude-code-workflows`
> (3.9k stars but **last pushed 2025-09-14**, a year stale, and its design-review workflow
> is the thing `impeccable`/`taste` already do).

---

## B. Design systems / CSS foundations to adopt or steal from

### 4. USWDS — `uswds/uswds` **(steal from, do not adopt)**
- https://github.com/uswds/uswds — **CC0 1.0 public domain** for the design system itself
  (some components differ; see their LICENSE.md). ~7,182 stars, pushed 2026-09-11,
  latest release **v3.14.0, 2026-08-18**.
- Genuinely free, no cap, and CC0 means you can lift tokens verbatim with no attribution
  obligation. It does ship precompiled `dist/css/uswds.min.css` — no Sass required.
- **Fit as a drop-in: poor, and you should reject it as one.** The bundle is large, it
  carries its own blue/red federal palette, its `usa-` class layer would fight the
  existing `.lband`/`.st-*` conventions, and its JS expects its own init. Dropping it
  into a template literal would blow the first-render budget the 1.3MB deck already
  strains.
- **Fit as a source: the best on this list.** Three things to copy as values, not code:
  the **density and spacing scale**, the **table and data-list patterns**, and above all
  the **form/validation and alert semantics**. It is the only mature system built for
  exactly this content type — dense US federal reference material read by people doing a
  job — and it has been contrast-audited by people paid to do it.
- **AcqVault payoff:** `/source-selection` and the Board Sim self-grade (alert/status
  semantics), and the rulebook tables.
- **Cost: moderate** (hand-porting patterns into `STYLE`), **heavy** if adopted whole —
  don't.

### 5. Open Props — `argyleink/open-props`
- https://github.com/argyleink/open-props — MIT, ~5,514 stars, pushed 2026-08-11
- Free, no cap. It is *only* CSS custom properties — no classes, no JS, no build
  required (there are per-module `.min.css` files you can paste).
- **Fit: very good, with a rule.** Do **not** import the colour props; the owner already
  has a palette and has said he does not want an invented one. Import (or hand-copy)
  only `sizes`, `easings`, `shadows` and the type scale. That is a few dozen lines
  pasted at the top of `STYLE`, and it is the cheapest way to get a *principled* spacing
  ramp where the current one is ad-hoc (`--fs-xs:11px … --fs-lg:15px` is a five-step
  font scale with no matching space scale).
- **AcqVault payoff:** the coherence complaint itself. One space ramp shared by /study
  lesson blocks, /48cons cards and the Board Sim rail is what makes four engines read as
  one product.
- **Cost: trivial** (copy the sizes/easings blocks) to **moderate** (actually migrating
  hard-coded px across 3,819 lines of `_seo.js` + 3,452 of `app.css`).

### 6. Tufte CSS — `edwardtufte/tufte-css` **(steal from)**
- https://github.com/edwardtufte/tufte-css — MIT, ~6,554 stars, pushed 2026-06-24
- **Fit: partial and deliberate.** Reject its ET Book face, its wide margins and its
  airiness — all three contradict "denser rather than airier" and the existing Inter +
  Source Serif 4 stack. **Accept exactly one idea: the sidenote.** Its
  checkbox-and-`<label>` sidenote pattern is pure CSS, degrades to inline on narrow
  screens, and needs zero JS.
- **AcqVault payoff:** `/rfo/part-N` and the other rulebook readers, where cross-
  references and the layout contract's citation lines currently interrupt the column.
  It also suits the study lesson's `ref`/`links` source line.
- **Cost: moderate** — it is a markup change in the renderers, not just CSS.

### 7. Modern Font Stacks — `system-fonts/modern-font-stacks`
- https://github.com/system-fonts/modern-font-stacks — **CC0-1.0**, ~3,508 stars, pushed
  2026-03-10
- Free, zero runtime cost, it is a lookup table of font-family strings.
- **Fit: trivial and immediately useful.** The current `--serif` fallback is
  `Georgia,'Times New Roman'`; the current Inter `@font-face` has no declared metric
  fallback at all, which is a real CLS source on first render. This gives measured
  stacks to use with `size-adjust` fallbacks.
- **AcqVault payoff:** first render on every page, most visibly the study cover and the
  rulebook body text.
- **Cost: trivial.**

### 8. Tocbot — `tscanlin/tocbot`
- https://github.com/tscanlin/tocbot — MIT, ~1,500 stars, pushed 2026-05-15
- Free. Vanilla JS, one `<script>`, ~8KB, no framework, no build.
- **Fit: very good** — it is one of the very few UI libraries on this list that is
  genuinely vanilla and genuinely drop-in.
- **AcqVault payoff:** the rulebook readers. `/rfo/part-N` is a long document with real
  heading structure and no scrollspy contents rail; the study course already has an
  outline concept the rulebook side lacks. This is the single highest ratio of
  reading-experience gained to code written on the whole list.
- **Cost: trivial.**

### 9. Littlefoot — `goblindegook/littlefoot`
- https://github.com/goblindegook/littlefoot — MIT, ~255 stars, pushed 2026-09-11
  (actively maintained)
- Free, vanilla JS + CSS, progressive enhancement over real `<a href="#fn">` footnotes,
  so it degrades cleanly with JS off and with the service worker cold.
- **Fit: good.** Lower stars than the rest, but small, current, and dependency-free.
  Pairs with #6 as the JS-driven alternative if the pure-CSS sidenote markup change is
  too invasive for the renderers.
- **AcqVault payoff:** rulebook readers again, and the Board Sim debrief `cite`/`links`
  rows — the handoff notes 48 of 230 follow-ups can carry their own citation with the
  renderer ready. Popover footnotes let a citation be inspected without losing the
  scenario.
- **Cost: moderate.**

### 10. Pagefind — `Pagefind/pagefind`
- https://github.com/Pagefind/pagefind — MIT, ~5,458 stars, pushed 2026-09-10
- Free, self-hosted, no service, no key. Indexes built HTML at deploy time and ships a
  chunked WASM index the browser fetches **lazily and partially** — the whole point is
  that a large corpus does not become a large first-render payload.
- **Fit: good but caveated.** It needs a directory of static HTML to index, which fits
  the rulebook corpus but not the Vercel-function-rendered study pages. It is also the
  one item here that adds a **build-time** step — the constraint is "no build step for
  the frontend", and this is a deploy-time CLI, so I believe it clears the bar, but it
  is the closest call on the list.
- **AcqVault payoff:** the reference half of the site — FAR/DFARS/PGI/FMR search across
  the corpus, offline-capable, which the existing service worker story complements well.
- **Cost: moderate to heavy.**

---

## C. Local, free, offline tooling

### 11. axe-core — `dequelabs/axe-core`
- https://github.com/dequelabs/axe-core — **MPL-2.0**, ~7,501 stars, pushed 2026-09-11
- Free, unlimited, runs locally. (Deque's *hosted* products are paid; the engine is not.)
- The engine under most of the skills in §A. Worth having directly so the a11y check can
  be a gate in `verify_deploy.py` rather than something an agent remembers to run.
- **Cost: trivial** via Playwright's `@axe-core/playwright`.

### 12. Unlighthouse — `harlan-zw/unlighthouse`
- https://github.com/harlan-zw/unlighthouse — MIT, ~4,837 stars, pushed 2026-09-11
- Free, local, no account. Crawls **every route** and runs Lighthouse on all of them,
  giving one table instead of one-page-at-a-time Lighthouse runs.
- **AcqVault payoff:** directly targets the stated first-render/payload concern, and
  will find the pages where the 1.3MB deck is actually being shipped. Run it against
  `node .local/serve.js` on :4321 — no Vercel bot challenge, which the handoff warns
  about explicitly.
- **Cost: trivial** (`npx unlighthouse --site http://localhost:4321`).
- Related and verified but *not* separately recommended: `GoogleChrome/lighthouse-ci`
  (Apache-2.0, ~7,078 stars, **pushed 2026-03-27** — noticeably less current) and
  `GoogleChrome/web-vitals` (Apache-2.0, ~8,607 stars, pushed 2026-09-10) if you want
  field metrics rather than lab numbers.

### 13. Stylelint — `stylelint/stylelint` + `43081j/postcss-lit`
- https://github.com/stylelint/stylelint — MIT, ~11,517 stars, pushed 2026-09-10
- https://github.com/43081j/postcss-lit — **no licence file detected by the API**,
  ~90 stars, pushed 2026-09-07
- **This is the one that solves the site's specific structural problem.** Stylelint
  cannot see CSS inside a JS template literal by default; `postcss-lit` is a PostCSS
  syntax that extracts exactly that, which is what `STYLE` and `STUDY_CSS` are.
  **Caveat, stated plainly: `postcss-lit` targets Lit's tagged `css\`\`` templates.
  AcqVault's literals are untagged plain strings, so this may need a trivial tag
  (`/* css */` comment or a no-op `css` tag) to be picked up. I did not verify that it
  works against `_seo.js` as written — test before relying on it.**
- **Payoff:** duplicate-property, invalid-value and shorthand-override bugs across 2,000+
  lines of CSS that currently nothing checks, plus enforceable rules like "no raw hex,
  use a token" — which is the mechanical half of making four engines coherent.
- **Cost: moderate.**

### 14. css-analyzer — `projectwallace/css-analyzer`
- https://github.com/projectwallace/css-analyzer — MIT, ~365 stars, pushed 2026-09-11
- Free, local library/CLI. Reports specificity graphs, unique colour/font-size counts,
  complexity.
- **Payoff:** the fastest way to *prove* the incoherence the owner feels. Run it over the
  concatenated `STYLE + STUDY_CSS + app.css` and count distinct font-sizes, distinct
  colours and distinct spacing values. That number is the brief for the sweep, and
  driving it down is how you know the sweep landed.
- **Cost: trivial.**

### 15. BackstopJS — `garris/BackstopJS`
- https://github.com/garris/BackstopJS — MIT, ~7,179 stars, pushed 2026-09-08
- Free, local, headless-Chrome screenshot diffing with an HTML report.
- **Fit note / laziest path:** if #3 (Playwright) is already in, Playwright's built-in
  `toHaveScreenshot()` covers 90% of this with zero extra dependencies. **Take BackstopJS
  only if you want the scenario-config-file + visual report workflow** across dozens of
  routes and breakpoints, which is plausible here given the 1084/1320px breakpoint pair.
- **Cost: moderate.**

### Contrast checking — verified, but with a caveat
- `Myndex/SAPC-APCA` — https://github.com/Myndex/SAPC-APCA — licence **NOASSERTION**
  (custom/mixed; read it before shipping the code), ~584 stars, pushed 2026-07-25. APCA
  is perceptually better than WCAG 2 contrast ratio, but it is **not** the WCAG 2.1 AA
  criterion, so do not use it as the compliance answer.
- `color-js/color.js` — MIT, ~2,301 stars, pushed 2026-09-07 — is the safer pick: it
  computes both WCAG 2 and APCA, and it would let you script a check that every
  brass-on-navy and `--muted`-on-`--off` pairing in `STYLE` passes AA, which is a real
  risk with `--brass:#87651c` on white and `--muted:#5e5d66`.
- **Cost: trivial** (a ~30-line node script over the token list).

---

## D. Rejected, and why

| Thing | Verified facts | Why rejected |
|---|---|---|
| Tailwind CSS (`tailwindlabs/tailwindcss`) | MIT, ~97,506★, pushed 2026-09-08 | Needs a build step. The play CDN is a runtime compiler — worse for first render than the current CSS. Non-starter. |
| Pico.css (`picocss/pico`) | MIT, ~16,849★, pushed **2026-05-09** | Semantic-element-styled and genuinely no-build, but it is a *classless* system that restyles bare `<p>`, `<table>`, `<article>` — it would fight every existing selector, and its aesthetic is airy and its own palette. Exactly the "invented palette" the owner rejected. |
| Simple.css (`kevquirk/simple.css`) | MIT, ~5,007★, pushed 2026-07-19 | Same classless problem, less capable. It is for sites with no design system; AcqVault has one. |
| GOV.UK Frontend (`alphagov/govuk-frontend`) | MIT, ~1,452★, pushed 2026-09-11 | The closest peer to USWDS and very well-built, but it is Sass-first, carries the GDS Transport/Arial identity and UK-government semantics. If you are going to steal from one government system, steal from USWDS — it is CC0 and it is the right jurisdiction. |
| Shoelace (`shoelace-style/shoelace`) | MIT, ~13,843★, **ARCHIVED** | Web components, CDN-loadable, would have been tempting. It is archived (continued as the paid-tier-adjacent Web Awesome). Archived + partly commercial = do not build on it. |
| Floating UI (`floating-ui/floating-ui`) | MIT, ~32,741★, pushed 2026-08-26 | Not rejected on quality — it is vanilla and excellent. Rejected on need: it is an ESM package and the only thing it would buy here is tooltip positioning, which CSS anchor positioning or 20 lines covers. YAGNI. |
| PurgeCSS (`FullHuman/purgecss`) | MIT, ~8,049★, pushed 2026-08-20 | Dead-CSS detection sounds right, but it works by scanning content files for class names — against CSS that lives in a JS template literal alongside the JS that generates the class names, it will produce false positives and delete live rules. Use #14 to *measure* instead of #13-adjacent tooling to *cut*. |
| `utopia-core` (`trys/utopia-core`) | **no licence**, ~138★, **pushed 2024-09-19** | Two years stale and unlicensed. Use the utopia.fyi *calculator* to generate a clamp() scale once and paste the output; do not depend on the library. |
| `instant.page` | MIT, ~6,217★, **pushed 2025-01-15** | Stale, and the service worker already handles the navigation-speed story. `GoogleChromeLabs/quicklink` (Apache-2.0, ~11,290★, pushed 2026-09-01) is the maintained alternative if prefetch is ever wanted — but measure with #12 first. |
| `IBMa/equal-access` | Apache-2.0, ~775★, pushed 2026-09-11 | Fine tool, but it is a second a11y engine doing what axe-core already does. One engine, gated, beats two engines, ignored. |
| reveal.js, system.css, NES.css | verified, all MIT, all real | Wrong problem entirely. Noted only because "course UI" searches surface them. |

---

## E. If he only does three things

1. **Measure the incoherence before designing for it** — `css-analyzer` (#14) over
   `STYLE + STUDY_CSS + app.css`, and a `color.js` (#15/contrast) script over every
   token pairing. Both are an afternoon, and both produce a number.
2. **Tocbot (#8) on the rulebook readers, Open Props' size/easing ramp (#5) everywhere.**
   These are the two cheapest changes that a reader would actually notice, and the space
   ramp is the mechanism by which four engines start looking like one.
3. **Playwright (#3) + axe-core (#11) wired into `verify_deploy.py`.** The handoff
   already documents that browser verification is flaky and manual. Making it a gate is
   what stops round five from re-breaking round four.

Deliberately **not** recommended: adopting any CSS framework. The site's token layer is
already better than what a drop-in would give it; the gap is enforcement and reading
affordances, not a framework.
