# Corpus invariants — read before any re-ingest or re-extraction

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
