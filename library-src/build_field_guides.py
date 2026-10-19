#!/usr/bin/env python3
"""Rebuild and lock the AcqVault Field Guide PDFs from their HTML sources.

Usage (from the repo root):
    python3 library-src/build_field_guides.py 1        # Vol. 1 only
    python3 library-src/build_field_guides.py 1 2      # several volumes
    python3 library-src/build_field_guides.py 1 --no-lock   # unlocked draft in /tmp for proofing

Pipeline per volume
  1. Headless Chrome prints library-src/field-guide-vol-N/index.html (CSS @page = US Letter).
  2. TOC page numbers: the TOC entries are internal links; we read where Chrome's
     link annotations land (PyMuPDF), write the numbers into a temp copy of the HTML,
     and print again. Placeholders are fixed-width so pagination doesn't shift.
  3. Running footers ("Page X of N") are rendered by Chrome from a generated
     footer sheet and stamped onto every page except the cover (PyMuPDF overlay).
  4. Lock (pypdf): AES-256, empty user password (opens freely), print + copy
     allowed, modify/annotate denied. The owner password is random and is
     deliberately never printed or stored.

Requires: Google Chrome, Python packages `pymupdf` (fitz) and `pypdf`.
Verify the lock afterwards with:  pdfinfo pdfs/acqvault-field-guide-vol-N.pdf
"""
import argparse, html, os, re, secrets, shutil, subprocess, sys, tempfile
from pathlib import Path

import fitz  # PyMuPDF
from pypdf import PdfReader, PdfWriter
from pypdf.constants import UserAccessPermissions as P

ROOT = Path(__file__).resolve().parent.parent
CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")

# One entry per volume.
VOLUMES = {
    "1": dict(
        src=ROOT / "library-src/field-guide-vol-1/index.html",
        out=ROOT / "pdfs/acqvault-field-guide-vol-1.pdf",
        title="AcqVault Field Guide — Vol. 1: Contracting Foundations",
        footer_left="AcqVault · Air Force Contracting · Vol. 1 — The Basics",
        footer_right="acqvault.com · verify against the RFO / R-DFARS",
        toc_page=3,          # 1-based page holding the TOC links
        no_footer_pages=1,   # cover
    ),
    "2": dict(
        src=ROOT / "library-src/field-guide-vol-2/index.html",
        out=ROOT / "pdfs/acqvault-field-guide-vol-2.pdf",
        title="AcqVault Field Guide — Vol. 2: The Unlimited Warrant Board",
        footer_left="AcqVault · Air Force Contracting · Vol. 2 — The Unlimited Warrant Board",
        footer_right="acqvault.com · verify against the RFO / R-DFARS",
        toc_page=3,
        toc_by_id=True,      # two-column TOC
        no_footer_pages=1,
    ),
}

FOOTER_CSS = """
@font-face{font-family:'Inter';font-weight:100 900;src:url(%(fonts)s/inter-latin.woff2) format('woff2');}
@page{size:letter;margin:0}
html,body{margin:0;-webkit-print-color-adjust:exact}
.pg{height:11in;width:8.5in;position:relative;break-after:page;overflow:hidden}
.f{position:absolute;left:.62in;right:.62in;bottom:.42in;border-top:1px solid #d6dde6;padding-top:5pt;
   display:flex;justify-content:space-between;font:6.4pt/1 'Inter',sans-serif;color:#7b8594}
.f b{color:#2e4d78;font-weight:600}
"""


def chrome_pdf(html_path: Path, pdf_path: Path):
    cmd = [CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
           "--allow-file-access-from-files", "--run-all-compositor-stages-before-draw",
           "--virtual-time-budget=10000", f"--print-to-pdf={pdf_path}", html_path.as_uri()]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not pdf_path.exists():
        sys.exit(f"Chrome produced no PDF for {html_path}")


def toc_numbers(pdf_path: Path, toc_page: int):
    """Target page (1-based) of each internal link on the TOC page, top to bottom."""
    with fitz.open(pdf_path) as doc:
        links = [l for l in doc[toc_page - 1].get_links() if l["kind"] in (fitz.LINK_GOTO, fitz.LINK_NAMED) and l.get("page", -1) >= 0]
        links.sort(key=lambda l: (round(l["from"].y0), l["from"].x0))
        return [l["page"] + 1 for l in links]


def toc_targets(pdf_path: Path, toc_page: int):
    """{anchor id: target page} for TOC links (Chrome keeps the #id as the named destination)."""
    with fitz.open(pdf_path) as doc:
        return {l["nameddest"]: l["page"] + 1 for l in doc[toc_page - 1].get_links()
                if l.get("nameddest") and l.get("page", -1) >= 0}


