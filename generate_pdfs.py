import os
import requests
from datetime import datetime
from fpdf import FPDF

MEILI_HOST = 'https://getmeilimeilisearchv190-production-a931.up.railway.app'
MEILI_KEY  = 'f68d1b50a6aa870ed16adce86770732894bb7c543b88f64385c2a321b7e8be73'
INDEX      = 'acqvault'
SOURCES    = {'rfo': 'Revolutionary FAR Overhaul', 'r-dfars': 'R-DFARS', 'far-companion': 'FAR Companion'}
OUTPUT_DIR = 'pdfs'

def fetch_all_docs(source):
    docs, offset = [], 0
    print(f'  Fetching {source}...', end='', flush=True)
    while True:
        res = requests.post(
            f'{MEILI_HOST}/indexes/{INDEX}/search',
            headers={'Authorization': f'Bearer {MEILI_KEY}', 'Content-Type': 'application/json'},
            json={'q': '', 'filter': f'source = "{source}"', 'limit': 1000, 'offset': offset},
            timeout=30,
        )
        hits = res.json().get('hits', [])
        docs.extend(hits)
        print('.', end='', flush=True)
        if len(hits) < 1000:
            break
        offset += 1000
    print(f' {len(docs)} docs')
    return docs

def sort_docs(docs):
    def key(d):
        try: return int(str(d.get('part','9999')).strip())
        except: return 9999
    return sorted(docs, key=key)

def safe(text):
    if not text: return ''
    return text.encode('latin-1', errors='replace').decode('latin-1')

class AcqVaultPDF(FPDF):
    def __init__(self, source_name, generated_date):
        super().__init__()
        self.source_name    = source_name
        self.generated_date = generated_date
        self.set_auto_page_break(auto=True, margin=22)
        self.set_margins(20, 18, 20)

    def header(self):
        self.set_font('Helvetica', '', 7)
        self.set_text_color(180, 180, 180)
        self.cell(0, 6, 'AcqVault.com - AF Acquisition Research', align='L', new_x='LMARGIN', new_y='NEXT')
        self.set_draw_color(220, 220, 220)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(3)

    def footer(self):
        self.set_y(-16)
        self.set_font('Helvetica', '', 7)
        self.set_text_color(180, 180, 180)
        self.cell(0, 8, f'acqvault.com  |  Generated {self.generated_date}  |  Page {self.page_no()}', align='C')

def add_cover(pdf, source_name, doc_count, generated_date):
    pdf.add_page()
    pdf.ln(30)
    pdf.set_font('Helvetica', 'B', 32)
    pdf.set_text_color(10, 10, 10)
    pdf.cell(0, 14, 'AcqVault.com', align='C', new_x='LMARGIN', new_y='NEXT')
    pdf.set_font('Helvetica', '', 11)
    pdf.set_text_color(120, 120, 120)
    pdf.cell(0, 8, 'AF Acquisition Research', align='C', new_x='LMARGIN', new_y='NEXT')
    pdf.ln(10)
    pdf.set_draw_color(220, 220, 220)
    pdf.line(pdf.l_margin + 40, pdf.get_y(), pdf.w - pdf.r_margin - 40, pdf.get_y())
    pdf.ln(14)
    pdf.set_font('Helvetica', 'B', 22)
    pdf.set_text_color(10, 10, 10)
    pdf.cell(0, 12, safe(source_name), align='C', new_x='LMARGIN', new_y='NEXT')
    pdf.ln(6)
    pdf.set_font('Helvetica', '', 10)
    pdf.set_text_color(150, 150, 150)
    pdf.cell(0, 7, f'Generated {generated_date}', align='C', new_x='LMARGIN', new_y='NEXT')
    pdf.cell(0, 7, f'{doc_count:,} documents indexed', align='C', new_x='LMARGIN', new_y='NEXT')
    pdf.ln(30)
    pdf.set_font('Helvetica', '', 8)
    pdf.set_text_color(170, 170, 170)
    pdf.multi_cell(0, 5, 'This document is compiled from official U.S. government acquisition regulation sources and indexed by AcqVault.com for the Air Force contracting community. Visit acqvault.com for the most current version.', align='C')

