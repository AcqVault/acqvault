#!/usr/bin/env python3
"""Generate output/doc-hashes.json — a compact {id: contentHash} manifest powering
the client-side "your saved clause changed" detection (see assets/saved.js).

Why a separate file: the client can fetch this (~200KB) to check whether any pinned
clause's text has changed, instead of re-loading the full ~13MB documents.json corpus.

Run this AFTER extract_documents.py regenerates output/documents.json (and before deploy):
    python3 scripts/gen_doc_hashes.py
When a clause's content changes between builds, its hash changes, and a user who pinned
it sees an "Updated" flag. The client treats this file as the single source of truth, so
the hash algorithm here does NOT need to be mirrored in JavaScript.

Hash = first 12 hex chars of SHA-1 over the UTF-8 content (48 bits; ample for change
detection — we only ever compare hashes for the SAME id across builds)."""
import json
import hashlib
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "output", "documents.json")
OUT = os.path.join(ROOT, "output", "doc-hashes.json")


def content_hash(content):
    return hashlib.sha1((content or "").encode("utf-8")).hexdigest()[:12]


def main():
    with open(SRC, encoding="utf-8") as f:
        docs = json.load(f)
    hashes = {}
    for d in docs:
        if not d:
            continue
        did = d.get("id")
        if not did:
            continue
        hashes[did] = content_hash(d.get("content", ""))
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(hashes, f, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {OUT}: {len(hashes)} hashes, {os.path.getsize(OUT):,} bytes")


if __name__ == "__main__":
    main()
