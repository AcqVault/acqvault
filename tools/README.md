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

Playwright starts `node .local/serve.js` from the repo root itself and waits for
`http://localhost:4321/study`. An already-running instance is reused.

## When a change is intentional

```
cd tools && npm run visual:update   # re-baseline the screenshots
```

Look at the diffs in `report/html` first — a re-baseline is how a regression gets blessed.

## What it covers

`states.mjs` holds the eight states both specs drive: /study course cover, Board Sim
scenario + debrief, /48cons cover, ladder interior, ladder board sim, /source-selection
intro and phase 1. `visual.spec.mjs` shoots each at **1084** (the owner's Chrome width),
**1320** (three-column breakpoint) and **375** (phone) — 24 screenshots, full page,
`maxDiffPixelRatio: 0.01`.

Determinism: `states.mjs` clears `acq-study-v1` and `acqvault_ssim` before every test,
seeds `Math.random` (the Board Sim picks its scenario randomly), and injects a stylesheet
killing animations, transitions and the caret.

## a11y

`a11y.spec.mjs` runs axe-core at 1084px and fails on any **serious/critical** violation
that is not already in `a11y-baseline.json`. The baseline is the honest current state of
the site, not a mute button — shrink it. Regenerate deliberately:

```
A11Y_WRITE_BASELINE=1 npx playwright test a11y.spec.mjs --workers=1
```

It is **not** wired into `scripts/verify_deploy.py`: that checks production, this checks
localhost. Run it before you push a layout or CSS change.
