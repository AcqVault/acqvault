# Corpus invariants — read before any re-ingest or re-extraction

> **Start with [`LAYOUT_CONTRACT.md`](LAYOUT_CONTRACT.md)** if you are ingesting or repairing a
> source. It is the *why* and the order of operations, with the RFO as the reference
> implementation. This file is the checks themselves.

`output/documents.json` is the product. Every rule below exists because the
problem **shipped to production at least once**. `scripts/corpus_health.py`
enforces all of them and `refresh.py` runs it as a ship gate, so you should
never have to remember this list — but you do need to know *why* it says no.

Run it any time you touch the corpus:

```bash
python3 scripts/corpus_health.py     # exit 1 = not ship-ready
```

---

## The invariants

### 1. No private-use (tofu) glyphs
Symbol/Wingdings fonts in source PDFs map em-dashes and bullets into the Unicode
private-use area (U+E000–U+F8FF). They have no glyph in a normal font, so readers
see a box (▯). **109 of them were live across 32 docs.**
→ `scripts/scrub_pua_glyphs.py`

### 2. Level markers never appear mid-line
Content is stored one logical line per row, each prefixed `L0:` / `L1:`. The
renderer only strips a **leading** marker, so a marker embedded mid-line is shown
to the reader as literal text. An older repair pass joined rows with `' '.join()`
instead of `'\n'.join()` and **45 docs displayed literal `L1:(1) Prohibition…`** —
37 of them visible on `/r-dfars/part-3` alone.
→ `scripts/fix_inline_lmarkers.py`

### 3. Marker style is per-source and must not drift
| source | markers |
|---|---|
| `r-dfars` | every line marked |
| `far-companion` | none |
| `fmr` | none |
| `rfo` | mostly marked |

Blindly emitting `L0:` on a source that has none is a **format change**, not a
line-break change. Any script that rewrites content must preserve each line's
original form.

### 4. No memo page furniture inside the text
When a page break falls mid-section, the PDF's running header is extracted with
the regulation and wedged between paragraphs — 203.903 read *"…deemed to have
made a disclosure. Attachment A1 DARS Tracking Number: 2026-O0031 … Page 6 of 14
(5) Contracting officer actions…"*. **563 docs / 1,908 lines.** Only whole lines
that are *exactly* a furniture element may be dropped.
→ `scripts/strip_page_furniture.py`

⚠️ A bare number line is **deliberately not** treated as furniture — only 13
exist and some are real values in the text.

### 5. No PGI attachments
Every DoD deviation memo bundles the regulation (Attachment A1) with a
Procedures, Guidance & Information attachment (A2). PGI headings look like
`PGI 225.1—BUY AMERICAN—SUPPLIES` — they don't start with a bare section number,
so a naive splitter never sees them as a boundary and absorbs the **entire**
attachment into whichever section preceded it. **40 docs, 843,000 characters**
(worst: 252.215-7996 at 104,820 chars).

PGI is guidance, **not** one of AcqVault's six sources, and is indexed nowhere
else — its presence also makes the host doc wrong.
→ `scripts/strip_pgi_attachments.py`

### 6. PDF prose reads as paragraphs, not page lines
RFO stores one logical paragraph per line. R-DFARS and the FAR Companion were
extracted straight from PDFs, so each stored line was a **physical page line**.
Since the renderer emits one `<p>` per stored line, prose got paragraph spacing
mid-sentence, couldn't reflow to the reader's screen, and a wrapped line
beginning `(` — e.g. `(Comptroller/Chief Financial Officer)` — was mis-tagged as
a new lettered paragraph with its own CITE button.

Health check fails above **5%** of line breaks falling mid-sentence.
→ `scripts/rewrap_pdf_lines.py`

⚠️ **FMR is excluded on purpose.** 303 of its 304 docs contain tabular rows;
joining lines there would destroy tables. Its lower rate is table structure, not
wrapped prose.

### 7. Every downloaded memo is actually ingested
Parts 24/34/35/40/41/50 sat in `R-DFARS/` with entries in `deviations.json` yet
had **zero corpus docs** — invisible to every other check, because they all key
off the corpus and a part with no docs has nothing to notice. This check keys off
the **source PDF inventory** instead.
→ `scripts/ingest_rdfars_missing.py`

Part 48 is allow-listed: its memo is a 2,479-char cover letter with no sections.

### 8. Structural basics
Unique ids, no empty content.

---

## Things that are NOT bugs

Don't "fix" these:

