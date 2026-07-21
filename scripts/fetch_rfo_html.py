#!/usr/bin/env python3
"""
Fetch the RFO part pages from acquisition.gov and cache them on disk.

The corpus was built from RFO.pdf, and pdfplumber's text extraction loses two
things the HTML keeps: the paragraph tiering (published as ListL1/ListL2/… classes,
which is exactly the L0:/L1:/L2: depth the corpus wants) and every table, which
extract_text() walks cell by cell and flattens into prose. The HTML is the same
text from the same publisher, structured.

Fetching is separated from parsing on purpose: the pages land in a local cache and
every later parsing run reads that cache, so iterating on the parser never touches
their servers again.

Politeness: one request at a time, a real delay between them, an identifying
User-Agent, and a skip for anything already cached. robots.txt allows
/far-overhaul/ (checked 2026-07-21) and sets no crawl-delay; the delay below is
ours, not theirs.

Usage:
    python3 scripts/fetch_rfo_html.py            # fetch anything not cached
    python3 scripts/fetch_rfo_html.py --refresh  # re-fetch everything
"""

import re
import sys
import time
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
CACHE = BASE / "_local_archive" / "rfo-html"
SITE = "https://www.acquisition.gov"
INDEX = f"{SITE}/far-overhaul/far-part-deviation-guide"
UA = "Mozilla/5.0 (compatible; AcqVault-corpus/1.0; +https://www.acqvault.com)"
DELAY_SECONDS = 1.5


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def main():
    refresh = "--refresh" in sys.argv
    CACHE.mkdir(parents=True, exist_ok=True)

    index_file = CACHE / "_index.html"
    if refresh or not index_file.exists():
        index_file.write_text(get(INDEX), encoding="utf-8")
        time.sleep(DELAY_SECONDS)
    index_html = index_file.read_text(encoding="utf-8")

    paths = sorted(
        set(re.findall(r'href="(/far-overhaul/far-part-deviation-guide/far-overhaul-part-\d+)"',
                       index_html)),
        key=lambda p: int(re.search(r"part-(\d+)$", p).group(1)),
    )
    print(f"{len(paths)} part pages listed on the deviation guide index")

    fetched = cached = 0
    for path in paths:
        part = re.search(r"part-(\d+)$", path).group(1)
        dest = CACHE / f"part-{part}.html"
        if dest.exists() and not refresh:
            cached += 1
            continue
        html = get(SITE + path)
        dest.write_text(html, encoding="utf-8")
        fetched += 1
        print(f"  part {part}: {len(html):,} bytes", flush=True)
        time.sleep(DELAY_SECONDS)

    print(f"\nfetched {fetched}, already cached {cached} -> {CACHE}")


if __name__ == "__main__":
    main()
