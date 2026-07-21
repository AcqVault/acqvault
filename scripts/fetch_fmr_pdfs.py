#!/usr/bin/env python3
"""
Fetch the FMR chapter PDFs so its tables can be recovered.

The FMR reached the corpus as PDF-extracted markdown and the source PDFs were never
kept, so its tables are flattened prose with no way back: 77 chapters carry 504
"Table N-N." captions followed by run-together header cells — "Table 6-1. Award Level
Matrix" and then "Organizational Level Award Level Performing the Work Headquarters".

comptroller.war.gov publishes each chapter as its own PDF under a predictable path,
so this fetches them into a local cache that scripts/attach_fmr_tables.py then reads.
Separated from extraction on purpose: parsing can be re-run any number of times
without touching their servers again.

Politeness: one request at a time, a real delay between them, an identifying
User-Agent, and a skip for anything already cached. robots.txt permits /Portals/
(checked 2026-07-22).

Usage:
    python3 scripts/fetch_fmr_pdfs.py            # fetch anything not cached
"""

import re
import sys
import time
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
CACHE = BASE / "_local_archive" / "fmr-pdf"
SITE = "https://comptroller.war.gov"
UA = "Mozilla/5.0 (compatible; AcqVault-corpus/1.0; +https://www.acqvault.com)"
DELAY_SECONDS = 1.2

# the corpus's volume labels, and the index page each one lives behind
VOLUMES = ["1", "2A", "2B", "3", "4", "5", "6A", "6B", "7A", "7B",
           "8", "9", "10", "11A", "11B", "12", "13", "14", "15", "16"]


def get(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        data = r.read()
    return data if binary else data.decode("utf-8", "replace")


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    fetched = cached = failed = 0

    for vol in VOLUMES:
        idx_url = f"{SITE}/FMR/vol{vol.lower()}_chapters/"
        try:
            html = get(idx_url)
        except Exception as e:
            print(f"  ! volume {vol} index: {e}")
            failed += 1
            continue
        time.sleep(DELAY_SECONDS)

        pdfs = sorted(set(re.findall(r'href="(/[Pp]ortals/45/documents/fmr/current/[^"]+\.pdf)"',
                                     html)))
        print(f"  volume {vol}: {len(pdfs)} chapter PDFs")
        for path in pdfs:
            name = f"{vol}__" + path.rsplit("/", 1)[-1]
            dest = CACHE / name
            if dest.exists():
                cached += 1
                continue
            try:
                dest.write_bytes(get(SITE + path, binary=True))
                fetched += 1
            except Exception as e:
                print(f"    ! {path}: {e}")
                failed += 1
            time.sleep(DELAY_SECONDS)

    print(f"\nfetched {fetched}, already cached {cached}, failed {failed} -> {CACHE}")


if __name__ == "__main__":
    main()
