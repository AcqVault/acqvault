# The layout contract — what a source must look like before it ships

Every rule here exists because the opposite shipped to production and a reader hit it.

**The RFO is the reference implementation.** Not because it was written more carefully,
but because acquisition.gov publishes it as structured HTML — one `<article>` per
section, an explicit level per paragraph, real `<table>` elements — so
`scripts/parse_rfo_html.py` never had to *guess* at structure. Every other source came
out of a PDF, where structure has to be inferred from a page image, and every defect
below is an inference that went wrong.

So the target is not "look like the RFO". It is: **a PDF-extracted source must end up
carrying the same structural facts the RFO gets for free.** Where that is genuinely
impossible, say so out loud (rule 0) rather than faking it.

Enforced by `scripts/corpus_health.py` (is the DATA valid?) and
`scripts/render_health.py` (can the RENDERERS read it?). `refresh.py` runs both and
refuses to ship if either fails. See `docs/CORPUS_INVARIANTS.md` for the checks
themselves; this file is the *why*, and the order of operations.

---

## Rule 0 — Declare what the source actually is, before extracting anything

A source has a **unit of address** (what a citation points at) and a **unit of
storage** (one document). They should be the same thing.

| source | unit of address | one document is | honest? |
|---|---|---|---|
| rfo | section (`15.404-1`) | one section | yes |
| r-dfars | section (`204.201`) | one section | yes |
| pgi | section (`PGI 204.201`) | one section | yes |
| far-companion | entry (`FC 8.401`) | one entry | yes |
| ssp | section / appendix (`3.9`, `A.3`) | one section | yes |
| afi-63-138 | paragraph (`1.1`) | one paragraph group | yes |
| **fmr** | **volume + chapter** | **one chapter** | **yes — declared** |
| category-management | part | one part | yes — declared |

The FMR has a **median document of 26,792 characters** against the RFO's 642, because a
DoD FMR citation addresses a chapter (`DoD FMR, Vol. 1, Ch. 1`), not a section. That is
not a defect to fix — it is a different unit, and it is **declared** in
`TITLE_STYLE` in `render_health.py` (`'chapter'`) so the gate stops demanding section
numbers from it. What is forbidden is leaving it *undeclared* and letting the checks
quietly fail or quietly pass.

**Test:** every source appears in `TITLE_STYLE`. A new source with no entry fails.

---

## Rule 1 — One logical paragraph per stored line. Never one *physical* line.

**This is the highest-value rule in the file.** A PDF stores the text as it was printed,
so every column break becomes a stored line. The renderers emit one `<p>` per stored
line, so a single sentence renders as three paragraphs with paragraph spacing between
them, unable to reflow to the reader's screen.

It is worse than ugly, because the continuation lines carry the **wrong indent level**.
Real PGI text before the fix:

```
L1:(b) DoD-issued PIIDs are thirteen characters in length. Use only alpha-numeric
L0:characters, as prescribed in FAR 4.201 and this subpart. Do not use the letter I or O in
L0:any part of the PIID.
```

One sentence, three paragraphs, and the two continuations sat at **L0** — rendered flush
to the outer margin while the line they continue was indented. Every PGI section read
like that, live, for two days.

**Measured, long lines (>40 chars) ending without terminal punctuation:**

| source | before | after |
|---|---|---|
| rfo | 26% | 26% (baseline — genuine continuations across list items) |
| r-dfars | 29% | 29% (rewrapped 2026-07-18) |
| far-companion | 6% | 6% (rewrapped 2026-07-18) |
| **pgi** | **78%** | **27%** (rewrapped 2026-07-23) |
| afi-63-138 | 77% | 77% — see rule 1a |
| category-management | 85% | 85% — see rule 1a |

~26% is the floor, not zero: regulation text legitimately continues across enumerated
items. A source sitting near 80% has not been rewrapped.

