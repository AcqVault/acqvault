#!/usr/bin/env python3
"""Generate two small client-side manifests from output/documents.json:

  output/doc-hashes.json   {id: contentHash}  — powers "your saved clause changed"
                           detection (assets/saved.js) without re-loading the ~13MB corpus.
  output/corpus-meta.json  freshness/provenance — powers the per-result "as of" stamps
                           and the auto-amber staleness banner (assets/app.js).

Run this AFTER extract_documents.py regenerates output/documents.json (and before deploy):
    python3 scripts/gen_doc_hashes.py
When a clause's content changes between builds its hash changes (a pinned-it user sees an
"Updated" flag); the client treats doc-hashes.json as the single source of truth, so the
hash algorithm here does NOT need to be mirrored in JavaScript.

Hash = first 12 hex chars of SHA-1 over the UTF-8 content (48 bits; ample for change
detection — we only ever compare hashes for the SAME id across builds)."""
import json
import hashlib
import os
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "output", "documents.json")
HASH_OUT = os.path.join(ROOT, "output", "doc-hashes.json")
META_OUT = os.path.join(ROOT, "output", "corpus-meta.json")


def content_hash(content):
    return hashlib.sha1((content or "").encode("utf-8")).hexdigest()[:12]


def main():
    with open(SRC, encoding="utf-8") as f:
        docs = json.load(f)
    docs = [d for d in docs if d]
    # Mirror the site's corpus filters (api/search.js + assets/app.js exclude compass),
    # so doc_count / per-source counts describe what users can actually search.
    docs = [d for d in docs if d.get("source") != "compass"]

    # ── doc-hashes.json ────────────────────────────────────────────────────
    hashes = {}
    for d in docs:
        did = d.get("id")
        if did:
            hashes[did] = content_hash(d.get("content", ""))
    with open(HASH_OUT, "w", encoding="utf-8") as f:
        json.dump(hashes, f, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {HASH_OUT}: {len(hashes)} hashes, {os.path.getsize(HASH_OUT):,} bytes")

    # ── corpus-meta.json ───────────────────────────────────────────────────
    # ISO-8601 'Z' timestamps sort lexicographically, so string max == newest.
    sources = {}
    newest_overall = ""
    for d in docs:
        src = d.get("source") or "unknown"
        ia = d.get("indexed_at") or ""
        s = sources.setdefault(src, {"count": 0, "newest_indexed_at": ""})
        s["count"] += 1
        if ia > s["newest_indexed_at"]:
            s["newest_indexed_at"] = ia
        if ia > newest_overall:
            newest_overall = ia
    meta = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "doc_count": len(docs),
        "newest_indexed_at": newest_overall,
        "sources": sources,
    }
    with open(META_OUT, "w", encoding="utf-8") as f:
        json.dump(meta, f, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {META_OUT}: {meta['doc_count']} docs, newest indexed {newest_overall}")


if __name__ == "__main__":
    main()
