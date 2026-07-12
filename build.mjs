#!/usr/bin/env node
// ARMERA static site generator.
// Reads data/*.json and emits a complete static site into dist/.
// All imagery, fonts and documents are served from Supabase storage.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
// Output to docs/ (served by GitHub Pages from the main branch).
const DIST = join(ROOT, 'docs');
// Site base path. '' for a custom domain / root site; '/<repo>' for GitHub project pages.
const BASE = process.env.BASE_PATH ?? '';

const SUPABASE_URL = 'https://pcouznwpyhtfrleedcsv.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjb3V6bndweWh0ZnJsZWVkY3N2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NjM3NzIsImV4cCI6MjA5OTQzOTc3Mn0.pNRCs82pde-0vMnaTh6ygtQNeWKgFS2s3lrIkhM8uZU';
const ASSETS = `${SUPABASE_URL}/storage/v1/object/public/site-assets`;
const INSTRUCTIONS_BUCKET = 'instructions';

const site = JSON.parse(readFileSync(join(ROOT, 'data/site.json'), 'utf8'));
const categories = readdirSync(join(ROOT, 'data/categories')).sort()
  .map(f => JSON.parse(readFileSync(join(ROOT, 'data/categories', f), 'utf8')));
const lifestyle = JSON.parse(readFileSync(join(ROOT, 'data/lifestyle.json'), 'utf8'));
const inspiration = JSON.parse(readFileSync(join(ROOT, 'data/inspiration.json'), 'utf8'));

/* ---------------- helpers ---------------- */
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = n => '£' + n.toLocaleString('en-GB');
const prodImg = f => `${ASSETS}/products/${f}`;
const lifeImg = f => `${ASSETS}/lifestyle/${f.replace(/\.png$/, '.jpg')}`;
const swatchImg = f => `${ASSETS}/swatches/${f}`;

const priceSpread = p => {
  const prices = p.variants.map(v => v.price);
  const min = Math.min(...prices), max = Math.max(...prices);
  return { min, max, single: min === max };
};
const fromLabel = p => {
  const { min, single } = priceSpread(p);
  return single ? money(min) : `From ${money(min)}`;
};
const mainImage = p => p.image || (p.imagesByCode ? Object.values(p.imagesByCode)[0] : null);

const guaranteeFor = catSlug => ({
  'furniture-and-basins': null, // resolved per range below
  'wcs': '25 year guarantee when registered',
  'concealed-cisterns-and-flush-plates': '5 year guarantee when registered',
  'taps': '15 year guarantee when registered',
  'wastes': '15 year guarantee when registered',
  'thermostatic-valves': '15 year guarantee when registered',
  'showering': '15 year guarantee when registered',
  'accessories-and-mirrors': '15 year guarantee when registered'
})[catSlug];

function guaranteeLine(cat, range) {
  if (cat.slug === 'furniture-and-basins') {
    if (/basins|slabs|counter-top/.test(range.slug)) {
      return /slabs/.test(range.slug) ? 'Quality guaranteed' : '25 year guarantee when registered';
    }
    return '10 year guarantee when registered';
  }
  if (cat.slug === 'accessories-and-mirrors' && range.slug === 'scene') {
    return '5 year guarantee when registered (2 years on electrical components)';
  }
  return guaranteeFor(cat.slug) || 'Quality guaranteed';
}