def render_doc(pdf, doc):
    W = pdf.w - pdf.l_margin - pdf.r_margin
    title   = safe(doc.get('title', 'Untitled'))
    content = safe(doc.get('content', ''))
    status  = safe(doc.get('status', ''))

    pdf.set_font('Helvetica', 'B', 11)
    pdf.set_text_color(20, 20, 20)
    pdf.multi_cell(W, 7, title)

    if status:
        pdf.set_font('Helvetica', 'I', 8)
        pdf.set_text_color(150, 150, 150)
        pdf.multi_cell(W, 5, f'Status: {status}')

    pdf.ln(3)

    if content:
        for line in content.split('\n'):
            s = line.strip()
            if not s:
                pdf.ln(2)
                continue

            # Always reset to left margin before each line
            pdf.set_x(pdf.l_margin)

            if s.upper().startswith('PART ') and len(s) < 140:
                pdf.set_font('Helvetica', 'B', 10)
                pdf.set_text_color(10, 10, 10)
                pdf.multi_cell(W, 6, s)
            elif s.lower().startswith('subpart ') and len(s) < 140:
                pdf.set_font('Helvetica', 'B', 9)
                pdf.set_text_color(30, 30, 30)
                pdf.multi_cell(W, 6, s)
            elif s[:1].isdigit() and '.' in s[:8] and len(s) < 220:
                pdf.set_font('Helvetica', 'B', 9)
                pdf.set_text_color(40, 40, 40)
                pdf.multi_cell(W, 6, s)
            elif s == s.upper() and len(s) > 3 and len(s) < 80 and any(c.isalpha() for c in s):
                pdf.set_font('Helvetica', 'B', 9)
                pdf.set_text_color(40, 40, 40)
                pdf.multi_cell(W, 6, s)
            elif s.startswith('('):
                ch = s[1:2]
                if ch.islower():      indent = 6
                elif ch.isdigit():    indent = 12
                elif ch.lower() in 'ivxlcdm': indent = 18
                elif ch.isupper():    indent = 24
                else:                 indent = 0
                pdf.set_font('Helvetica', '', 9)
                pdf.set_text_color(70, 70, 70)
                pdf.set_x(pdf.l_margin + indent)
                pdf.multi_cell(W - indent, 5.5, s)
            else:
                pdf.set_font('Helvetica', '', 9)
                pdf.set_text_color(70, 70, 70)
                pdf.multi_cell(W, 5.5, s)

    pdf.ln(6)
    pdf.set_x(pdf.l_margin)
    pdf.set_draw_color(235, 235, 235)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
    pdf.ln(4)

def generate_pdf(source, source_name, docs):
    generated_date = datetime.now().strftime('%B %d, %Y')
    pdf = AcqVaultPDF(source_name, generated_date)
    add_cover(pdf, source_name, len(docs), generated_date)
    current_part = None
    for doc in docs:
        part = str(doc.get('part', '')).strip()
        if part != current_part:
            pdf.add_page()
            current_part = part
            pdf.set_x(pdf.l_margin)
            pdf.set_font('Helvetica', 'B', 13)
            pdf.set_text_color(10, 10, 10)
            pdf.cell(0, 10, f'PART {part}', new_x='LMARGIN', new_y='NEXT')
            pdf.set_draw_color(10, 10, 10)
            pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
            pdf.ln(6)
        render_doc(pdf, doc)
    return pdf

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f'AcqVault PDF Generator — {datetime.now().strftime("%B %d, %Y")}\n')
    for source, source_name in SOURCES.items():
        print(f'[{source_name}]')
        try:
            docs = fetch_all_docs(source)
            if not docs:
                print('  No documents found — skipping.\n')
                continue
            docs = sort_docs(docs)
            print('  Generating PDF...')
            pdf = generate_pdf(source, source_name, docs)
            out = os.path.join(OUTPUT_DIR, f'{source}.pdf')
            pdf.output(out)
            print(f'  Saved: {out} ({os.path.getsize(out)//1024} KB)\n')
        except Exception as e:
            print(f'  ERROR: {e}\n')
    print('Done.')

if __name__ == '__main__':
    main()
