#!/usr/bin/env python3
"""AcqVault OG/social card generator.

One HTML template -> 1200x630 PNGs, rendered by headless Chrome at 2x and
downscaled with Pillow for crisp text. Self-hosted fonts are inlined as data
URIs so the render matches the site exactly. Output goes to assets/og-*.png,
which api/_seo.js and index.html reference per route.

Usage:  python3 scripts/og/gen_og.py [name ...]   (default: all)
Requires: Google Chrome, Pillow.
"""
import base64, subprocess, os, sys, tempfile
from PIL import Image

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FONTS = os.path.join(REPO, 'assets', 'fonts')
ASSETS = os.path.join(REPO, 'assets')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

def b64(path):
    return base64.b64encode(open(path, 'rb').read()).decode()

SERIF = b64(os.path.join(FONTS, 'source-serif4-latin.woff2'))
INTER = b64(os.path.join(FONTS, 'inter-latin.woff2'))

# Vault-dial emblem — the site nav logo, brass on navy.
DIAL = '''<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
<rect x="3" y="3" width="94" height="94" rx="20" fill="#0f2540" stroke="#6f521a" stroke-width="1"/>
<rect x="11" y="11" width="78" height="78" rx="14" fill="none" stroke="#87651c" stroke-width="2"/>
<circle cx="50" cy="50" r="24" fill="none" stroke="#e4c477" stroke-width="3.5"/>
<g stroke="#e4c477" stroke-width="4" stroke-linecap="round">
<line x1="50" y1="29" x2="50" y2="39"/><line x1="50" y1="71" x2="50" y2="61"/>
<line x1="29" y1="50" x2="39" y2="50"/><line x1="71" y1="50" x2="61" y2="50"/></g>
<circle cx="50" cy="50" r="6" fill="#e4c477"/></svg>'''

TEMPLATE = '''<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{{font-family:'SS';src:url(data:font/woff2;base64,{serif}) format('woff2');font-weight:200 900;}}
@font-face{{font-family:'IN';src:url(data:font/woff2;base64,{inter}) format('woff2');font-weight:100 900;}}
*{{margin:0;padding:0;box-sizing:border-box;}}
html,body{{width:1200px;height:630px;overflow:hidden;}}
.card{{position:relative;width:1200px;height:630px;
  background:radial-gradient(120% 140% at 12% 8%, #1b436b 0%, #123253 42%, #0a1c33 100%);
  font-family:'IN',sans-serif;overflow:hidden;}}
.rule{{position:absolute;top:0;left:0;right:0;height:6px;
  background:linear-gradient(90deg,#6f521a,#e4c477 45%,#f3dfa6 55%,#87651c);}}
.rings{{position:absolute;right:-120px;top:50%;transform:translateY(-50%);width:900px;height:900px;
  border-radius:50%;opacity:.5;
  background:
   radial-gradient(circle, transparent 38%, rgba(205,178,119,.10) 38.4%, transparent 39%),
   radial-gradient(circle, transparent 30%, rgba(205,178,119,.08) 30.4%, transparent 31%),
   radial-gradient(circle, transparent 46%, rgba(205,178,119,.07) 46.4%, transparent 47%);}}
.wrap{{position:absolute;inset:0;padding:64px 72px;display:flex;align-items:center;}}
.col{{flex:1;max-width:730px;z-index:2;}}
.eyebrow{{font-weight:800;font-size:24px;letter-spacing:.2em;text-transform:uppercase;
  color:#e4c477;margin-bottom:26px;}}
.eyebrow .dot{{color:rgba(228,196,119,.5);margin:0 12px;}}
.head{{font-family:'SS',serif;color:#fff;line-height:1.02;letter-spacing:-.015em;
  font-size:{headsize}px;font-weight:{headweight};margin-bottom:24px;}}
.sub{{font-size:31px;line-height:1.32;color:rgba(230,238,248,.86);font-weight:400;max-width:660px;}}
.sub b{{color:#fff;font-weight:700;}}
.pills{{margin-top:34px;display:flex;flex-wrap:wrap;gap:12px;max-width:660px;}}
.pill{{font-size:21px;font-weight:700;color:#fff;padding:8px 18px;border-radius:999px;
  border:1px solid rgba(255,255,255,.14);}}
.chip{{margin-top:34px;display:inline-flex;align-items:center;gap:12px;font-size:22px;font-weight:700;
  color:#0a1c33;background:#e4c477;padding:10px 22px;border-radius:999px;}}
.emblem{{position:absolute;right:96px;top:50%;transform:translateY(-50%);width:300px;height:300px;
  z-index:2;filter:drop-shadow(0 18px 40px rgba(0,0,0,.4));}}
.foot{{position:absolute;left:72px;bottom:46px;font-size:20px;font-weight:700;letter-spacing:-.01em;
  color:rgba(255,255,255,.62);z-index:2;}}
.foot b{{color:#e4c477;}}
</style></head><body>
<div class="card"><div class="rule"></div><div class="rings"></div>
<div class="wrap"><div class="col">
<div class="eyebrow">{eyebrow}</div>
<div class="head">{head}</div>
<div class="sub">{sub}</div>
{extra}
</div></div>
<div class="emblem">{dial}</div>
{foot}
</div></body></html>'''