/* ---------------- layout ---------------- */
const FAVICON = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#1c1b18"/><text x="32" y="44" font-family="Georgia,serif" font-size="36" fill="#f4efe4" text-anchor="middle">A</text></svg>`
)}`;

const navModel = [
  { href: '/products/', label: 'Products', children: categories.map(c => ({ href: `/products/${c.slug}/`, label: c.name })) },
  { href: '/inspiration/', label: 'Inspiration' },
  { href: '/about/', label: 'About' },
  { href: '/support/', label: 'Support' },
  { href: '/contact/', label: 'Contact' }
];

function layout({ title, desc, path, body, extraHead = '', extraBody = '' }) {
  const nav = navModel.map(item => {
    const active = path.startsWith(item.href) ? ' active' : '';
    const drop = item.children ? `<div class="menu-drop">${item.children.map(c => `<a href="${c.href}">${esc(c.label)}</a>`).join('')}</div>` : '';
    return `<div><a class="navlink${active}" href="${item.href}">${esc(item.label)}</a>${drop}</div>`;
  }).join('');

  const mobileNav = navModel.map(item => {
    const subs = item.children ? item.children.map(c => `<a class="sub" href="${c.href}">${esc(c.label)}</a>`).join('') : '';
    return `<a class="big" href="${item.href}">${esc(item.label)}</a>${subs}`;
  }).join('');

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="icon" href="${FAVICON}">
<link rel="stylesheet" href="/styles.css">
${extraHead}
</head>
<body>
<div class="topline">
  <div class="container">
    <span class="hide-m">Considered design in form &amp; function</span>
    <span><a class="tel" href="tel:01225251204">01225 251204</a><span style="margin:0 12px;color:#4c463b">|</span><a href="mailto:${site.email}">${site.email}</a></span>
  </div>
</div>
<header class="site">
  <div class="container">
    <a href="/" aria-label="ARMERA home"><img class="logo-img" src="${ASSETS}/brand/logo.png" alt="ARMERA"></a>
    <nav class="primary" aria-label="Primary">${nav}</nav>
    <button class="burger" aria-label="Open menu"><span></span><span></span><span></span></button>
  </div>
</header>
<div class="mobile-menu" role="dialog" aria-label="Menu">
  <div class="inner">
    <div class="close-row">
      <img class="logo-img" src="${ASSETS}/brand/logo.png" alt="ARMERA" style="height:20px">
      <button class="close btn" style="margin:0;padding:10px 22px">Close</button>
    </div>
    ${mobileNav}
    <p class="small" style="margin-top:34px">${site.phone} &nbsp;·&nbsp; ${site.email}</p>
  </div>
</div>
<main>
${body}
</main>
<footer class="site">
  <div class="container">
    <div class="grid-foot">
      <div class="brand">
        <img class="logo-img" src="${ASSETS}/brand/logo-light.png" alt="ARMERA">
        <p>Affordable luxury within an easy to comprehend &amp; coordinated bathroomware portfolio that harnesses detail in design.</p>
      </div>
      <div>
        <h5>Products</h5>
        <ul>${categories.map(c => `<li><a href="/products/${c.slug}/">${esc(c.name)}</a></li>`).join('')}</ul>
      </div>
      <div>
        <h5>Company</h5>
        <ul>
          <li><a href="/about/">About ARMERA</a></li>
          <li><a href="/inspiration/">Inspiration</a></li>
          <li><a href="/support/">Support</a></li>
          <li><a href="/support/instructions/">Instructions</a></li>
          <li><a href="/contact/">Contact us</a></li>
        </ul>
      </div>
      <div>
        <h5>Contact</h5>
        <ul>
          <li><a href="tel:01225251204">${site.phone}</a></li>
          <li><a href="mailto:${site.email}">${site.email}</a></li>
          <li style="margin-top:14px;font-size:13.5px;line-height:1.7;color:#8d8677">${esc(site.address)}</li>
        </ul>
      </div>
    </div>
    <div class="fine">
      <span>© ${new Date().getFullYear()} ARMERA. All rights reserved.</span>
      <span>Our products conform to the Water Regulatory Advisory Scheme (WRAS)</span>
      <span>${esc(site.priceNote)}</span>
    </div>
  </div>
</footer>
<script src="/site.js" defer></script>
${extraBody}
</body>
</html>`;
}

function crumbs(items) {
  return `<div class="container"><nav class="crumbs" aria-label="Breadcrumb">${items
    .map((c, i) => i === items.length - 1
      ? `<em>${esc(c.label)}</em>`
      : `<a href="${c.href}">${esc(c.label)}</a><span class="sep">/</span>`)
    .join('')}</nav></div>`;
}

function write(path, html) {
  const full = join(DIST, path);
  mkdirSync(dirname(full), { recursive: true });
  // Rewrite site-internal absolute URLs onto the configured base path.
  if (BASE) html = html.replaceAll('href="/', `href="${BASE}/`).replaceAll('src="/', `src="${BASE}/`);
  writeFileSync(full, html);
}