def fill_toc_by_id(src_html: str, targets: dict):
    """Fill each <a href="#id">…<span class="p"> by its anchor id — safe for multi-column TOCs,
    where visual (top-to-bottom) order differs from document order."""
    missing = []
    def sub(m):
        if m.group(2) not in targets:
            missing.append(m.group(2)); return m.group(0)
        return f"{m.group(1)}{targets[m.group(2)]}{m.group(3)}"
    out = re.sub(r'(<a href="#([^"]+)"[^>]*>(?:(?!</a>).)*?<span class="p">)[^<]*(</span>)', sub, src_html, flags=re.S)
    if missing:
        sys.exit(f"TOC entries with no link target in the PDF: {missing}")
    return out


def fill_toc(src_html: str, numbers):
    it = iter(numbers)
    out, n = re.subn(r'(<span class="p">)[^<]*(</span>)', lambda m: f"{m.group(1)}{next(it)}{m.group(2)}", src_html)
    if n != len(numbers):
        sys.exit(f"TOC mismatch: {n} entries in HTML, {len(numbers)} links in PDF")
    return out


def stamp_footers(body_pdf: Path, out_pdf: Path, vol: dict, tmp: Path):
    with fitz.open(body_pdf) as doc:
        total = doc.page_count
        pages = []
        for i in range(1, total + 1):
            if i <= vol["no_footer_pages"]:
                pages.append('<div class="pg"></div>')
            else:
                pages.append(f'<div class="pg"><div class="f"><span><b>AcqVault</b> · {html.escape(vol["footer_left"].split(" · ", 1)[1])}</span>'
                             f'<span>Page {i} of {total} · {html.escape(vol["footer_right"])}</span></div></div>')
        fhtml = tmp / "footer.html"
        fhtml.write_text("<!doctype html><meta charset=utf-8><style>%s</style>%s" % (
            FOOTER_CSS % {"fonts": (ROOT / "assets/fonts").as_uri()}, "".join(pages)), encoding="utf-8")
        fpdf = tmp / "footer.pdf"
        chrome_pdf(fhtml, fpdf)
        with fitz.open(fpdf) as foot:
            if foot.page_count != total:
                sys.exit(f"footer sheet has {foot.page_count} pages, body has {total}")
            for i in range(vol["no_footer_pages"], total):
                doc[i].show_pdf_page(doc[i].rect, foot, i, overlay=True)
        doc.set_metadata({"title": vol["title"], "author": "AcqVault", "subject": "Training aid — verify against the RFO / R-DFARS"})
        doc.save(out_pdf, garbage=3, deflate=True)
    return total


def lock(src: Path, dst: Path, title: str):
    reader = PdfReader(src)
    writer = PdfWriter(clone_from=reader)
    writer.add_metadata({"/Title": title, "/Author": "AcqVault"})
    allowed = P.PRINT | P.PRINT_TO_REPRESENTATION | P.EXTRACT | P.EXTRACT_TEXT_AND_GRAPHICS
    # Owner password: random, never printed or saved — nobody can lift the lock later.
    writer.encrypt(user_password="", owner_password=secrets.token_urlsafe(32),
                   algorithm="AES-256", permissions_flag=allowed)
    with open(dst, "wb") as f:
        writer.write(f)


def build(key: str, do_lock: bool):
    vol = VOLUMES[key]
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        src = vol["src"]
        work_html = src.with_name(".build-index.html")   # same dir so relative asset paths resolve
        try:
            work_html.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
            pass1 = tmp / "pass1.pdf"
            chrome_pdf(work_html, pass1)
            if vol.get("toc_by_id"):   # multi-column TOC: match links to entries by anchor id
                targets = toc_targets(pass1, vol["toc_page"])
                work_html.write_text(fill_toc_by_id(src.read_text(encoding="utf-8"), targets), encoding="utf-8")
                nums = list(targets.values())
            else:
                nums = toc_numbers(pass1, vol["toc_page"])
                work_html.write_text(fill_toc(src.read_text(encoding="utf-8"), [str(n) for n in nums]), encoding="utf-8")
            pass2 = tmp / "pass2.pdf"
            chrome_pdf(work_html, pass2)
            again = list(toc_targets(pass2, vol["toc_page"]).values()) if vol.get("toc_by_id") else toc_numbers(pass2, vol["toc_page"])
            if again != nums:
                sys.exit("TOC numbers shifted between passes — check the TOC placeholders")
        finally:
            work_html.unlink(missing_ok=True)
        stamped = tmp / "stamped.pdf"
        total = stamp_footers(pass2, stamped, vol, tmp)
        if do_lock:
            lock(stamped, vol["out"], vol["title"])
            dest = vol["out"]
        else:
            dest = Path(tempfile.gettempdir()) / vol["out"].name.replace(".pdf", "-draft.pdf")
            shutil.copy(stamped, dest)
        print(f"Vol. {key}: {total} pages -> {dest}")
        print("  TOC:", " ".join(map(str, nums)))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("volumes", nargs="+", choices=sorted(VOLUMES))
    ap.add_argument("--no-lock", action="store_true", help="write an unlocked draft to the temp dir instead of pdfs/")
    a = ap.parse_args()
    for v in a.volumes:
        build(v, not a.no_lock)
