"""
AcqVault — Monthly PDF Generator
Fetches all documents from Meilisearch for each source, compiles them
in sequential part order, and generates clean PDFs with AcqVault watermark.

Run: python generate_pdfs.py
Requires: pip install fpdf2 requests
"""

import os
import requests
from datetime import datetime
from fpdf import FPDF

# ── CONFIG ────────────────────────────────────────────────────────────────────
MEILI_HOST = 'https://getmeilimeilisearchv190-production-a931.up.railway.app'
MEILI_KEY  = 'f68d1b50a6aa870ed16adce86770732894bb7c543b88f64385c2a321b7e8be73'
INDEX      = 'acqvault'

SOURCES = {
    'rfo':           'Revolutionary FAR Overhaul',
    'r-dfars':       'R-DFARS',
    'far-companion': 'FAR Companion',
}

OUTPUT_DIR = 'pdfs'
WATERMARK_TEXT = 'AcqVault.com'
SITE_URL = 'acqvault.com'


# ── FETCH ─────────────────────────────────────────────────────────────────────
def fetch_all_docs(source):
    """Fetch all documents for a source via paginated search."""
    docs   = []
    offset = 0
    limit  = 1000
    print(f'  Fetching {source}...', end='', flush=True)

    while True:
        res = requests.post(
            f'{MEILI_HOST}/indexes/{INDEX}/search',
            headers={
                'Authorization': f'Bearer {MEILI_KEY}',
                'Content-Type':  'application/json',
            },
            json={
                'q':      '',
                'filter': f'source = "{source}"',
                'limit':  limit,
                'offset': offset,
            },
            timeout=30,
        )
        res.raise_for_status()
        data = res.json()
        hits = data.get('hits', [])
        docs.extend(hits)
        print('.', end='', flush=True)

        if len(hits) < limit:
            break
        offset += limit

    print(f' {len(docs)} docs')
    return docs


def sort_docs(docs):
    """Sort documents by part number ascending."""
    def key(doc):
        try:
            return int(str(doc.get('part', '9999')).strip())
        except (ValueError, TypeError):
            return 9999
    return sorted(docs, key=key)


# ── PDF CLASS ─────────────────────────────────────────────────────────────────
class AcqVaultPDF(FPDF):
    def __init__(self, source_name, generated_date):
        super().__init__()
        self.source_name    = source_name
        self.generated_date = generated_date
        self.set_auto_page_break(auto=True, margin=22)
        self.set_margins(left=20, top=18, right=20)

    def header(self):
        self.set_font('Helvetica', '', 7)
        self.set_text_color(180, 180, 180)
        left  = f'{WATERMARK_TEXT} — AF Acquisition Research'
        right = self.source_name
        self.cell(0, 6, left, align='L', new_x='RIGHT', new_y='TOP')
        self.set_x(-20 - self.get_string_width(right))
        self.cell(self.get_string_width(right), 6, right, align='R')
        self.set_text_color(220, 220, 220)
        self.ln(4)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(3)

    def footer(self):
        self.set_y(-16)
        self.set_font('Helvetica', '', 7)
        self.set_text_color(180, 180, 180)
        footer_text = f'{SITE_URL}  |  Generated {self.generated_date}  |  Page {self.page_no()}'
        self.cell(0, 8, footer_text, align='C')


# ── COVER PAGE ────────────────────────────────────────────────────────────────
def add_cover(pdf, source_name, doc_count, generated_date):
    pdf.add_page()
    pdf.ln(30)

    # Logo / wordmark
    pdf.set_font('Helvetica', 'B', 32)
    pdf.set_text_color(10, 10, 10)
    pdf.cell(0, 14, WATERMARK_TEXT, align='C', new_x='LMARGIN', new_y='NEXT')

    pdf.set_font('Helvetica', '', 11)
    pdf.set_text_color(120, 120, 120)
    pdf.cell(0, 8, 'AF Acquisition Research', align='C', new_x='LMARGIN', new_y='NEXT')
    pdf.ln(10)

    # Divider
    pdf.set_draw_color(220, 220, 220)
    pdf.line(pdf.l_margin + 40, pdf.get_y(), pdf.w - pdf.r_margin - 40, pdf.get_y())
    pdf.ln(14)

    # Source name
    pdf.set_font('Helvetica', 'B', 22)
    pdf.set_text_color(10, 10, 10)
    pdf.cell(0, 12, source_name, align='C', new_x='LMARGIN', new_y='NEXT')
    pdf.ln(6)

    # Meta
    pdf.set_font('Helvetica', '', 10)
    pdf.set_text_color(150, 150, 150)
    pdf.cell(0, 7, f'Generated {generated_date}', align='C', new_x='LMARGIN', new_y='NEXT')
    pdf.cell(0, 7, f'{doc_count:,} documents indexed', align='C', new_x='LMARGIN', new_y='NEXT')
    pdf.ln(30)

    # Disclaimer
    pdf.set_font('Helvetica', '', 8.5)
    pdf.set_text_color(170, 170, 170)
    pdf.set_x(pdf.l_margin + 20)
    pdf.multi_cell(
        pdf.w - pdf.l_margin - pdf.r_margin - 40, 5.5,
        'This document is compiled from official U.S. government acquisition regulation '
        'sources and indexed by AcqVault.com for the Air Force contracting community. '
        'Content reflects the live Meilisearch index at time of generation. '
        f'Visit {SITE_URL} for the most current version and full-text search.',
        align='C',
    )