/* ---------------- home ---------------- */
function homePage() {
  const featured = [
    { cat: 'furniture-and-basins', range: 'atoll-furniture' },
    { cat: 'furniture-and-basins', range: 'palladium-furniture' },
    { cat: 'furniture-and-basins', range: 'holloway-furniture' },
    { cat: 'accessories-and-mirrors', range: 'scene' }
  ].map(({ cat, range }) => {
    const c = categories.find(x => x.slug === cat);
    const r = c.ranges.find(x => x.slug === range);
    return { c, r };
  });

  const body = `
<div class="hero">
  <img src="${lifeImg('p008_01.png')}" alt="Two Palladium wall hung units in Walnut glow with Vaere monobasin mixers in brushed gold" fetchpriority="high">
  <div class="veil"></div>
  <div class="content">
    <div class="container">
      <span class="eyebrow">Bathroomware, considered</span>
      <h1>Designed to inspire</h1>
      <p class="lede">Thoughtful interiors created by striking &amp; beautiful bathroomware — a complete and coordinated collection, finished to the finest detail.</p>
      <a class="btn" href="/products/">Explore the collection</a>
    </div>
  </div>
</div>

<section class="pad">
  <div class="container">
    <div class="section-head rv">
      <div>
        <span class="eyebrow">The collection</span>
        <h2>Every element of the bathroom, coordinated</h2>
      </div>
      <a class="more" href="/products/">All products</a>
    </div>
    <div class="grid grid--4">
      ${categories.map((c, i) => `
      <a class="tile rv" href="/products/${c.slug}/" style="transition-delay:${(i % 4) * 70}ms">
        <div class="frame"><img src="${lifeImg(c.hero.img)}" alt="${esc(c.name)}" loading="lazy"></div>
        <div class="meta">
          <div class="name">${esc(c.name)}</div>
          <div class="sub">${c.ranges.length} ${c.ranges.length === 1 ? 'range' : 'ranges'}</div>
          <span class="cue">View range</span>
        </div>
      </a>`).join('')}
    </div>
  </div>
</section>

<section class="pad--tight">
  <div class="container">
    <div class="split">
      <div class="imgwrap rv"><img src="${lifeImg('p013_01.png')}" alt="Palladium 600mm unit with hidden internal drawer and organiser in Natural oak" loading="lazy"></div>
      <div class="copy rv">
        <span class="eyebrow">Founded on experience &amp; passion</span>
        <h2>Considered design in form and function</h2>
        <p>ARMERA is the creation of a committed and personable team with over 20 years’ experience in bathrooms, product design and interiors. Our promise is to provide considered design in form and function, a complete and seductive offering, and a close partnership-approach with our customers.</p>
        <p>We are not always trying to re-invent the wheel — we also sensibly look at what already works well, and make it better by focusing on the design detail, striking a perfect balance between old and new.</p>
        <a class="btn" href="/about/">Our story</a>
      </div>
    </div>
  </div>
</section>

<section class="pad">
  <div class="container">
    <div class="section-head rv">
      <div>
        <span class="eyebrow">Signature ranges</span>
        <h2>Pieces that define a room</h2>
      </div>
    </div>
    <div class="grid grid--4">
      ${featured.map(({ c, r }, i) => `
      <a class="tile rv" href="/products/${c.slug}/${r.slug}/" style="transition-delay:${i * 70}ms">
        <div class="frame frame--tall"><img src="${lifeImg(r.hero.img)}" alt="${esc(r.name)}" loading="lazy"></div>
        <div class="meta">
          <div class="name">${esc(r.name)}</div>
          <div class="sub">${esc(r.tagline)}</div>
          <span class="cue">Discover</span>
        </div>
      </a>`).join('')}
    </div>
  </div>
</section>

<section class="band-dark pad">
  <div class="container">
    <div class="split">
      <div class="copy rv">
        <span class="eyebrow">Special finishes</span>
        <h2>Coordinated across the entire range</h2>
        <p>Special finish options include the sleek brushed black, an elegant brushed gold and the smart brushed stainless steel. Match your brassware in your chosen finish to accessories, flush plates, toilet hinge cover caps, basin wastes and overflows.</p>
        <p>We have an array of colour and finish options for our furniture, ranging from our opulent Walnut Noir to the contemporary Cavern Blue.</p>
        <a class="btn" href="/products/taps/">Explore brassware</a>
      </div>
      <div class="imgwrap rv"><img src="${lifeImg('p066_01.png')}" alt="Oculus wall mounted basin mixer in brushed gold with co-ordinated click clack waste" loading="lazy"></div>
    </div>
    <div class="gband" style="margin-top:clamp(60px,8vw,110px)">
      ${site.guarantee.map(g => `
      <div class="cell rv">
        <div class="years">${g.years}<small>year guarantee</small></div>
        <p>${esc(g.covers)}</p>
      </div>`).join('')}
    </div>
    <p class="rv" style="font-size:12.5px;margin-top:34px;color:#847d6e">${esc(site.guaranteeNote)}</p>
  </div>
</section>

<section class="pad">
  <div class="container">
    <div class="section-head rv">
      <div>
        <span class="eyebrow">Inspiration</span>
        <h2>Rooms to linger in</h2>
      </div>
      <a class="more" href="/inspiration/">View the gallery</a>
    </div>
    <div class="grid grid--3">
      ${inspiration.slice(0, 3).map((im, i) => `
      <a class="tile rv" href="/inspiration/" style="transition-delay:${i * 70}ms">
        <div class="frame frame--tall"><img src="${ASSETS}/${im.file}" alt="ARMERA bathroom inspiration" loading="lazy"></div>
      </a>`).join('')}
    </div>
  </div>
</section>`;

  write('index.html', layout({
    title: 'ARMERA — Designer Bathroomware | Designed to Inspire',
    desc: 'ARMERA brings affordable luxury within an easy to comprehend & coordinated bathroomware portfolio that harnesses detail in design.',
    path: '/',
    body
  }));
}

