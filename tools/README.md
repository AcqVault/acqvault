# tools/ — local visual-regression + accessibility harness

**Local only. Nothing in here ships.** It lives under `tools/` with its own
`package.json` because a *root* package.json would make Vercel start building a site that
is deliberately static + serverless functions. `node_modules/`, `.playwright/` and
`report/` are gitignored; `snapshots/` and `a11y-baseline.json` are checked in on purpose.

## Install

```
cd tools && npm install && npx playwright install chromium
```

## Run

```
cd tools && npm run visual          # everything: visual.spec.mjs + a11y.spec.mjs
npx playwright test visual.spec.mjs # just the screenshots
npx playwright test a11y.spec.mjs   # just axe
```

Playwright starts `node tools/serve.cjs` from the repo root and waits for
`http://localhost:4322/study`. An already-running instance is reused. It is deliberately
NOT `.local/serve.js`: that one is gitignored and serves three routes, so app.css and the
whole reader had no coverage at all.

## When a change is intentional

```
cd tools && npm run visual:update   # re-baseline the screenshots
```

Look at the diffs in `report/html` first — a re-baseline is how a regression gets blessed.

## What it covers

`states.mjs` holds the **15** states all three specs drive: /study course cover, Board Sim
scenario + debrief, /48cons cover + ladder interior + ladder board sim, /source-selection
intro and phase 1, the home page, a rulebook hub, a rulebook part page, /library,
/what-is-the-rfo, /changes and /deviations. `visual.spec.mjs` shoots each at **1084** (the
owner's Chrome width), **1320** (three-column breakpoint) and **375** (phone) — **45**
screenshots, full page, `maxDiffPixelRatio: 0.01`.

`npm run visual` runs every `*.spec.mjs`, which is three specs, not two: `visual`,
`a11y`, and `tokens` (every custom property a page references is defined by a stylesheet
that page actually loads — `--r-pill` once was not, and a squared-off pill is under the
pixel threshold).

**A green suite means "nothing large broke", never "nothing changed."** At
`maxDiffPixelRatio: 0.01` on a full-page shot, a moved 1px border, a 2px corner, or a line
of small text sliding across a column all pass. Several real changes have. Look at the page.

Determinism: `states.mjs` clears `acq-study-v1` and `acqvault_ssim` before every test,
seeds `Math.random` (the Board Sim picks its scenario randomly), and injects a stylesheet
killing animations, transitions and the caret.

## a11y — two layers

`npm run a11y:sweep` walks one URL per page TYPE (22 of them: every hub source, a part
page from a differently-shaped source, and /slip). No baselines, no screenshots, so it
cannot go flaky. It exists because state coverage is not type coverage — /slip had no
coverage of any kind and was failing AA twice: `--label-3` was tuned against `--surface`
but `.topic` sits on the lighter `--surface-2` (4.33:1), and the system blue `--tint` was
used as 15px text at 3.82:1. An errored page counts as a failure there; a sweep that
checks nothing and prints "no violations" is worse than no sweep.

## a11y

`a11y.spec.mjs` runs axe-core at 1084px and fails on any **serious/critical** violation
that is not already in `a11y-baseline.json`. The baseline is the honest current state of
the site, not a mute button — shrink it. Regenerate deliberately:

```
A11Y_WRITE_BASELINE=1 npx playwright test a11y.spec.mjs --workers=1
```

It is **not** wired into `scripts/verify_deploy.py`: that checks production, this checks
localhost. Run it before you push a layout or CSS change.
