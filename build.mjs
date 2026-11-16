#!/usr/bin/env node
// ARMERA static site generator.
// Static pages (home, inspiration, about, support, contact) are fully baked.
// The /products tree is generated as shell pages rendered at runtime by catalog.js
// from the content API (Cloudflare D1), so the admin area can add/edit/remove
// ranges and products without a rebuild. All files live in Cloudflare R2.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = dirname(fileURLToPath(import.meta.url));
// Output to docs/ (served by GitHub Pages from the main branch).
// Where the generated site is written. Defaults to docs/ (what GitHub Pages
// serves); set OUT_DIR to build elsewhere without disturbing it.
const DIST = process.env.OUT_DIR
  ? (process.env.OUT_DIR.startsWith('/') ? process.env.OUT_DIR : join(ROOT, process.env.OUT_DIR))
  : join(ROOT, 'docs');
// Site base path. '' for a custom domain / root site; '/<repo>' for GitHub project pages.
const BASE = process.env.BASE_PATH ?? '';

const DATA_URL = process.env.DATA_URL ?? 'https://armera-api.harry-01f.workers.dev';
// Where the build itself fetches content from. Usually the same as DATA_URL,
// but DATA_URL may be '' for a same-origin build, and the build still needs a
// real address to read from.
const CONTENT_API = process.env.CONTENT_API || DATA_URL || 'https://armera-api.harry-01f.workers.dev';
const ASSETS = `${DATA_URL}/assets`;
const INSTRUCTIONS_URL = `${DATA_URL}/instructions`;
const INSTRUCTIONS_BUCKET = 'instructions';
// CARTO basemap key (browser key — travels in every tile request, so it is
// public by design). Free to 5m tiles/month; the CARTO + OpenStreetMap
// attribution on the map is the condition of that tier, so leave it in place.
const CARTO_KEY = 'cb1_30vv_1_debcb48eb777bc52077e4a38';

// Short content hashes for cache-busting: a changed file gets a new URL, so a
// browser can never pair a stale stylesheet with fresh scripts.
const STATIC_FILES = ['styles.css', 'site.js', 'armera-client.js', 'search.js', 'track.js', 'guarantee.js', 'catalog.js', 'instructions.js', 'videos.js', 'retailers.js', 'admin.js', 'flowchart.js', 'swatch.js'];
const assetVersions = Object.fromEntries(STATIC_FILES.map(f => [
  f, createHash('sha1').update(readFileSync(join(ROOT, 'static', f))).digest('hex').slice(0, 8)
]));
const v = f => `/${f}?v=${assetVersions[f]}`;

// ---------------------------------------------------------------------------
// Everything editable in the admin is read LIVE from the content API at build time.
// Nothing editable is hard-coded here: the catalogue of products, the page
// wording, the contact details and the catalogue PDF all come from the
// site_content table, exactly as the running site sees them. data/*.json is
// the original transcription kept for reference, and is only consulted for
// things the admin cannot change (the inspiration page, the guarantee table,
// finish names) — never for products.
// ---------------------------------------------------------------------------
const localSite = JSON.parse(readFileSync(join(ROOT, 'data/site.json'), 'utf8'));
const inspiration = JSON.parse(readFileSync(join(ROOT, 'data/inspiration.json'), 'utf8'));
const ALLOW_STALE = process.env.ALLOW_STALE === '1';

let live = {};
try {
  const res = await fetch(`${CONTENT_API}/rest/v1/site_content?select=key,data`);
  if (!res.ok) throw new Error(`The content API replied ${res.status}`);
  for (const row of await res.json()) live[row.key] = row.data;
} catch (e) {
  const why = `Could not read the live content from the API (${e.message}).`;
  if (!ALLOW_STALE) {
    throw new Error(`${why}\n\n` +
      'Refusing to build: the pages would be generated from the repository copy\n' +
      'of the catalogue, which is older than the live data and would publish a\n' +
      'site missing anything changed in the admin since. Fix the connection and\n' +
      'build again, or run with ALLOW_STALE=1 if you understand the pages will\n' +
      'be built from data/*.json.\n' +
      'This affects the generated pages only — nothing is written back, so no\n' +
      'live data is at risk either way.');
  }
  console.log(`${why} ALLOW_STALE=1 — building from the repository copy.`);
}

const liveCategoryKeys = Object.keys(live).filter(k => /^\d\d-/.test(k)).sort();
const categories = liveCategoryKeys.length
  ? liveCategoryKeys.map(k => live[k])
  : readdirSync(join(ROOT, 'data/categories')).sort()
      .map(f => JSON.parse(readFileSync(join(ROOT, 'data/categories', f), 'utf8')));

// A malformed row would publish a broken catalogue, so check the shape before
// generating anything. Refusing to build is always recoverable; publishing a
// site with products missing is not.
for (const k of liveCategoryKeys) {
  const c = live[k];
  if (!c || typeof c.slug !== 'string' || !Array.isArray(c.ranges)) {
    throw new Error(`Live content row "${k}" is not a category (expected a slug and a ranges array). Nothing has been written; fix the row and build again.`);
  }
  for (const r of c.ranges) {
    if (!r || typeof r.slug !== 'string' || !Array.isArray(r.products)) {
      throw new Error(`Range "${r && r.slug}" in "${k}" has no products array. Nothing has been written; fix the row and build again.`);
    }
  }
  // Each address becomes a folder name on disk and part of a link, so it may
  // only be lower-case letters, digits and hyphens — never "..", a slash or markup.
  const plain = /^[a-z0-9][a-z0-9-]{0,119}$/;
  for (const s of [c.slug, ...c.ranges.flatMap(r => [r.slug, ...r.products.map(p => p && p.slug)])]) {
    if (typeof s !== 'string' || !plain.test(s)) {
      throw new Error(`"${String(s).slice(0, 60)}" in "${k}" is not a usable address. Nothing has been written; fix it in the admin and build again.`);
    }
  }
}

const livePages = live.pages || {};

