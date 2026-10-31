// Specification sheets, built on request.
//
// Page one is drawn here from whatever the catalogue currently says — range,
// code, finish, description, note, tagline and the product photograph. Page
// two onward is the product's own dimensional drawing, merged in untouched.
//
// Doing it on request rather than in advance means a sheet is never stale: fix
// a price or swap a photo and the next download reflects it, and a product
// added this morning has a sheet this morning without anyone generating one.
//
// The layout follows the sheets ARMERA already sends out.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const mm = n => n * 2.834645669;
const A4 = [mm(210), mm(297)];
const M = mm(18);
const COL = mm(88);

const INK = rgb(0.137, 0.133, 0.125);
const GREY = rgb(0.42, 0.41, 0.39);
const LIGHT = rgb(0.62, 0.61, 0.59);
const RULE = rgb(0.55, 0.54, 0.52);

function wrap(text, font, size, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
    else { if (line) lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

async function grab(bucket, key) {
  if (!key) return null;
  const obj = await bucket.get(key);
  if (!obj) return null;
  return new Uint8Array(await obj.arrayBuffer());
}

// Find a product in the catalogue tables and bring back what the sheet needs.
export async function specSubject(db, catSlug, rangeSlug, productSlug) {
  const row = await db.prepare(`
    select p.name, p.image, p.dims, p.note, p.drawing, p.images_by_code,
           r.title as range_title, r.name as range_name, r.tagline, p.id as pid
      from catalogue_products p
      join catalogue_ranges r on r.id = p.range_id
      join catalogue_categories c on c.key = r.category_key
     where c.slug = ? and r.slug = ? and p.slug = ?`).bind(catSlug, rangeSlug, productSlug).first();
  if (!row) return null;
  const vars = await db.prepare(
    'select sku, finish, price, image from catalogue_variants where product_id = ? order by position')
    .bind(row.pid).all();
  return { ...row, variants: vars.results };
}

export async function buildSpecSheet(env, subject, wantedSku) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage(A4);
  const [W, H] = A4;
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const variant = subject.variants.find(v => v.sku === wantedSku) || subject.variants[0] || {};
  let y = H - M;

  page.drawLine({ start: { x: M, y }, end: { x: M + COL, y }, thickness: 0.7, color: RULE });

  y -= mm(13);
  page.drawText('SPECIFICATION', { x: M, y, size: 27, font: body, color: LIGHT });
  y -= mm(11.5);
  page.drawText('SHEET', { x: M, y, size: 27, font: body, color: LIGHT });

  y -= mm(12);
  const line = (label, value) => {
    if (value === undefined || value === null || value === '') return;
    page.drawText(label, { x: M, y, size: 9, font: bold, color: INK });
    page.drawText(String(value), {
      x: M + bold.widthOfTextAtSize(label, 9) + 3, y, size: 9, font: body, color: GREY });
    y -= mm(5.2);
  };
  line('Range: ', subject.range_title || subject.range_name);
  line('Product Code: ', variant.sku);
  line('Finish: ', variant.finish);
  line('Description: ', subject.name);
  if (subject.dims) line('Dimensions: ', subject.dims + (/x/i.test(subject.dims) ? ' mm' : ''));
  if (variant.price) line('RRP: ', '£' + Number(variant.price).toLocaleString('en-GB') + ' inc. VAT');

  if (subject.note) {
    y -= mm(3);
    for (const ln of wrap(subject.note, body, 8.5, COL)) {
      page.drawText(ln, { x: M, y, size: 8.5, font: body, color: GREY });
      y -= mm(4.4);
    }
    y += mm(1.5);
  }

  y -= mm(5);
  page.drawLine({ start: { x: M, y }, end: { x: M + COL, y }, thickness: 0.7, color: RULE });

  if (subject.tagline) {
    y -= mm(6.5);
    for (const ln of wrap(subject.tagline, body, 8.5, COL)) {
      page.drawText(ln, { x: M, y, size: 8.5, font: body, color: GREY });
      y -= mm(4.4);
    }
  }

  // the product photograph, centred in what is left
  let photoKey = variant.image || subject.image;
  if (!photoKey && subject.images_by_code) {
    const byCode = JSON.parse(subject.images_by_code);
    photoKey = Object.values(byCode).filter(Boolean)[0];
  }
  if (photoKey) {
    const bytes = await grab(env.ASSETS, 'products/' + photoKey);
    if (bytes) {
      try {
        const img = /\.png$/i.test(photoKey) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        const boxW = W - 2 * M, boxH = mm(118);
        const top = y - mm(12);
        const scale = Math.min(boxW / img.width, boxH / img.height);
        const dw = img.width * scale, dh = img.height * scale;
        page.drawImage(img, { x: (W - dw) / 2, y: top - dh, width: dw, height: dh });
      } catch (e) { /* an image pdf-lib cannot read should not lose the sheet */ }
    }
  }

  // footer
  const logo = await grab(env.ASSETS, 'brand/logo.png');
  if (logo) {
    try {
      const img = await pdf.embedPng(logo);
      const lw = mm(52), lh = lw * img.height / img.width;
      page.drawImage(img, { x: W - M - lw, y: M + mm(12), width: lw, height: lh });
    } catch (e) { /* no logo is survivable */ }
  }
  for (const [text, dy] of [['info@armera.co.uk', mm(7)], ['www.armera.co.uk', mm(2.5)]]) {
    page.drawText(text, {
      x: W - M - body.widthOfTextAtSize(text, 8.5), y: M + dy, size: 8.5, font: body, color: GREY });
  }

  // the dimensional drawing, merged in as it is
  if (subject.drawing) {
    const bytes = await grab(env.ASSETS, 'drawings/' + subject.drawing);
    if (bytes) {
      try {
        const src = await PDFDocument.load(bytes);
        const pages = await pdf.copyPages(src, src.getPageIndices());
        for (const pg of pages) pdf.addPage(pg);
      } catch (e) { /* a drawing that will not parse leaves a one-page sheet */ }
    }
  }

  return pdf.save();
}