def eyebrow(parts):
    return '<span class="dot">·</span>'.join(parts)

def pills(items):
    p = ''.join(f'<span class="pill" style="background:{c}">{n}</span>' for n, c in items)
    return f'<div class="pills">{p}</div>'

def one_pill(name, color):
    return f'<div class="pills"><span class="pill" style="background:{color}">{name}</span></div>'

def chip(text):
    return f'<div class="chip">{text}</div>'

FOOT = '<div class="foot">acqvault.com<b> · </b>free · no login · no CAC</div>'

SOURCE_PILLS = [
    ('RFO', '#2f5aa6'), ('R-DFARS', '#2c6a44'), ('FAR Companion', '#67508f'),
    ('Category Mgmt', '#1c6377'), ('DAFI 63-138', '#a8324e'), ('DoD FMR', '#a84e22'),
]

def source(head, sub, pill, color, parts=None):
    label = f'{pill} · {parts}' if parts else pill
    return dict(eyebrow=eyebrow(['ACQVAULT', 'FULL TEXT']), head=head, headsize=72, headweight=600,
                sub=sub, extra=one_pill(label, color), foot=FOOT)

VARIANTS = {
  'home': dict(
     eyebrow=eyebrow(['FREE', 'NO LOGIN', 'NO CAC']),
     head='AcqVault', headsize=104, headweight=600,
     sub='The federal acquisition rulebook — <b>fully searchable</b>. RFO, R-DFARS, and every official source in one place.',
     extra=pills(SOURCE_PILLS), foot=''),
  'study': dict(
     eyebrow=eyebrow(['ACQVAULT', 'STUDY']),
     head='Drill it until<br>it&rsquo;s reflex.', headsize=76, headweight=600,
     sub='Knowledge checks, threshold sprints, a daily word, and board-style scenarios — <b>free, no account</b>.',
     extra=chip('A daily word · 90-second rounds'), foot=FOOT),
  'library': dict(
     eyebrow=eyebrow(['ACQVAULT', 'LIBRARY']),
     head='Field guides &amp;<br>source PDFs.', headsize=76, headweight=600,
     sub='Written for the acquisition community — plus every indexed source as one clean PDF each.',
     extra=chip('Field Guides · templates · full text'), foot=FOOT),
  'src-rfo': source('Revolutionary<br>FAR Overhaul.',
     'The overhauled FAR — reproduced in full and <b>searchable to the word</b>. Free, no CAC.',
     'RFO', '#2f5aa6', 'Parts 1–53'),
  'src-r-dfars': source('R-DFARS<br>Deviations.',
     'The DoD class deviations that implement the RFO — the set you cite in place of the legacy supplement.',
     'R-DFARS', '#2c6a44'),
  'src-far-companion': source('FAR<br>Companion.',
     'Practitioner guidance alongside the Revolutionary FAR Overhaul — full text, <b>searchable</b>.',
     'FAR Companion', '#67508f'),
  'src-category-management': source('Category<br>Management.',
     'The federal category management buying guidance — searchable to the word, free, no login.',
     'Category Mgmt', '#1c6377'),
  'src-afi-63-138': source('DAFI<br>63-138.',
     'Air Force acquisition program management — reproduced in full and searchable, no CAC.',
     'DAFI 63-138', '#a8324e'),
  'src-fmr': source('DoD Financial<br>Management Reg.',
     'DoD 7000.14-R — all 16 volumes, budget to contract payment, by volume and chapter.',
     'DoD FMR', '#a84e22'),
  'src-ssp': source('DoD Source<br>Selection.',
     'The DoD Source Selection Procedures — team roles, the rating methods, tradeoff and LPTA, and the debriefing guide.',
     'Source Selection', '#87651c'),
  # Clay, matching --pgi-solid in assets/app.css. The subtitle carries the
  # guidance-not-regulation distinction, because a shared link is the one place a
  # reader meets this source with no badge and no colour to tell them.
  'src-pgi': source('DFARS<br>PGI.',
     'The procedural companion to the R-DFARS rule — how to carry a requirement out. <b>Guidance, not regulation.</b>',
     'DFARS PGI', '#7a5a4a'),
}

def render(name):
    html = TEMPLATE.format(serif=SERIF, inter=INTER, dial=DIAL, **VARIANTS[name])
    with tempfile.NamedTemporaryFile('w', suffix='.html', delete=False) as f:
        f.write(html); htmlpath = f.name
    raw = os.path.join(ASSETS, f'_raw_{name}.png')
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--no-sandbox',
        f'--screenshot={raw}', '--window-size=1200,630', '--force-device-scale-factor=2',
        '--hide-scrollbars', '--default-background-color=00000000', f'file://{htmlpath}'],
        capture_output=True)
    os.unlink(htmlpath)
    img = Image.open(raw).convert('RGB').resize((1200, 630), Image.LANCZOS)
    outp = os.path.join(ASSETS, f'og-{name}-v2.png')
    img.save(outp, optimize=True)
    os.unlink(raw)
    print(f'og-{name}-v2.png  {os.path.getsize(outp)//1024} KB')

if __name__ == '__main__':
    for name in (sys.argv[1:] or list(VARIANTS)):
        render(name)