// Contact details and the spares line are edited on the admin's Pages tab.
const site = {
  ...localSite,
  ...(livePages.contact || {}),
  spares: (livePages.support && livePages.support.spares) || localSite.spares
};

console.log(categories === undefined ? '' :
  `Catalogue: ${liveCategoryKeys.length ? 'live from Cloudflare' : 'REPOSITORY COPY (stale)'} — ` +
  `${categories.length} categories, ` +
  `${categories.reduce((n, c) => n + c.ranges.reduce((m, r) => m + r.products.length, 0), 0)} products`);
console.log('Homepage hero:', livePages?.home?.hero ? `${livePages.home.hero.type} — ${livePages.home.hero.file}` : 'default photograph');

const DEFAULT_HERO_ALT = 'Two Palladium wall hung units in Walnut glow with Vaere monobasin mixers in brushed gold';
const DEFAULT_HERO_FILE = 'p008_01.png';
const heroUrl = f => `${ASSETS}/${(f.includes('/') ? f : `lifestyle/${f}`).split('/').map(encodeURIComponent).join('/')}`;

function heroMarkup() {
  const h = (livePages.home && livePages.home.hero) || {};
  const alt = esc(h.alt || DEFAULT_HERO_ALT);
  const speed = Math.min(90, Math.max(10, Number(h.zoomSpeed) || 30));

  if (h.type === 'video' && h.file) {
    const poster = h.poster ? ` poster="${heroUrl(h.poster)}"` : '';
    return `<video id="hero-media" data-hero-file="${esc(h.file)}" src="${heroUrl(h.file)}"${poster} autoplay muted loop playsinline preload="auto" aria-label="${alt}"></video>`;
  }

  // One photograph or several. Several slide across, one every five seconds.
  const files = (Array.isArray(h.files) && h.files.length ? h.files : [h.file || DEFAULT_HERO_FILE]).filter(Boolean);
  const drift = h.zoom === false ? '' : ' kb';
  const slides = files.map((f, i) => {
    const cls = 'hero-slide' + (i === 0 ? ' on' : '');
    const load = i === 0 ? ' fetchpriority="high"' : ' loading="lazy"';
    return `<div class="${cls}"><img class="hero-shot${i === 0 ? drift : ''}" src="${heroUrl(f)}" data-img="${esc(f)}" data-frame="hero" alt="${i === 0 ? alt : ''}"${load}></div>`;
  }).join('');
  return `<div id="hero-media" class="hero-shuffle" data-hero-files="${esc(files.join('|'))}"` +
    `${h.zoom === false ? ' data-hero-still=""' : ''} style="--hero-zoom:${speed}s">${slides}</div>`;
}

/* ---------------- helpers ---------------- */
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const lifeImg = f => `${ASSETS}/lifestyle/${f.replace(/\.png$/, '.jpg')}`;

const CFG = {
  assets: ASSETS,
  base: BASE,
  instructionsBucket: INSTRUCTIONS_BUCKET,
  dataUrl: DATA_URL,
  instructionsUrl: INSTRUCTIONS_URL,
  cartoKey: CARTO_KEY
};

// Catalogue: the filename lives in the `pages` content row so the admin can
// swap in a new edition; every link below is tagged data-catalogue and gets
// its href rewritten at runtime by site.js.
// Social accounts. Monochrome marks so they sit quietly with the rest.
const SOCIAL = [
  ['Facebook', 'https://www.facebook.com/armeraUK',
   '<path d="M13.6 21v-8.2h2.76l.41-3.2h-3.17V7.55c0-.93.26-1.56 1.59-1.56h1.7V3.13c-.3-.04-1.3-.13-2.47-.13-2.44 0-4.12 1.49-4.12 4.23v2.37H7.5v3.2h2.8V21h3.3z"/>'],
  ['LinkedIn', 'https://www.linkedin.com/company/armera/',
   '<path d="M5 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM3.2 9h3.6v11.8H3.2zM9.6 9h3.45v1.62h.05c.48-.9 1.65-1.85 3.4-1.85 3.63 0 4.3 2.39 4.3 5.5v6.53h-3.6v-5.79c0-1.38-.02-3.16-1.92-3.16-1.93 0-2.22 1.5-2.22 3.06v5.89H9.6z"/>'],
  ['Instagram', 'https://www.instagram.com/armera_uk/',
   '<rect x="3.1" y="3.1" width="17.8" height="17.8" rx="5.1" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
   '<circle cx="12" cy="12" r="4.1" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
   '<circle cx="16.9" cy="7.1" r="1.15"/>']
];
const socialMarkup = (cls = '') => `<ul class="social${cls ? ' ' + cls : ''}">` + SOCIAL.map(([name, href, art]) =>
  `<li><a href="${href}" target="_blank" rel="noopener" aria-label="ARMERA on ${name}" title="${name}">` +
  `<svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor" aria-hidden="true">${art}</svg></a></li>`
).join('') + '</ul>';

// Uploaded and named in the admin's Catalogue tab; site.js re-points these
// links at runtime too, so a fresh upload needs no rebuild.
const liveCat = livePages.catalogue || {};
const CATALOGUE_FILE = liveCat.file || 'ARMERA-Catalogue-March-2026.pdf';
const CATALOGUE_LABEL = liveCat.label || 'The ARMERA collection';
const catHref = `${ASSETS}/documents/${encodeURIComponent(CATALOGUE_FILE)}`;
const telHref = p => 'tel:' + String(p || '').replace(/[^0-9+]/g, '');
const catLink = (text, cls = 'cat-inline') =>
  `<a class="${cls}" data-catalogue href="${catHref}" target="_blank" rel="noopener">${esc(text)}</a>`;