/* ---------------- products index ---------------- */
function productsIndex() {
  const body = `
${crumbs([{ label: 'Home', href: '/' }, { label: 'Products' }])}
<section class="pad--tight">
  <div class="container">
    <span class="eyebrow rv">The collection</span>
    <h1 class="rv" style="max-width:16ch;margin:14px 0 18px">Products</h1>
    <p class="lede rv" style="max-width:60ch">A complete and coordinated bathroomware portfolio — furniture, ceramics, brassware, showering and accessories, designed to work beautifully together.</p>
  </div>
</section>
<section class="pad--tight">
  <div class="container">
    <div class="grid grid--2">
      ${categories.map((c, i) => `
      <a class="tile rv" href="/products/${c.slug}/" style="transition-delay:${(i % 2) * 80}ms">
        <div class="frame"><img src="${lifeImg(c.hero.img)}" alt="${esc(c.hero.caption)}" loading="lazy"></div>
        <div class="meta">
          <div class="name">${esc(c.name)}</div>
          <div class="sub">${c.ranges.map(r => r.name).join(' · ')}</div>
          <span class="cue">View</span>
        </div>
      </a>`).join('')}
    </div>
  </div>
</section>`;

  write('products/index.html', layout({
    title: 'Products — ARMERA',
    desc: 'Explore the ARMERA collection: furniture & basins, WCs, concealed cisterns & flush plates, taps, wastes, thermostatic valves, showering and accessories.',
    path: '/products/',
    body
  }));
}

/* ---------------- category pages ---------------- */
function categoryPage(cat) {
  const body = `
${crumbs([{ label: 'Home', href: '/' }, { label: 'Products', href: '/products/' }, { label: cat.name }])}
<section class="pad--tight">
  <div class="container">
    <span class="eyebrow rv">The collection</span>
    <h1 class="rv" style="margin:14px 0 0">${esc(cat.name)}</h1>
  </div>
</section>
<section class="pad--tight">
  <div class="container">
    <div class="grid grid--3">
      ${cat.ranges.map((r, i) => `
      <a class="tile rv" href="/products/${cat.slug}/${r.slug}/" style="transition-delay:${(i % 3) * 70}ms">
        <div class="frame"><img src="${lifeImg(r.hero.img)}" alt="${esc(r.hero.caption)}" loading="lazy"></div>
        <div class="meta">
          <div class="name">${esc(r.title)}</div>
          <div class="sub">${esc(r.tagline)}</div>
          <span class="cue">View range</span>
        </div>
      </a>`).join('')}
    </div>
  </div>
</section>`;

  write(`products/${cat.slug}/index.html`, layout({
    title: `${cat.name} — ARMERA`,
    desc: `${cat.name} by ARMERA: ${cat.ranges.map(r => r.name).join(', ')}.`,
    path: `/products/`,
    body
  }));
}

/* ---------------- range pages ---------------- */
function swatchChip(s) {
  return s.img
    ? `style="background-image:url('${swatchImg(s.img)}')"`
    : `class="chip chip--plain"`;
}

function addonBlock(addons, heading = 'Why not add…') {
  if (!addons || !addons.length) return '';
  return `
  <div class="addons">
    <span class="eyebrow">Complete the look</span>
    <h3 style="margin-top:12px">${esc(heading)}</h3>
    <div class="grid grid--2" style="margin-top:26px">
      ${addons.map(a => `
      <div class="addon-card rv">
        <div class="pic"><img src="${prodImg(a.image)}" alt="${esc(a.name)}" loading="lazy"></div>
        <div class="body">
          <h4>${esc(a.name)}</h4>
          <ul>
            ${a.variants.map(v => `<li><span><span class="sku">${esc(v.sku)}</span>${esc(v.finish)}</span><span class="p">${money(v.price)}</span></li>`).join('')}
          </ul>
        </div>
      </div>`).join('')}
    </div>
  </div>`;
}

