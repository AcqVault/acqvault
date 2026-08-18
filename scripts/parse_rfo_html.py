#!/usr/bin/env python3
"""
Turn the cached acquisition.gov RFO pages into corpus documents.

The published HTML carries everything the PDF pipeline lost:

  <article id="FAR_3_101_2">                     one section, already anchored
    <h4><span class="autonumber">3.101-2</span> Solicitation and acceptance…</h4>
    <div class="body conbody">
      <p class="ListL1">(a) As a rule…</p>       the tiering, as published
      <p class="ListL2">(1) Has or is seeking…</p>
      <table>…</table>                            a real table, not flattened prose
    </div>
  </article>

Sections nest, so a part page is a tree of articles. Each document takes ONLY its
own <div class="body conbody">, never a descendant's, or a parent would swallow
every child's text.

Documents keep the existing schema and — critically — join to the current corpus on
`anchor`, which the corpus already stores and which is the article id upstream. That
means a re-ingest preserves every document `id`, so pinned clauses, saved searches
and doc-hashes.json all survive.

Usage:
    python3 scripts/parse_rfo_html.py             # parse + report, writes a preview
    python3 scripts/parse_rfo_html.py --write     # rebuild the rfo half of the corpus
"""

import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString, Tag

from scrub_pua_glyphs import scrub  # acquisition.gov emits PUA glyphs (e.g. U+F8FD for ×)

BASE = Path(__file__).resolve().parent.parent
CACHE = BASE / "_local_archive" / "rfo-html"
DOCS = BASE / "output" / "documents.json"
PREVIEW = BASE / "_local_archive" / "rfo-rebuilt.json"
SITE = "https://www.acquisition.gov"
PART_URL = f"{SITE}/far-overhaul/far-part-deviation-guide/far-overhaul-part-%s"

# Levels deeper than this collapse — the renderers cap indentation at 4 anyway.
MAX_LEVEL = 4


def clean(text):
    """Collapse whitespace; map upstream's private-use glyphs to real characters.

    The 2026-08 re-render of acquisition.gov swapped the multiplication sign in
    32.503-6 for U+F8FD — the same PUA family scrub_pua_glyphs.py already maps,
    verified there by the arithmetic. Scrubbing at parse time keeps invariant #1
    (no tofu) true for every future ingest instead of relying on a manual pass.
    """
    text = scrub(str(text or ""))[0]
    return re.sub(r"\s+", " ", text).replace(" ", " ").strip()


def level_of(tag):
    """ListL1 -> 1. Anything without a ListL class is a top-level paragraph."""
    for c in tag.get("class") or []:
        m = re.fullmatch(r"ListL(\d+)", c.strip())
        if m:
            return min(int(m.group(1)), MAX_LEVEL)
    return 0


def table_rows(table):
    """Rows of cell text. Keeps every cell, including empties, so columns line up."""
    rows = []
    for tr in table.find_all("tr"):
        cells = [clean(td.get_text(" ")) for td in tr.find_all(["th", "td"])]
        if cells:
            rows.append(cells)
    if not rows:
        return None
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    rows = [r for r in rows if any(r)]
    if len(rows) < 2 or width < 2:
        return None
    return rows


# Containers that merely wrap content — descend through them. Anything else is
# either a block worth a line of its own or inline text belonging to its parent.
WRAPPERS = {"div", "section", "ul", "ol", "dl", "blockquote", "figure", "fieldset"}
BLOCKS = {"p", "li", "dt", "dd", "pre", "h5", "h6"}


def walk_blocks(node, lines, tables):
    """Collect blocks in document order, never crossing into a nested section.

    A nested <article> is a document in its own right, so descending into one would
    make the parent swallow every child's text. Wrapper elements, though, must be
    descended: the tables sit in a div.agov-table-wrapper and 52.212-4 keeps most of
    its clause inside a <section>, both of which a direct-children walk misses.
    """
    for el in node.children:
        if not isinstance(el, Tag):
            continue
        if el.name == "article":
            continue
        if el.name == "table":
            rows = table_rows(el)
            if not rows:
                # Not a real data table — a single-column or layout table, e.g. the
                # fill-in block at the end of 52.232-35. Never drop it: emit the text
                # so nothing the publisher shows goes missing from the corpus.
                for tr in el.find_all("tr"):
                    txt = clean(tr.get_text(" "))
                    if txt:
                        lines.append("L0:" + txt)
                continue
            if rows:
                # The cells stay in `content`, one line per row, so the text remains
                # searchable — a clause found only by a phrase inside its table must
                # still be findable. The span tells the renderers to draw the real
                # table in place of those lines.
                start = len(lines)
                for r in rows:
                    lines.append("L0:" + " ".join(c for c in r if c))
                tables.append({"start": start, "end": len(lines) - 1, "rows": rows})
            continue
        if el.name in BLOCKS:
            if el.find("table") is not None:
                walk_blocks(el, lines, tables)
                continue
            txt = clean(el.get_text(" "))
            if txt:
                lvl = level_of(el)
                if el.name in ("li", "dd") and lvl == 0:
                    lvl = 1
                lines.append(f"L{lvl}:{txt}")
            continue
        if el.name in WRAPPERS:
            walk_blocks(el, lines, tables)