const catBand = ({ dark = false } = {}) => `
<section class="pad${dark ? '' : '--tight'}${dark ? ' band-dark' : ''}">
  <div class="container">
    <div class="cat-band">
      <div class="cover"><span class="ph" data-catalogue-cover>Catalogue</span></div>
      <div class="copy">
        <span class="eyebrow">The catalogue</span>
        <h2 data-catalogue-title>${esc(CATALOGUE_LABEL)}</h2>
        <p>The complete ARMERA collection in one volume — every range, finish and dimension, with recommended retail pricing throughout.</p>
        <a class="btn${dark ? '' : ' btn--solid'}" data-catalogue href="${catHref}" target="_blank" rel="noopener">View the catalogue</a>
      </div>
    </div>
  </div>
</section>`;

/* ---------------- layout ---------------- */
// Favicon: the ARMERA 'A' from the logo, on the brand ink tile.
const FAVICON = `${ASSETS}/brand/favicon-32.png`;

// The address the finished site lives at. Canonical links, the sitemap and
// social previews all use it, whichever host this particular build is served
// from — so a preview copy never claims to be the real thing. The current live
// site answers on www, so the new one keeps that to hold on to its rankings.
const SITE_URL = (process.env.SITE_URL || 'https://www.armera.co.uk').replace(/\/$/, '');
// Search engines are kept out until launch. Set INDEXABLE=1 on the launch build.
const INDEXABLE = process.env.INDEXABLE === '1';

// The registered company, as Companies House records it. A UK company's
// website has to state these.
const COMPANY = { name: 'ARMERA Limited', number: '12405257', registeredIn: 'England and Wales' };

// Every page written, for the sitemap.
const sitePages = [];
const jsonLd = obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;


const navModel = [
  { href: '/products/', label: 'Products', children: categories.map(c => ({ href: `/products/${c.slug}/`, label: c.name })) },
  { href: '/inspiration/', label: 'Inspiration' },
  { href: '/about/', label: 'About' },
  { href: '/retailers/', label: 'Find a retailer' },
  { href: '/support/', label: 'Support' },
  { href: '/contact/', label: 'Contact' }
];

function layout({ title, desc, path, body, extraHead = '', extraBody = '', noindex = false,
                  canonicalPath, ogImage, ogType = 'website', structured = [] }) {
  const canonical = canonicalPath === null ? '' : SITE_URL + (canonicalPath || path);
  const shareImage = ogImage || `${ASSETS}/lifestyle/p001_01.jpg`;
  if (canonical && !noindex) sitePages.push(canonicalPath || path);
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
${canonical ? `<link rel="canonical" href="${canonical}">` : ''}
<meta property="og:site_name" content="ARMERA">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
${canonical ? `<meta property="og:url" content="${canonical}">` : ''}
<meta property="og:image" content="${esc(shareImage)}">
<meta name="twitter:card" content="summary_large_image">
${structured.map(jsonLd).join('\n')}
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
    <span><a class="tel" href="${telHref(site.phone)}" data-ck="contact.phone">${site.phone}</a><span style="margin:0 12px;color:#4c463b">|</span><a href="mailto:${site.email}" data-ck="contact.email">${site.email}</a></span>
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
        <p>A coordinated bathroomware collection, designed for everyday use and lasting appeal.</p>
        ${socialMarkup('social--foot')}
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
          <li><a href="${telHref(site.phone)}" data-ck="contact.phone">${site.phone}</a></li>
          <li><a href="mailto:${site.email}" data-ck="contact.email">${site.email}</a></li>
          <li style="margin-top:14px;font-size:13.5px;line-height:1.7;color:#8d8677" data-ck="contact.address">${esc(site.address)}</li>
        </ul>
      </div>
    </div>
    <div class="fine">
      <span>© ${new Date().getFullYear()} ARMERA. All rights reserved. <a href="/privacy/" style="border-bottom:1px solid #4c463b">Privacy</a></span>
      <span>${COMPANY.name}, registered in ${COMPANY.registeredIn}, company number ${COMPANY.number}. Registered office: ${esc(site.address)}</span>
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
      <h1 data-ck="home.heading">${esc((livePages.home && livePages.home.heading) || 'Designed to inspire')}</h1>
      <p class="lede" data-ck="home.lede">${esc((livePages.home && livePages.home.lede) || 'A coordinated bathroomware collection for rooms with a clear point of view — from furniture and ceramics to brassware and showering.')}</p>
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
        <div class="frame"><img src="${lifeImg(c.hero.img)}" data-img="${esc(c.hero.img)}" data-frame="tile" alt="${esc(c.name)}" loading="lazy"></div>
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
      <div class="imgwrap"><img src="${lifeImg('p013_01.png')}" data-img="p013_01.png" data-frame="tile" alt="Palladium 600mm unit with hidden internal drawer and organiser in Natural oak" loading="lazy"></div>
      <div class="copy">
        <span class="eyebrow">Built on experience</span>
        <h2>Details that make a bathroom work</h2>
        <p>ARMERA brings together more than 20 years’ experience in bathrooms, product design and interiors. We create complete collections with well-judged proportions, practical details and finishes that work together.</p>
        <p>We start with what people need from the room, not novelty for its own sake. By refining familiar forms, proportions and everyday functions, we make products that feel right in use and sit comfortably in a range of interiors.</p>
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
        <p>Brushed Black, Brushed Gold and Brushed Stainless Steel are coordinated across brassware, accessories, flush plates, hinge caps, basin wastes and overflows.</p>
        <p>Furniture colours and finishes, from Walnut Noir to Cavern Blue, give you the freedom to carry a scheme through the whole room.</p>
        <a class="btn" href="/products/taps/">Explore brassware</a>
      </div>
      <div class="imgwrap"><img src="${lifeImg('p066_01.png')}" data-img="p066_01.png" data-frame="tile" alt="Oculus wall mounted basin mixer in brushed gold with co-ordinated click clack waste" loading="lazy"></div>
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
    desc: 'ARMERA creates coordinated bathroomware collections for considered, practical interiors.',
    path: '/',
    body,
    structured: [{
      '@context': 'https://schema.org', '@type': 'Organization',
      name: 'ARMERA', legalName: COMPANY.name, url: SITE_URL + '/',
      logo: `${ASSETS}/brand/logo.png`,
      telephone: site.phone, email: site.email,
      address: { '@type': 'PostalAddress', streetAddress: 'Units 1 & 2 Northlands Industrial Estate, Copheap Lane',
                 addressLocality: 'Warminster', addressRegion: 'Wiltshire', postalCode: 'BA12 0BG', addressCountry: 'GB' },
      sameAs: SOCIAL.map(([, href]) => href)
    }]
  }));
}