function rangePage(cat, range) {
  const products = range.products.map((p, i) => {
    const img = mainImage(p);
    return `
    <a class="tile rv" href="/products/${cat.slug}/${range.slug}/${p.slug}/" style="transition-delay:${(i % 3) * 60}ms">
      <div class="frame cutout"><img src="${prodImg(img)}" alt="${esc(p.name)}" loading="lazy"></div>
      <div class="meta">
        <div class="name">${esc(p.name)}</div>
        ${p.dims ? `<div class="sub">${esc(p.dims)}${/x/.test(p.dims) ? ' mm' : ''}</div>` : ''}
        <div class="pricefrom">${fromLabel(p)} <span class="small">RRP</span></div>
        <span class="cue">View details</span>
      </div>
    </a>`;
  }).join('');

  const swatches = range.swatches ? `
    <div>
      <span class="eyebrow" style="margin-bottom:16px">Colours</span>
      <div class="swatches" style="margin-top:16px">
        ${range.swatches.map(s => `
        <div class="swatch">
          <div class="chip" ${swatchChip(s)}></div>
          <p>${esc(s.name)}</p>
        </div>`).join('')}
      </div>
    </div>` : (range.features ? `
    <div>
      <span class="eyebrow">In the detail</span>
      <ul style="list-style:none;margin-top:16px">
        ${range.features.map(f => `<li style="padding:9px 0;border-bottom:1px solid var(--line);font-size:14.5px;color:var(--ink-soft)">${esc(f)}</li>`).join('')}
      </ul>
    </div>` : '');

  const body = `
${crumbs([{ label: 'Home', href: '/' }, { label: 'Products', href: '/products/' }, { label: cat.name, href: `/products/${cat.slug}/` }, { label: range.name }])}
<div class="container">
  <figure class="range-hero rv in">
    <img src="${lifeImg(range.hero.img)}" alt="${esc(range.hero.caption)}">
    <figcaption>${esc(range.hero.caption)}</figcaption>
  </figure>
</div>
<section class="pad--tight">
  <div class="container">
    <div class="range-intro">
      <div class="rv">
        <span class="eyebrow">${esc(cat.name)}</span>
        <h1 style="margin:14px 0 18px">${esc(range.title)}</h1>
        <p class="lede" style="max-width:48ch">${esc(range.tagline)}</p>
      </div>
      <div class="rv">${swatches}</div>
    </div>
  </div>
</section>
<section class="pad--tight">
  <div class="container">
    <div class="grid grid--3">${products}</div>
    ${range.footnote ? `<p class="small rv" style="margin-top:38px;max-width:90ch">${esc(range.footnote)}</p>` : ''}
    ${addonBlock(range.addons)}
  </div>
</section>`;

  write(`products/${cat.slug}/${range.slug}/index.html`, layout({
    title: `${range.title} — ${cat.name} — ARMERA`,
    desc: `${range.title}: ${range.tagline}`,
    path: `/products/`,
    body
  }));
}

/* ---------------- product pages ---------------- */
function productPage(cat, range, p) {
  const spread = priceSpread(p);
  const hasColours = !!p.imagesByCode && !!range.swatches;
  const firstCode = hasColours ? p.variants[0].code : null;
  const heroImg = hasColours ? p.imagesByCode[firstCode] : mainImage(p);

  const swatchButtons = hasColours ? `
  <div class="variant-swatches">
    <p class="label">Colour — <b>${esc(p.variants[0].finish)}</b></p>
    <div class="row">
      ${p.variants.map((v, i) => {
        const s = (range.swatches || []).find(x => x.code === v.code);
        const bg = s && s.img ? `background-image:url('${swatchImg(s.img)}')` : 'background:#fff';
        return `<button type="button" class="${i === 0 ? 'on' : ''}" style="${bg}" data-img="${prodImg(p.imagesByCode[v.code])}" data-name="${esc(v.finish)}" data-code="${esc(v.code)}" aria-label="${esc(v.finish)}"></button>`;
      }).join('')}
    </div>
  </div>` : '';

  const gallery = p.gallery ? `
  <div class="thumbs">
    <button type="button" class="on" data-img="${prodImg(mainImage(p))}"><img src="${prodImg(mainImage(p))}" alt=""></button>
    ${p.gallery.map(g => `<button type="button" data-img="${prodImg(g)}"><img src="${prodImg(g)}" alt=""></button>`).join('')}
  </div>` : '';

  const finishCol = hasColours ? 'Colour' : 'Finish / option';
  const table = `
  <table class="pricing">
    <caption>Options &amp; pricing</caption>
    <thead><tr><th>Code</th><th>${finishCol}</th><th class="price">RRP</th></tr></thead>
    <tbody>
      ${p.variants.map(v => `<tr${v.code ? ` data-code="${esc(v.code)}"` : ''}><td class="sku">${esc(v.sku)}</td><td>${esc(v.finish)}</td><td class="price">${money(v.price)}</td></tr>`).join('')}
    </tbody>
  </table>`;

  const notes = [p.note, ...(p.notes || [])].filter(Boolean);
  const basinNote = p.basinLink
    ? `<p class="footnote">Pair with a ceramic basin from the <a href="/products/furniture-and-basins/${p.basinLink}/" style="border-bottom:1px solid var(--line-dark)">${p.basinLink === 'in-cabinet-ceramic-basins' ? 'in-cabinet ceramic basins' : 'Reef/Holloway ceramic basins'}</a> range.</p>`
    : '';

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'Product',
    name: `${range.name} ${p.name}`, brand: { '@type': 'Brand', name: 'ARMERA' },
    image: prodImg(heroImg),
    offers: { '@type': 'AggregateOffer', priceCurrency: 'GBP', lowPrice: spread.min, highPrice: spread.max, offerCount: p.variants.length }
  };

  const body = `
${crumbs([{ label: 'Home', href: '/' }, { label: 'Products', href: '/products/' }, { label: cat.name, href: `/products/${cat.slug}/` }, { label: range.name, href: `/products/${cat.slug}/${range.slug}/` }, { label: p.name }])}
<section class="pad--tight">
  <div class="container">
    <div class="pdp">
      <div class="stage rv in">
        <div class="inner"><img src="${prodImg(heroImg)}" alt="${esc(range.name)} ${esc(p.name)}"></div>
        ${gallery}
      </div>
      <div class="info">
        <span class="eyebrow">${esc(range.title)}</span>
        <h1>${esc(p.name)}</h1>
        ${p.dims ? `<p class="dims">${esc(p.dims)}${/x/.test(p.dims) ? ' mm' : ''}</p>` : ''}
        <p class="from">${fromLabel(p)}<span class="inc">RRP inc. VAT</span></p>
        ${swatchButtons}
        ${table}
        ${notes.map(n => `<p class="note">${esc(n)}</p>`).join('')}
        ${basinNote}
        ${p.footnote ? `<p class="footnote">${esc(p.footnote)}</p>` : ''}
        <div class="assure">
          <span>${esc(guaranteeLine(cat, range))}</span>
          <span>WRAS compliant</span>
          <span>Available through ARMERA retail partners</span>
        </div>
      </div>
    </div>
    ${addonBlock(range.addons)}
    ${range.footnote ? `<p class="small" style="margin-top:30px;max-width:90ch">${esc(range.footnote)}</p>` : ''}
  </div>
</section>
<section class="pad--tight">
  <div class="container">
    <div class="section-head">
      <div>
        <span class="eyebrow">More from this range</span>
        <h2 style="font-size:clamp(24px,2.6vw,34px)">${esc(range.title)}</h2>
      </div>
      <a class="more" href="/products/${cat.slug}/${range.slug}/">View all</a>
    </div>
    <div class="grid grid--4">
      ${range.products.filter(x => x.slug !== p.slug).slice(0, 4).map(x => `
      <a class="tile" href="/products/${cat.slug}/${range.slug}/${x.slug}/">
        <div class="frame cutout"><img src="${prodImg(mainImage(x))}" alt="${esc(x.name)}" loading="lazy"></div>
        <div class="meta">
          <div class="name" style="font-size:19px">${esc(x.name)}</div>
          <div class="pricefrom">${fromLabel(x)}</div>
        </div>
      </a>`).join('')}
    </div>
  </div>
</section>`;

  write(`products/${cat.slug}/${range.slug}/${p.slug}/index.html`, layout({
    title: `${p.name} — ${range.title} — ARMERA`,
    desc: `${range.name} ${p.name}. ${fromLabel(p)} RRP inc. VAT. ${p.dims ? `Dimensions ${p.dims}mm.` : ''}`,
    path: `/products/`,
    body,
    extraHead: `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>`
  }));
}