**Fix:** `scripts/rewrap_pdf_lines.py`. It joins a line to the previous one only when the
previous line is left hanging AND the next is clearly a continuation, and never across a
heading, a new enumerated item, a tabular row, or a dot-leader TOC line. It asserts that
only whitespace changed.

### Rule 1a — a source with a bespoke line renderer is exempt, deliberately
DAFI 63-138 and Category Management are parsed line-by-line by dedicated renderers
(`dafiParagraphMatch`, `dafiNativeTableHTML`, `isCategoryGuide`) that key off the stored
line shape. Rewrapping them would break the renderer that makes them readable. Their
mid-sentence rate is high and that is **accepted**, not overlooked.

### Rule 1b — ⚠ REWRAP BEFORE ATTACHING TABLES
A doc's tables are stored as **line-index spans** (`{"start": 75, "end": 77}`) and the
renderers draw the table *instead of* those lines. Rejoining lines renumbers them, so
rewrapping a doc that already carries tables slides every span onto the wrong text —
silently deleting regulation and drawing the table in the wrong place. R-DFARS and the
FAR Companion escaped this only by accident of ordering. `rewrap_pdf_lines.py` now
**refuses** any doc carrying tables and says so. **Correct order: rewrap, then extract
tables.**

---

## Rule 2 — Paragraph depth must be present and plausibly distributed

The `L0:`–`L4:` prefix is the indentation contract. Having markers is not enough; the
**distribution** has to look like nested regulation.

| source | L0 / L1 / L2 / L3 / L4 | verdict |
|---|---|---|
| rfo | 4801 / 7425 / 8214 / 3904 / 1263 | the shape to aim for |
| pgi (after rewrap) | 1860 / 1059 / 1531 / 859 / 821 | healthy |
| **r-dfars** | **9570 / 14774 / 209 / 22 / 1** | **degenerate** |
| far-companion, fmr, ssp, afi, cat-mgmt | 0 / 0 / 0 / 0 / 0 | none stored |

R-DFARS records **one single line at L4** across the entire source, for text that nests
four deep constantly. Its stored depth is effectively binary.

This is survivable *only* because both renderers **derive depth at render time** from the
paragraph token — `(a)`→L1, `(1)`→L2, `(i)`→L3, `(A)`→L4 — a mapping measured against the
RFO's published levels (96%/93%/91%/92% agreement), not assumed. That derivation is what
gives the five unmarked sources their tiering.

**So the real requirement is: depth must be RECOVERABLE.** Either store it correctly, or
leave the paragraph tokens intact in the text so the renderer can derive it. What breaks
is text that has *neither* — which is what a bad rewrap produces when it merges a `(1)`
onto the end of the previous line.

**Never** write derived markers back into the corpus: it short-circuits the special
renderers (a marker branch is checked first, so DAFI would lose its table handling), and
it moves ~1,700 document hashes, telling every pinned-clause user the regulation changed
when only the indent did.

---

## Rule 3 — Every title is `<number> <Title>`, complete, and clean

The title is not decoration: it is parsed for the section number, sorted on, and copied
**verbatim into the citation** a contracting officer pastes into a contract file.

Three failure modes, all of which shipped:

1. **Prefix the parsers don't expect.** All 427 PGI titles read `PGI 204.201 …`, and every
   number regex was anchored at a digit — so every section fell through with an *empty*
   number, the contents list drew 27 em-dashes, and all 27 sections of part 204 produced
   the identical citation `DFARS PGI Part 4`.
2. **Truncated at the PDF line wrap** — `252.209-7008 Notice of Prohibition Relating to
   Organizational Conflict of`. 71 rejoined across two passes
   (`repair_wrapped_titles.py`, `repair_wrapped_titles_pdf.py`). ⚠ The tell that a
   "title" is really a mis-ingested *paragraph* is that **the join still dangles** — that
   is the guard, not a length limit alone.
3. **Whitespace from the page** — 20 titles carried a double space after the section
   number, straight through into citations.