/* ---------------- catalogue shells (rendered at runtime by catalog.js) ---------------- */
// Catalogue pages are drawn in the browser from live data, so an edit in the
// admin shows at once. But a page that is empty until JavaScript runs gives a
// search engine — and most AI tools, which do not run JavaScript at all —
// nothing to read. So each shell is built with its real content already in
// it: heading, description, prices, links. The browser replaces it with the
// live version a moment after loading.
const prodImg = f => `${ASSETS}/products/${encodeURIComponent(f)}`;
const money = n => '£' + Number(n).toLocaleString('en-GB');
const firstImage = p => p.image || (p.variants || []).map(v => v.image).filter(Boolean)[0] || null;
const crumbData = trail => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: trail.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE_URL + path }))
});

function catalogShell(path, title, desc, { urlPath, fallback = '', structured = [], ogImage, ogType, noindex = false } = {}) {
  const body = `
<div id="catalog" class="container" data-shell>
  ${fallback || '<section class="pad--tight"><p class="small">Loading the collection…</p></section>'}
</div>
${catBand()}`;
  write(path, layout({
    title, desc, path: '/products/', body,
    canonicalPath: urlPath === undefined ? null : urlPath,
    structured, ogImage, ogType, noindex,
    extraBody: `<script src="${v('flowchart.js')}" defer></script><script src="${v('catalog.js')}" defer></script>`
  }));
}

function catalogShells() {
  const home = ['Home', '/'], all = ['Products', '/products/'];

  catalogShell('products/index.html', 'Products — ARMERA',
    'Explore the ARMERA collection: furniture & basins, WCs, concealed cisterns & flush plates, taps, wastes, thermostatic valves, showering and accessories.',
    { urlPath: '/products/',
      structured: [crumbData([home, all])],
      fallback: `<section class="pad--tight"><h1>Products</h1><ul class="plain-list">${
        categories.map(c => `<li><a href="/products/${c.slug}/">${esc(c.name)}</a></li>`).join('')}</ul></section>` });

  for (const cat of categories) {
    const catPath = `/products/${cat.slug}/`;
    catalogShell(`products/${cat.slug}/index.html`, `${cat.name} — ARMERA`,
      `${cat.name} by ARMERA: ${cat.ranges.map(r => r.name).join(', ')}.`.slice(0, 300),
      { urlPath: catPath,
        structured: [crumbData([home, all, [cat.name, catPath]])],
        ogImage: cat.hero && cat.hero.img ? lifeImg(cat.hero.img) : undefined,
        fallback: `<section class="pad--tight"><h1>${esc(cat.name)}</h1><ul class="plain-list">${
          cat.ranges.map(r => `<li><a href="${catPath}${r.slug}/">${esc(r.title || r.name)}</a>${r.tagline ? ' — ' + esc(r.tagline) : ''}</li>`).join('')}</ul></section>` });

    for (const range of cat.ranges) {
      const rangePath = `${catPath}${range.slug}/`;
      const rangeTitle = range.title || range.name;
      catalogShell(`products/${cat.slug}/${range.slug}/index.html`, `${rangeTitle} — ARMERA`,
        `${rangeTitle}${range.tagline ? ': ' + range.tagline : ''}`.slice(0, 300),
        { urlPath: rangePath,
          structured: [crumbData([home, all, [cat.name, catPath], [range.name, rangePath]])],
          ogImage: range.hero && range.hero.img ? lifeImg(range.hero.img) : undefined,
          fallback: `<section class="pad--tight"><h1>${esc(rangeTitle)}</h1>${range.tagline ? `<p class="lede">${esc(range.tagline)}</p>` : ''}<ul class="plain-list">${
            range.products.map(p => `<li><a href="${rangePath}${p.slug}/">${esc(p.name)}</a></li>`).join('')}</ul></section>` });

      for (const p of range.products) {
        const prodPath = `${rangePath}${p.slug}/`;
        const variants = p.variants || [];
        const prices = variants.map(v => v.price).filter(n => typeof n === 'number');
        const img = firstImage(p);
        const dims = p.dims ? `${p.dims}${/x/i.test(p.dims) ? ' mm' : ''}` : '';
        const description = [`${range.name} ${p.name}`, dims, range.tagline, p.note].filter(Boolean).join('. ').slice(0, 300);
        catalogShell(`products/${cat.slug}/${range.slug}/${p.slug}/index.html`,
          `${p.name} — ${rangeTitle} — ARMERA`, description,
          { urlPath: prodPath, ogType: 'product', ogImage: img ? prodImg(img) : undefined,
            structured: [
              crumbData([home, all, [cat.name, catPath], [range.name, rangePath], [p.name, prodPath]]),
              { '@context': 'https://schema.org', '@type': 'Product',
                name: `${range.name} ${p.name}`, description,
                brand: { '@type': 'Brand', name: 'ARMERA' },
                category: cat.name, url: SITE_URL + prodPath,
                ...(img ? { image: prodImg(img) } : {}),
                ...(variants[0] && variants[0].sku ? { sku: variants[0].sku, mpn: variants[0].sku } : {}) }
            ],
            fallback: `<section class="pad--tight"><p class="eyebrow">${esc(rangeTitle)}</p><h1>${esc(p.name)}</h1>${
              dims ? `<p>${esc(dims)}</p>` : ''}${
              prices.length ? `<p>${prices.length > 1 && Math.min(...prices) !== Math.max(...prices) ? 'From ' : ''}${money(Math.min(...prices))} RRP inc. VAT</p>` : ''}${
              variants.length ? `<table class="pricing"><thead><tr><th>Code</th><th>Finish / option</th><th>RRP</th></tr></thead><tbody>${
                variants.map(v => `<tr><td>${esc(v.sku)}</td><td>${esc(v.finish || '')}</td><td>${typeof v.price === 'number' ? money(v.price) : ''}</td></tr>`).join('')}</tbody></table>` : ''}${
              p.note ? `<p class="note">${esc(p.note)}</p>` : ''}</section>` });
      }
    }
  }
  // 404 doubles as the shell for products added after this build. It is never
  // the canonical address of anything, so it carries no canonical link.
  catalogShell('404.html', 'ARMERA', 'ARMERA designer bathroomware.', { noindex: true });
}