/* ---------------- inspiration ---------------- */
function inspirationPage() {
  const body = `
${crumbs([{ label: 'Home', href: '/' }, { label: 'Inspiration' }])}
<section class="pad--tight">
  <div class="container">
    <span class="eyebrow rv">Gallery</span>
    <h1 class="rv" style="margin:14px 0 18px">Inspiration</h1>
    <p class="lede rv" style="max-width:58ch">Thoughtful interiors created by striking &amp; beautiful bathroomware. A collection of rooms and details to spark your next project.</p>
  </div>
</section>
<section class="pad--tight">
  <div class="container">
    <div class="masonry">
      ${inspiration.map((im, i) => `
      <figure class="rv" style="transition-delay:${(i % 3) * 60}ms">
        <img src="${ASSETS}/${im.file}" data-full="${ASSETS}/${im.file}" alt="ARMERA bathroom inspiration" loading="lazy" width="${im.w}" height="${im.h}">
      </figure>`).join('')}
    </div>
  </div>
</section>
<div class="lightbox" role="dialog" aria-label="Image viewer">
  <button class="x">Close</button>
  <button class="nav prev" aria-label="Previous">‹</button>
  <img src="" alt="ARMERA bathroom inspiration">
  <button class="nav next" aria-label="Next">›</button>
</div>`;

  write('inspiration/index.html', layout({
    title: 'Inspiration — ARMERA',
    desc: 'Bathroom inspiration from ARMERA — thoughtful interiors created by striking & beautiful bathroomware.',
    path: '/inspiration/',
    body
  }));
}

