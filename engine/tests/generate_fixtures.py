"""Generate controlled packaging-style PDF pairs with known differences (ReportLab, BSD).
Usage: generate_fixtures.py <outdir>"""
import sys, os, io
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A5
from reportlab.lib.colors import CMYKColor, black
import pypdfium2 as pdfium

OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
W, H = A5

def page(c, product="ALOE VERA SHAMPOO", net="Net Vol. 100 ml", warning="Warning: For external use only. Keep out of reach of children.",
         ingredients="Ingredients: Aqua, Sodium Laureth Sulfate, Aloe Barbadensis Leaf Juice, Parfum.",
         batch="Batch: AB2417  MFG: 03/2026  EXP: 02/2029", logo_fill=(0.1, 0.6, 0.2, 0.0), logo_pos=(40, H-120), badge=True):
    c.setFont("Helvetica-Bold", 20); c.drawString(40, H-60, product)
    c.setFont("Helvetica", 11)
    c.drawString(40, H-160, net)
    if warning: c.drawString(40, 120, warning)
    c.drawString(40, 140, ingredients[:60]); c.drawString(40, 126+28, ingredients[60:]) if len(ingredients)>60 else None
    c.drawString(40, 90, batch)
    c.setFillColor(CMYKColor(*logo_fill)); c.rect(*logo_pos, 60, 40, fill=1, stroke=0)   # "logo"
    c.setFillColor(black)
    if badge:
        c.circle(W-70, H-90, 22, fill=0, stroke=1)   # a recycling-style symbol placeholder (no text)
        c.line(W-82, H-90, W-58, H-90)

def make(name, pages):
    c = canvas.Canvas(f"{OUT}/{name}.pdf", pagesize=A5)
    for kw in pages:
        page(c, **kw); c.showPage()
    c.save()

base = {}
make("original", [base, dict(product="ALOE VERA CONDITIONER", net="Net Vol. 250 ml")])
make("identical", [base, dict(product="ALOE VERA CONDITIONER", net="Net Vol. 250 ml")])
make("changed_name", [dict(product="ALOE VERA SHAMPO0"), dict(product="ALOE VERA CONDITIONER", net="Net Vol. 250 ml")])
make("changed_number", [dict(net="Net Vol. 1000 ml"), dict(product="ALOE VERA CONDITIONER", net="Net Vol. 250 ml")])
make("changed_date", [dict(batch="Batch: AB2417  MFG: 03/2026  EXP: 02/2039"), dict(product="ALOE VERA CONDITIONER", net="Net Vol. 250 ml")])
make("missing_warning", [dict(warning=""), dict(product="ALOE VERA CONDITIONER", net="Net Vol. 250 ml")])
make("added_text", [dict(ingredients=base.get("ingredients","Ingredients: Aqua, Sodium Laureth Sulfate, Aloe Barbadensis Leaf Juice, Parfum.")+" Lanolin."), dict(product="ALOE VERA CONDITIONER", net="Net Vol. 250 ml")])
make("graphic_colour_changed", [dict(logo_fill=(0.9, 0.1, 0.1, 0.0)), dict(product="ALOE VERA CONDITIONER", net="Net Vol. 250 ml")])
make("graphic_moved", [dict(logo_pos=(60, H-140)), dict(product="ALOE VERA CONDITIONER", net="Net Vol. 250 ml")])
make("graphic_removed", [dict(badge=False), dict(product="ALOE VERA CONDITIONER", net="Net Vol. 250 ml")])
make("tiny_colour_shift", [dict(logo_fill=(0.1, 0.6, 0.2, 0.03)), dict(product="ALOE VERA CONDITIONER", net="Net Vol. 250 ml")])
make("extra_page", [base, dict(product="ALOE VERA CONDITIONER", net="Net Vol. 250 ml"), dict(product="BONUS PAGE", net="Net Vol. 1 ml")])
make("removed_page", [base])
# Scanned variants: rasterise the original / changed_number into image-only PDFs
def scan(src, dst):
    pdf = pdfium.PdfDocument(f"{OUT}/{src}.pdf"); c = canvas.Canvas(f"{OUT}/{dst}.pdf", pagesize=A5)
    from reportlab.lib.utils import ImageReader
    for i in range(len(pdf)):
        img = pdf[i].render(scale=2).to_pil().convert("RGB"); c.drawImage(ImageReader(img), 0, 0, W, H); c.showPage()
    c.save()
scan("original", "scan_original"); scan("changed_number", "scan_changed_number")

# --- failure fixtures -------------------------------------------------------
c = canvas.Canvas(f"{OUT}/encrypted.pdf", pagesize=A5, encrypt="secret-pw"); page(c); c.showPage(); c.save()
open(f"{OUT}/corrupted.pdf", "wb").write(b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 99 0 R >>\nendobj\n" + os.urandom(2000) + b"\n%%EOF\n")
open(f"{OUT}/not_a_pdf.pdf", "wb").write(b"This is just text pretending to be a PDF. " * 50)
open(f"{OUT}/image_not_pdf.png", "wb").write(b"\x89PNG\r\n\x1a\n" + os.urandom(500))
print(sorted(os.listdir(OUT)))
