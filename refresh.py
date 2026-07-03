#!/usr/bin/env python3
"""
AcqVault corpus refresher — safe, gated, run-anytime.

    python3 refresh.py              fetch → diff → show report → ask before applying/shipping
    python3 refresh.py --dry-run    fetch → diff → report only (never writes anything)
    python3 refresh.py --yes        apply + commit + push without prompting
    python3 refresh.py --check      quick "anything new upstream?" (HEAD probes only, ~5s)

What it does
  RFO      — scrapes the per-part HTML pages on acquisition.gov (the same source the live
             section-level corpus was built from), rebuilds the rfo docs with L-markers,
             preserves every existing doc id via its stable #FAR_x_y anchor, and replaces
             ONLY the rfo docs in output/documents.json. Unchanged sections keep their old
             entry byte-for-byte (indexed_at included) so diffs stay minimal and honest.
  R-DFARS  — HEAD-checks the 46 DoD deviation memos (+ looks for new ones). If anything
             changed it downloads via fetch_dod_deviations.py and FLAGS the corpus
             re-extraction for review — it never guesses its way into the r-dfars docs.
  Others   — far-companion / category-management PDFs get a freshness probe + report only.
             fmr / compass / dafi are never touched.

Safety gates (any failure = nothing is written, site stays as-is)
  * every part page discovered on the hub must fetch and parse
  * new rfo doc count within ±10% of current
  * ≥95% of existing rfo anchors must still be found upstream
  * no parsed section may be suspiciously empty

Shipping (only after you say yes)
  regenerates doc-hashes + corpus-meta, bumps the service-worker cache version, updates the
  hero indexed-count fallback, appends the run to output/changes-log.json (the change-page
  ledger), commits as the AcqVault author and pushes.
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_DIR = Path(__file__).parent
DOCS_PATH = BASE_DIR / "output" / "documents.json"
CHANGES_LOG = BASE_DIR / "output" / "changes-log.json"
REPORT_PATH = BASE_DIR / "output" / "refresh-report.json"

SITE = "https://www.acquisition.gov"
HUB_URL = SITE + "/far-overhaul/far-part-deviation-guide"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

RFO_COUNT_TOLERANCE = 0.10   # ±10% doc-count drift allowed
ANCHOR_COVERAGE_MIN = 0.95   # ≥95% of old anchors must still exist
MIN_CONTENT_CHARS = 10   # catches broken parses; legit "[Reserved]" stubs are longer

session = requests.Session()
session.headers["User-Agent"] = UA


def fail(msg):
    print("\n✗ GATE FAILED: " + msg)
    print("  Nothing was written. The site is unchanged.")
    sys.exit(2)


def get(url, tries=3):
    last = None
    for attempt in range(tries):
        try:
            r = session.get(url, timeout=45)
            r.raise_for_status()
            return r
        except Exception as e:  # noqa: BLE001 — retry then surface
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("fetch failed after {} tries: {} ({})".format(tries, url, last))


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── RFO: scrape per-part HTML pages ───────────────────────────────────────────

def discover_part_pages():
    """Hub page → sorted list of (part_number, url)."""
    html = get(HUB_URL).text
    slugs = sorted(set(re.findall(r"far-overhaul-part-(\d+)", html)), key=int)
    if not slugs:
        fail("hub page listed zero part pages — layout may have changed: " + HUB_URL)
    return [(int(n), "{}/far-overhaul-part-{}".format(HUB_URL, n)) for n in slugs]


HEADINGS = ("h1", "h2", "h3", "h4", "h5", "h6")


def block_lines(article):
    """Reproduce the original ingestion's content rule, byte-for-byte:
    the doc's text is the FIRST run of paragraphs after its own heading —
    child headings encountered before any text are skipped (containers
    inherit their first child's text), and the run stops at the next
    heading once text has started. Levels come from the ListLn classes."""
    started = False
    lines = []
    els = article.find_all(list(HEADINGS) + ["p", "li"])
    for el in els:
        if el.name in HEADINGS:
            if el is els[0]:
                continue          # the article's own title
            if started:
                break             # next section begins — stop
            continue              # child heading before any text — skip
        txt = " ".join(el.get_text(" ", strip=True).split())
        if not txt:
            continue
        level = 0
        for cls in el.get("class") or []:
            m = re.match(r"ListL(\d+)$", cls)
            if m:
                level = int(m.group(1))
                break
        lines.append("L{}:{}".format(level, txt))
        started = True
    return lines


def parse_part_page(part_num, url, html):
    """One part page → list of section docs (id-less; ids mapped later)."""
    soup = BeautifulSoup(html, "html.parser")
    docs = []
    for topic in soup.find_all("article", id=re.compile(r"^FAR_")):
        classes = " ".join(topic.get("class") or [])
        if "topic" not in classes:
            continue
        anchor = topic["id"]
        if anchor.startswith("FAR_Part_"):
            continue  # whole-part shells (e.g. a reserved Part 38) are not corpus docs
        heading = topic.find(list(HEADINGS))
        if heading is None:
            continue
        title = " ".join(heading.get_text(" ", strip=True).split()).rstrip(".")
        if re.match(r"Part\s+\d+\b", title):
            continue  # part-shell articles (sometimes reusing a section's id) are not docs
        if title.startswith("Subpart"):
            title = title.replace(" - ", " ", 1)
        lines = block_lines(topic)
        # heading-only sections (e.g. "3.102 [Reserved]") are real corpus docs whose
        # content is exactly the title; sections with text get the L-marker block
        content = title + "\n\n" + "\n".join(lines) if lines else title
        num_match = re.match(r"(Subpart\s+[\d.]+|[\d.]+(?:-\d+)*)", title)
        num = num_match.group(1) if num_match else anchor
        docs.append({
            "title": title,
            "content": content,
            "part": str(part_num),
            "anchor": anchor,
            "url": url + "#" + anchor,
            "filename": "RFO " + num,
        })
    return docs


def refresh_rfo(existing_rfo):
    pages = discover_part_pages()
    print("RFO: {} part pages on the hub (corpus currently covers {} parts)".format(
        len(pages), len({d["part"] for d in existing_rfo})))
    old_by_anchor = {d["anchor"]: d for d in existing_rfo}
    old_parts = {d["part"] for d in existing_rfo}
    new_docs_raw = []
    for i, (part_num, url) in enumerate(pages):
        html = get(url).text
        parsed = parse_part_page(part_num, url, html)
        if not parsed:
            # reserved/empty parts (e.g. Part 38 "[Reserved]") are fine as long as
            # the corpus never had content for them either
            if str(part_num) in old_parts:
                fail("part page parsed to zero sections (layout change?): " + url)
            print("  part {:>3}: reserved/no content — skipped".format(part_num))
            continue
        new_docs_raw.extend(parsed)
        print("  part {:>3}: {:>3} sections".format(part_num, len(parsed)), end="\r")
        if i < len(pages) - 1:
            time.sleep(0.35)
    print()

    # gates -------------------------------------------------------------------
    if existing_rfo:
        drift = abs(len(new_docs_raw) - len(existing_rfo)) / float(len(existing_rfo))
        if drift > RFO_COUNT_TOLERANCE:
            fail("rfo doc count moved {} → {} ({:+.0%}) — beyond the ±{:.0%} gate".format(
                len(existing_rfo), len(new_docs_raw), drift, RFO_COUNT_TOLERANCE))
        found = {d["anchor"] for d in new_docs_raw}
        missing = [a for a in old_by_anchor if a not in found]
        coverage = 1.0 - len(missing) / float(len(old_by_anchor))
        if coverage < ANCHOR_COVERAGE_MIN:
            fail("only {:.1%} of existing sections found upstream (gate {:.0%}). First missing: {}".format(
                coverage, ANCHOR_COVERAGE_MIN, ", ".join(missing[:5])))
    thin = [d for d in new_docs_raw
            if len(d["content"]) < MIN_CONTENT_CHARS and d["content"] != d["title"]]
    if thin:
        fail("{} sections parsed nearly empty, e.g. {}".format(len(thin), thin[0]["anchor"]))
    seen, dups = set(), set()
    for d in new_docs_raw:
        if d["anchor"] in seen:
            dups.add(d["anchor"])
        seen.add(d["anchor"])
    if dups:
        fail("duplicate section anchors parsed (would collide ids): " + ", ".join(sorted(dups)[:5]))

    # id preservation + byte-identical reuse of unchanged docs -----------------
    final, added, modified, removed = [], [], [], []
    part_status = {}
    for d in existing_rfo:
        part_status.setdefault(d["part"], d.get("status", "Active deviation"))
    stamp = now_iso()
    for d in new_docs_raw:
        old = old_by_anchor.get(d["anchor"])
        if old is not None and old["content"] == d["content"] and old["title"] == d["title"]:
            final.append(old)                       # untouched → keep byte-for-byte
            continue
        doc = {
            "title": d["title"], "content": d["content"], "part": d["part"],
            "id": old["id"] if old else hashlib.sha1(("rfo|" + d["anchor"]).encode()).hexdigest()[:16],
            "source": "rfo",
            "filename": old["filename"] if old else d["filename"],
            "status": old["status"] if old else part_status.get(d["part"], "Active deviation"),
            "indexed_at": stamp,
            "url": d["url"],
            "date": old.get("date", "") if old else "",
            "anchor": d["anchor"],
        }
        final.append(doc)
        (modified if old else added).append(doc)
    found = {d["anchor"] for d in new_docs_raw}
    removed = [old_by_anchor[a] for a in old_by_anchor if a not in found]
    return final, added, modified, removed


# ── R-DFARS + other PDFs: freshness probes ────────────────────────────────────

def head_info(url):
    try:
        r = session.head(url, timeout=30, allow_redirects=True)
        return r.headers.get("last-modified", ""), int(r.headers.get("content-length") or 0)
    except Exception:
        return "", -1


def check_rdfars():
    """Compare the hub's DoD memo list against local R-DFARS/*.pdf. Returns summary string."""
    html = get(HUB_URL).text
    remote = sorted(set(re.findall(r'href="(/sites/[^"]*DoD[^"]*\.pdf)"', html, re.I)))
    local = {p.name: p.stat().st_size for p in (BASE_DIR / "R-DFARS").glob("*.pdf")}
    new_files, changed = [], []
    for href in remote:
        name = href.rsplit("/", 1)[-1]
        if name not in local:
            new_files.append(name)
            continue
        _, size = head_info(SITE + href)
        if size > 0 and size != local[name]:
            changed.append(name)
    if not new_files and not changed and len(remote) == len(local):
        return "current ({} memos, all sizes match)".format(len(local)), False
    parts = []
    if new_files:
        parts.append("{} NEW memo(s): {}".format(len(new_files), ", ".join(new_files[:4])))
    if changed:
        parts.append("{} changed: {}".format(len(changed), ", ".join(changed[:4])))
    if len(remote) != len(local):
        parts.append("count remote {} vs local {}".format(len(remote), len(local)))
    return "; ".join(parts), True


def check_static_pdf(label, url, local_glob, download=True):
    """Probe an acquisition.gov PDF; when it changed upstream, pull the new copy
    into the tracked source folder (validated as a real PDF first). The corpus
    re-extraction for these sources is deliberately a supervised session job."""
    lm, size = head_info(url)
    local = sorted(BASE_DIR.glob(local_glob))
    lsize = local[0].stat().st_size if local else 0
    if size == lsize:
        return "{}: current".format(label), False
    msg = "{}: CHANGED upstream (remote {:,}B vs local {:,}B, last-modified {})".format(
        label, size, lsize, lm or "?")
    if download and local:
        data = get(url).content
        if data[:5] == b"%PDF-" and len(data) > 100000:
            local[0].write_bytes(data)
            msg += " — new PDF downloaded to {}".format(local[0].relative_to(BASE_DIR))
        else:
            msg += " — download did NOT look like a valid PDF ({} bytes), left untouched".format(len(data))
    return msg, True


# ── Threshold watch ───────────────────────────────────────────────────────────

MONEY_RE = re.compile(r"\$[\d][\d,.]*(?:\s?(?:million|billion))?")


def threshold_watch(existing_rfo, final_rfo, modified):
    """Two drift alarms for the Toolkit threshold widget:
    (a) modified sections whose dollar figures changed (a value the widget quotes
        may have moved), and (b) widget citations that no longer resolve to a
        section in the refreshed corpus (the RFO renumbered — fix widgets.js)."""
    old_by_anchor = {d["anchor"]: d for d in existing_rfo}
    dollar_drift = []
    for d in modified:
        o = old_by_anchor.get(d.get("anchor"))
        if not o:
            continue
        om, nm = set(MONEY_RE.findall(o["content"])), set(MONEY_RE.findall(d["content"]))
        if om != nm:
            dollar_drift.append({"title": d["title"], "part": d["part"],
                                 "gone": sorted(om - nm), "new": sorted(nm - om)})
    widget = BASE_DIR / "assets" / "widgets.js"
    cites = re.findall(r"cite:\s*'RFO ([^']+)'", widget.read_text()) if widget.exists() else []
    first_words = {d["title"].split()[0] for d in final_rfo}
    subpart_words = {d["title"].split()[1] for d in final_rfo if d["title"].startswith("Subpart ")}
    broken = [c for c in set(cites) if c not in first_words and c not in subpart_words]
    if dollar_drift or broken:
        print("\n⚠ THRESHOLD WATCH")
        if broken:
            print("  Toolkit citations that no longer resolve in the corpus (fix assets/widgets.js):")
            for c in sorted(broken):
                print("    · RFO " + c)
        if dollar_drift:
            print("  Modified sections with changed dollar figures (check the Toolkit values):")
            for e in dollar_drift[:15]:
                print("    · Part {:>3}  {}  −{} +{}".format(
                    e["part"], e["title"][:58], e["gone"] or "[]", e["new"] or "[]"))
            if len(dollar_drift) > 15:
                print("    · … and {} more (full list in refresh-report.json)".format(len(dollar_drift) - 15))
    return {"dollar_drift": dollar_drift, "broken_widget_cites": sorted(broken)}


def _deck_texts(deck):
    """Yield (kind, id, topic, text) for every human-facing string in the study deck —
    questions, answers, distractors, debriefs, refs, scenario prose, asks, scripts,
    facts, baits, key moves, follow-up hints/debriefs, and coach lines."""
    for pool in ("recall_basic", "recall_advanced", "thresholds"):
        for c in deck.get(pool, []):
            topic = c.get("topic", pool)
            for f in ("q", "a", "x", "ref"):
                if c.get(f):
                    yield pool, c["id"], topic, c[f]
            for opt in c.get("d") or []:
                yield pool, c["id"], topic, opt
    for s in deck.get("scenarios", []):
        topic = "/".join(s.get("topics") or [])
        for f in ("scenario", "ask", "script", "board_answer"):
            if s.get(f):
                yield "scenario", s["id"], topic, s[f]
        for fact in s.get("facts") or []:
            yield "scenario", s["id"], topic, fact.get("fact", "") + " " + fact.get("why", "")
        for fw in s.get("frameworks") or []:
            yield "scenario", s["id"], topic, (fw if isinstance(fw, str) else fw.get("framework", "") + " " + fw.get("why", ""))
        for b in s.get("baits") or []:
            yield "scenario", s["id"], topic, b
        for k in s.get("key_moves") or []:
            yield "scenario", s["id"], topic, k
        for fu in s.get("follow_ups") or []:
            if isinstance(fu, dict):
                yield "scenario", s["id"], topic, " ".join(filter(None, (fu.get("q"), fu.get("h"), fu.get("d"))))
            else:
                yield "scenario", s["id"], topic, fu
        co = s.get("coach") or {}
        yield "scenario", s["id"], topic, " ".join(filter(None, (co.get("qtype"), co.get("rule"), co.get("cite"))))


DECK_PATH = BASE_DIR / "assets" / "study-deck.json"
DECK_CITE_RE = re.compile(r"\b(RFO|R-DFARS)\s+(?:Part\s+(\d+)|(\d+(?:\.[\d]+)*(?:-\d+)?))")


def study_deck_watch(final_rfo, all_docs, modified):
    """Guards the /study question deck (assets/study-deck.json) against corpus drift.
    Runs on every refresh, alongside threshold_watch:
      (a) BROKEN CITES — every 'RFO x.y' / 'RFO Part N' / 'R-DFARS x.y' the deck quotes
          must still resolve to a section in the refreshed corpus (renumbering breaks
          study answers silently);
      (b) CONTENT REVIEW — any deck item whose text cites a section this run MODIFIED
          gets flagged: the rule the question teaches may have changed. Reviewing the
          flagged questions is a supervised job — tell your assistant AcqVault's study
          deck needs a review pass and it will re-verify each one against the new text.
    The deck itself is never auto-edited; this is an alarm, not a mutation."""
    if not DECK_PATH.exists():
        return {"skipped": "no study deck"}
    deck = json.loads(DECK_PATH.read_text())

    # resolution sets from the refreshed corpus
    rfo_sections = {d["title"].split()[0] for d in final_rfo}                       # "6.103", "15.404-1", …
    rfo_subparts = {d["title"].split()[1] for d in final_rfo if d["title"].startswith("Subpart ")}
    rfo_parts = {str(d["part"]) for d in final_rfo}
    rd_docs = [d for d in all_docs if d.get("source") == "r-dfars"]
    rd_tokens = set()
    for d in rd_docs:
        for w in d["title"].replace("—", " ").split():
            if w and w[0].isdigit():
                rd_tokens.add(w.rstrip(".,"))

    def rfo_resolves(sec):
        if sec in rfo_sections or sec in rfo_subparts:
            return True
        base = sec.split("-")[0]                       # 6.103-1 → 6.103
        if base in rfo_sections or base in rfo_subparts:
            return True
        return sec.split(".")[0] in rfo_parts          # last resort: the part still exists

    def rd_resolves(sec):
        if any(t == sec or t.startswith(sec + ".") for t in rd_tokens):
            return True
        return any(t.startswith(sec) for t in rd_tokens)  # "217.74" ← "217.7401" etc.

    modified_secs = {d["title"].split()[0] for d in modified}
    modified_parts = {str(d["part"]) for d in modified}

    broken, review = {}, {}
    for kind, item_id, topic, text in _deck_texts(deck):
        for m in DECK_CITE_RE.finditer(text or ""):
            book, part_no, sec = m.group(1), m.group(2), m.group(3)
            label = "{} {}".format(book, "Part " + part_no if part_no else sec)
            # (a) does the cite still resolve?
            ok = True
            if book == "RFO":
                ok = (part_no in rfo_parts) if part_no else rfo_resolves(sec)
            else:
                ok = rd_resolves(part_no or sec)
            if not ok:
                broken.setdefault(label, set()).add("{}:{}".format(kind, item_id))
            # (b) does the cite touch a section this run modified?
            if book == "RFO" and modified:
                hit = (part_no and part_no in modified_parts) or \
                      (sec and (sec in modified_secs or sec.split("-")[0] in modified_secs))
                if hit:
                    review.setdefault("{}:{}".format(kind, item_id), set()).add(label)

    broken_out = {k: sorted(v) for k, v in sorted(broken.items())}
    review_out = {k: sorted(v) for k, v in sorted(review.items())}
    if broken_out or review_out:
        print("\n⚠ STUDY DECK WATCH (assets/study-deck.json)")
        if broken_out:
            print("  Deck citations that no longer resolve in the corpus (fix the questions):")
            for c, items in list(broken_out.items())[:12]:
                print("    · {}  ({} item{}: {})".format(c, len(items), "s" if len(items) != 1 else "", ", ".join(items[:4])))
        if review_out:
            print("  Deck items citing sections MODIFIED this run — supervised review needed:")
            for item, cites in list(review_out.items())[:15]:
                print("    · {}  cites {}".format(item, ", ".join(cites)))
            if len(review_out) > 15:
                print("    · … and {} more (full list in refresh-report.json)".format(len(review_out) - 15))
        print("  → Reviewing flagged questions is a supervised job — tell your assistant the")
        print("    study deck needs a review pass; it will re-verify each against the new text.")
    else:
        print("\n✓ STUDY DECK WATCH: all deck citations resolve; no flagged questions this run.")
    return {"broken_deck_cites": broken_out, "review_items": review_out}


# ── documents.json merge + ship ───────────────────────────────────────────────

def load_docs():
    return json.loads(DOCS_PATH.read_text())


def write_docs(all_docs):
    DOCS_PATH.write_text(json.dumps(all_docs, ensure_ascii=False))


def merge_rfo(all_docs, new_rfo):
    """Replace the rfo block in place, preserving overall source order."""
    out, inserted = [], False
    for d in all_docs:
        if d["source"] == "rfo":
            if not inserted:
                out.extend(sorted(new_rfo, key=lambda x: int(x["part"])))
                inserted = True
            continue
        out.append(d)
    if not inserted:
        out = sorted(new_rfo, key=lambda x: int(x["part"])) + out
    return out


def bump_service_worker():
    sw = BASE_DIR / "sw.js"
    text = sw.read_text()
    m = re.search(r"acqvault-v(\d+)", text)
    if not m:
        print("  ⚠ could not find cache version in sw.js — bump it manually")
        return None
    new = "acqvault-v{}".format(int(m.group(1)) + 1)
    sw.write_text(text.replace(m.group(0), new))
    return new


def update_hero_count(total):
    idx = BASE_DIR / "index.html"
    text = idx.read_text()
    new_text = re.sub(r"<strong>[\d,]+</strong> indexed sections",
                      "<strong>{:,}</strong> indexed sections".format(total), text)
    if new_text != text:
        idx.write_text(new_text)


def append_changes_log(entry):
    log = json.loads(CHANGES_LOG.read_text()) if CHANGES_LOG.exists() else []
    log.append(entry)
    CHANGES_LOG.write_text(json.dumps(log, ensure_ascii=False, indent=1))


def ship(summary_line):
    print("\nShipping…")
    subprocess.run([sys.executable, str(BASE_DIR / "scripts" / "gen_doc_hashes.py")],
                   cwd=str(BASE_DIR), check=True)
    new_cache = bump_service_worker()
    if new_cache:
        print("  service worker cache → " + new_cache)
    files = ["output/documents.json", "output/doc-hashes.json", "output/corpus-meta.json",
             "output/changes-log.json", "output/refresh-report.json", "sw.js", "index.html"]
    subprocess.run(["git", "add"] + files, cwd=str(BASE_DIR), check=True)
    subprocess.run(["git", "commit",
                    "--author=AcqVault <287015657+AcqVault@users.noreply.github.com>",
                    "-m", summary_line], cwd=str(BASE_DIR), check=True)
    subprocess.run(["git", "push"], cwd=str(BASE_DIR), check=True)
    print("  pushed. Vercel will deploy in ~1 minute.")


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="Refresh the AcqVault corpus from acquisition.gov")
    ap.add_argument("--dry-run", action="store_true", help="report only; never write")
    ap.add_argument("--yes", action="store_true", help="apply + commit + push without prompting")
    ap.add_argument("--check", action="store_true", help="fast upstream freshness probe only")
    args = ap.parse_args()

    print("AcqVault refresh — " + datetime.now().strftime("%Y-%m-%d %H:%M"))
    print("=" * 62)

    rd_msg, rd_changed = check_rdfars()
    print("R-DFARS: " + rd_msg)
    fc_msg, fc_changed = check_static_pdf(
        "FAR Companion", SITE + "/sites/default/files/page_file_uploads/far-companion.pdf",
        "FAR Companion/*.pdf", download=not args.check)
    cm_msg, cm_changed = check_static_pdf(
        "Category Mgmt", SITE + "/sites/default/files/page_file_uploads/category-management-buying-guide.pdf",
        "Category Management/*.pdf", download=not args.check)
    print(fc_msg)
    print(cm_msg)
    if (rd_changed or fc_changed or cm_changed) and not args.check:
        print("  → NOTE: new source PDFs are downloaded locally, but re-extracting them into")
        print("    the searchable corpus is a supervised job — tell your assistant AcqVault")
        print("    needs updating and it will extract, parity-validate, and ship them.")
    if rd_changed and not args.check:
        print("  → pulling the new/changed DoD memos via fetch_dod_deviations.py …")
        try:
            subprocess.run([sys.executable, str(BASE_DIR / "fetch_dod_deviations.py")],
                           cwd=str(BASE_DIR), check=True)
            print("  → memos downloaded into R-DFARS/.")
        except Exception as e:  # noqa: BLE001
            print("  ⚠ memo download failed ({}) — R-DFARS files left untouched".format(e))

    if args.check:
        lm, _ = head_info(SITE + "/sites/default/files/page_file_uploads/RFO.pdf")
        print("RFO upstream PDF last-modified: {} (proxy signal — full diff needs a normal run)".format(lm or "?"))
        return

    all_docs = load_docs()
    existing_rfo = [d for d in all_docs if d["source"] == "rfo"]
    final_rfo, added, modified, removed = refresh_rfo(existing_rfo)

    unchanged = len(final_rfo) - len(added) - len(modified)
    print("\nRFO diff vs current corpus")
    print("  unchanged : {}".format(unchanged))
    print("  modified  : {}".format(len(modified)))
    print("  added     : {}".format(len(added)))
    print("  removed   : {}".format(len(removed)))

    def brief(docs, cap=12):
        for d in docs[:cap]:
            print("    · Part {:>3}  {}".format(d["part"], d["title"][:80]))
        if len(docs) > cap:
            print("    · … and {} more".format(len(docs) - cap))
    if modified:
        print("  Modified sections:")
        brief(modified)
    if added:
        print("  New sections:")
        brief(added)
    if removed:
        print("  Removed sections:")
        brief(removed)

    watch = threshold_watch(existing_rfo, final_rfo, modified)
    deck_watch = study_deck_watch(final_rfo, all_docs, modified)

    report = {
        "run_at": now_iso(),
        "threshold_watch": watch,
        "study_deck_watch": deck_watch,
        "rfo": {
            "unchanged": unchanged,
            "modified": [{"id": d["id"], "part": d["part"], "title": d["title"]} for d in modified],
            "added": [{"id": d["id"], "part": d["part"], "title": d["title"]} for d in added],
            "removed": [{"id": d["id"], "part": d["part"], "title": d["title"]} for d in removed],
        },
        "r_dfars": rd_msg, "far_companion": fc_msg, "category_management": cm_msg,
    }

    if not (added or modified or removed):
        print("\n✓ RFO corpus is already current — nothing to apply.")
        if not args.dry_run:
            REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=1))
        return

    if args.dry_run:
        print("\n(dry run — nothing written)")
        return

    if not args.yes:
        answer = input("\nApply to corpus AND commit+push? [y/N] ").strip().lower()
        if answer != "y":
            print("Not applied. Re-run with --yes or answer y when ready.")
            return

    merged = merge_rfo(all_docs, final_rfo)
    write_docs(merged)
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=1))
    append_changes_log(report)
    update_hero_count(len(merged) - sum(1 for d in merged if d["source"] == "compass"))
    summary = "Corpus refresh: RFO {} modified / {} added / {} removed".format(
        len(modified), len(added), len(removed))
    ship(summary)
    print("\n✓ Done: " + summary)


if __name__ == "__main__":
    main()
