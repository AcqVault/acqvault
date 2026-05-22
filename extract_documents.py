"""
AcqVault — PDF Text Extractor & Meilisearch Document Builder
=============================================================
Extracts text from all three source collections and produces
a clean documents.json ready for Meilisearch bulk import.

Sources handled:
  RFO/           — single PDF, chunked by detected FAR Part sections
  FAR Companion/ — single PDF, chunked by detected FC Part sections
  R-DFARS/       — 46 individual PDFs, one document per file

Requirements:
    pip3 install pdfplumber

Usage:
    python3 extract_documents.py

Output:
    ./output/documents.json       All documents, Meilisearch-ready
    ./output/extract_report.json  Per-file stats and any warnings
"""

import json
import re
import hashlib
from pathlib import Path
from datetime import datetime, timezone

import pdfplumber

# ── Config ────────────────────────────────────────────────────────────────────

BASE_DIR   = Path(__file__).parent
OUTPUT_DIR = BASE_DIR / "output"

SOURCES = {
    "rfo": {
        "path":        BASE_DIR / "RFO",
        "label":       "Revolutionary FAR Overhaul",
        "source_key":  "rfo",
        "mode":        "single",        # one large PDF to chunk
        "chunk_regex": r"(?:^|\n)\s*(Part\s+\d+\b[^\n]{0,80})",
    },
    "far-companion": {
        "path":        BASE_DIR / "FAR Companion",
        "label":       "FAR Companion",
        "source_key":  "far-companion",
        "mode":        "single",
        "chunk_regex": r"(?:^|\n)\s*(FC\s+\d+[\.\d]*\b[^\n]{0,80}|FAR Companion[^\n]{0,60})",
    },
    "r-dfars": {
        "path":        BASE_DIR / "R-DFARS",
        "label":       "R-DFARS (DoD Deviations)",
        "source_key":  "r-dfars",
        "mode":        "multi",         # one PDF per part
    },
}

# Minimum characters to keep a chunk (filters out cover pages / blanks)
MIN_CHUNK_CHARS = 200

# ── Helpers ───────────────────────────────────────────────────────────────────

def make_id(*parts):
    """Stable, URL-safe document ID."""
    raw = "-".join(str(p) for p in parts).lower()
    raw = re.sub(r"[^a-z0-9\-]", "-", raw)
    raw = re.sub(r"-{2,}", "-", raw).strip("-")
    return raw


def extract_text_from_pdf(pdf_path):
    """Return full text string from a PDF using pdfplumber."""
    text_parts = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            t = page.extract_text()
            if t:
                text_parts.append(t)
    return "\n".join(text_parts)


def part_number_from_filename(filename):
    """Extract FAR part number from R-DFARS filename."""
    m = re.search(r"Part[_-](\d+)", filename, re.IGNORECASE)
    return m.group(1).lstrip("0") if m else None


def detect_status(text):
    """
    Best-effort status detection from document text.
    Returns one of: Interim, Proposed, Final, Open for comment, Class Deviation, Unknown
    """
    t = text[:2000].lower()
    if "class deviation" in t:
        return "Class Deviation"
    if "interim rule" in t or "interim final" in t:
        return "Interim rule"
    if "proposed rule" in t:
        return "Proposed"
    if "open for comment" in t or "comment period" in t:
        return "Open for comment"
    if "final rule" in t:
        return "Final"
    return "Unknown"


def detect_title(text, fallback):
    """Try to extract a meaningful title from the first 500 chars of text."""
    lines = [l.strip() for l in text[:600].splitlines() if len(l.strip()) > 10]
    # Return second non-trivial line (first is often "Department of Defense" etc.)
    for line in lines[:6]:
        if len(line) > 20 and not re.match(r"^(page|department|federal|dod|class)", line, re.I):
            return line[:120]
    return fallback


def clean_text(text):
    """Remove excessive whitespace and junk characters."""
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def chunk_single_pdf(text, chunk_regex, source_key, label, filename, pdf_path):
    """
    Split a large PDF's text into per-section documents using
    the section header regex. Falls back to page-block chunking
    if fewer than 3 sections are detected.
    """
    docs = []
    matches = list(re.finditer(chunk_regex, text, re.MULTILINE | re.IGNORECASE))

    if len(matches) >= 3:
        # Split on detected section headers
        for i, match in enumerate(matches):
            start = match.start()
            end   = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            chunk = clean_text(text[start:end])
            if len(chunk) < MIN_CHUNK_CHARS:
                continue

            header = match.group(1).strip()
            # Try to pull a part number from the header
            pn_match = re.search(r"\d+", header)
            part_num = pn_match.group(0) if pn_match else str(i + 1)

            doc_id = make_id(source_key, "part", part_num)
            docs.append({
                "id":           doc_id,
                "source":       source_key,
                "source_label": label,
                "part":         part_num,
                "title":        header[:120],
                "content":      chunk,
                "filename":     filename,
                "status":       detect_status(chunk),
                "indexed_at":   datetime.now(timezone.utc).isoformat(),
            })
    else:
        # Fallback: one document per ~3000-char block
        block_size = 3000
        blocks = [text[i:i + block_size] for i in range(0, len(text), block_size)]
        for idx, block in enumerate(blocks):
            block = clean_text(block)
            if len(block) < MIN_CHUNK_CHARS:
                continue
            doc_id = make_id(source_key, "block", str(idx + 1))
            docs.append({
                "id":           doc_id,
                "source":       source_key,
                "source_label": label,
                "part":         None,
                "title":        detect_title(block, f"{label} — Block {idx + 1}"),
                "content":      block,
                "filename":     filename,
                "status":       detect_status(block),
                "indexed_at":   datetime.now(timezone.utc).isoformat(),
            })

    return docs


