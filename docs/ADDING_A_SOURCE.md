# Adding a source — behavior contract & checklist

Every source added to AcqVault must behave identically to the existing six
(RFO, R-DFARS, FAR Companion, Category Management, DAFI 63-138, DoD FMR).
This file is the contract: the enumeration sites you must touch, and the
behaviors the new source must inherit. Work through it top to bottom.

## 1. Enumeration sites (all of them — they are scattered on purpose)

**`index.html`**
- Source filter pills in the search bar (`.fpill[data-source]`, ~line 213).
- Browse source pills in the sticky bar (`.browse-src-pill[data-bsource]`, ~line 234).
- Browse source dropdown menu items (`#browse-source-menu` buttons, with the LIVE chip).
- Coverage section copy if it names sources.

**`assets/app.js`**
- `SOURCE_URLS` — official-source link ("View original"). CAC-gated sources get
  special handling (see the compass pattern in `renderReaderPage`).
- `SOURCE_LABELS` — display name used in cites, badges, and the reader.
- `PARTS_BY_SOURCE` — the part/volume list that renders the left panel.
- `liveSources` (in the coverage/status code, ~line 2094).
- `indexPartForSource` / `displayPartForSource` / `partWord` — how the corpus
  `part` field maps to the UI (R-DFARS subtracts 200; FMR says "Volume").
- `buildReaderHTML` `tagBg`/`tagClr` — the per-source badge colors (per-source
  coding is the ONE sanctioned use of non-palette color).
- `parseBrowseTitle` — must extract `{num, label}` from the new source's title
  format (add a branch if the format is new; FC needed paren-token support).
- `generateCitation` — must produce a correct file-ready cite from the title
  format (FC and FMR each needed their own branch). **Test titles that carry
  paragraph tokens and odd formats — a failed match silently degrades the cite
  to the bare part, which reads like "citing the top."**
- Content-line special cases if the source's text isn't plain `L{n}:` lines
  (see `isDafiSource` / `isCategoryGuide` render branches).

**`api/search.js`** — scorer must stay byte-identical to the client
(`acqLocalSearch` in app.js); any source exclusion filter must exist in BOTH,
plus `scripts/gen_doc_hashes.py` (three filters total — the compass removal
resurrected itself through the generator once).

**`api/_seo.js`** — `SOURCES` map (server-rendered pages + descriptions).

**Others** — `vercel.json` (rewrites if the source gets a page),
`output/library.json` (library cards), the sitemap, and the OG share card's
source chips (`assets/og-card-*.png` — rebuild it, keep the old file in place).

## 2. Behavior contract (what "works correctly and looks like this" means)

Every source, once wired, must inherit these without extra work — if one of
them doesn't hold, the wiring above is incomplete:

- **Browse reader** renders through `buildReaderHTML` — part banner, in-part
  search, Contents TOC (13px nums / 15px titles), sections with serif headers,
  and per-section Cite buttons.
- **Paragraph cites carry their full nesting path** via `makeParaPath` — a
  "(1)" under "(a)" cites `X.XXX(a)(1)`. Nesting comes from the `L{n}` ingest
  levels, so the extractor must emit them correctly.
- **The full-page reader (`?view=reader`, "open in new tab") renders the part
  through the SAME `buildReaderHTML` pipeline** — it must read exactly like the
  browse pane, never like the compact drawer.
- **Per-tab persistence** — browse view + scroll position survive tab
  discard/reload (`acq-browse-v1`, `acq-browse-html-v1`, `acq-view-v1` in
  sessionStorage). Works for any source automatically; the FMR chapter view is
  the one path that skips the HTML cache (falls back to fetch+render).
- **The source dropdown paints above the sticky bars** (`body.src-menu-open`
  lifts the hero container; the menu itself is trapped in a z:2 stacking
  context — do not "fix" by raising the container permanently).
- **Left part panel** at 14px labels / 13px numbers.
- **Copy buttons never lie** — `brCopy`/`copyInlineCite`/`copyResultCite` flash
  success only after the clipboard write lands, with an `execCommand` fallback.

## 3. Verify before shipping

- Browse the new source: parts render, sections have correct header cites,
  paragraph CITE buttons compose full paths (spot-check against the corpus
  text in `output/documents.json`).
- Open a section via search → "open in new tab": the page must look identical
  to the browse pane for the same part.
- Reload the tab mid-scroll: view and position restore.
- Search filter pill, coverage row, library card, SEO page all show the source.
- Follow the deploy ritual (asset `?v` bumps + `sw.js` CACHE bump — installed
  clients never see a fix without the SW bump).
