#!/usr/bin/env node
// ARMERA static site generator.
// Static pages (home, inspiration, about, support, contact) are fully baked.
// The /products tree is generated as shell pages rendered at runtime by catalog.js
// from the Supabase `site_content` table, so the admin area can add/edit/remove
// ranges and products without a rebuild. All assets live in Supabase Storage.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = dirname(fileURLToPath(import.meta.url));
// Output to docs/ (served by GitHub Pages from the main branch).
const DIST = join(ROOT, 'docs');
// Site base path. '' for a custom domain / root site; '/<repo>' for GitHub project pages.
const BASE = process.env.BASE_PATH ?? '';

const SUPABASE_URL = 'https://pcouznwpyhtfrleedcsv.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjb3V6bndweWh0ZnJsZWVkY3N2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NjM3NzIsImV4cCI6MjA5OTQzOTc3Mn0.pNRCs82pde-0vMnaTh6ygtQNeWKgFS2s3lrIkhM8uZU';
const ASSETS = `${SUPABASE_URL}/storage/v1/object/public/site-assets`;
const INSTRUCTIONS_BUCKET = 'instructions';

// Short content hashes for cache-busting: a changed file gets a new URL, so a
// browser can never pair a stale stylesheet with fresh scripts.
const STATIC_FILES = ['styles.css', 'site.js', 'search.js', 'track.js', 'guarantee.js', 'catalog.js', 'instructions.js', 'videos.js', 'retailers.js', 'admin.js'];
const assetVersions = Object.fromEntries(STATIC_FILES.map(f => [
  f, createHash('sha1').update(readFileSync(join(ROOT, 'static', f))).digest('hex').slice(0, 8)
]));
const v = f => `/${f}?v=${assetVersions[f]}`;

const site = JSON.parse(readFileSync(join(ROOT, 'data/site.json'), 'utf8'));
const categories = readdirSync(join(ROOT, 'data/categories')).sort()
  .map(f => JSON.parse(readFileSync(join(ROOT, 'data/categories', f), 'utf8')));
const inspiration = JSON.parse(readFileSync(join(ROOT, 'data/inspiration.json'), 'utf8'));