def process_single_source(cfg):
    """Handle RFO and FAR Companion (one large PDF each)."""
    docs    = []
    report  = []
    pdfs    = sorted(cfg["path"].glob("*.pdf"))

    if not pdfs:
        print(f"  ⚠  No PDFs found in {cfg['path']}")
        return docs, report

    for pdf_path in pdfs:
        print(f"  → Extracting: {pdf_path.name}")
        try:
            text = extract_text_from_pdf(pdf_path)
            print(f"     {len(text):,} characters extracted")

            chunks = chunk_single_pdf(
                text,
                cfg["chunk_regex"],
                cfg["source_key"],
                cfg["label"],
                pdf_path.name,
                pdf_path,
            )
            print(f"     {len(chunks)} sections/chunks produced")
            docs.extend(chunks)
            report.append({
                "file":     pdf_path.name,
                "source":   cfg["source_key"],
                "chars":    len(text),
                "docs":     len(chunks),
                "status":   "ok",
            })
        except Exception as e:
            print(f"  ✗  Error: {e}")
            report.append({"file": pdf_path.name, "source": cfg["source_key"], "status": f"error: {e}"})

    return docs, report


def process_multi_source(cfg):
    """Handle R-DFARS — one document per PDF file."""
    docs   = []
    report = []
    pdfs   = sorted(cfg["path"].glob("*.pdf"))

    if not pdfs:
        print(f"  ⚠  No PDFs found in {cfg['path']}")
        return docs, report

    for pdf_path in pdfs:
        part_num = part_number_from_filename(pdf_path.name)
        print(f"  → Part {(part_num or '?'):>3}  {pdf_path.name}")
        try:
            text = extract_text_from_pdf(pdf_path)
            text = clean_text(text)

            if len(text) < MIN_CHUNK_CHARS:
                print(f"       ⚠  Very little text extracted — may be scanned PDF")
                report.append({"file": pdf_path.name, "source": cfg["source_key"],
                                "chars": len(text), "docs": 0, "status": "warn:low_text"})
                continue

            doc_id = make_id(cfg["source_key"], "part", part_num or pdf_path.stem)
            title  = detect_title(text, f"DoD Deviation — FAR Part {part_num}")

            docs.append({
                "id":           doc_id,
                "source":       cfg["source_key"],
                "source_label": cfg["label"],
                "part":         part_num,
                "title":        title,
                "content":      text,
                "filename":     pdf_path.name,
                "status":       detect_status(text),
                "indexed_at":   datetime.now(timezone.utc).isoformat(),
            })
            report.append({
                "file":   pdf_path.name,
                "source": cfg["source_key"],
                "part":   part_num,
                "chars":  len(text),
                "docs":   1,
                "status": "ok",
            })
        except Exception as e:
            print(f"       ✗  Error: {e}")
            report.append({"file": pdf_path.name, "source": cfg["source_key"], "status": f"error: {e}"})

    return docs, report


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    OUTPUT_DIR.mkdir(exist_ok=True)

    all_docs   = []
    all_report = []

    print("=" * 60)
    print("AcqVault — PDF Extraction & Document Builder")
    print(f"Output : {OUTPUT_DIR.resolve()}")
    print("=" * 60)

    for name, cfg in SOURCES.items():
        print(f"\n[{cfg['label']}]")
        if not cfg["path"].exists():
            print(f"  ⚠  Folder not found: {cfg['path']} — skipping")
            continue

        if cfg["mode"] == "single":
            docs, report = process_single_source(cfg)
        else:
            docs, report = process_multi_source(cfg)

        all_docs.extend(docs)
        all_report.extend(report)

    # ── Write outputs ─────────────────────────────────────────────────────────

    docs_path   = OUTPUT_DIR / "documents.json"
    report_path = OUTPUT_DIR / "extract_report.json"

    docs_path.write_text(json.dumps(all_docs, indent=2, ensure_ascii=False))
    report_path.write_text(json.dumps(all_report, indent=2, ensure_ascii=False))

    # ── Summary ───────────────────────────────────────────────────────────────

    ok     = sum(1 for r in all_report if r["status"] == "ok")
    warns  = sum(1 for r in all_report if "warn"  in r.get("status", ""))
    errors = sum(1 for r in all_report if "error" in r.get("status", ""))

    by_source = {}
    for d in all_docs:
        by_source[d["source"]] = by_source.get(d["source"], 0) + 1

    print("\n" + "=" * 60)
    print(f"  Total documents : {len(all_docs)}")
    for src, count in by_source.items():
        print(f"    {src:<20} {count} docs")
    print(f"  Files OK        : {ok}")
    print(f"  Warnings        : {warns}")
    print(f"  Errors          : {errors}")
    print(f"\n  documents.json  → {docs_path.resolve()}")
    print(f"  extract_report  → {report_path.resolve()}")
    print("=" * 60)

    if warns or errors:
        print("\nFiles needing attention:")
        for r in all_report:
            if r["status"] != "ok":
                print(f"  {r['file']}  →  {r['status']}")


if __name__ == "__main__":
    main()
