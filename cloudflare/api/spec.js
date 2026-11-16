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
    select p.name, p.image, p.dims, p.note, p.drawing, p.images_by_code, p.extra,
           r.title as range_title, r.name as range_name, r.tagline, p.id as pid
      from catalogue_products p
      join catalogue_ranges r on r.id = p.range_id
      join catalogue_categories c on c.key = r.category_key
     where c.slug = ? and r.slug = ? and p.slug = ?`).bind(catSlug, rangeSlug, productSlug).first();
  if (!row) return null;
  const vars = await db.prepare(
    'select sku, finish, price, image from catalogue_variants where product_id = ? order by position')
    .bind(row.pid).all();
  let flow = null;
  try { flow = cleanFlow((JSON.parse(row.extra || '{}') || {}).flow); } catch { /* no figures */ }
  return { ...row, flow, variants: vars.results };
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
  let logoImg = null;
  const logo = await grab(env.ASSETS, 'brand/logo.png');
  if (logo) { try { logoImg = await pdf.embedPng(logo); } catch (e) { /* no logo is survivable */ } }
  const footer = async pg => {
    if (logoImg) {
      const lw = mm(52), lh = lw * logoImg.height / logoImg.width;
      pg.drawImage(logoImg, { x: W - M - lw, y: M + mm(12), width: lw, height: lh });
    }
    for (const [text, dy] of [['info@armera.co.uk', mm(7)], ['www.armera.co.uk', mm(2.5)]]) {
      pg.drawText(text, {
        x: W - M - body.widthOfTextAtSize(text, 8.5), y: M + dy, size: 8.5, font: body, color: GREY });
    }
  };
  await footer(page);

  // flow rates, on a page of their own, drawn from the same figures the
  // product page uses
  if (subject.flow) {
    const fp = pdf.addPage(A4);
    drawFlowPage(fp, subject, variant, body, bold);
    await footer(fp);
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


/* ---------- flow rates ---------- */

// Keep only what can be drawn: real numbers, in pressure order.
function cleanFlow(flow) {
  if (!flow || !Array.isArray(flow.series)) return null;
  const series = flow.series.map(s => ({
    label: String((s && s.label) || '').trim(),
    points: (Array.isArray(s && s.points) ? s.points : [])
      .map(p => [Number(p && p[0]), Number(p && p[1])])
      .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] > 0 && p[1] >= 0)
      .sort((a, b) => a[0] - b[0])
  })).filter(s => s.points.length).slice(0, 6);
  return series.length ? { series, note: String(flow.note || '').trim() } : null;
}

const fig = n => String(Math.round(n * 100) / 100);
// The standard PDF fonts cannot draw every character; swap the few that turn up.
const plain = t => String(t).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/½/g, '1/2').replace(/[^\x20-\x7e£]/g, '');

function niceScale(max) {
  const pow = Math.pow(10, Math.floor(Math.log10(max / 4)));
  let step = pow;
  for (const m of [1, 2, 2.5, 5, 10]) { step = m * pow; if (max / step <= 5) break; }
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let t = 0; t <= top + step / 1000; t += step) ticks.push(Math.round(t * 1000) / 1000);
  return { top, ticks };
}

const LINE_STYLES = [
  { color: INK, dash: undefined }, { color: LIGHT, dash: undefined },
  { color: INK, dash: [5, 4] }, { color: LIGHT, dash: [5, 4] },
  { color: INK, dash: [1.5, 4] }, { color: LIGHT, dash: [1.5, 4] }
];

function drawFlowPage(page, subject, variant, body, bold) {
  const [W, H] = A4;
  const flow = subject.flow;
  let y = H - M;
  page.drawLine({ start: { x: M, y }, end: { x: M + COL, y }, thickness: 0.7, color: RULE });
  y -= mm(13);
  page.drawText('FLOW RATES', { x: M, y, size: 27, font: body, color: LIGHT });
  y -= mm(11);
  const head = (label, value) => {
    if (!value) return;
    page.drawText(label, { x: M, y, size: 9, font: bold, color: INK });
    page.drawText(plain(value), { x: M + bold.widthOfTextAtSize(label, 9) + 3, y, size: 9, font: body, color: GREY });
    y -= mm(5.2);
  };
  head('Range: ', subject.range_title || subject.range_name);
  head('Product Code: ', variant.sku);
  head('Description: ', subject.name);
  y -= mm(3);
  page.drawLine({ start: { x: M, y }, end: { x: M + COL, y }, thickness: 0.7, color: RULE });

  // the chart
  const L = M + mm(14), R = W - M, top = y - mm(14), ih = mm(86), bottom = top - ih, iw = R - L;
  let maxX = 0, maxY = 0;
  for (const s of flow.series) for (const p of s.points) { maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); }
  const xTop = Math.max(1, Math.ceil(maxX));
  const ys = niceScale(maxY || 1);
  const X = v => L + (v / xTop) * iw;
  const Y = v => bottom + (v / ys.top) * ih;
  const GRID = rgb(0.86, 0.85, 0.83);

  for (const t of ys.ticks) {
    page.drawLine({ start: { x: L, y: Y(t) }, end: { x: R, y: Y(t) }, thickness: 0.4, color: GRID });
    const label = fig(t);
    page.drawText(label, { x: L - 5 - body.widthOfTextAtSize(label, 8), y: Y(t) - 2.6, size: 8, font: body, color: GREY });
  }
  for (let x = 0; x <= xTop + 0.001; x += (xTop <= 4 ? 0.5 : 1)) {
    page.drawLine({ start: { x: X(x), y: bottom }, end: { x: X(x), y: bottom - 3 }, thickness: 0.5, color: RULE });
    const label = fig(x);
    page.drawText(label, { x: X(x) - body.widthOfTextAtSize(label, 8) / 2, y: bottom - 12, size: 8, font: body, color: GREY });
  }
  page.drawLine({ start: { x: L, y: bottom }, end: { x: R, y: bottom }, thickness: 0.6, color: RULE });
  const xt = 'PRESSURE (BAR)';
  page.drawText(xt, { x: L + iw / 2 - body.widthOfTextAtSize(xt, 7) / 2, y: bottom - 24, size: 7, font: body, color: GREY });
  const yt = 'FLOW (LITRES PER MINUTE)';
  page.drawText(yt, { x: M + 2, y: bottom + ih / 2 - body.widthOfTextAtSize(yt, 7) / 2, size: 7, font: body, color: GREY,
                      rotate: { type: 'degrees', angle: 90 } });

  flow.series.forEach((s, i) => {
    const st = LINE_STYLES[i % LINE_STYLES.length];
    for (let n = 1; n < s.points.length; n++) {
      page.drawLine({ start: { x: X(s.points[n - 1][0]), y: Y(s.points[n - 1][1]) },
                      end: { x: X(s.points[n][0]), y: Y(s.points[n][1]) },
                      thickness: 1.1, color: st.color, dashArray: st.dash });
    }
    for (const p of s.points) {
      page.drawCircle({ x: X(p[0]), y: Y(p[1]), size: 2.1, color: rgb(1, 1, 1), borderColor: st.color, borderWidth: 0.9 });
    }
  });

  // the key, when there is more than one line to tell apart
  y = bottom - mm(15);
  const solo = flow.series.length === 1 && !flow.series[0].label;
  if (!solo) {
    let kx = L;
    flow.series.forEach((s, i) => {
      const st = LINE_STYLES[i % LINE_STYLES.length];
      const label = plain(s.label || 'Flow');
      const w = 26 + body.widthOfTextAtSize(label, 8.5) + 16;
      if (kx + w > R) { kx = L; y -= mm(5); }
      page.drawLine({ start: { x: kx, y: y + 2.6 }, end: { x: kx + 20, y: y + 2.6 }, thickness: 1.1, color: st.color, dashArray: st.dash });
      page.drawText(label, { x: kx + 26, y, size: 8.5, font: body, color: GREY });
      kx += w;
    });
    y -= mm(9);
  }

  // the same figures as a table
  const bars = [...new Set(flow.series.flatMap(s => s.points.map(p => p[0])))].sort((a, b) => a - b);
  const first = mm(62), colW = (W - 2 * M - first) / Math.max(bars.length, 1);
  bars.forEach((b, i) => {
    const label = fig(b) + ' bar';
    page.drawText(label, { x: M + first + colW * (i + 1) - body.widthOfTextAtSize(label, 8), y, size: 8, font: bold, color: INK });
  });
  y -= mm(2.2);
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: RULE });
  for (const s of flow.series) {
    y -= mm(5.2);
    let name = plain(solo ? 'Litres per minute' : (s.label || 'Flow'));
    while (name.length > 3 && body.widthOfTextAtSize(name, 8.5) > first - 6) name = name.slice(0, -2);
    page.drawText(name, { x: M, y, size: 8.5, font: body, color: GREY });
    bars.forEach((b, i) => {
      const hit = s.points.find(p => p[0] === b);
      const label = hit ? fig(hit[1]) : '-';
      page.drawText(label, { x: M + first + colW * (i + 1) - body.widthOfTextAtSize(label, 8.5), y, size: 8.5, font: body, color: GREY });
    });
    y -= mm(2);
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.3, color: GRID });
  }
  if (!solo) {
    y -= mm(5);
    page.drawText('Figures in litres per minute.', { x: M, y, size: 7.5, font: body, color: GREY });
  }
  if (flow.note) {
    y -= mm(7);
    for (const ln of wrap(plain(flow.note), body, 8.5, W - 2 * M)) {
      page.drawText(ln, { x: M, y, size: 8.5, font: body, color: GREY });
      y -= mm(4.4);
    }
  }
}