/* ---------------- about ---------------- */
function aboutPage() {
  const sections = [
    {
      side: 'Who we are',
      paras: [
        'Founded on experience & passion, ARMERA is the creation of a committed and personable team with over 20 years’ experience in bathrooms, product design and interiors. Our promise is to provide considered design in form and function, a complete and seductive offering, and a close partnership-approach with our customers.',
        'Our approach towards our sales channel is to partner with retailers ensuring the final customer receives great advice and service. Our partnership distribution strategy, devotion to detailed design, and trusted personal service embodies who we are.'
      ]
    },
    {
      side: 'Our design process',
      paras: [
        'Our design process is born out of genuine passion and love of our products. We have listened and learnt from the market, from end consumers to installers, retailers to project specifiers, interior designers and contract partners. We have engineered new technologies and solutions that make life safer and easier. We have designed products to create well-proportioned, beautiful bathroomware which delivers a superior experience.',
        'We are not always trying to re-invent the wheel, we also sensibly look at what already works well, and make it better by focusing on the design detail, striking a perfect balance between old and new.'
      ]
    },
    {
      side: 'Finishes',
      paras: [
        'We offer special finishes coordinated across the entire range. Special finish options include the sleek brushed black, an elegant brushed gold and the smart brushed stainless steel. Customers can match their brassware in their chosen finish to accessories, flush plates, toilet hinge cover caps, basin wastes and overflows. We have an array of colour and finish options for our furniture, ranging from our opulent Walnut Noir to the contemporary Cavern Blue.'
      ]
    },
    {
      side: 'Manufacturing',
      paras: [
        'Manufacturing is in accordance with the strictest of quality processes and standards, implemented with years of experience in this field. This results in true manufacturing excellence, culminating in guaranteed technically and aesthetically superior products.',
        'Our products conform to the Water Regulatory Advisory Scheme (WRAS), and are designed and manufactured with sustainability in mind, incorporating water-saving and flow-regulated technology. All of our products are quality-guaranteed.'
      ]
    },
    {
      side: 'In partnership',
      paras: [
        'We love our industry, our business, our products and our customers. Thanks for working in partnership with ARMERA to ultimately provide a gratifying and superior bathroom experience.'
      ]
    }
  ];

  const body = `
${crumbs([{ label: 'Home', href: '/' }, { label: 'About' }])}
<section class="pad--tight">
  <div class="container">
    <span class="eyebrow rv">About ARMERA</span>
    <h1 class="rv" style="margin:14px 0 26px;max-width:18ch">Founded on experience &amp; passion</h1>
  </div>
</section>
<div class="container rv">
  <figure class="range-hero" style="margin-top:0">
    <img src="${lifeImg('p002_01.png')}" alt="ARMERA bathroom with Palladium furniture and Vaere brassware">
  </figure>
</div>
<section class="pad--tight">
  <div class="container container--mid">
    ${sections.map(s => `
    <div class="about-grid rv">
      <div class="side">${esc(s.side)}</div>
      <div class="body">${s.paras.map(t => `<p>${esc(t)}</p>`).join('')}</div>
    </div>`).join('')}
  </div>
</section>
<section class="band-dark pad">
  <div class="container">
    <span class="eyebrow rv">Quality, guaranteed</span>
    <h2 class="rv" style="margin:14px 0 40px">Guarantees you can build on</h2>
    <div class="gband">
      ${site.guarantee.map(g => `
      <div class="cell rv">
        <div class="years">${g.years}<small>year guarantee</small></div>
        <p>${esc(g.covers)}</p>
      </div>`).join('')}
    </div>
    <p class="rv" style="font-size:12.5px;margin-top:34px;color:#847d6e">${esc(site.guaranteeNote)}</p>
  </div>
</section>`;

  write('about/index.html', layout({
    title: 'About — ARMERA',
    desc: 'Founded on experience & passion, ARMERA is the creation of a committed and personable team with over 20 years’ experience in bathrooms, product design and interiors.',
    path: '/about/',
    body
  }));
}

/* ---------------- support ---------------- */
function supportPage() {
  const body = `
${crumbs([{ label: 'Home', href: '/' }, { label: 'Support' }])}
<section class="pad--tight">
  <div class="container">
    <span class="eyebrow rv">We’re here to help</span>
    <h1 class="rv" style="margin:14px 0 18px">Support</h1>
    <p class="lede rv" style="max-width:56ch">Advice, spares and documentation for your ARMERA products — backed by trusted personal service.</p>
  </div>
</section>
<section class="pad--tight">
  <div class="container">
    <div class="info-cards">
      <div class="info-card rv">
        <span class="eyebrow">Spares</span>
        <h3>Spares &amp; advice</h3>
        <p>For spares, please contact us on <a href="tel:01225251204" style="border-bottom:1px solid var(--line-dark)">01225 251204</a> for advice on spares.</p>
        <a class="link" href="tel:01225251204">Call 01225 251204</a>
      </div>
      <div class="info-card rv" style="transition-delay:80ms">
        <span class="eyebrow">Documentation</span>
        <h3>Instructions</h3>
        <p>Installation and product instructions for the ARMERA collection, available to view and download as PDF.</p>
        <a class="link" href="/support/instructions/">View instructions</a>
      </div>
      <div class="info-card rv" style="transition-delay:160ms">
        <span class="eyebrow">Guarantee</span>
        <h3>Register your product</h3>
        <p>2 years guarantee for parts &amp; labour as standard — extended up to 25 years for parts only when registered on armera.co.uk.</p>
        <a class="link" href="/about/">Guarantee details</a>
      </div>
    </div>
    <div class="info-cards" style="margin-top:clamp(18px,2.4vw,34px);grid-template-columns:1fr">
      <div class="info-card rv" style="min-height:0;flex-direction:row;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap">
        <div>
          <span class="eyebrow">Brochure</span>
          <h3 style="margin-bottom:6px">March 2026 Collection catalogue</h3>
          <p style="flex-grow:0">The complete ARMERA collection with pricing, finishes and dimensions.</p>
        </div>
        <a class="btn btn--solid" style="margin-top:0" href="${ASSETS}/documents/ARMERA-Catalogue-March-2026.pdf" target="_blank" rel="noopener">Download catalogue</a>
      </div>
    </div>
  </div>
</section>`;

  write('support/index.html', layout({
    title: 'Support — ARMERA',
    desc: 'ARMERA support: spares advice on 01225 251204, product instructions and guarantee registration.',
    path: '/support/',
    body
  }));
}