- **Huge docs.** Size alone can't distinguish a swallow from a legitimately large
  unit. `252.225-7036` is 160K because it carries **15 Alternates**; FMR stores
  one doc per **chapter** (Housing Allowances = 257K). The health check reports
  the largest doc per source as *information only*. The precise swallow detectors
  are the PGI check and the container-inheritance check.
- **`[Reserved]` sections.** ~343 are genuine — they carry **no body at all**.
  A `[Reserved]` doc that carries text is NOT one of them; see below.
- **Same-number siblings.** Some memos really do carry two sections under one
  number (233.170, 233.205-70, 205.302). Both are kept, the later one with a
  numeric-suffixed id. Never merge texts whose content contradicts.
- **Empty parent headings.** A section or subpart header with **no body**, whose
  substance lives in its numbered children, is correct and expected. R-DFARS has
  ~80 of these. Contrast with the inheritance bug below — the difference is
  whether the parent is empty or is holding a *copy of its child*.

## The container-inheritance bug (fixed 2026-07-19 — do not re-dismiss)

Three entries above used to wave this off, and it survived four corpus audits as
a result. Recording it precisely so that can't happen again.

`block_lines()` in `refresh.py` let a container article skip its child's heading
and absorb that child's paragraphs. The result was a parent whose body is a
**byte-identical copy of a numbered child's body** — 463 rfo docs, 731K chars:

- 45 Part 52 clause groups, where the title also contradicted the body
  (`52.233 [Reserved]` held the whole Disputes clause). Fixed in `1fb0260`.
- 418 subpart and section containers, where the title merely *matched* the body
  so the duplication read as plausible (`Subpart 2.1 Definitions` ≡
  `2.101 Definitions`, 98K). This is why the "huge docs" entry above once cited
  `Subpart 2.1 Definitions` as an example of a legitimately large doc — it was
  the single largest instance of the bug.

**Do not detect this by size, by title, or by "looks duplicated".** The only safe
signal is body identity with a doc whose section number is a descendant of this
one. Validated against upstream ground truth over parts 1/3/15/33/52: 46/46
inherited containers caught, 6/6 containers that genuinely own their text spared,
zero false positives. Six containers really do have their own prose ahead of
their first child — a blunter rule would have emptied them.

Guarded by the `no container inherited a child's text` health check and by
`scripts/repair_rfo_container_inheritance.py`.

## When writing a corpus-rewriting script

1. **Assert text preservation.** Compare whitespace- and marker-stripped content
   before/after. If only line breaks should move, prove it — `rewrap_pdf_lines.py`
   asserts this per doc and reported 0 docs with changed text across 31,466 joins.
2. **Assert marker style is unchanged** (invariant 3).
3. **Write a review file first**, apply behind `--apply`.
4. **Match the on-disk JSON format exactly** — `json.dumps(docs,
   ensure_ascii=False)`, no trailing newline — or the diff becomes the whole file.
5. **Re-run `gen_doc_hashes.py`** (rebuilds `doc-hashes.json` + `corpus-meta.json`)
   and **bump the `sw.js` cache** so installed clients get the new corpus.
6. **Run `corpus_health.py`** before shipping.

---

# Render invariants — a valid corpus is not enough

Everything above proves `documents.json` holds good DATA. None of it asks whether the
code that DRAWS that data can parse it. On 2026-07-21 the DFARS PGI passed every single
check above and shipped anyway with:

* **all 427 section numbers unparsed.** Titles read `PGI 204.201 …`; `parseBrowseTitle`,
  `generateCitation` and `regOrderKey` all anchor their number regexes at a DIGIT, so
  every section fell through with an empty number and the contents list drew 27 em-dashes.
* **one citation shared by 27 sections.** With no number parsed, the Cite button fell back
  to the part, so every section of PGI part 204 copied `DFARS PGI Part 4`.
* **ordering by locale string compare**, because `regOrderKey` returned null for all of them.
* **no Browse entry point at all.** The source was in the search filter pills and nowhere
  else — unreachable by browsing.

Nobody noticed until the owner browsed it and said it "didn't seem like it was even
complete." Every one of those defects lives in the gap between *the corpus is valid* and
*the renderer can read the corpus*.

These are enforced by **`scripts/render_health.py`**, a SEPARATE gate from
`corpus_health.py` because the fix is a code change, not a repair script. `refresh.py`
runs both before shipping. It drives the REAL renderer functions — `scripts/render_probe.js`
slices them verbatim out of `assets/app.js` (which cannot be `require()`d; it touches
`document` at top level) using `scripts/extract_js_fns.js`. A reimplementation would
agree with itself while the shipped code stayed broken, which is exactly what happened.