**Tests:** `parseBrowseTitle` yields a non-empty number for 100% of non-exempt docs;
the number appears in the citation; no title ends on a dangling preposition; no runs of
whitespace. Exemptions are declared **by document id**, never by rule — a percentage
floor hides new failures inside the margin left by old ones.

---

## Rule 4 — A citation must be unique within its part

**The single most valuable check in the gate**, because a citation is a *derived
identity*: two documents sharing one means a parse fell through, whatever the cause. It
needs no per-source knowledge and cannot be defeated by a new title format — exactly the
property the PGI ship needed and did not have.

Same-number siblings are real (`205.302` twice in r-dfars part 5) and are allow-listed
**by id pair** in `render_health.py`.

---

## Rule 5 — A section number is not unique, and a bare number is not unambiguous

Two distinct sections in R-DFARS part 233 are both numbered `233.170`. Anything that
pairs, links, or dedupes on a bare number **must detect the collision and decline** — a
missing link is recoverable, a confidently wrong cross-reference in a rulebook is not.

And the rule/guidance boundary is **never guessed**: a reference resolves into the PGI
only when the text literally wrote `PGI` before the number. A bare `204.201` means the
regulation *even inside a PGI document*. Before this, `See PGI 209.470` linked the bare
number to the R-DFARS rule — which is `[Reserved]`, because the procedure lives in the
PGI. The reader was told to follow a procedure and landed on an empty section.

---

## Rule 6 — Nothing internal may ever be visible

Ingest markers (`L1:`), table placeholders (`⟦TBL:n⟧`), page furniture (running heads,
bare page numbers), and PUA glyphs are all machinery. Each has leaked: 45 docs once
showed a literal `L1:`, 37 of them on one page. Page furniture wedged mid-sentence was
stripped from 563 docs / 1,908 lines.

---

## Rule 7 — Tables must not eat the prose they replace

A table span must be in range **and** the table must reproduce every word in the span it
replaces, because the renderers draw the table *instead of* that text — so a loose match
silently deletes regulation. This cut candidate matches 37→18 and that was the correct
trade. Page furniture is exempt; DAFI is exempt (its hand-rebuilt tables deliberately
cover flattened garbage). **Never relax it.**

And: raw extractor output is not automatically better than hand-curated data. A
Category Management re-ingest put HCaTS under Tier 4 when it belongs to Tier 3 — in a
buying guide the tier *is* the answer. **Diff before trusting an extraction.**

---

## Rule 8 — Deep links need a stable anchor

Only the RFO carries an `anchor` field (3,073 of 3,073) — the publisher's own element id,
which is why its ids survived a complete re-extraction with all 3,073 preserved. Every
other source deep-links on the internal `id`. That is workable but fragile: an id derived
from position changes when the source is re-ingested, breaking every citation anyone
saved.

**When a publisher gives you a stable id, keep it and use it as the join key on
re-ingest.** It is the difference between a re-extraction that preserves pinned clauses
and one that orphans them.

---

## Ingesting a new source — the order that avoids rework

1. **Declare it** — `TITLE_STYLE`, the unit of address (rule 0), and whether it gets a
   bespoke renderer (rule 1a).
2. **Prefer structured HTML over the PDF.** Always check whether the publisher offers it;
   the RFO's entire advantage is that acquisition.gov does. Cache the fetch to a local
   archive so parser iteration never re-hits their servers.
3. **Split into documents at the unit of address**, keeping the publisher's ids as
   `anchor`.
4. **Rewrap physical lines into logical paragraphs** (rule 1).
5. **Then extract tables** (rule 1b — this order is not optional).
6. **Strip furniture and internal markers** (rule 6).
7. **Repair titles** (rule 3).
8. **Wire every registry** — `docs/ADDING_A_SOURCE.md` lists all of them, and the registry
   check enforces it. The PGI shipped missing four, leaving it with no Browse entry point
   at all: reachable only from a search filter.
9. **Run both gates**, then read ten sections *by eye*. Every defect in this file passed
   the checks that existed at the time; the reason they were found was a person reading
   the page.