/* ---------------- privacy ----------------
   Written to match what the site actually does. If the site changes what it
   collects, this page has to change with it — they are checked against each
   other in PRE-LAUNCH-REPORT.md (DATA-1 and DATA-2). */
function privacyPage() {
  const body = `
${crumbs([{ label: 'Home', href: '/' }, { label: 'Privacy' }])}
<section class="pad--tight">
  <div class="container container--mid legal">
    <span class="eyebrow">Your information</span>
    <h1 style="margin:14px 0 10px">Privacy</h1>
    <p class="small">Last updated: 16 November 2026</p>

    <h2>The short version</h2>
    <ul>
      <li>This website does not use cookies.</li>
      <li>It carries no advertising and no social-media tracking.</li>
      <li>We do not sell your information, or pass it to anyone for their marketing.</li>
      <li>We only hold personal details about you if you register a guarantee or get in touch with us.</li>
    </ul>

    <h2>Who we are</h2>
    <p>This website is run by ${COMPANY.name}, a company registered in ${COMPANY.registeredIn} (company number ${COMPANY.number}).
    Our registered office is ${esc(site.address)}. For the purposes of UK data protection law we are the
    “controller” of the personal information described on this page, which means we decide how it is used and are responsible for it.</p>
    <p>If you have any question about your information, or want to use any of the rights set out below, contact us at
    <a href="mailto:${site.email}">${site.email}</a>, on <a href="${telHref(site.phone)}">${site.phone}</a>, or by post at the address above.</p>

    <h2>What we collect, why, and for how long</h2>

    <h3>When you register a guarantee</h3>
    <p><strong>What:</strong> your name, email address and postal address; where and when you bought the product; the products you are registering;
    and, if you choose to give them, the name of your developer, the date you moved in, your installer’s name and address, and a photograph or copy of your proof of purchase.</p>
    <p><strong>Why:</strong> to register your guarantee, to deal with any claim you make under it, and to contact you if there is something you need to know about a product you own, such as a safety notice.</p>
    <p><strong>Our legal basis:</strong> it is necessary for the guarantee, which is a contract between us and you. We also have a legitimate interest in keeping accurate records of the products we have guaranteed.</p>
    <p><strong>How long:</strong> for as long as the guarantee lasts — up to 25 years, depending on the product — and for up to six years after it ends, which is the period in which a legal claim could be brought.</p>
    <p>If you give us your installer’s details, please make sure they are happy for you to do so. We use them only in connection with your guarantee.</p>

    <h3>When you order a colour swatch</h3>
    <p><strong>What:</strong> your name, postal address and email address, the colours you asked for and, if you choose to give them, your company, telephone number and any note you add.</p>
    <p><strong>Why:</strong> to post the samples to you and to contact you about your request.</p>
    <p><strong>Our legal basis:</strong> it is necessary to do what you have asked us to do.</p>
    <p><strong>How long:</strong> normally for no more than two years after your request.</p>

    <h3>When you contact us</h3>
    <p><strong>What:</strong> your contact details and whatever you tell us, whether by email, telephone or post.</p>
    <p><strong>Why:</strong> to answer your enquiry and to help with spares, advice or a problem with a product.</p>
    <p><strong>Our legal basis:</strong> our legitimate interest in responding to people who get in touch with us.</p>
    <p><strong>How long:</strong> for as long as it takes to deal with your enquiry, and normally for no more than two years afterwards unless it relates to a guarantee.</p>

    <h3>When you visit this website</h3>
    <p><strong>What:</strong> which pages are viewed, the kind of device used (phone, tablet or computer), the website that led to ours, and a random number
    that lets us count pages viewed in one visit. We do <strong>not</strong> record your IP address, your name, or anything else that identifies you, and the random number is forgotten as soon as you close the tab.</p>
    <p><strong>Why:</strong> to understand which pages and products are useful, so we can improve the website.</p>
    <p><strong>Our legal basis:</strong> our legitimate interest in knowing how the website is used. You can object at any time using the button below.</p>
    <p><strong>How long:</strong> no longer than 14 months.</p>
    <p><button type="button" class="btn" id="stats-optout" hidden>Don’t count my visits</button>
       <span class="small" id="stats-optout-state" style="margin-left:12px"></span></p>
    <p class="small">The website also respects your browser’s “Do Not Track” setting: if it is switched on, your visits are never counted.</p>

    <h3>When you search for a retailer</h3>
    <p>The town or postcode you type is sent to a postcode lookup service so the map can show the right area. We do not keep it.</p>

    <h3>Keeping the website secure</h3>
    <p>Like every website, ours is sent your device’s IP address in order to deliver pages to it. Our hosting provider uses it briefly to do that and to
    block abuse — for example, to stop a form being submitted thousands of times. We do not keep a record of it.</p>

    <h2>Cookies and your browser’s storage</h2>
    <p>This website sets no cookies. It uses your browser’s own storage in two small ways: the random visit number described above, which lasts only until you
    close the tab; and, if you choose “Don’t count my visits”, a note of that choice so we can honour it next time. Neither is shared with anyone.</p>

    <h2>Who we share your information with</h2>
    <p>We do not sell your information. We share it only with the companies that provide services we need to run this website, and only as far as they need it:</p>
    <ul>
      <li><strong>Cloudflare</strong>, which hosts the website and securely stores its database and files, acting on our instructions.</li>
      <li><strong>CARTO and OpenStreetMap</strong>, which supply the map on the “Find a retailer” page. Your browser fetches the map images directly from them, so they see its IP address.</li>
      <li><strong>postcodes.io</strong>, which looks up the town or postcode you search for.</li>
    </ul>
    <p>We may also disclose information where the law requires us to.</p>

    <h2>Where your information is held</h2>
    <p>Some of the companies above operate internationally, so information may be processed outside the United Kingdom. Where that happens we rely on
    UK adequacy regulations, or on safeguards approved under UK data protection law such as the International Data Transfer Agreement.</p>

    <h2>Your rights</h2>
    <p>Under UK data protection law you have the right to:</p>
    <ul>
      <li>ask for a copy of the information we hold about you;</li>
      <li>ask us to correct anything that is wrong or incomplete;</li>
      <li>ask us to delete your information, where we no longer need it;</li>
      <li>ask us to restrict how we use it;</li>
      <li>object to our using it — including for the visit statistics described above;</li>
      <li>ask for the information you gave us in a form you can take elsewhere.</li>
    </ul>
    <p>To use any of these, contact us using the details above. There is no charge, and we will reply within one month.</p>

    <h2>If you are unhappy</h2>
    <p>Please tell us first, so we can try to put it right. You also have the right to complain to the Information Commissioner’s Office, the UK’s data protection regulator:
    <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener">ico.org.uk/make-a-complaint</a>, telephone 0303 123 1113,
    or by post to Wycliffe House, Water Lane, Wilmslow, Cheshire SK9 5AF.</p>

    <h2>A few other things</h2>
    <p><strong>You do not have to give us any personal information to use this website.</strong> If you register a guarantee, the details marked as required are needed to register it; without them we cannot.</p>
    <p><strong>No automated decisions.</strong> We do not use your information to make decisions about you by automated means, and we do not build profiles of visitors.</p>
    <p><strong>Children.</strong> This website is not aimed at children, and we do not knowingly collect information from them.</p>
    <p><strong>Links to other websites.</strong> Links to our social media pages, to videos and to map directions open on those companies’ own websites, which have their own privacy policies. Nothing is sent to them unless you follow the link.</p>
    <p><strong>Changes to this page.</strong> If we change how we use your information we will update this page and change the date at the top.</p>
  </div>
</section>`;

  write('privacy/index.html', layout({
    title: 'Privacy — ARMERA',
    desc: 'How ARMERA uses personal information: what we collect, why, how long we keep it, and your rights under UK data protection law.',
    path: '/privacy/',
    body
  }));
}