// The homepage hero is chosen in the admin. Bake the current choice straight
// into the HTML so the browser requests that file and nothing else — otherwise
// it loads a default image first and swaps, which shows the wrong picture.
let livePages = {};
try {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/site_content?key=eq.pages&select=data`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }
  });
  const rows = await res.json();
  livePages = (rows && rows[0] && rows[0].data) || {};
  console.log('Homepage hero:', livePages?.home?.hero ? `${livePages.home.hero.type} — ${livePages.home.hero.file}` : 'default photograph');
} catch (e) {
  console.log('Could not reach Supabase for page settings; using the default hero.');
}

const DEFAULT_HERO_ALT = 'Two Palladium wall hung units in Walnut glow with Vaere monobasin mixers in brushed gold';
function heroMarkup() {
  const h = (livePages.home && livePages.home.hero) || null;
  if (!h || !h.file) {
    return `<img id="hero-media" data-hero-file="p008_01.png" src="${lifeImg('p008_01.png')}" alt="${DEFAULT_HERO_ALT}" fetchpriority="high">`;
  }
  const path = h.file.includes('/') ? h.file : `lifestyle/${h.file}`;
  const url = `${ASSETS}/${path.split('/').map(encodeURIComponent).join('/')}`;
  if (h.type === 'video') {
    const poster = h.poster
      ? ` poster="${ASSETS}/${(h.poster.includes('/') ? h.poster : `lifestyle/${h.poster}`).split('/').map(encodeURIComponent).join('/')}"`
      : '';
    return `<video id="hero-media" data-hero-file="${esc(h.file)}" src="${url}"${poster} autoplay muted loop playsinline preload="auto" aria-label="${esc(h.alt || DEFAULT_HERO_ALT)}"></video>`;
  }
  return `<img id="hero-media" data-hero-file="${esc(h.file)}" src="${url}" alt="${esc(h.alt || DEFAULT_HERO_ALT)}" fetchpriority="high">`;
}

/* ---------------- helpers ---------------- */
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const lifeImg = f => `${ASSETS}/lifestyle/${f.replace(/\.png$/, '.jpg')}`;

const CFG = {
  supabaseUrl: SUPABASE_URL,
  anonKey: ANON_KEY,
  assets: ASSETS,
  base: BASE,
  instructionsBucket: INSTRUCTIONS_BUCKET
};

// Catalogue: the filename lives in the Supabase `pages` row so the admin can
// swap in a new edition; every link below is tagged data-catalogue and gets
// its href rewritten at runtime by site.js.
const CATALOGUE_FILE = 'ARMERA-Catalogue-March-2026.pdf';
const catHref = `${ASSETS}/documents/${CATALOGUE_FILE}`;
const catLink = (text, cls = 'cat-inline') =>
  `<a class="${cls}" data-catalogue href="${catHref}" target="_blank" rel="noopener">${esc(text)}</a>`;
const catBand = ({ dark = false } = {}) => `
<section class="pad${dark ? '' : '--tight'}${dark ? ' band-dark' : ''}">
  <div class="container">
    <div class="cat-band">
      <div class="cover"><span class="ph" data-catalogue-cover>Catalogue</span></div>
      <div class="copy">
        <span class="eyebrow">The catalogue</span>
        <h2 data-catalogue-title>March 2026 Collection</h2>
        <p>The complete ARMERA collection in one volume — every range, finish and dimension, with recommended retail pricing throughout.</p>
        <a class="btn${dark ? '' : ' btn--solid'}" data-catalogue href="${catHref}" target="_blank" rel="noopener">View the catalogue</a>
      </div>
    </div>
  </div>
</section>`;

/* ---------------- layout ---------------- */
// Favicon: the ARMERA 'A' from the logo, on the brand ink tile.
const FAVICON = `${ASSETS}/brand/favicon-32.png`;

const navModel = [
  { href: '/products/', label: 'Products', children: categories.map(c => ({ href: `/products/${c.slug}/`, label: c.name })) },
  { href: '/inspiration/', label: 'Inspiration' },
  { href: '/about/', label: 'About' },
  { href: '/retailers/', label: 'Find a retailer' },
  { href: '/support/', label: 'Support' },
  { href: '/contact/', label: 'Contact' }
];

function layout({ title, desc, path, body, extraHead = '', extraBody = '', noindex = false }) {
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
${noindex ? '<meta name="robots" content="noindex">' : ''}
<link rel="icon" type="image/png" sizes="32x32" href="${FAVICON}">
<link rel="apple-touch-icon" sizes="180x180" href="${ASSETS}/brand/favicon-180.png">
<link rel="stylesheet" href="${v('styles.css')}">
${extraHead}
</head>
<body>
<div class="topline">
  <div class="container">
    <span class="hide-m">Considered design in form &amp; function</span>
    <span class="hide-m"><a data-catalogue href="${catHref}" target="_blank" rel="noopener">View the catalogue</a><span style="margin:0 12px;color:#4c463b">|</span><a href="/retailers/">Find a retailer</a></span>
    <span><a class="tel" href="tel:01225251204" data-ck="contact.phone">${site.phone}</a><span style="margin:0 12px;color:#4c463b">|</span><a href="mailto:${site.email}" data-ck="contact.email">${site.email}</a></span>
  </div>
</div>
<header class="site">
  <div class="container">
    <a href="/" aria-label="ARMERA home"><img class="logo-img" src="${ASSETS}/brand/logo.png" alt="ARMERA"></a>
    <nav class="primary" aria-label="Primary">${nav}</nav>
    <div class="head-tools">
      <button class="icon-btn js-search-open" aria-label="Search the site">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><line x1="15.8" y1="15.8" x2="21" y2="21"/></svg>
      </button>
      <button class="burger" aria-label="Open menu"><span></span><span></span><span></span></button>
    </div>
  </div>
</header>
<div class="mobile-menu" role="dialog" aria-label="Menu">
  <div class="inner">
    <div class="close-row">
      <img class="logo-img" src="${ASSETS}/brand/logo.png" alt="ARMERA" style="height:20px">
      <button class="close btn" style="margin:0;padding:10px 22px">Close</button>
    </div>
    ${mobileNav}
    <a class="big js-search-open" href="#" role="button">Search</a>
    <p class="small" style="margin-top:34px"><span data-ck="contact.phone">${site.phone}</span> &nbsp;·&nbsp; <span data-ck="contact.email">${site.email}</span></p>
  </div>
</div>
<main>
${body}
</main>
<div class="search-overlay" id="site-search" role="dialog" aria-modal="true" aria-label="Search the site">
  <div class="search-bar">
    <div class="container">
      <svg class="search-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><line x1="15.8" y1="15.8" x2="21" y2="21"/></svg>
      <input id="site-search-input" type="search" placeholder="Search products, ranges, retailers, instructions…" aria-label="Search" autocomplete="off">
      <button class="search-close js-search-close" aria-label="Close search">Close</button>
    </div>
  </div>
  <div class="search-results"><div class="container" id="site-search-results"></div></div>
</div>
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
          <li><a href="/retailers/">Find a retailer</a></li>
          <li><a href="/support/">Support</a></li>
          <li><a href="/support/instructions/">Instructions</a></li>
          <li><a href="/support/how-to-videos/">How-to videos</a></li>
          <li><a href="/register-guarantee/">Register your guarantee</a></li>
          <li><a href="/contact/">Contact us</a></li>
          <li><a data-catalogue href="${catHref}" target="_blank" rel="noopener">Download the catalogue</a></li>
        </ul>
      </div>
      <div>
        <h5>Contact</h5>
        <ul>
          <li><a href="tel:01225251204" data-ck="contact.phone">${site.phone}</a></li>
          <li><a href="mailto:${site.email}" data-ck="contact.email">${site.email}</a></li>
          <li style="margin-top:14px;font-size:13.5px;line-height:1.7;color:#8d8677" data-ck="contact.address">${esc(site.address)}</li>
        </ul>
      </div>
    </div>
    <div class="fine">
      <span>© ${new Date().getFullYear()} ARMERA. All rights reserved.</span>
      <span>Water-using products conform to the Water Regulatory Advisory Scheme (WRAS)</span>
      <span>${esc(site.priceNote)}</span>
    </div>
  </div>
</footer>
<script>window.ARMERA=${JSON.stringify(CFG)}</script>
<script src="${v('site.js')}" defer></script>
<script src="${v('search.js')}" defer></script>
<script src="${v('track.js')}" defer></script>
${extraBody}
</body>
</html>`;
}