def own_body(article):
    """The article's own body div, not a nested section's."""
    for child in article.find_all("div", class_="body", recursive=False):
        return child
    # some sections wrap the body one level down but still before any nested article
    for child in article.children:
        if isinstance(child, Tag) and child.name == "div" and "body" in (child.get("class") or []):
            return child
    return None


def parse_part(html, part):
    """Yield one document dict per <article> section on the page."""
    soup = BeautifulSoup(html, "lxml")
    out = []
    for article in soup.find_all("article", id=re.compile(r"^FAR_")):
        anchor = article.get("id")
        # The part-level container is a table of contents, not regulation text: its
        # body is the list of every section title in the part. Indexing it would put
        # each clause title in the corpus twice and match it ahead of the clause
        # itself. (Parts 38 and 51 consist of nothing else — they are Reserved.)
        if re.fullmatch(r"FAR_Part_\d+", anchor or ""):
            continue
        head = None
        for h in ("h1", "h2", "h3", "h4", "h5", "h6"):
            head = article.find(h, recursive=False)
            if head:
                break
        if head is None:
            continue
        title = clean(head.get_text(" ")).rstrip(".")
        body = own_body(article)

        lines = []
        tables = []
        if body is not None:
            walk_blocks(body, lines, tables)

        content = title + "\n\n" + "\n".join(lines) if lines else title
        # the table spans are indices into the *line list*; content adds two header
        # lines (title, blank) before them, so shift to match the stored content
        shift = 2 if lines else 0
        for t in tables:
            t["start"] += shift
            t["end"] += shift

        out.append({
            "title": title,
            "content": content,
            "part": str(part),
            "anchor": anchor,
            "url": (PART_URL % part) + "#" + anchor,
            "source": "rfo",
            "tables": tables,
        })
    return out


def main():
    write = "--write" in sys.argv
    files = sorted(CACHE.glob("part-*.html"),
                   key=lambda p: int(re.search(r"part-(\d+)", p.name).group(1)))
    if not files:
        sys.exit("no cached pages — run scripts/fetch_rfo_html.py first")

    scraped = []
    for f in files:
        part = re.search(r"part-(\d+)", f.name).group(1)
        docs = parse_part(f.read_text(encoding="utf-8"), part)
        scraped.append((part, docs))
        print(f"  part {part:>2}: {len(docs):>4} sections, "
              f"{sum(len(d['tables']) for d in docs):>3} tables, "
              f"{sum(len(d['content']) for d in docs):>7} chars", flush=True)

    all_new = [d for _, docs in scraped for d in docs]
    print(f"\nscraped {len(all_new)} sections, "
          f"{sum(len(d['tables']) for d in all_new)} tables, "
          f"{sum(len(d['content']) for d in all_new):,} chars")

    corpus = json.loads(DOCS.read_text())
    existing = [d for d in corpus if d.get("source") == "rfo"]
    by_anchor = {d.get("anchor"): d for d in existing if d.get("anchor")}
    print(f"current corpus: {len(existing)} rfo docs, "
          f"{sum(len(d.get('content', '')) for d in existing):,} chars")

    matched = sum(1 for d in all_new if d["anchor"] in by_anchor)
    print(f"\njoin on anchor: {matched} matched, {len(all_new) - matched} new, "
          f"{len(by_anchor) - matched} in corpus but not upstream")

    shorter = [d for d in all_new
               if d["anchor"] in by_anchor
               and len(d["content"]) < len(by_anchor[d["anchor"]].get("content", "")) * 0.95]
    print(f"sections where the scrape is >5% SHORTER than the corpus: {len(shorter)}")
    for d in shorter[:10]:
        old = by_anchor[d["anchor"]]
        print(f"   {d['title'][:52]:54} {len(old.get('content','')):>6} -> {len(d['content']):>6}")

    if not write:
        PREVIEW.write_text(json.dumps(all_new, ensure_ascii=False))
        print(f"\n(preview only) wrote {PREVIEW}")
        return

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rebuilt = []
    for d in all_new:
        prev = by_anchor.get(d["anchor"])
        doc = {
            "title": d["title"],
            "content": d["content"],
            "part": d["part"],
            # keep the established id so pinned clauses and hashes survive
            "id": prev["id"] if prev else hashlib.sha1(
                d["anchor"].encode()).hexdigest()[:16],
            "anchor": d["anchor"],
            "source": "rfo",
            "url": d["url"],
            "filename": prev.get("filename") if prev else f"RFO {d['title'].split(' ')[0]}",
            "status": prev.get("status") if prev else "Active deviation",
            "date": prev.get("date", "") if prev else "",
            "indexed_at": now,
        }
        if d["tables"]:
            doc["tables"] = d["tables"]
        rebuilt.append(doc)

    others = [d for d in corpus if d.get("source") != "rfo"]
    DOCS.write_text(json.dumps(others + rebuilt, ensure_ascii=False))
    print(f"\nwrote {len(rebuilt)} rfo docs (+{len(others)} untouched) -> {DOCS}")


if __name__ == "__main__":
    main()
