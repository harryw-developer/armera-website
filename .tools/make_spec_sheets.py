#!/usr/bin/env python3
"""Build ARMERA specification packs.

Page 1 is generated here — range, code, finish, description, tagline and the
product photograph, laid out like the sheets ARMERA already sends out.
Page 2 onward is ARMERA's own dimensional drawing PDF, merged in untouched.
"""
import io, json, glob, os, re, sys, urllib.request
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from pypdf import PdfReader, PdfWriter
from PIL import Image

ROOT = os.path.expanduser("~/ARMERA Ltd/website")
TOOLS = os.path.join(ROOT, ".tools")
OUT = os.path.join(TOOLS, "specs")
PRODUCT_IMG = os.path.join(ROOT, "assets-src", "products")
IMG_CACHE = os.path.join(TOOLS, "imgcache")
ASSETS_URL = ("https://pcouznwpyhtfrleedcsv.supabase.co/storage/v1/"
              "object/public/site-assets/products/")


def product_image(name):
    """Local copy if we have one, otherwise pull it from storage once."""
    if not name:
        return None
    local = os.path.join(PRODUCT_IMG, name)
    if os.path.exists(local):
        return local
    os.makedirs(IMG_CACHE, exist_ok=True)
    cached = os.path.join(IMG_CACHE, name)
    if not os.path.exists(cached):
        try:
            req = urllib.request.Request(ASSETS_URL + urllib.request.quote(name),
                                         headers={"User-Agent": "ARMERA spec builder"})
            open(cached, "wb").write(urllib.request.urlopen(req, timeout=45).read())
        except Exception:
            return None
    return cached
LOGO = os.path.join(ROOT, "assets-src", "brand", "logo.png")

INK = (0.137, 0.133, 0.125)
GREY = (0.42, 0.41, 0.39)
LIGHT = (0.62, 0.61, 0.59)
RULE = (0.55, 0.54, 0.52)

W, H = A4
M = 18 * mm


def wrap(c, text, font, size, max_w):
    c.setFont(font, size)
    words, lines, cur = text.split(), [], ""
    for w_ in words:
        t = (cur + " " + w_).strip()
        if c.stringWidth(t, font, size) <= max_w:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w_
    if cur:
        lines.append(cur)
    return lines


def label_line(c, x, y, label, value, size=9):
    c.setFillColorRGB(*INK)
    c.setFont("Helvetica-Bold", size)
    c.drawString(x, y, label)
    lw = c.stringWidth(label, "Helvetica-Bold", size)
    c.setFillColorRGB(*GREY)
    c.setFont("Helvetica", size)
    c.drawString(x + lw + 3, y, value)


def cover_page(c, p, rng, cat, variant):
    col_w = 88 * mm
    y = H - M

    c.setStrokeColorRGB(*RULE)
    c.setLineWidth(0.7)
    c.line(M, y, M + col_w, y)

    y -= 13 * mm
    c.setFillColorRGB(*LIGHT)
    c.setFont("Helvetica", 27)
    c.drawString(M, y, "SPECIFICATION")
    y -= 11.5 * mm
    c.drawString(M, y, "SHEET")

    y -= 12 * mm
    label_line(c, M, y, "Range: ", rng.get("title", rng.get("name", "")))
    y -= 5.2 * mm
    label_line(c, M, y, "Product Code: ", variant["sku"])
    y -= 5.2 * mm
    label_line(c, M, y, "Finish: ", variant.get("finish", ""))
    y -= 5.2 * mm
    desc = p["name"]
    label_line(c, M, y, "Description: ", desc)

    note = (p.get("note") or "").strip()
    if note:
        y -= 8 * mm
        c.setFillColorRGB(*GREY)
        for ln in wrap(c, note, "Helvetica", 8.5, col_w):
            c.drawString(M, y, ln)
            y -= 4.4 * mm
        y += 1.5 * mm

    y -= 5 * mm
    c.setStrokeColorRGB(*RULE)
    c.line(M, y, M + col_w, y)

    tagline = (rng.get("tagline") or "").strip()
    if tagline:
        y -= 6.5 * mm
        c.setFillColorRGB(*GREY)
        for ln in wrap(c, tagline, "Helvetica", 8.5, col_w):
            c.drawString(M, y, ln)
            y -= 4.4 * mm

    # product photograph, centred in the space that remains
    img_file = variant.get("image") or p.get("image") or \
        (list(p.get("imagesByCode", {}).values()) or [None])[0]
    path = product_image(img_file)
    if path and os.path.exists(path):
        im = Image.open(path).convert("RGB")
        box_w, box_h = W - 2 * M, 118 * mm
        top = y - 12 * mm
        scale = min(box_w / im.width, box_h / im.height)
        dw, dh = im.width * scale, im.height * scale
        c.drawImage(ImageReader(im), (W - dw) / 2, top - dh,
                    dw, dh, mask="auto")

    # footer: logo, email, website
    if os.path.exists(LOGO):
        lg = Image.open(LOGO).convert("RGBA")
        bg = Image.new("RGB", lg.size, (255, 255, 255))
        bg.paste(lg, mask=lg.split()[3])
        lw = 52 * mm
        lh = lw * lg.height / lg.width
        c.drawImage(ImageReader(bg), W - M - lw, M + 12 * mm, lw, lh, mask="auto")
    c.setFillColorRGB(*GREY)
    c.setFont("Helvetica", 8.5)
    c.drawRightString(W - M, M + 7 * mm, "info@armera.co.uk")
    c.drawRightString(W - M, M + 2.5 * mm, "www.armera.co.uk")


def build(p, rng, cat, drawing_path, out_path):
    variant = (p.get("variants") or [{}])[0]
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    cover_page(c, p, rng, cat, variant)
    c.showPage()
    c.save()
    buf.seek(0)

    writer = PdfWriter()
    for page in PdfReader(buf).pages:
        writer.add_page(page)
    if drawing_path and os.path.exists(drawing_path):
        try:
            for page in PdfReader(drawing_path).pages:
                writer.add_page(page)
        except Exception as e:
            print("  ! could not merge drawing:", os.path.basename(drawing_path), e)
    with open(out_path, "wb") as f:
        writer.write(f)


def main():
    os.makedirs(OUT, exist_ok=True)
    only = sys.argv[1] if len(sys.argv) > 1 else None
    made, with_drawing = 0, 0
    index = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "data/categories/*.json"))):
        cat = json.load(open(path))
        for rng in cat["ranges"]:
            for p in rng["products"]:
                key = f'{cat["slug"]}/{rng["slug"]}/{p["slug"]}'
                if only and only not in key:
                    continue
                name = "spec-" + re.sub(r"[^a-z0-9]+", "-", f'{rng["slug"]}-{p["slug"]}'.lower()).strip("-") + ".pdf"
                dwg = os.path.join(TOOLS, "drawings", p["drawing"]) if p.get("drawing") else None
                build(p, rng, cat, dwg, os.path.join(OUT, name))
                index[key] = name
                made += 1
                with_drawing += 1 if dwg else 0
    json.dump(index, open(os.path.join(TOOLS, "spec_index.json"), "w"), indent=1)
    print(f"spec sheets built: {made} ({with_drawing} include a dimensional drawing)")


if __name__ == "__main__":
    main()
