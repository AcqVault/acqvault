# OG / social share cards

`gen_og.py` renders the site's Open Graph preview cards (1200×630 PNG) from a
single HTML template, so link previews on LinkedIn/Slack/etc. are per-section
instead of one generic image.

## Regenerate

```bash
python3 scripts/og/gen_og.py            # all cards
python3 scripts/og/gen_og.py study      # just one
```

Requires Google Chrome (headless render) and Pillow (`pip install pillow`).
Output lands in `assets/og-*.png`.

## Cards → routes

| File | Used on |
| --- | --- |
| `og-home.png` | `/` (index.html), and the deviations/changes pages (default) |
| `og-study.png` | `/study` |
| `og-library.png` | `/library` |
| `og-src-<source>.png` | each source hub `/<source>` and part page, e.g. `og-src-rfo.png` |

Wiring lives in `api/_seo.js` (`shell({ ogImage })`, passed per renderer) and
`index.html` (`og:image` / `twitter:image`). To add or restyle a card, edit the
`VARIANTS` dict / `TEMPLATE` in `gen_og.py` and rerun.

Social crawlers cache aggressively; a restyle that must show immediately should
use a new filename (and update the reference) rather than overwriting.