/* ---------------- inspiration ---------------- */
function inspirationPage() {
  const body = `
${crumbs([{ label: 'Home', href: '/' }, { label: 'Inspiration' }])}
<section class="pad--tight">
  <div class="container">
    <span class="eyebrow">Gallery</span>
    <h1 style="margin:14px 0 18px">Inspiration</h1>
    <p class="lede" style="max-width:58ch">Bathrooms, materials and details from the ARMERA collection — ideas for planning a room that works beautifully every day.</p>
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
    desc: 'Bathroom inspiration from ARMERA: rooms, materials and details from the collection.',
    path: '/inspiration/',
    body
  }));
}

/* ---------------- about (sections editable) ---------------- */
const aboutSections = [
  {
    side: 'Our approach',
    paras: [
      'ARMERA brings together more than 20 years’ experience in bathrooms, product design and interiors. We make coordinated collections with well-judged proportions, practical details and finishes that work together.',
      'We work closely with retailers so customers can get clear advice, see the collection in person and choose with confidence.'
    ]
  },
  {
    side: 'Our design process',
    paras: [
      'Our starting point is how a bathroom is planned, fitted and used. We listen to homeowners, installers, retailers, specifiers and designers, then focus on the details that make a real difference: proportion, installation, safety and day-to-day use.',
      'Rather than chasing novelty, we refine familiar forms and functions. The result is bathroomware that feels considered, straightforward to specify and made to live with.'
    ]
  },
  {
    side: 'Finishes',
    paras: [
      'Brushed Black, Brushed Gold and Brushed Stainless Steel are coordinated across brassware, accessories, flush plates, hinge caps, basin wastes and overflows. Furniture colours and finishes, from Walnut Noir to Cavern Blue, give you the freedom to carry a scheme through the whole room.'
    ]
  },
  {
    side: 'Manufacturing',
    paras: [
      'Our products are made through established quality processes and standards, with attention paid to performance as well as appearance.',
      'Where applicable, products conform to WRAS requirements and incorporate water-saving or flow-regulated technology. Every ARMERA product is covered by our guarantee.'
    ]
  },
  {
    side: 'In partnership',
    paras: [
      'We support the people who specify, sell, install and live with ARMERA products. Clear information, coordinated ranges and responsive service help make every project run more smoothly.'
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
    <h1 style="margin:14px 0 26px;max-width:18ch" data-ck="about.heading">${esc((livePages.about && livePages.about.heading) || 'Bathroomware, brought together')}</h1>
  </div>
</section>
<div class="container">
  <figure class="range-hero" style="margin-top:0">
    <img src="${lifeImg('p002_01.png')}" alt="ARMERA bathroom with Palladium furniture and Vaere brassware">
  </figure>
</div>
<section class="pad--tight">
  <div class="container container--mid" data-ck-sections="about.sections">
    ${aboutBodySections(
      (livePages.about && Array.isArray(livePages.about.sections) && livePages.about.sections.length)
        ? livePages.about.sections
        : aboutSections
    )}
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
    desc: 'Discover ARMERA: coordinated bathroomware shaped by more than 20 years of experience in bathrooms, product design and interiors.',
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
    <p class="lede" style="max-width:56ch">Product advice, spares and documentation for ARMERA bathroomware.</p>
  </div>
</section>
<section class="pad--tight">
  <div class="container">
    <div class="info-cards">
      <div class="info-card">
        <span class="eyebrow">Spares</span>
        <h3>Spares &amp; advice</h3>
        <p data-ck="support.spares">${esc(site.spares || 'For spares, please contact us on 01225 251204 for advice on spares.')}</p>
        <a class="link" href="${telHref(site.phone)}">Call us</a>
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
          <h3 style="margin-bottom:6px" data-catalogue-title>${esc(CATALOGUE_LABEL)}</h3>
          <p style="flex-grow:0">The complete ARMERA collection with pricing, finishes and dimensions.</p>
        </div>
        <a class="btn btn--solid" style="margin-top:0" data-catalogue href="${catHref}" target="_blank" rel="noopener">Download catalogue</a>
      </div>
    </div>
  </div>
</section>`;

  write('support/index.html', layout({
    title: 'Support — ARMERA',
    desc: `ARMERA support: spares advice on ${site.phone}, product instructions and guarantee registration.`,
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
      Instruction documents are being added. In the meantime, please call <a href="${telHref(site.phone)}" style="border-bottom:1px solid var(--line-dark)" data-ck="contact.phone">${site.phone}</a> or email <a href="mailto:${site.email}" style="border-bottom:1px solid var(--line-dark)" data-ck="contact.email">${site.email}</a> and we will gladly help.
    </div>
  </div>
</section>`;

  write('support/instructions/index.html', layout({
    title: 'Instructions — Support — ARMERA',
    desc: 'Installation and product instructions for the ARMERA collection, available as PDF downloads.',
    path: '/support/',
    canonicalPath: '/support/instructions/',
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
      Videos are being added. In the meantime, please call <a href="${telHref(site.phone)}" style="border-bottom:1px solid var(--line-dark)" data-ck="contact.phone">${site.phone}</a> and we will gladly talk you through it.
    </div>
  </div>
</section>`;

  write('support/how-to-videos/index.html', layout({
    title: 'How-to videos — Support — ARMERA',
    desc: 'ARMERA how-to videos.',
    path: '/support/',
    canonicalPath: '/support/how-to-videos/',
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
      No retailers found for that search. Try a nearby town or a wider area, or call <a href="${telHref(site.phone)}" style="border-bottom:1px solid var(--line-dark)" data-ck="contact.phone">${site.phone}</a> and we will help you find your nearest stockist.
    </div>
    <p class="small" style="margin-top:22px">Interested in stocking ARMERA? Call <a href="${telHref(site.phone)}" style="border-bottom:1px solid var(--line-dark)" data-ck="contact.phone">${site.phone}</a> or email <a href="mailto:${site.email}" style="border-bottom:1px solid var(--line-dark)" data-ck="contact.email">${site.email}</a> to speak with our team.</p>
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
        <div class="gf-extra" aria-hidden="true">
          <label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label>
        </div>
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
    canonicalPath: '/register-guarantee/',
    body,
    extraBody: `<script src="${v('guarantee.js')}" defer></script>`
  }));
}

/* ---------------- order a colour swatch ---------------- */
// The colours offered are read from the live catalogue by swatch.js, so a
// colour added to a range in the admin can be ordered straight away.
function swatchPage() {
  const field = (name, label, opts = {}) => `
          <label class="gf${opts.wide ? ' gf--wide' : ''}">
            <span>${esc(label)}${opts.required ? ' <b>*</b>' : ''}</span>
            <input type="${opts.type || 'text'}" name="${name}" maxlength="${opts.max || 160}" ${opts.required ? 'required' : ''} ${opts.autocomplete ? `autocomplete="${opts.autocomplete}"` : ''}>
          </label>`;

  const body = `
${crumbs([{ label: 'Home', href: '/' }, { label: 'Products', href: '/products/' }, { label: 'Order a colour swatch' }])}
<section class="pad--tight">
  <div class="container">
    <span class="eyebrow">Furniture</span>
    <h1 style="margin:14px 0 18px">Order a colour swatch</h1>
    <p class="lede" style="max-width:62ch">Choose the furniture colours you would like to see in your own room, tell us where to send them, and we will post the samples to you.</p>
  </div>
</section>

<section class="pad--tight" style="padding-top:0">
  <div class="container container--mid">
    <form id="swatch-form" class="gform" novalidate>

      <fieldset>
        <legend>Colours</legend>
        <div id="sw-choices"><p class="small">Loading the colours…</p></div>
        <p class="small" id="sw-count"></p>
      </fieldset>

      <fieldset>
        <legend>Where to send them</legend>
        <div class="gf-grid">
${field('name', 'Your name', { required: true, autocomplete: 'name', max: 120 })}
${field('company', 'Company', { autocomplete: 'organization' })}
${field('email', 'Email address', { required: true, type: 'email', autocomplete: 'email' })}
${field('phone', 'Telephone', { type: 'tel', autocomplete: 'tel', max: 40 })}
${field('address1', 'Address line 1', { required: true, autocomplete: 'address-line1', wide: true })}
${field('address2', 'Address line 2', { autocomplete: 'address-line2', wide: true })}
${field('town', 'Town or city', { required: true, autocomplete: 'address-level2', max: 80 })}
${field('postcode', 'Postcode', { required: true, autocomplete: 'postal-code', max: 16 })}
          <label class="gf gf--wide">
            <span>Anything we should know</span>
            <textarea name="notes" rows="3" maxlength="1000"></textarea>
          </label>
        </div>
      </fieldset>

      <div class="gf-submit">
        <div class="gf-extra" aria-hidden="true">
          <label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label>
        </div>
        <button type="submit" class="btn btn--solid" id="sw-send">Send my request</button>
        <p class="small" id="sw-msg"></p>
      </div>
      <p class="small" style="margin-top:18px">We use these details only to send your samples. See our <a href="/privacy/" style="border-bottom:1px solid var(--line-dark)">privacy policy</a>.</p>
    </form>
  </div>
</section>`;

  write('order-swatch/index.html', layout({
    title: 'Order a colour swatch — ARMERA',
    desc: 'Order samples of ARMERA furniture colours to see them in your own bathroom before you choose.',
    path: '/products/',
    canonicalPath: '/order-swatch/',
    body,
    extraBody: `<script src="${v('swatch.js')}" defer></script>`
  }));
}

/* ---------------- contact ---------------- */
function contactPage() {
  const body = `
${crumbs([{ label: 'Home', href: '/' }, { label: 'Contact' }])}
<section class="pad--tight">
  <div class="container">
    <span class="eyebrow">Contact us</span>
    <h1 style="margin:14px 0 30px">Talk to us<br>about your bathroom.</h1>
    <p class="bigline"><a href="${telHref(site.phone)}" data-ck="contact.phone">${site.phone}</a></p>
    <p class="bigline" style="margin-top:6px"><a href="mailto:${site.email}" data-ck="contact.email">${site.email}</a></p>
    <div class="contact-list" style="max-width:860px">
      <div class="row">
        <div class="k">Telephone</div>
        <div><a href="${telHref(site.phone)}" data-ck="contact.phone">${site.phone}</a></div>
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
        <div data-ck="support.spares">${esc(site.spares || 'For spares, please contact us on 01225 251204 for advice on spares.')}</div>
      </div>
      <div class="row">
        <div class="k">Where to buy</div>
        <div>ARMERA is sold through retail partners across the UK. <a href="/retailers/" style="border-bottom:1px solid var(--line-dark)">Find your nearest retailer</a>.</div>
      </div>
      <div class="row">
        <div class="k">Catalogue</div>
        <div><a data-catalogue href="${catHref}" target="_blank" rel="noopener" style="border-bottom:1px solid var(--line-dark)" data-catalogue-title>${esc(CATALOGUE_LABEL)}</a></div>
      </div>
      <div class="row">
        <div class="k">Follow</div>
        <div>${socialMarkup()}</div>
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
    extraBody: `<script src="${v('armera-client.js')}"></script><script src="${v('flowchart.js')}" defer></script><script src="${v('admin.js')}" defer></script>`
  }));
}

/* ---------------- build ---------------- */
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
writeFileSync(join(DIST, '.nojekyll'), '');

const css = readFileSync(join(ROOT, 'static/styles.css'), 'utf8').replaceAll('ASSETS', ASSETS);
writeFileSync(join(DIST, 'styles.css'), css);
for (const f of ['site.js', 'search.js', 'track.js', 'guarantee.js', 'catalog.js', 'instructions.js', 'videos.js', 'retailers.js', 'admin.js', 'armera-client.js', 'flowchart.js', 'swatch.js']) {
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
swatchPage();
contactPage();
privacyPage();
// The admin belongs on its own protected hostname, not on the public site.
// Public builds leave it out entirely, so there is one door rather than three.
if (process.env.INCLUDE_ADMIN === '1') adminPage();
else console.log('Admin page: omitted (set INCLUDE_ADMIN=1 to include it)');

/* ---------------- sitemap, robots, headers ---------------- */

// Every indexable page, at the address it will finally live at.
const pages = [...new Set(sitePages)].sort();
writeFileSync(join(DIST, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  pages.map(path => `  <url><loc>${esc(SITE_URL + path)}</loc></url>`).join('\n') + '\n</urlset>\n');

writeFileSync(join(DIST, 'robots.txt'),
  `# ARMERA — ${SITE_URL}\nUser-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);

// The one inline script on every page is the site's settings. Its fingerprint
// goes in the policy below, so the browser will run that script and no other
// inline script — which is what stops an injected one from running.
const inlineHash = createHash('sha256').update(`window.ARMERA=${JSON.stringify(CFG)}`).digest('base64');
const api = DATA_URL ? new URL(DATA_URL).origin : '';
// Script and stylesheets may come from this site, and from one folder on the
// API — the map and PDF libraries — and nowhere else. That folder cannot be
// written to through the admin, so even a stolen admin sign-in cannot put
// code in front of visitors.
const vendor = api ? `${api}/assets/vendor/` : '';
const csp = [
  `default-src 'self'`,
  `script-src 'self' 'sha256-${inlineHash}' ${vendor}`,
  `style-src 'self' 'unsafe-inline' ${vendor}`,
  `img-src 'self' data: blob: ${api} https://*.basemaps.cartocdn.com`,
  `font-src 'self' ${api}`,
  `media-src 'self' ${api}`,
  `connect-src 'self' ${api} https://api.postcodes.io`,
  `worker-src 'self' blob:`,
  `frame-src 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
  `frame-ancestors 'none'`, `upgrade-insecure-requests`
].map(rule => rule.replace(/\s+/g, ' ').trim()).join('; ');

// Read by Cloudflare. (GitHub Pages ignores this file and cannot set headers.)
writeFileSync(join(DIST, '_headers'), [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  X-Frame-Options: DENY',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '  Strict-Transport-Security: max-age=31536000',
  '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  `  Content-Security-Policy: ${csp}`,
  ...(INDEXABLE ? [] : ['  X-Robots-Tag: noindex']),
  '',
  '# The admin is never for search engines, and is never cached.',
  '/admin/*',
  '  X-Robots-Tag: noindex',
  '  Cache-Control: no-store',
  ''
].join('\n'));

// Old addresses from the previous website, sent on to their new homes so
// links and search rankings carry over. Maintained in data/redirects.txt.
try {
  writeFileSync(join(DIST, '_redirects'), readFileSync(join(ROOT, 'data/redirects.txt'), 'utf8'));
} catch { /* no redirect map yet */ }

console.log(`Sitemap: ${pages.length} pages at ${SITE_URL} — search engines ${INDEXABLE ? 'ALLOWED' : 'kept out (set INDEXABLE=1 at launch)'}`);
console.log(`Built site into ${DIST}${BASE ? ` (base path ${BASE})` : ''}`);