function instructionsPage() {
  const cfg = { supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY, instructionsBucket: INSTRUCTIONS_BUCKET, assetsBase: ASSETS };
  const body = `
${crumbs([{ label: 'Home', href: '/' }, { label: 'Support', href: '/support/' }, { label: 'Instructions' }])}
<section class="pad--tight">
  <div class="container">
    <span class="eyebrow rv">Documentation</span>
    <h1 class="rv" style="margin:14px 0 18px">Instructions</h1>
    <p class="lede rv" style="max-width:56ch">Installation and product instructions for the ARMERA collection. Select a document to view or download the PDF.</p>
  </div>
</section>
<section class="pad--tight">
  <div class="container">
    <div class="pdf-grid" id="pdf-grid"></div>
    <div class="empty-note" id="pdf-empty" style="display:none">
      Instruction documents are being added. In the meantime, please call <a href="tel:01225251204" style="border-bottom:1px solid var(--line-dark)">01225 251204</a> or email <a href="mailto:${site.email}" style="border-bottom:1px solid var(--line-dark)">${site.email}</a> and we will gladly help.
    </div>
  </div>
</section>`;

  write('support/instructions/index.html', layout({
    title: 'Instructions — Support — ARMERA',
    desc: 'Installation and product instructions for the ARMERA collection, available as PDF downloads.',
    path: '/support/',
    body,
    extraBody: `<script>window.ARMERA_CFG=${JSON.stringify(cfg)}</script><script src="/instructions.js" type="module"></script>`
  }));
}

/* ---------------- contact ---------------- */
function contactPage() {
  const body = `
${crumbs([{ label: 'Home', href: '/' }, { label: 'Contact' }])}
<section class="pad--tight">
  <div class="container">
    <span class="eyebrow rv">Contact us</span>
    <h1 class="rv" style="margin:14px 0 30px">We’d love to talk<br>bathrooms.</h1>
    <p class="bigline rv"><a href="tel:01225251204">01225 251204</a></p>
    <p class="bigline rv" style="margin-top:6px"><a href="mailto:${site.email}">${site.email}</a></p>
    <div class="contact-list rv" style="max-width:860px">
      <div class="row">
        <div class="k">Telephone</div>
        <div><a href="tel:01225251204">${site.phone}</a></div>
      </div>
      <div class="row">
        <div class="k">Email</div>
        <div><a href="mailto:${site.email}">${site.email}</a></div>
      </div>
      <div class="row">
        <div class="k">Address</div>
        <div>${esc(site.address)}</div>
      </div>
      <div class="row">
        <div class="k">Spares</div>
        <div>For spares, please contact us on ${site.phone} for advice.</div>
      </div>
    </div>
  </div>
</section>
<div class="container rv" style="margin-top:20px">
  <figure class="range-hero" style="margin-top:0">
    <img src="${lifeImg('p014_01.png')}" alt="Lagoon wall hung WC with Halo flush plate in brushed gold and Atoll unit in graphite grey">
  </figure>
</div>`;

  write('contact/index.html', layout({
    title: 'Contact — ARMERA',
    desc: 'Contact ARMERA on 01225 251204 or info@armera.co.uk.',
    path: '/contact/',
    body
  }));
}

/* ---------------- build ---------------- */
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
writeFileSync(join(DIST, '.nojekyll'), '');

// static files (CSS gets the Supabase assets base injected)
const css = readFileSync(join(ROOT, 'static/styles.css'), 'utf8').replaceAll('ASSETS', ASSETS);
writeFileSync(join(DIST, 'styles.css'), css);
writeFileSync(join(DIST, 'site.js'), readFileSync(join(ROOT, 'static/site.js')));
writeFileSync(join(DIST, 'instructions.js'), readFileSync(join(ROOT, 'static/instructions.js')));

homePage();
productsIndex();
let pageCount = 3;
for (const cat of categories) {
  categoryPage(cat);
  pageCount++;
  for (const range of cat.ranges) {
    rangePage(cat, range);
    pageCount++;
    for (const p of range.products) {
      productPage(cat, range, p);
      pageCount++;
    }
  }
}
inspirationPage();
aboutPage();
supportPage();
instructionsPage();
contactPage();
pageCount += 5;

console.log(`Built ${pageCount} pages into docs/${BASE ? ` (base path ${BASE})` : ''}`);