# ── CONTENT RENDERING ─────────────────────────────────────────────────────────
def safe_text(text):
    """Encode text for Latin-1 FPDF output."""
    if not text:
        return ''
    return text.encode('latin-1', errors='replace').decode('latin-1')


def render_doc(pdf, doc, is_first_in_part):
    """Render a single document's content into the PDF."""
    title    = safe_text(doc.get('title', 'Untitled'))
    content  = safe_text(doc.get('content', ''))
    status   = safe_text(doc.get('status', ''))
    filename = safe_text(doc.get('filename', ''))

    # Document title
    pdf.set_font('Helvetica', 'B', 11)
    pdf.set_text_color(20, 20, 20)
    pdf.multi_cell(0, 7, title)

    # Status + filename meta line
    meta_parts = []
    if status:   meta_parts.append(f'Status: {status}')
    if filename: meta_parts.append(f'File: {filename}')
    if meta_parts:
        pdf.set_font('Helvetica', 'I', 8)
        pdf.set_text_color(150, 150, 150)
        pdf.cell(0, 5, '  |  '.join(meta_parts), new_x='LMARGIN', new_y='NEXT')

    pdf.ln(3)

    # Content body
    if content:
        lines = content.split('\n')
        for line in lines:
            stripped = line.strip()
            if not stripped:
                pdf.ln(2)
                continue

            # PART header
            if stripped.upper().startswith('PART ') and len(stripped) < 140:
                pdf.set_font('Helvetica', 'B', 10)
                pdf.set_text_color(10, 10, 10)
                pdf.multi_cell(0, 6, stripped)
                pdf.ln(1)
            # Subpart
            elif stripped.lower().startswith('subpart ') and len(stripped) < 140:
                pdf.set_font('Helvetica', 'B', 9.5)
                pdf.set_text_color(30, 30, 30)
                pdf.multi_cell(0, 6, stripped)
            # Section number (e.g. "19.102 Title")
            elif len(stripped) < 220 and stripped[:1].isdigit() and '.' in stripped[:8]:
                pdf.set_font('Helvetica', 'B', 9)
                pdf.set_text_color(40, 40, 40)
                pdf.multi_cell(0, 6, stripped)
            # Paragraph (a)(1)(i)(A)
            elif stripped.startswith('('):
                indent = 0
                if stripped[:2] in ('(a','(b','(c','(d','(e','(f','(g','(h'):
                    indent = 8
                elif stripped[:2] in ('(1','(2','(3','(4','(5','(6','(7','(8','(9'):
                    indent = 16
                elif stripped[:3] in ('(i)','(ii','(ii','(iv','(v)','(vi'):
                    indent = 24
                elif stripped[:2] in ('(A','(B','(C','(D','(E','(F'):
                    indent = 32
                pdf.set_font('Helvetica', '', 9)
                pdf.set_text_color(70, 70, 70)
                pdf.set_x(pdf.l_margin + indent)
                pdf.multi_cell(pdf.w - pdf.l_margin - pdf.r_margin - indent, 5.5, stripped)
            # All-caps header
            elif stripped == stripped.upper() and len(stripped) > 3 and len(stripped) < 80 and any(c.isalpha() for c in stripped):
                pdf.set_font('Helvetica', 'B', 9)
                pdf.set_text_color(40, 40, 40)
                pdf.multi_cell(0, 6, stripped)
            # Regular text
            else:
                pdf.set_font('Helvetica', '', 9)
                pdf.set_text_color(70, 70, 70)
                pdf.multi_cell(0, 5.5, stripped)

    pdf.ln(8)
    # Separator between docs
    pdf.set_draw_color(235, 235, 235)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
    pdf.ln(6)


# ── GENERATE ──────────────────────────────────────────────────────────────────
def generate_pdf(source, source_name, docs):
    generated_date = datetime.now().strftime('%B %d, %Y')
    pdf = AcqVaultPDF(source_name, generated_date)

    add_cover(pdf, source_name, len(docs), generated_date)

    current_part = None
    for doc in docs:
        part = str(doc.get('part', '')).strip()
        is_new_part = (part != current_part)

        if is_new_part:
            pdf.add_page()
            current_part = part

            # Part header band
            pdf.set_font('Helvetica', 'B', 13)
            pdf.set_text_color(10, 10, 10)
            pdf.cell(0, 10, f'PART {part}', new_x='LMARGIN', new_y='NEXT')
            pdf.set_draw_color(10, 10, 10)
            pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
            pdf.ln(6)

        render_doc(pdf, doc, is_new_part)

    return pdf


# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f'AcqVault PDF Generator — {datetime.now().strftime("%B %d, %Y")}\n')

    for source, source_name in SOURCES.items():
        print(f'[{source_name}]')
        try:
            docs = fetch_all_docs(source)
            if not docs:
                print(f'  No documents found — skipping.\n')
                continue

            docs = sort_docs(docs)
            print(f'  Generating PDF...')
            pdf = generate_pdf(source, source_name, docs)

            out_path = os.path.join(OUTPUT_DIR, f'{source}.pdf')
            pdf.output(out_path)
            size_kb = os.path.getsize(out_path) / 1024
            print(f'  Saved: {out_path} ({size_kb:.0f} KB)\n')

        except Exception as e:
            print(f'  ERROR: {e}\n')

    print('Done.')


if __name__ == '__main__':
    main()