### 9. Every numbered source's titles parse to a section number
100% of non-exempt docs, not a percentage floor — a floor hides new failures inside the
margin left by old ones. Exemptions are declared **by document id**.

### 10. Citations are unique within a part
**The highest-value check here.** A citation is a derived *identity*: two docs sharing one
means a parse fell through, whatever the cause. It needs no per-source knowledge and
cannot be defeated by a new title format — the property the PGI ship needed and lacked.

### 11. The parsed number appears in the citation
`parseBrowseTitle` and `generateCitation` have INDEPENDENT regexes. Fixing one does not
fix the other; this check is what notices.

### 12. `regOrderKey` never returns null for a numbered source
Otherwise section ordering silently degrades to `localeCompare`.

### 13. Every live source appears in every registry site
The scattered enumerations are listed in `registry_sites()` and in `docs/ADDING_A_SOURCE.md`.

### 14. The mirrored functions really are identical
`regOrderKey` / `regTitleCmp` / `pairKey` carry "KEEP IDENTICAL" comments that were
enforced by nothing. Compared with comments and whitespace stripped.

### 15. The in-app part label equals the server-rendered one
The reader said "Part 204" while the crawlable page at the same URL said "Part 4".

## Things that are NOT bugs (render side)

* **`[Reserved]` titles parse fine.** `52.233 [Reserved]` leads with a digit. No exemption
  needed — don't add one.
* **FMR `Chapter N:` and Category Management `Part N -` titles have no section number,
  legitimately.** They are declared `TITLE_STYLE` `'chapter'` / `'part'` and are exempt
  from the parse check — but NOT from the citation checks, which is what keeps the
  exemption honest.
* **FAR Companion's null order keys are correct.** Many FC entries annotate the SAME FAR
  section (`FC 5.000 Plain language` and `FC 5.000 Expanding reach beyond the GPE`), so a
  numeric key ties for all of them and the alphabetical locale fallback is what actually
  orders the part. Teaching `regOrderKey` to strip the `FC ` prefix was tried and
  measured: it reordered 19 parts, replacing a deterministic alphabetical order with
  corpus order. Reverted on purpose; declared in `ORDER_KEY_LOCALE_OK`.
* **A section number is NOT unique within a part.** R-DFARS part 233 holds two different
  sections numbered `233.170`. Anything that pairs or links on a bare number must detect
  the collision and decline, not pick the first match.

## The r-dfars part-52 clause library (decided 2026-07-23 — don't relitigate)

**Part 52 is the legacy PRE-DEVIATION clause library, kept on purpose.** 347 clause
docs, of which 74 exist nowhere else — including 252.204-7012 (Safeguarding Covered
Defense Information). Deleting the part would delete regulation text.

**Where a deviation memo restates a clause (273 numbers), the memo's copy in the
clause's SUBJECT part is authoritative.** Proven from the signed memos, not inferred:
of the 13 clause numbers whose two copies carry DIFFERENT "As prescribed in" lines,
the memo prints the subject-part copy's prescription 12/13 and the part-52 copy's
0/13 (the 13th could not be located in the memo text). Independently: all 13
subject-part prescriptions exist as corpus sections; 12 of 13 part-52 prescriptions
do not — they reference pre-RFO section numbers.

**The fix is labelling + search dedup, NEVER text editing.** The part-52 copies are
faithful reproductions of the legacy text; rewriting their prescription lines would
falsify a reproduced document (the same reason the CM tier revert happened).
Enforced/implemented as:
  * SEARCH queries return one hit per clause number — subject-part substantive beats
    part-52 substantive beats title-only stub (`clauseSuppressSet`, KEPT IDENTICAL in
    api/search.js and assets/app.js — scorer parity). A part FILTER (browse) still
    returns everything.
  * The SSR part-52 page labels each restated clause with a "Deviated — current text
    in Part NNN" chip linking to the memo copy; the in-app part-52 reader carries a
    part-level pre-deviation banner.
  * Title-only stubs (e.g. the part-12 commercial-clause list) STAY in the corpus —
    they are the memo's own applicability list — but lose to a substantive twin in
    search.

**Wrapped-title repair (`scripts/repair_wrapped_titles.py`):** the memos wrap long
headings onto a second line and ingest kept only the first, so 59 titles ended
mid-phrase ("…Organizational Conflict of") and their citations did too. The script
rejoins title + continuation, touches ONLY the `title` field (asserted), and doc
hashes are content-only so no pinned clause fired a false "changed" alert. ⚠ Its
tail heuristic must require real words: 252.227-7037's next line is a LIST OF CLAUSE
NUMBERS, which a naive join would have welded into the title.
