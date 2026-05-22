"""
AcqVault — R-DFARS DoD Deviation Downloader
============================================
Scrapes https://www.acquisition.gov/far-overhaul/far-part-deviation-guide
and downloads all DoD-specific deviation PDFs.

Rerun monthly to pick up new/updated deviations.

Requirements:
    pip install requests beautifulsoup4

Usage:
    python fetch_dod_deviations.py

Output:
    ./r-dfars/                  Downloaded PDFs
    ./r-dfars/_manifest.json    Metadata for each file (part, url, date, size)
"""

import json
import re
import time
from datetime import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ── Config ────────────────────────────────────────────────────────────────────

BASE_URL  = "https://www.acquisition.gov"
PAGE_URL  = f"{BASE_URL}/far-overhaul/far-part-deviation-guide"
OUT_DIR   = Path("r-dfars")
HEADERS   = {"User-Agent": "AcqVault/1.0 (acquisition research tool; contact acqvault.com)"}
DELAY_SEC = 0.6   # polite delay between downloads

# ── Helpers ───────────────────────────────────────────────────────────────────

def full_url(href: str) -> str:
    return href if href.startswith("http") else BASE_URL + href


def part_number_from_url(url: str):
    """Extract FAR part number(s) from the PDF filename, e.g. 'Part-6' → '6'."""
    m = re.search(r"Part[_-](\d+)", url, re.IGNORECASE)
    return m.group(1) if m else None


def kb(n_bytes: int) -> str:
    return f"{n_bytes // 1024} KB"

# ── Main ──────────────────────────────────────────────────────────────────────

def scrape_dod_links(html: str) -> list[dict]:
    """Return list of {label, url, part} dicts for every DoD deviation PDF."""
    soup = BeautifulSoup(html, "html.parser")
    results = []

    for a in soup.find_all("a", href=True):
        href = a["href"]
        # Only DoD PDFs — skip other agencies
        if not href.endswith(".pdf"):
            continue
        filename = href.split("/")[-1]
        if not filename.startswith("DoD_"):
            continue

        url   = full_url(href)
        label = a.get_text(strip=True) or filename
        part  = part_number_from_url(filename)

        results.append({"label": label, "url": url, "filename": filename, "part": part})

    # Deduplicate by URL (same PDF sometimes linked more than once)
    seen = set()
    unique = []
    for r in results:
        if r["url"] not in seen:
            seen.add(r["url"])
            unique.append(r)

    return sorted(unique, key=lambda x: int(x["part"] or 0))


def download_all(dod_links: list[dict]) -> list[dict]:
    OUT_DIR.mkdir(exist_ok=True)
    manifest = []

    for item in dod_links:
        out_path = OUT_DIR / item["filename"]
        entry = {
            "filename": item["filename"],
            "part":     item["part"],
            "url":      item["url"],
            "fetched":  None,
            "size_kb":  None,
            "status":   None,
        }

        # Skip if already downloaded (re-run safe)
        if out_path.exists():
            entry["status"]  = "exists"
            entry["size_kb"] = out_path.stat().st_size // 1024
            print(f"  ↩  SKIP  Part {item['part']:>3}  {item['filename']}")
            manifest.append(entry)
            continue

        print(f"  ↓  GET   Part {item['part']:>3}  {item['filename']} … ", end="", flush=True)
        try:
            r = requests.get(item["url"], headers=HEADERS, timeout=60)
            r.raise_for_status()
            out_path.write_bytes(r.content)
            entry["status"]  = "downloaded"
            entry["fetched"] = datetime.utcnow().isoformat() + "Z"
            entry["size_kb"] = len(r.content) // 1024
            print(f"{kb(len(r.content))}")
        except requests.HTTPError as e:
            entry["status"] = f"http_error:{e.response.status_code}"
            print(f"HTTP {e.response.status_code}")
        except Exception as e:
            entry["status"] = f"error:{e}"
            print(f"ERROR — {e}")

        manifest.append(entry)
        time.sleep(DELAY_SEC)

    return manifest


def main():
    print("=" * 60)
    print("AcqVault — R-DFARS DoD Deviation Downloader")
    print(f"Target : {PAGE_URL}")
    print(f"Output : {OUT_DIR.resolve()}")
    print("=" * 60)

    # 1. Fetch the deviation guide index page
    print("\n[1/3] Fetching deviation guide index …")
    resp = requests.get(PAGE_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    print(f"      OK ({kb(len(resp.content))})")

    # 2. Parse all DoD PDF links
    print("\n[2/3] Parsing DoD deviation links …")
    dod_links = scrape_dod_links(resp.text)
    print(f"      Found {len(dod_links)} DoD deviation PDF(s)")
    for item in dod_links:
        print(f"        Part {(item['part'] or '?'):>3}  {item['filename']}")

    if not dod_links:
        print("\n  No DoD PDFs found — check if the page structure has changed.")
        return

    # 3. Download
    print(f"\n[3/3] Downloading to ./{OUT_DIR}/ …\n")
    manifest = download_all(dod_links)

    # 4. Write manifest
    manifest_path = OUT_DIR / "_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))

    # 5. Summary
    downloaded = sum(1 for m in manifest if m["status"] == "downloaded")
    skipped    = sum(1 for m in manifest if m["status"] == "exists")
    errors     = sum(1 for m in manifest if m["status"] not in ("downloaded", "exists"))

    print("\n" + "=" * 60)
    print(f"  Downloaded : {downloaded}")
    print(f"  Skipped    : {skipped}  (already on disk)")
    print(f"  Errors     : {errors}")
    print(f"  Manifest   : {manifest_path.resolve()}")
    print("=" * 60)

    if errors:
        print("\nFailed files:")
        for m in manifest:
            if m["status"] not in ("downloaded", "exists"):
                print(f"  {m['filename']}  →  {m['status']}")


if __name__ == "__main__":
    main()