function write(path, html) {
  const full = join(DIST, path);
  mkdirSync(dirname(full), { recursive: true });
  // Rewrite site-internal absolute URLs onto the configured base path.
  if (BASE) html = html.replaceAll('href="/', `href="${BASE}/`).replaceAll('src="/', `src="${BASE}/`);
  writeFileSync(full, html);
}

function crumbs(items) {
  return `<div class="container"><nav class="crumbs" aria-label="Breadcrumb">${items
    .map((c, i) => i === items.length - 1
      ? `<em>${esc(c.label)}</em>`
      : `<a href="${c.href}">${esc(c.label)}</a><span class="sep">/</span>`)
    .join('')}</nav></div>`;
}

/* ---------------- home (static, with editable hero text) ---------------- */
function homePage() {
  const banner = `<div class="news-banner" id="news-banner" hidden><div class="container"><p id="news-banner-text"></p></div></div>`;
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
${banner}
<div class="hero" id="hero">
  ${heroMarkup()}
  <div class="veil"></div>
  <div class="content">
    <div class="container">
      <h1 data-ck="home.heading">Designed to inspire</h1>
      <p class="lede" data-ck="home.lede">Thoughtful interiors created by striking &amp; beautiful bathroomware — a complete and coordinated collection, finished to the finest detail.</p>
      <a class="btn" href="/products/">Explore the collection</a>
    </div>
  </div>
</div>

<section class="pad">
  <div class="container">
    <div class="section-head">
      <div>
        <span class="eyebrow">The collection</span>
        <h2>Every element of the bathroom, coordinated</h2>
      </div>
      <a class="more" href="/products/">All products</a>
    </div>
    <div class="grid grid--4">
      ${categories.map(c => `
      <a class="tile" href="/products/${c.slug}/">
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
      <div class="imgwrap"><img src="${lifeImg('p013_01.png')}" alt="Palladium 600mm unit with hidden internal drawer and organiser in Natural oak" loading="lazy"></div>
      <div class="copy">
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
    <div class="section-head">
      <div>
        <span class="eyebrow">Signature ranges</span>
        <h2>Pieces that define a room</h2>
      </div>
    </div>
    <div class="grid grid--4">
      ${featured.map(({ c, r }) => `
      <a class="tile" href="/products/${c.slug}/${r.slug}/">
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
      <div class="copy">
        <h2>Coordinated across the entire range</h2>
        <p>Special finish options include the sleek brushed black, an elegant brushed gold and the smart brushed stainless steel. Match your brassware in your chosen finish to accessories, flush plates, toilet hinge cover caps, basin wastes and overflows.</p>
        <p>We have an array of colour and finish options for our furniture, ranging from our opulent Walnut Noir to the contemporary Cavern Blue.</p>
        <a class="btn" href="/products/taps/">Explore brassware</a>
      </div>
      <div class="imgwrap"><img src="${lifeImg('p066_01.png')}" alt="Oculus wall mounted basin mixer in brushed gold with co-ordinated click clack waste" loading="lazy"></div>
    </div>
    <div class="gband" style="margin-top:clamp(60px,8vw,110px)">
      ${site.guarantee.map(g => `
      <div class="cell">
        <div class="years">${g.years}<small>year guarantee</small></div>
        <p>${esc(g.covers)}</p>
      </div>`).join('')}
    </div>
    <p style="font-size:12.5px;margin-top:34px;color:#a8a294">${esc(site.guaranteeNote)}</p>
  </div>
</section>

${catBand()}

<section class="pad">
  <div class="container">
    <div class="section-head">
      <div>
        <span class="eyebrow">Inspiration</span>
        <h2>Rooms to linger in</h2>
      </div>
      <a class="more" href="/inspiration/">View the gallery</a>
    </div>
    <div class="grid grid--3">
      ${inspiration.slice(0, 3).map(im => `
      <a class="tile" href="/inspiration/">
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

/* ---------------- catalogue shells (rendered at runtime by catalog.js) ---------------- */
function catalogShell(path, title, desc, crumbLabels) {
  const body = `
${crumbLabels ? crumbs(crumbLabels) : ''}
<div id="catalog" class="container" data-shell>
  <section class="pad--tight"><p class="small">Loading the collection…</p></section>
</div>
${catBand()}`;
  write(path, layout({
    title, desc, path: '/products/', body,
    extraBody: `<script src="${v('catalog.js')}" defer></script>`
  }));
}

function catalogShells() {
  catalogShell('products/index.html', 'Products — ARMERA',
    'Explore the ARMERA collection: furniture & basins, WCs, concealed cisterns & flush plates, taps, wastes, thermostatic valves, showering and accessories.');
  for (const cat of categories) {
    catalogShell(`products/${cat.slug}/index.html`, `${cat.name} — ARMERA`, `${cat.name} by ARMERA.`);
    for (const range of cat.ranges) {
      catalogShell(`products/${cat.slug}/${range.slug}/index.html`, `${range.title} — ARMERA`, `${range.title}: ${range.tagline}`);
      for (const p of range.products) {
        catalogShell(`products/${cat.slug}/${range.slug}/${p.slug}/index.html`, `${p.name} — ${range.title} — ARMERA`, `${range.name} ${p.name}.`);
      }
    }
  }
  // 404 doubles as the shell for products added after this build.
  catalogShell('404.html', 'ARMERA', 'ARMERA designer bathroomware.');
}

/* ---------------- inspiration ---------------- */
function inspirationPage() {
  const body = `
${crumbs([{ label: 'Home', href: '/' }, { label: 'Inspiration' }])}
<section class="pad--tight">
  <div class="container">
    <span class="eyebrow">Gallery</span>
    <h1 style="margin:14px 0 18px">Inspiration</h1>
    <p class="lede" style="max-width:58ch">Thoughtful interiors created by striking &amp; beautiful bathroomware. A collection of rooms and details to spark your next project.</p>
  </div>
</section>
<section class="pad--tight">
  <div class="container">
    <div class="masonry">
      ${inspiration.map(im => `
      <figure>
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

/* ---------------- about (sections editable) ---------------- */
const aboutSections = [
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

function aboutBodySections(sections) {
  return sections.map(s => `
    <div class="about-grid">
      <div class="side">${esc(s.side)}</div>
      <div class="body">${s.paras.map(t => `<p>${esc(t)}</p>`).join('')}</div>
    </div>`).join('');
}

function aboutPage() {
  const body = `
${crumbs([{ label: 'Home', href: '/' }, { label: 'About' }])}
<section class="pad--tight">
  <div class="container">
    <span class="eyebrow">About ARMERA</span>
    <h1 style="margin:14px 0 26px;max-width:18ch" data-ck="about.heading">Founded on experience &amp; passion</h1>
  </div>
</section>
<div class="container">
  <figure class="range-hero" style="margin-top:0">
    <img src="${lifeImg('p002_01.png')}" alt="ARMERA bathroom with Palladium furniture and Vaere brassware">
  </figure>
</div>
<section class="pad--tight">
  <div class="container container--mid" data-ck-sections="about.sections">
    ${aboutBodySections(aboutSections)}
  </div>
</section>
${catBand()}
<section class="band-dark pad">
  <div class="container">
    <h2 style="margin:14px 0 40px">Guarantees you can build on</h2>
    <div class="gband">
      ${site.guarantee.map(g => `
      <div class="cell">
        <div class="years">${g.years}<small>year guarantee</small></div>
        <p>${esc(g.covers)}</p>
      </div>`).join('')}
    </div>
    <p style="font-size:12.5px;margin-top:34px;color:#a8a294">${esc(site.guaranteeNote)}</p>
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
    <span class="eyebrow">We’re here to help</span>
    <h1 style="margin:14px 0 18px">Support</h1>
    <p class="lede" style="max-width:56ch">Advice, spares and documentation for your ARMERA products — backed by trusted personal service.</p>
  </div>
</section>
<section class="pad--tight">
  <div class="container">
    <div class="info-cards">
      <div class="info-card">
        <span class="eyebrow">Spares</span>
        <h3>Spares &amp; advice</h3>
        <p data-ck="support.spares">For spares, please contact us on 01225 251204 for advice on spares.</p>
        <a class="link" href="tel:01225251204">Call us</a>
      </div>
      <div class="info-card">
        <span class="eyebrow">Documentation</span>
        <h3>Instructions</h3>
        <p>Installation and product instructions for the ARMERA collection, available to view and download as PDF.</p>
        <a class="link" href="/support/instructions/">View instructions</a>
      </div>
      <div class="info-card">
        <span class="eyebrow">Videos</span>
        <h3>How-to videos</h3>
        <p>Short films covering valve calibration, temperature and flow adjustments, and everyday maintenance.</p>
        <a class="link" href="/support/how-to-videos/">Watch the videos</a>
      </div>
      <div class="info-card">
        <span class="eyebrow">Guarantee</span>
        <h3>Register your product</h3>
        <p>2 years guarantee for parts &amp; labour as standard — extended up to 25 years for parts only when registered.</p>
        <a class="link" href="/register-guarantee/">Register your guarantee</a>
      </div>
    </div>
    <div class="info-cards" style="margin-top:clamp(18px,2.4vw,34px);grid-template-columns:1fr">
      <div class="info-card" style="min-height:0;flex-direction:row;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap">
        <div>
          <span class="eyebrow">Brochure</span>
          <h3 style="margin-bottom:6px" data-catalogue-title>March 2026 Collection</h3>
          <p style="flex-grow:0">The complete ARMERA collection with pricing, finishes and dimensions.</p>
        </div>
        <a class="btn btn--solid" style="margin-top:0" data-catalogue href="${catHref}" target="_blank" rel="noopener">Download catalogue</a>
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
  const body = `
${crumbs([{ label: 'Home', href: '/' }, { label: 'Support', href: '/support/' }, { label: 'Instructions' }])}
<section class="pad--tight">
  <div class="container">
    <span class="eyebrow">Documentation</span>
    <h1 style="margin:14px 0 18px">Instructions</h1>
    <p class="lede" style="max-width:56ch">Installation and product instructions for the ARMERA collection. Select a document to view or download the PDF.</p>
  </div>
</section>
<section class="pad--tight">
  <div class="container">
    <div class="doc-tools">
      <input id="pdf-search" type="search" placeholder="Search instructions by name or product" aria-label="Search instructions">
      <span class="count" id="pdf-count"></span>
    </div>
    <div class="pdf-grid" id="pdf-grid"></div>
    <p class="empty-note" id="pdf-none" style="display:none">No instructions match that search.</p>
    <div class="empty-note" id="pdf-empty" style="display:none">
      Instruction documents are being added. In the meantime, please call <a href="tel:01225251204" style="border-bottom:1px solid var(--line-dark)" data-ck="contact.phone">${site.phone}</a> or email <a href="mailto:${site.email}" style="border-bottom:1px solid var(--line-dark)" data-ck="contact.email">${site.email}</a> and we will gladly help.
    </div>
  </div>
</section>`;

  write('support/instructions/index.html', layout({
    title: 'Instructions — Support — ARMERA',
    desc: 'Installation and product instructions for the ARMERA collection, available as PDF downloads.',
    path: '/support/',
    body,
    extraBody: `<script src="${v('instructions.js')}" type="module"></script>`
  }));
}

function videosPage() {
  const body = `
${crumbs([{ label: 'Home', href: '/' }, { label: 'Support', href: '/support/' }, { label: 'How-to videos' }])}
<section class="pad--tight">
  <div class="container">
    <span class="eyebrow">Videos</span>
    <h1 style="margin:14px 0 18px">How-to videos</h1>
    <p class="lede" style="max-width:56ch">Short films covering valve calibration, temperature and flow adjustments, and everyday maintenance. Each video opens on YouTube.</p>
  </div>
</section>
<section class="pad--tight">
  <div class="container">
    <div class="video-grid" id="video-grid"></div>
    <div class="empty-note" id="video-empty" style="display:none">
      Videos are being added. In the meantime, please call <a href="tel:01225251204" style="border-bottom:1px solid var(--line-dark)" data-ck="contact.phone">${site.phone}</a> and we will gladly talk you through it.
    </div>
  </div>
</section>`;

  write('support/how-to-videos/index.html', layout({
    title: 'How-to videos — Support — ARMERA',
    desc: 'ARMERA how-to videos.',
    path: '/support/',
    body,
    extraBody: `<script src="${v('videos.js')}" defer></script>`
  }));
}


/* ---------------- find a retailer ---------------- */
function retailersPage() {
  const body = `
${crumbs([{ label: 'Home', href: '/' }, { label: 'Find a retailer' }])}
<section class="pad--tight">
  <div class="container">
    <span class="eyebrow">Stockists</span>
    <h1 style="margin:14px 0 18px">Find a retailer</h1>
    <p class="lede" style="max-width:60ch">ARMERA is sold through a network of trusted retail partners, so you can see and feel the products, and get expert advice on your bathroom. Search by town or postcode, or explore the map.</p>
  </div>
</section>
<section class="pad--tight" style="padding-top:0">
  <div class="container">
    <div class="retailer-tools">
      <input id="retailer-search" type="text" placeholder="Town, city or postcode" aria-label="Search retailers by town, city or postcode" autocomplete="postal-code">
      <label class="radius-pick" for="retailer-radius">Within
        <select id="retailer-radius" aria-label="Search radius in miles">
          <option value="5">5 miles</option>
          <option value="15">15 miles</option>
          <option value="30" selected>30 miles</option>
          <option value="50">50 miles</option>
          <option value="100">100 miles</option>
        </select>
      </label>
      <button class="btn" id="retailer-go" type="button">Search</button>
      <button class="clear" id="retailer-clear" type="button" style="display:none">Clear</button>
      <span class="count" id="retailer-count"></span>
    </div>
    <div class="retailer-layout">
      <div id="retailer-map"></div>
      <div class="retailer-list" id="retailer-list"></div>
    </div>
    <div class="empty-note" id="retailer-empty" style="display:none;margin-top:22px">
      No retailers found for that search. Try a nearby town or a wider area, or call <a href="tel:01225251204" style="border-bottom:1px solid var(--line-dark)" data-ck="contact.phone">${site.phone}</a> and we will help you find your nearest stockist.
    </div>
    <p class="small" style="margin-top:22px">Are you a retailer interested in stocking ARMERA? We would love to hear from you — call <a href="tel:01225251204" style="border-bottom:1px solid var(--line-dark)" data-ck="contact.phone">${site.phone}</a> or email <a href="mailto:${site.email}" style="border-bottom:1px solid var(--line-dark)" data-ck="contact.email">${site.email}</a>.</p>
  </div>
</section>
${catBand()}`;

  write('retailers/index.html', layout({
    title: 'Find a retailer — ARMERA',
    desc: 'Find your nearest ARMERA stockist. Search by town or postcode and view our retail partners on the map.',
    path: '/retailers/',
    body,
    extraBody: `<script src="${v('retailers.js')}" defer></script>`
  }));
}


/* ---------------- register a guarantee ---------------- */
function guaranteePage() {
  const field = (name, label, opts = {}) => `
        <label class="gf${opts.wide ? ' gf--wide' : ''}">
          <span>${esc(label)}${opts.required ? ' <b>*</b>' : ''}</span>
          <input type="${opts.type || 'text'}" name="${name}" ${opts.required ? 'required' : ''} ${opts.autocomplete ? `autocomplete="${opts.autocomplete}"` : ''}>
        </label>`;

  const body = `
${crumbs([{ label: 'Home', href: '/' }, { label: 'Support', href: '/support/' }, { label: 'Register your guarantee' }])}
<section class="pad--tight">
  <div class="container">
    <span class="eyebrow">Guarantee</span>
    <h1 style="margin:14px 0 18px">Register your guarantee</h1>
    <p class="lede" style="max-width:62ch">Registering extends your guarantee for parts — up to 25 years depending on the product. It takes a couple of minutes, and you only need your retailer and purchase date to hand.</p>
  </div>
</section>

<section class="pad--tight" style="padding-top:0">
  <div class="container container--mid">
    <form id="guarantee-form" class="gform" novalidate>

      <fieldset>
        <legend>Contact information</legend>
        <div class="gf-grid">
          <label class="gf gf--narrow">
            <span>Title <b>*</b></span>
            <select name="title" required>
              <option value="">Please choose</option>
              <option>Mr</option><option>Mrs</option><option>Miss</option><option>Ms</option><option>Mx</option><option>Dr</option><option>Prof</option>
            </select>
          </label>
          ${field('first_name', 'First name', { required: true, autocomplete: 'given-name' })}
          ${field('last_name', 'Last name', { required: true, autocomplete: 'family-name' })}
          ${field('email', 'Email', { required: true, type: 'email', autocomplete: 'email', wide: true })}
        </div>
      </fieldset>

      <fieldset>
        <legend>Your address</legend>
        <div class="gf-grid">
          ${field('address1', 'Address line 1', { required: true, autocomplete: 'address-line1', wide: true })}
          ${field('address2', 'Address line 2', { autocomplete: 'address-line2', wide: true })}
          ${field('town', 'Town / City', { required: true, autocomplete: 'address-level2' })}
          ${field('postcode', 'Postcode', { required: true, autocomplete: 'postal-code' })}
          ${field('country', 'Country', { autocomplete: 'country-name' })}
        </div>
      </fieldset>

      <fieldset>
        <legend>Retailer / developer details</legend>
        <div class="gf-grid">
          ${field('retailer_name', 'Retailer name', { required: true })}
          ${field('purchase_date', 'Purchase date', { required: true, type: 'date' })}
        </div>
        <p class="gf-note">If you are registering for a new home:</p>
        <div class="gf-grid">
          ${field('developer_name', 'Builder / developer name')}
          ${field('moved_in_date', 'Date you moved into your new home', { type: 'date' })}
        </div>
      </fieldset>

      <fieldset>
        <legend>Installer details</legend>
        <div class="gf-grid">
          ${field('installer_name', 'Installer name', { wide: true })}
          ${field('installer_address1', 'Installer address line 1', { wide: true })}
          ${field('installer_address2', 'Installer address line 2', { wide: true })}
          ${field('installer_town', 'Installer town / city')}
          ${field('installer_postcode', 'Installer postcode')}
          ${field('installer_country', 'Installer country')}
        </div>
      </fieldset>

      <fieldset>
        <legend>Your purchased products</legend>
        <p class="gf-note">Product codes &amp; descriptions — if you are unsure, please write “I don’t know”.</p>
        <div id="gf-products"></div>
        <button type="button" class="abtn abtn--ghost abtn--sm" id="gf-add-product">Add another product</button>
      </fieldset>

      <fieldset>
        <legend>Proof of purchase <span class="gf-optional">optional</span></legend>
        <p class="gf-note">A photograph of your receipt or invoice helps us process the guarantee more quickly.</p>
        <input type="file" name="proof" id="gf-proof" accept="image/*,application/pdf">
        <div id="gf-proof-state" class="small"></div>
      </fieldset>

      <div class="gf-submit">
        <button type="submit" class="btn btn--solid" id="gf-send">Register my guarantee</button>
        <p class="small" id="gf-msg"></p>
      </div>
    </form>
  </div>
</section>`;

  write('register-guarantee/index.html', layout({
    title: 'Register your guarantee — ARMERA',
    desc: 'Register your ARMERA products to extend your guarantee for parts, up to 25 years depending on the product.',
    path: '/support/',
    body,
    extraBody: `<script src="${v('guarantee.js')}" defer></script>`
  }));
}

/* ---------------- contact ---------------- */
function contactPage() {
  const body = `
${crumbs([{ label: 'Home', href: '/' }, { label: 'Contact' }])}
<section class="pad--tight">
  <div class="container">
    <span class="eyebrow">Contact us</span>
    <h1 style="margin:14px 0 30px">We’d love to talk<br>bathrooms.</h1>
    <p class="bigline"><a href="tel:01225251204" data-ck="contact.phone">${site.phone}</a></p>
    <p class="bigline" style="margin-top:6px"><a href="mailto:${site.email}" data-ck="contact.email">${site.email}</a></p>
    <div class="contact-list" style="max-width:860px">
      <div class="row">
        <div class="k">Telephone</div>
        <div><a href="tel:01225251204" data-ck="contact.phone">${site.phone}</a></div>
      </div>
      <div class="row">
        <div class="k">Email</div>
        <div><a href="mailto:${site.email}" data-ck="contact.email">${site.email}</a></div>
      </div>
      <div class="row">
        <div class="k">Address</div>
        <div data-ck="contact.address">${esc(site.address)}</div>
      </div>
      <div class="row">
        <div class="k">Spares</div>
        <div data-ck="support.spares">For spares, please contact us on 01225 251204 for advice on spares.</div>
      </div>
      <div class="row">
        <div class="k">Where to buy</div>
        <div>ARMERA is sold through retail partners across the UK. <a href="/retailers/" style="border-bottom:1px solid var(--line-dark)">Find your nearest retailer</a>.</div>
      </div>
      <div class="row">
        <div class="k">Catalogue</div>
        <div><a data-catalogue href="${catHref}" target="_blank" rel="noopener" style="border-bottom:1px solid var(--line-dark)" data-catalogue-title>March 2026 Collection</a></div>
      </div>
    </div>
  </div>
</section>
<div class="container" style="margin-top:20px">
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

/* ---------------- admin ---------------- */
function adminPage() {
  const body = `
<section class="pad--tight">
  <div class="container" id="admin-root">
    <p class="small">Loading…</p>
  </div>
</section>`;
  write('admin/index.html', layout({
    title: 'Site admin — ARMERA',
    desc: 'ARMERA site administration.',
    path: '/admin/',
    body,
    noindex: true,
    extraBody: `<script src="${ASSETS}/vendor/supabase/supabase.js"></script><script src="${v('admin.js')}" defer></script>`
  }));
}

/* ---------------- build ---------------- */
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
writeFileSync(join(DIST, '.nojekyll'), '');

const css = readFileSync(join(ROOT, 'static/styles.css'), 'utf8').replaceAll('ASSETS', ASSETS);
writeFileSync(join(DIST, 'styles.css'), css);
for (const f of ['site.js', 'search.js', 'track.js', 'guarantee.js', 'catalog.js', 'instructions.js', 'videos.js', 'retailers.js', 'admin.js']) {
  writeFileSync(join(DIST, f), readFileSync(join(ROOT, 'static', f)));
}

homePage();
catalogShells();
inspirationPage();
aboutPage();
supportPage();
instructionsPage();
videosPage();
retailersPage();
guaranteePage();
contactPage();
adminPage();

console.log(`Built site into docs/${BASE ? ` (base path ${BASE})` : ''}`);
