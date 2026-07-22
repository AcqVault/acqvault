#!/usr/bin/env python3
"""Build the tiny lookup the in-app cross-reference links need.

WHY THIS EXISTS. linkifyXrefs() resolves a section number against a map built from
ACQ_INDEX — the whole 27 MB on-device corpus. But acqLoadCorpus() is only ever called
from the OFFLINE fallback paths, so for an online reader ACQ_INDEX is null,
buildXrefMap() returns null, and every in-app cross-reference silently renders as plain
text. The server-rendered pages had 87 working links on the same part where the app had
zero. Loading the full corpus just to linkify would undo the performance work that
removed it from the boot path, so ship the ~200 KB of numbers instead.

    python3 scripts/gen_xref_index.py
"""
import json, re
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
LEAD = re.compile(r"^(?:PGI\s+)?(\d{1,3}\.\d{1,6}(?:-\d+)*)\b")
SOURCES = ("rfo", "r-dfars", "pgi")

docs = json.loads((BASE / "output/documents.json").read_text(encoding="utf-8"))
tables = {s: {} for s in SOURCES}
for d in docs:
    if d.get("source") not in SOURCES:
        continue
    m = LEAD.match((d.get("title") or "").strip())
    if not m:
        continue
    t = tables[d["source"]]
    prev = t.get(m[1])
    # Same preference as the renderers: real text beats [Reserved], longer beats shorter,
    # so a clause number resolves to the substantive copy and not a header-only stub.
    reserved = "[reserved]" in (d.get("title") or "").lower()
    entry = [d["id"], str(d.get("part")), len(d.get("content") or ""), reserved]
    if prev and not (prev[3] and not reserved) and prev[2] >= entry[2]:
        continue
    t[m[1]] = entry
out = {s: {k: [v[0], v[1]] for k, v in sorted(t.items())} for s, t in tables.items()}
p = BASE / "output" / "xref-index.json"
p.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"wrote {p.relative_to(BASE)}: " + ", ".join(f"{s} {len(out[s])}" for s in SOURCES)
      + f"  ({p.stat().st_size // 1024} KB)")
