# Verification suites

Run these after touching citations, cross-references, or clause dedup. They drive the
**real shipped functions** — sliced verbatim out of `assets/app.js` by
`scripts/extract_js_fns.js` — against the **real corpus**. That is the point: a
reimplementation agrees with itself while the shipped code stays broken, which is
exactly how the DFARS PGI shipped with all 427 of its section numbers unparsed.

```bash
node scripts/verify/cite_verify.js     # citation format, uniqueness, no bare-part fallbacks
node scripts/verify/xref_verify.js     # cross-reference resolution and its guards
node scripts/verify/dedup_verify.js    # one search hit per clause; part 52 labelled legacy
```

These complement, not replace, the two gates `refresh.py` runs before shipping:

```bash
python3 scripts/corpus_health.py       # is the DATA valid?
python3 scripts/render_health.py       # can the RENDERERS read it?
```

## What each one is protecting

**cite_verify** — a citation is what a contracting officer pastes into a contract file.
It checks the doubled em-dash, the SSP's lettered appendix sections, "Subpart" being
invented for sources that have none, double-suffixed DFARS numbers, and that no numbered
document degrades to a bare `<label> Part N`.

**xref_verify** — the rule/guidance boundary is the thing to protect. `PGI 204.201`
must resolve **only** into the PGI, and a bare `204.201` must **never** reach it, even
from inside a PGI document. Also: CFR / U.S.C. / Public Law / DoDI numbers are not
sections, a number split across a PDF line break must not follow to its parent, and a
duplicated clause number must resolve to the substantive copy rather than a stub.

**dedup_verify** — one search hit per clause number, with the memo copy winning and
part 52 kept as the labelled pre-deviation library.

## cdp.js — for anything the browser has to actually *do*

The three suites above check logic. `cdp.js` checks the rendered page: it launches the
real Chrome headless at an exact viewport and evaluates an expression in the **page**
world, printing whatever JSON you return.

```bash
node scripts/verify/cdp.js <url> <width> <height> <exprFile>
```

```js
// expr.js — must evaluate to a Promise or value; return a string and it prints raw
(async () => {
  const btn = document.querySelector('.pn-top');
  window.scrollTo(0, 2500);
  await new Promise(r => setTimeout(r, 400));
  return JSON.stringify({ visible: btn.classList.contains('visible') });
})()
```

⚠ **Reach for this instead of the in-app browser pane for anything scroll-, animation-,
or viewport-driven.** That pane cannot verify such behaviour and fails *silently* in ways
that read as product bugs: `requestAnimationFrame` never fires, programmatic scrolling
dispatches no `scroll` events, CSS transitions never advance (so a correctly-toggled
class still computes `opacity: 0`), its JS runs in an isolated world where `window`-level
listeners and events do not cross (the DOM does, which is the confusing part), and it will
not size below 388px CSS wide — so it cannot measure the 375px case at all. Three
"defects" in `assets/part-nav.js` were chased down to exactly these before `cdp.js`
existed. It needs no dependencies: Node 18+ ships a global `WebSocket`.

## The trap these exist because of

`assets/app.js` cannot be `require()`d — it touches `document` at top level. The
extractor slices the functions out and evals them in a bare `vm` context. ⚠ A top-level
`const` inside a `vm.Script` lives in that script's own lexical scope and **never appears
on the context object** — only function declarations hoist onto the global. Without an
explicit `Object.assign(globalThis, {...})` epilogue every registry reads back
`undefined` while the functions look fine, which is a very convincing way to write a
suite that checks nothing.
