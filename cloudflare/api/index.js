// ARMERA data API.
//
// Serves the site's content out of D1 and its files out of R2, speaking the
// small dialect of PostgREST that the front end already uses — so the site
// changes only where it points, not how it asks.
//
// The admin writes here too: D1 is the record. Everything that changes data
// sits behind requireAuth, and everything the public can call is validated,
// size-capped and rate-limited, because the public includes people who are
// not customers.

import { requireAuth, hashPassword, checkPassword, issueSession,
         tooManyAttempts, recordAttempt, tokenDigest } from './auth.js';
import { specSubject, buildSpecSheet } from './spec.js';
import { sendSwatchEmail } from './mail.js';

// Origins allowed to send credentials. Anything else still gets the open,
// credential-free CORS used for public reads.
//
// Listing hostnames one by one meant adding a domain silently broke the admin
// login — the browser refuses a wildcard origin on a credentialed request, and
// the only symptom is "Load Failed". Any host on a domain ARMERA controls is
// accepted instead, so a new subdomain works without a deploy.
const OWN_DOMAINS = ['armera.co.uk', 'hayesbrow.com'];
const TRUSTED = [
  'https://armera-website.harry-01f.workers.dev',
  'https://harryw-developer.github.io',
  'http://localhost:4173'
];

function trusted(origin) {
  if (!origin) return false;
  if (TRUSTED.includes(origin)) return true;
  let host;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:') return false;
    host = u.hostname.toLowerCase();
  } catch { return false; }
  return OWN_DOMAINS.some(d => host === d || host.endsWith('.' + d));
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'apikey, authorization, content-type, prefer, range',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS, ...extra }
  });

// Checked when there is no such account, so the response takes as long either way.
const DUMMY_HASH = '100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/* ---------- being careful with strangers ---------- */

const clientIp = request => request.headers.get('CF-Connecting-IP') || 'unknown';

// Per-address throttles. If a limiter is missing or errors, let the request
// through: a broken limiter should not take the site down with it.
async function tooFast(limiter, key) {
  if (!limiter) return false;
  try { return !(await limiter.limit({ key })).success; }
  catch { return false; }
}
const slowDown = extra => json({ error: 'Too many requests. Please wait a minute and try again.' }, 429,
                                { 'retry-after': '60', ...(extra || {}) });

// Read a request body as text, refusing anything over the cap. The declared
// length is checked first so an oversized upload is refused before it is read.
async function readCapped(request, maxBytes) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) return null;
  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes) return null;
  return buf;
}
async function readJson(request, maxBytes) {
  const buf = await readCapped(request, maxBytes);
  if (!buf) return null;
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch { return null; }
}

// A trimmed string no longer than max, or null. Control characters removed.
function text(v, max) {
  if (v === undefined || v === null) return null;
  const t = String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  return t ? t.slice(0, max) : null;
}
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
const isEmail = v => typeof v === 'string' && v.length <= 160 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

// File types a customer may attach as proof of purchase, with the first bytes
// each must start with — the declared type alone is whatever the sender says.
const PROOF_TYPES = {
  'image/jpeg': { ext: 'jpg', ok: b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  'image/png':  { ext: 'png', ok: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 },
  'image/webp': { ext: 'webp', ok: b => b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45 },
  'image/heic': { ext: 'heic', ok: b => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },
  'image/heif': { ext: 'heic', ok: b => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },
  'application/pdf': { ext: 'pdf', ok: b => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 }
};
const PROOF_KEY = /^proof-\d{13}-[a-f0-9]{16}\.(jpg|png|webp|heic|pdf)$/;
const MAX_PROOF = 10 * 1024 * 1024;

// What a saved category must look like before its tables are rebuilt from it.
// Returns a sentence describing the first problem, or null if it is sound.
const SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;

// Flow-rate figures, if a product has them: up to six lines, each a short
// label and up to twelve [pressure in bar, litres per minute] pairs.
function flowProblem(flow) {
  if (flow === undefined || flow === null) return null;
  if (typeof flow !== 'object' || !Array.isArray(flow.series)) return 'they are not in a form that can be saved.';
  if (flow.series.length > 6) return 'no more than six lines can be shown on one chart.';
  if (flow.note !== undefined && (typeof flow.note !== 'string' || flow.note.length > 400)) return 'the note is too long.';
  for (const s of flow.series) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.points)) return 'a line has no figures.';
    if (s.label !== undefined && (typeof s.label !== 'string' || s.label.length > 80)) return 'a line’s name is too long.';
    if (s.points.length > 12) return 'a line has too many figures.';
    for (const pt of s.points) {
      if (!Array.isArray(pt) || pt.length !== 2 || !pt.every(n => typeof n === 'number' && Number.isFinite(n))) return 'a figure is not a number.';
      if (pt[0] <= 0 || pt[0] > 20 || pt[1] < 0 || pt[1] > 500) return 'a figure is outside what is possible.';
    }
  }
  return null;
}
function categoryProblem(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return 'The category is not an object.';
  if (!SLUG.test(doc.slug || '')) return 'The category has no valid address (slug).';
  if (typeof doc.name !== 'string' || !doc.name.trim()) return 'The category has no name.';
  if (!Array.isArray(doc.ranges)) return 'The category has no list of ranges.';
  const rangeSlugs = new Set();
  for (const r of doc.ranges) {
    if (!r || typeof r !== 'object') return 'A range is not an object.';
    if (!SLUG.test(r.slug || '')) return `The range “${r.name || '?'}” has no valid address (slug).`;
    if (rangeSlugs.has(r.slug)) return `Two ranges share the address “${r.slug}”.`;
    rangeSlugs.add(r.slug);
    if (typeof r.name !== 'string' || !r.name.trim()) return `The range “${r.slug}” has no name.`;
    if (!Array.isArray(r.products)) return `The range “${r.name}” has no list of products.`;
    const productSlugs = new Set();
    for (const p of r.products) {
      if (!p || typeof p !== 'object') return `A product in “${r.name}” is not an object.`;
      if (!SLUG.test(p.slug || '')) return `The product “${p.name || '?'}” in “${r.name}” has no valid address (slug).`;
      if (productSlugs.has(p.slug)) return `Two products in “${r.name}” share the address “${p.slug}”.`;
      productSlugs.add(p.slug);
      if (typeof p.name !== 'string' || !p.name.trim()) return `A product in “${r.name}” has no name.`;
      if (p.variants !== undefined && !Array.isArray(p.variants)) return `The options for “${p.name}” are not a list.`;
      const flowFault = flowProblem(p.flow);
      if (flowFault) return `The flow rates for “${p.name}”: ${flowFault}`;
      for (const v of (p.variants || [])) {
        if (!v || typeof v !== 'object') return `An option of “${p.name}” is not an object.`;
        if (typeof v.sku !== 'string' || !v.sku.trim()) return `An option of “${p.name}” has no code.`;
        if (v.price !== undefined && v.price !== null && typeof v.price !== 'number') return `The price of ${v.sku} is not a number.`;
      }
    }
  }
  return null;
}

/* ---------- rebuilding a category from its tables ---------- */

const JSON_FIELDS = new Set(['hero', 'altHero', 'swatches', 'addons', 'features',
                             'imagesByCode', 'gallery', 'goesWith']);
const parse = s => (s ? JSON.parse(s) : null);

function assemble(cols, mapping, extra) {
  const out = {};
  for (const [key, col] of mapping) {
    const v = cols[col];
    if (v !== null && v !== undefined) out[key] = JSON_FIELDS.has(key) ? parse(v) : v;
  }
  if (extra) Object.assign(out, parse(extra));
  return out;
}

const CAT_MAP = [['slug', 'slug'], ['name', 'name'], ['hero', 'hero']];
const RNG_MAP = [['slug','slug'],['name','name'],['title','title'],['tagline','tagline'],
                 ['footnote','footnote'],['hero','hero'],['altHero','alt_hero'],
                 ['swatches','swatches'],['addons','addons'],['features','features']];
const PRD_MAP = [['slug','slug'],['name','name'],['image','image'],['dims','dims'],
                 ['note','note'],['footnote','footnote'],['spec','spec'],['drawing','drawing'],
                 ['basinLink','basin_link'],['imagesByCode','images_by_code'],
                 ['gallery','gallery'],['goesWith','goes_with']];
const VAR_MAP = [['sku','sku'],['finish','finish'],['price','price'],['code','code'],['image','image']];

async function catalogueRows(db) {
  const [cats, rngs, prods, vars_] = await Promise.all([
    db.prepare('select * from catalogue_categories order by position').all(),
    db.prepare('select * from catalogue_ranges order by position').all(),
    db.prepare('select * from catalogue_products order by position').all(),
    db.prepare('select * from catalogue_variants order by position').all()
  ]);
  const group = (rows, key) => {
    const m = new Map();
    for (const row of rows) {
      const k = row[key];
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(row);
    }
    return m;
  };
  const byVar = group(vars_.results, 'product_id');
  const byProd = group(prods.results, 'range_id');
  const byRng = group(rngs.results, 'category_key');

  return cats.results.map(c => {
    const doc = assemble(c, CAT_MAP, c.extra);
    doc.ranges = (byRng.get(c.key) || []).map(r => {
      const rd = assemble(r, RNG_MAP, r.extra);
      rd.products = (byProd.get(r.id) || []).map(p => {
        const pd = assemble(p, PRD_MAP, p.extra);
        pd.variants = (byVar.get(p.id) || []).map(v => assemble(v, VAR_MAP, v.extra));
        return pd;
      });
      return rd;
    });
    return { key: c.key, data: doc };
  });
}

/* ---------- the PostgREST subset the site uses ---------- */

async function siteContent(db, url) {
  const select = url.searchParams.get('select') || 'key,data';
  const keyFilter = url.searchParams.get('key');

  let wanted = null;                                  // null means every row
  if (keyFilter) {
    if (keyFilter.startsWith('eq.')) wanted = [keyFilter.slice(3)];
    else if (keyFilter.startsWith('in.')) wanted = keyFilter.slice(3).replace(/^\(|\)$/g, '').split(',').map(s => s.trim());
    else if (keyFilter.startsWith('like.')) wanted = null;
  }

  const isCat = k => /^\d\d-/.test(k);
  let rows = [];

  const needCatalogue = !wanted || wanted.some(isCat);
  if (needCatalogue) rows = rows.concat(await catalogueRows(db));

  const needDocs = !wanted || wanted.some(k => !isCat(k));
  if (needDocs) {
    const docs = await db.prepare("select key, data, updated_at from site_content where key not like '0%'").all();
    // Categories are served from their tables above. The stored copy of each
    // is skipped by the same test, so a tenth category ("10-…") cannot appear twice.
    rows = rows.concat(docs.results.filter(r => !isCat(r.key))
      .map(r => ({ key: r.key, data: JSON.parse(r.data), updated_at: r.updated_at })));
  }

  if (wanted) rows = rows.filter(r => wanted.includes(r.key));
  if ((url.searchParams.get('order') || '').startsWith('key')) rows.sort((a, b) => a.key.localeCompare(b.key));

  const cols = select.split(',').map(s => s.trim());
  if (!cols.includes('*')) rows = rows.map(r => Object.fromEntries(cols.filter(c => c in r).map(c => [c, r[c]])));
  return rows;
}

/* ---------- files ---------- */

// Types a browser would render as a document and run script from. Uploads are
// admin-only, but a file served from here should never be able to act as a
// page on this origin, so these are sandboxed and offered as downloads.
const ACTIVE_TYPES = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml)/i;

// Files the pages load as code or styling (the map and PDF libraries). The
// site's content policy lets pages run script from this folder and nowhere
// else on this API, so nothing signed-in may add to it or change it — these
// are replaced by a deploy, never through the admin.
const PROTECTED_PREFIX = /^\/*vendor\//i;
// Things a browser would run or render as a page. An admin has no reason to
// upload one, and a stolen admin sign-in should not be able to.
const RISKY_NAME = /\.(m?js|cjs|html?|xhtml|svg|xml|css|php|wasm)$/i;
const RISKY_TYPE = /(javascript|ecmascript|html|xhtml|svg|xml|wasm|text\/css)/i;

async function serveFile(bucket, key, request, opts = {}) {
  if (!key) return new Response('not found', { status: 404, headers: CORS });
  const obj = await bucket.get(key);
  if (!obj) return new Response('not found', { status: 404, headers: CORS });
  const headers = new Headers(CORS);
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  // A customer's proof of purchase is never to be kept by a browser or a cache.
  headers.set('cache-control', opts.private ? 'private, no-store' : 'public, max-age=31536000, immutable');
  headers.set('x-content-type-options', 'nosniff');
  if (ACTIVE_TYPES.test(headers.get('content-type') || '')) {
    headers.set('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    headers.set('content-disposition', 'attachment');
  }
  const inm = request.headers.get('if-none-match');
  if (inm && inm === obj.httpEtag) return new Response(null, { status: 304, headers });
  return new Response(obj.body, { headers });
}

// A path segment that may not decode cleanly; a malformed one is just not found.
function decoded(part) {
  try { return decodeURIComponent(part); } catch { return null; }
}

/* ---------- keeping the catalogue tables in step with a saved category ---------- */

// Rebuild the catalogue tables for one category document.
async function rebuildCategory(env, key, doc, before = []) {
  const js = v => (v === undefined || v === null) ? null : JSON.stringify(v);
  const pick = (o, keys) => {
    const extra = {};
    for (const k of Object.keys(o)) if (!keys.includes(k)) extra[k] = o[k];
    return Object.keys(extra).length ? JSON.stringify(extra) : null;
  };
  const base = await env.DB.prepare('select coalesce(max(id),0) as n from catalogue_ranges').first();
  const pbase = await env.DB.prepare('select coalesce(max(id),0) as n from catalogue_products').first();
  const vbase = await env.DB.prepare('select coalesce(max(id),0) as n from catalogue_variants').first();
  let rid = base.n, pid = pbase.n, vid = vbase.n;

  const pos = await env.DB.prepare('select position from catalogue_categories where key = ?').bind(key).first();
  const stmts = [
    env.DB.prepare(`delete from catalogue_variants where product_id in (
        select p.id from catalogue_products p join catalogue_ranges r on r.id = p.range_id
        where r.category_key = ?)`).bind(key),
    env.DB.prepare(`delete from catalogue_products where range_id in (
        select id from catalogue_ranges where category_key = ?)`).bind(key),
    env.DB.prepare('delete from catalogue_ranges where category_key = ?').bind(key),
    env.DB.prepare('insert or replace into catalogue_categories (key,slug,name,hero,extra,position) values (?,?,?,?,?,?)')
      .bind(key, doc.slug, doc.name, js(doc.hero), pick(doc, ['slug','name','hero','ranges']),
            pos ? pos.position : 99)
  ];
  (doc.ranges || []).forEach((r, ri) => {
    rid++;
    stmts.push(env.DB.prepare('insert into catalogue_ranges (id,category_key,slug,name,title,tagline,footnote,hero,alt_hero,swatches,addons,features,extra,position) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(rid, key, r.slug, r.name, r.title ?? null, r.tagline ?? null, r.footnote ?? null,
            js(r.hero), js(r.altHero), js(r.swatches), js(r.addons), js(r.features),
            pick(r, ['slug','name','title','tagline','footnote','hero','altHero','swatches','addons','features','products']), ri));
    const myRid = rid;
    (r.products || []).forEach((prod, pi) => {
      pid++;
      stmts.push(env.DB.prepare('insert into catalogue_products (id,range_id,slug,name,image,dims,note,footnote,spec,drawing,basin_link,images_by_code,gallery,goes_with,extra,position) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(pid, myRid, prod.slug, prod.name, prod.image ?? null, prod.dims ?? null, prod.note ?? null,
              prod.footnote ?? null, prod.spec ?? null, prod.drawing ?? null, prod.basinLink ?? null,
              js(prod.imagesByCode), js(prod.gallery), js(prod.goesWith),
              pick(prod, ['slug','name','image','dims','note','footnote','spec','drawing','basinLink','imagesByCode','gallery','goesWith','variants']), pi));
      const myPid = pid;
      (prod.variants || []).forEach((v, vi) => {
        vid++;
        stmts.push(env.DB.prepare('insert into catalogue_variants (id,product_id,sku,finish,price,code,image,extra,position) values (?,?,?,?,?,?,?,?,?)')
          .bind(vid, myPid, v.sku, v.finish ?? null, v.price ?? null, v.code ?? null, v.image ?? null,
                pick(v, ['sku','finish','price','code','image']), vi));
      });
    });
  });
  // one transaction: the content row and its tables change together or not at all
  await env.DB.batch([...before, ...stmts]);
}

const handler = {
  async handle(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // A credentialed request will not accept a wildcard origin, so the
    // preflight has to name the origin back when we trust it.
    const reqOrigin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') {
      const headers = trusted(reqOrigin)
        ? { ...CORS, 'access-control-allow-origin': reqOrigin,
            'access-control-allow-credentials': 'true', 'vary': 'Origin',
            'access-control-max-age': '86400' }
        : CORS;
      return new Response(null, { headers });
    }

    if (path === '/rest/v1/site_content') {
      try {
        return json(await siteContent(env.DB, url));
      } catch (e) {
        console.error('site_content', e);
        return json({ error: 'The collection could not be read just now.' }, 500);
      }
    }

    if (path.startsWith('/assets/')) {
      return serveFile(env.ASSETS, decoded(path.slice('/assets/'.length)), request);
    }
    if (path.startsWith('/instructions/')) {
      return serveFile(env.INSTRUCTIONS, decoded(path.slice('/instructions/'.length)), request);
    }

    // The instructions page needs the list of instruction PDFs. Nothing public
    // needs a list of every other file, so that is not offered.
    if (path === '/storage/v1/object/list/instructions') {
      const out = [];
      let cursor;
      do {
        const page = await env.INSTRUCTIONS.list({ limit: 1000, cursor });
        for (const o of page.objects) {
          out.push({ name: o.key, id: o.key,
                     metadata: { size: o.size, mimetype: o.httpMetadata?.contentType || 'application/octet-stream' } });
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      return json(out);
    }

    /* ---------- signing in ---------- */

    const credCors = trusted(reqOrigin)
      ? { 'access-control-allow-origin': reqOrigin, 'access-control-allow-credentials': 'true',
          'vary': 'Origin' }
      : {};

    if (path === '/auth/login' && request.method === 'POST') {
      if (await tooFast(env.RL_AUTH, clientIp(request))) return slowDown(credCors);
      const body = await readJson(request, 4096) || {};
      const addr = String(body.email || '').trim().toLowerCase().slice(0, 160);
      const password = typeof body.password === 'string' ? body.password.slice(0, 1024) : '';
      if (!addr || !password) return json({ error: 'Email and password are required.' }, 400, credCors);
      if (await tooManyAttempts(env.DB, addr)) {
        return json({ error: 'Too many attempts. Try again in fifteen minutes.' }, 429, credCors);
      }
      const row = await env.DB.prepare(
        'select email, display_name, password_hash, disabled, session_epoch from admin_users where email = ?')
        .bind(addr).first();
      // Always do the expensive check, against a dummy when there is no such
      // account, so the time taken does not reveal which addresses exist.
      const usable = row && !row.disabled && row.password_hash;
      const matched = await checkPassword(password, usable ? row.password_hash : DUMMY_HASH);
      const ok = Boolean(usable && matched);
      await recordAttempt(env.DB, addr, ok);
      if (!ok) return json({ error: 'Those details were not recognised.' }, 401, credCors);
      const token = await issueSession(row.email, env.SESSION_SECRET, 14, row.session_epoch || 0);
      await env.DB.prepare('update admin_users set last_seen = ? where email = ?')
        .bind(new Date().toISOString(), row.email).run();
      // The token goes back in the body only. No cookie: see requireAuth.
      return json({ email: row.email, display_name: row.display_name, token }, 200, credCors);
    }

    // Signing out retires the token on the server, not just in the browser:
    // a copy of it taken beforehand stops working too. (It signs that person
    // out everywhere, which for a handful of people is the safer trade.)
    if (path === '/auth/logout') {
      const who = await requireAuth(request, env);
      if (who && who.via === 'password') {
        await env.DB.prepare('update admin_users set session_epoch = session_epoch + 1 where email = ?')
          .bind(who.email).run();
      }
      return json({ ok: true }, 200, credCors);
    }

    if (path === '/auth/me') {
      const who = await requireAuth(request, env);
      if (!who) return json({ error: 'not signed in' }, 401, credCors);
      return json({ email: who.email, display_name: who.display_name,
                    prefs: JSON.parse(who.prefs || '{}'), via: who.via }, 200, credCors);
    }

    // Setting a first password, from a one-time link. The link proves nothing
    // about who you are beyond holding it, so it is single use, expires, and
    // can only set the password for the address it was issued to.
    if (path === '/auth/claim' && request.method === 'POST') {
      if (await tooFast(env.RL_AUTH, clientIp(request))) return slowDown(credCors);
      const { token, password } = await readJson(request, 4096) || {};
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || !password) {
        return json({ error: 'Link and password are both needed.' }, 400, credCors);
      }
      if (typeof password !== 'string' || password.length < 10 || password.length > 1024) {
        return json({ error: 'Use at least 10 characters.' }, 400, credCors);
      }
      // Only a fingerprint of the link is kept, so reading the database does
      // not hand anyone a working link.
      const row = await env.DB.prepare('select email, setup_expires from admin_users where setup_token = ?')
        .bind(await tokenDigest(token)).first();
      if (!row) return json({ error: 'That link is not valid.' }, 401, credCors);
      if (!row.setup_expires || new Date(row.setup_expires) < new Date()) {
        return json({ error: 'That link has expired. Ask for a new one.' }, 401, credCors);
      }
      await env.DB.prepare(`update admin_users set password_hash = ?, setup_token = null,
          setup_expires = null, session_epoch = session_epoch + 1 where email = ?`)
        .bind(await hashPassword(password), row.email).run();
      return json({ ok: true, email: row.email }, 200, credCors);
    }

    // Changing a password while signed in. The current password is asked for
    // again, so a sign-in left open on a shared computer — or a stolen token —
    // cannot be turned into a permanent takeover.
    if (path === '/auth/change-password' && request.method === 'POST') {
      if (await tooFast(env.RL_AUTH, clientIp(request))) return slowDown(credCors);
      const who = await requireAuth(request, env);
      if (!who) return json({ error: 'not signed in' }, 401, credCors);
      const { password, current } = await readJson(request, 4096) || {};
      if (typeof password !== 'string' || password.length < 10 || password.length > 1024) {
        return json({ error: 'Use at least 10 characters.' }, 400, credCors);
      }
      const row = await env.DB.prepare('select password_hash from admin_users where email = ?')
        .bind(who.email).first();
      if (row && row.password_hash) {
        if (await tooManyAttempts(env.DB, who.email)) {
          return json({ error: 'Too many attempts. Try again in fifteen minutes.' }, 429, credCors);
        }
        const matched = typeof current === 'string' && await checkPassword(current.slice(0, 1024), row.password_hash);
        if (!matched) {
          await recordAttempt(env.DB, who.email, false);
          return json({ error: 'Your current password was not right.' }, 403, credCors);
        }
      }
      const changed = await env.DB.prepare(
        `update admin_users set password_hash = ?, session_epoch = session_epoch + 1
          where email = ? returning session_epoch`)
        .bind(await hashPassword(password), who.email).first();
      // Every earlier token is now retired, including the one that made this
      // request, so hand back a fresh one for this browser.
      const token = await issueSession(who.email, env.SESSION_SECRET, 14, changed.session_epoch);
      return json({ ok: true, token, note: 'Other sessions have been signed out.' }, 200, credCors);
    }

    /* ===== BEGIN admin + public write routes (keep together) ===== */

    if (path.startsWith('/admin/') || path === '/prefs') {
      const who = await requireAuth(request, env);
      if (!who) return json({ error: 'not signed in' }, 401, credCors);

      if (path.startsWith('/admin/content/') && request.method === 'POST') {
        const key = decoded(path.slice('/admin/content/'.length));
        if (!key || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(key)) return json({ error: 'That is not a valid content key.' }, 400, credCors);
        const data = await readJson(request, 2 * 1024 * 1024);
        if (data === null || typeof data !== 'object') return json({ error: 'That could not be read, or is too large to save.' }, 400, credCors);
        const now = new Date().toISOString();
        const write = env.DB.prepare('insert or replace into site_content (key, data, updated_at) values (?,?,?)')
          .bind(key, JSON.stringify(data), now);
        if (/^[0-9][0-9]-/.test(key)) {
          const problem = categoryProblem(data);
          if (problem) return json({ error: problem }, 400, credCors);
          await rebuildCategory(env, key, data, [write]);
        } else {
          await write.run();
        }
        return json({ ok: true, key, updated_at: now }, 200, credCors);
      }

      if (path === '/admin/page_views') {
        const since = url.searchParams.get('since') || new Date(Date.now() - 30 * 86400000).toISOString();
        const rows = await env.DB.prepare(
          'select ts,page_type,item_name,item_ref,referrer_host,device,session_id from page_views where ts > ? order by ts desc limit 20000')
          .bind(since).all();
        return json(rows.results, 200, credCors);
      }

      if (path === '/admin/guarantees' && request.method === 'GET') {
        const rows = await env.DB.prepare('select * from guarantee_registrations order by created_at desc limit 5000').all();
        return json(rows.results.map(r => ({ ...r, products: JSON.parse(r.products || '[]') })), 200, credCors);
      }
      if (path.startsWith('/admin/guarantees/') && request.method === 'POST') {
        const id = Number(path.split('/').pop());
        const { status } = await readJson(request, 1024) || {};
        if (!Number.isInteger(id) || !['new', 'checked', 'registered'].includes(status)) {
          return json({ error: 'That status is not one we use.' }, 400, credCors);
        }
        await env.DB.prepare('update guarantee_registrations set status = ? where id = ?').bind(status, id).run();
        return json({ ok: true }, 200, credCors);
      }

      if (path === '/admin/swatch-requests' && request.method === 'GET') {
        const rows = await env.DB.prepare('select * from swatch_requests order by created_at desc limit 5000').all();
        return json(rows.results.map(r => ({ ...r, swatches: JSON.parse(r.swatches || '[]') })), 200, credCors);
      }
      if (path.startsWith('/admin/swatch-requests/') && request.method === 'POST') {
        const id = Number(path.split('/').pop());
        const { status } = await readJson(request, 1024) || {};
        if (!Number.isInteger(id) || !['new', 'sent'].includes(status)) {
          return json({ error: 'That status is not one we use.' }, 400, credCors);
        }
        await env.DB.prepare('update swatch_requests set status = ? where id = ?').bind(status, id).run();
        return json({ ok: true }, 200, credCors);
      }

      const pickBucket = which =>
        which === 'instructions' ? env.INSTRUCTIONS : which === 'guarantee-proof' ? env.PROOF : env.ASSETS;

      if (path === '/admin/files') {
        const bucket = pickBucket(url.searchParams.get('bucket') || 'site-assets');
        const prefix = url.searchParams.get('prefix') || '';
        const out = [];
        let cursor;
        do {
          const page = await bucket.list({ limit: 1000, cursor, prefix });
          for (const o of page.objects) out.push({ name: o.key, id: o.key,
            metadata: { size: o.size, mimetype: o.httpMetadata?.contentType || 'application/octet-stream' } });
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);
        out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        return json(out, 200, credCors);
      }

      if (path.startsWith('/admin/upload/') && (request.method === 'PUT' || request.method === 'POST')) {
        const rest = path.slice('/admin/upload/'.length);
        const cutAt = rest.indexOf('/');
        const which = rest.slice(0, cutAt);
        if (!['site-assets', 'instructions', 'guarantee-proof'].includes(which)) return json({ error: 'where?' }, 400, credCors);
        const key = decoded(rest.slice(cutAt + 1));
        if (!key || key.length > 300 || key.startsWith('/') || key.includes('..') || /[\u0000-\u001f\\]/.test(key)) {
          return json({ error: 'That file name cannot be used.' }, 400, credCors);
        }
        const sentType = (request.headers.get('content-type') || 'application/octet-stream').slice(0, 120);
        if (PROTECTED_PREFIX.test(key) || RISKY_NAME.test(key) || RISKY_TYPE.test(sentType)) {
          return json({ error: 'That kind of file cannot be uploaded here.' }, 415, credCors);
        }
        await pickBucket(which).put(key, request.body, {
          httpMetadata: { contentType: sentType,
                          cacheControl: 'public, max-age=31536000' } });
        return json({ ok: true, key }, 200, credCors);
      }

      if (path.startsWith('/admin/file/')) {
        const rest = path.slice('/admin/file/'.length);
        const cut = rest.indexOf('/');
        const bucket = pickBucket(rest.slice(0, cut));
        const key = decoded(rest.slice(cut + 1));
        if (!key) return json({ error: 'not found' }, 404, credCors);
        if (request.method === 'DELETE') {
          if (bucket === env.ASSETS && PROTECTED_PREFIX.test(key)) {
            return json({ error: 'The site needs that file to work, so it cannot be removed here.' }, 403, credCors);
          }
          await bucket.delete(key);
          return json({ ok: true }, 200, credCors);
        }
        return serveFile(bucket, key, request, { private: bucket === env.PROOF });
      }

      /* ---- who may sign in ---- */

      if (path === '/admin/users' && request.method === 'GET') {
        const rows = await env.DB.prepare(
          `select email, display_name, password_hash is not null as has_password,
                  setup_token is not null as has_link, setup_expires, last_seen, disabled
             from admin_users order by email`).all();
        return json(rows.results.map(r => ({ ...r, you: r.email === who.email })), 200, credCors);
      }

      if (path === '/admin/users' && request.method === 'POST') {
        const { email, display_name } = await readJson(request, 4096) || {};
        const addr = String(email || '').trim().toLowerCase();
        if (!isEmail(addr)) {
          return json({ error: 'That does not look like an email address.' }, 400, credCors);
        }
        const existing = await env.DB.prepare('select email from admin_users where email = ?').bind(addr).first();
        if (existing) return json({ error: 'That person is already on the list.' }, 409, credCors);
        const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
        const expires = new Date(Date.now() + 7 * 86400000).toISOString();
        await env.DB.prepare(
          'insert into admin_users (email, display_name, prefs, setup_token, setup_expires) values (?,?,?,?,?)')
          .bind(addr, text(display_name, 60) || addr.split('@')[0], '{}', await tokenDigest(token), expires).run();
        return json({ ok: true, email: addr, token, expires }, 200, credCors);
      }

      if (path.startsWith('/admin/users/')) {
        const rest = path.slice('/admin/users/'.length);
        const makeLink = rest.endsWith('/link');
        const addr = (decoded(makeLink ? rest.slice(0, -5) : rest) || '').toLowerCase();
        const target = await env.DB.prepare('select email, disabled from admin_users where email = ?')
          .bind(addr).first();
        if (!target) return json({ error: 'No such person.' }, 404, credCors);

        // a new one-time link, for someone who never set a password or forgot it
        if (makeLink && request.method === 'POST') {
          const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
          const expires = new Date(Date.now() + 7 * 86400000).toISOString();
          await env.DB.prepare('update admin_users set setup_token = ?, setup_expires = ? where email = ?')
            .bind(await tokenDigest(token), expires, addr).run();
          return json({ ok: true, email: addr, token, expires }, 200, credCors);
        }

        if (request.method === 'POST') {
          const sent = await readJson(request, 4096) || {};
          const display_name = sent.display_name == null ? null : text(sent.display_name, 60);
          const disabled = sent.disabled === 1 || sent.disabled === true ? 1
                         : sent.disabled === 0 || sent.disabled === false ? 0 : null;
          if (disabled === 1 && addr === who.email) {
            return json({ error: 'You cannot switch off your own access.' }, 400, credCors);
          }
          if (disabled === 1) {
            const left = await env.DB.prepare(
              'select count(*) as n from admin_users where disabled = 0 and password_hash is not null and email != ?')
              .bind(addr).first();
            if (left.n === 0) return json({ error: 'That is the last person who can sign in.' }, 400, credCors);
          }
          await env.DB.prepare(
            'update admin_users set display_name = coalesce(?, display_name), disabled = coalesce(?, disabled) where email = ?')
            .bind(display_name ?? null, disabled ?? null, addr).run();
          // Switching someone off ends their open sessions at once.
          if (disabled === 1) {
            await env.DB.prepare('update admin_users set session_epoch = session_epoch + 1 where email = ?')
              .bind(addr).run();
          }
          return json({ ok: true }, 200, credCors);
        }

        if (request.method === 'DELETE') {
          if (addr === who.email) return json({ error: 'You cannot remove yourself.' }, 400, credCors);
          const left = await env.DB.prepare(
            'select count(*) as n from admin_users where disabled = 0 and password_hash is not null and email != ?')
            .bind(addr).first();
          if (left.n === 0) return json({ error: 'That is the last person who can sign in.' }, 400, credCors);
          await env.DB.prepare('delete from admin_users where email = ?').bind(addr).run();
          await env.DB.prepare('delete from auth_attempts where email = ?').bind(addr).run();
          return json({ ok: true }, 200, credCors);
        }
      }

      if (path === '/prefs' && request.method === 'POST') {
        const body = await readJson(request, 16 * 1024);
        if (!body || typeof body !== 'object') return json({ error: 'That could not be read.' }, 400, credCors);
        const prefs = { ...JSON.parse(who.prefs || '{}'), ...(body.prefs && typeof body.prefs === 'object' ? body.prefs : {}) };
        if (JSON.stringify(prefs).length > 8000) return json({ error: 'Too many settings to save.' }, 400, credCors);
        if (body.display_name != null) body.display_name = text(body.display_name, 60);
        await env.DB.prepare('update admin_users set prefs = ?, display_name = coalesce(?, display_name) where email = ?')
          .bind(JSON.stringify(prefs), body.display_name ?? null, who.email).run();
        return json({ ok: true, prefs }, 200, credCors);
      }

      return json({ error: 'not found' }, 404, credCors);
    }

    // A page view. No cookie, no address stored — the address is used only to
    // throttle, and is never written down.
    if (path === '/track' && request.method === 'POST') {
      if (await tooFast(env.RL_TRACK, clientIp(request))) return slowDown();
      const v = await readJson(request, 4096);
      if (!v || typeof v !== 'object') return json({ ok: false }, 400);
      const pagePath = text(v.path, 300);
      const session = text(v.session_id, 40);
      if (!pagePath || !pagePath.startsWith('/') || !session || !/^[A-Za-z0-9]{6,40}$/.test(session)) {
        return json({ ok: false }, 400);
      }
      const device = ['mobile', 'tablet', 'desktop'].includes(v.device) ? v.device : null;
      const pageType = text(v.page_type, 30);
      const refHost = text(v.referrer_host, 120);
      await env.DB.prepare('insert into page_views (path,page_type,item_name,item_ref,referrer_host,device,session_id) values (?,?,?,?,?,?,?)')
        .bind(pagePath, pageType && /^[a-z0-9_-]+$/i.test(pageType) ? pageType : null,
              text(v.item_name, 160), text(v.item_ref, 160),
              refHost && /^[a-z0-9.-]+$/i.test(refHost) ? refHost.toLowerCase() : null,
              device, session).run();
      return json({ ok: true });
    }

    // A guarantee registration from the public form. Every field is trimmed
    // and length-capped here; the browser's own checks count for nothing.
    if (path === '/guarantee' && request.method === 'POST') {
      if (await tooFast(env.RL_FORM, clientIp(request))) return slowDown();
      const g = await readJson(request, 32 * 1024);
      if (!g || typeof g !== 'object') return json({ error: 'That could not be read.' }, 400);

      // A field no person can see. Something filled it in, so it was not a person.
      // Answer as if it worked, and keep nothing.
      if (text(g.website, 200)) return json({ ok: true });

      const LIMITS = { title: 20, first_name: 80, last_name: 80, email: 160, address1: 160, address2: 160,
                       town: 80, postcode: 16, country: 60, retailer_name: 160, developer_name: 160,
                       installer_name: 160, installer_address1: 160, installer_address2: 160,
                       installer_town: 80, installer_postcode: 16, installer_country: 60, notes: 1000 };
      const row = {};
      for (const [field, max] of Object.entries(LIMITS)) row[field] = text(g[field], max);
      row.purchase_date = isDate(g.purchase_date) ? g.purchase_date : null;
      row.moved_in_date = isDate(g.moved_in_date) ? g.moved_in_date : null;

      const need = ['first_name', 'last_name', 'email', 'address1', 'town', 'postcode', 'retailer_name', 'purchase_date'];
      if (need.some(k => !row[k])) return json({ error: 'Some required details are missing.' }, 400);
      if (!isEmail(row.email)) return json({ error: 'That email address does not look right.' }, 400);

      const products = (Array.isArray(g.products) ? g.products : []).slice(0, 30)
        .map(item => ({ code: text(item && item.code, 60) || '', description: text(item && item.description, 200) || '' }))
        .filter(item => item.code || item.description);
      row.products = JSON.stringify(products);

      // Only a proof file this API issued, and only if it is really there.
      row.proof_file = null;
      if (typeof g.proof_file === 'string' && PROOF_KEY.test(g.proof_file)) {
        if (await env.PROOF.head(g.proof_file)) row.proof_file = g.proof_file;
      }

      const cols = ['title','first_name','last_name','email','address1','address2','town','postcode','country',
                    'retailer_name','purchase_date','developer_name','moved_in_date','installer_name',
                    'installer_address1','installer_address2','installer_town','installer_postcode',
                    'installer_country','products','proof_file','notes'];
      await env.DB.prepare(`insert into guarantee_registrations (${cols.join(',')}) values (${cols.map(() => '?').join(',')})`)
        .bind(...cols.map(c => row[c] ?? null)).run();
      return json({ ok: true });
    }

    // A request for furniture colour swatches. Kept in the database first, so
    // it is never lost; then emailed to sales if email sending is set up. The
    // colours are checked against the catalogue — only ones that exist count.
    if (path === '/swatch-request' && request.method === 'POST') {
      if (await tooFast(env.RL_FORM, clientIp(request))) return slowDown();
      const g = await readJson(request, 16 * 1024);
      if (!g || typeof g !== 'object') return json({ error: 'That could not be read.' }, 400);
      if (text(g.website, 200)) return json({ ok: true });          // the trap field: not a person

      const LIMITS = { name: 120, company: 160, email: 160, phone: 40, address1: 160, address2: 160,
                       town: 80, postcode: 16, notes: 1000 };
      const row = {};
      for (const [field, max] of Object.entries(LIMITS)) row[field] = text(g[field], max);
      if (['name', 'email', 'address1', 'town', 'postcode'].some(k => !row[k])) {
        return json({ error: 'Some required details are missing.' }, 400);
      }
      if (!isEmail(row.email)) return json({ error: 'That email address does not look right.' }, 400);

      const ranges = await env.DB.prepare('select slug, name, swatches from catalogue_ranges where swatches is not null').all();
      const known = new Map();
      for (const r of ranges.results) {
        for (const sw of (JSON.parse(r.swatches || '[]') || [])) {
          if (sw && sw.name) known.set(`${r.slug}|${sw.code || ''}|${sw.name}`, { range: r.name, name: sw.name, code: sw.code || '' });
        }
      }
      const chosen = [];
      for (const item of (Array.isArray(g.swatches) ? g.swatches : []).slice(0, 40)) {
        const hit = item && known.get(`${item.range}|${item.code || ''}|${item.name}`);
        if (hit && !chosen.some(c => c.range === hit.range && c.name === hit.name)) chosen.push(hit);
      }
      if (!chosen.length) return json({ error: 'Please choose at least one colour.' }, 400);
      if (chosen.length > 12) return json({ error: 'Please choose no more than twelve colours.' }, 400);
      row.swatches = JSON.stringify(chosen);

      const cols = ['name', 'company', 'email', 'phone', 'address1', 'address2', 'town', 'postcode', 'swatches', 'notes'];
      const saved = await env.DB.prepare(
        `insert into swatch_requests (${cols.join(',')}) values (${cols.map(() => '?').join(',')}) returning id`)
        .bind(...cols.map(c => row[c] ?? null)).first();

      // The email is a courtesy on top of the saved record. If it fails, the
      // request is still in the admin, marked as not emailed.
      try {
        if (await sendSwatchEmail(env, { ...row, id: saved.id, swatches: chosen })) {
          await env.DB.prepare('update swatch_requests set emailed = 1 where id = ?').bind(saved.id).run();
        }
      } catch (e) { console.error('swatch email', e); }
      return json({ ok: true });
    }

    // The proof-of-purchase photo that goes with a registration. The name is
    // chosen here, never by the sender, so nobody can overwrite another
    // customer's file; the type is checked against the file's own first bytes;
    // and it is throttled, because this is the one place a stranger can make
    // this site store something.
    if ((path === '/guarantee-proof' || path.startsWith('/guarantee-proof/')) &&
        (request.method === 'POST' || request.method === 'PUT')) {
      if (await tooFast(env.RL_FORM, clientIp(request))) return slowDown();
      const kind = PROOF_TYPES[(request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()];
      if (!kind) return json({ error: 'Please attach a photo (JPEG, PNG, WebP, HEIC) or a PDF.' }, 415);
      const buf = await readCapped(request, MAX_PROOF);
      if (!buf || buf.byteLength < 12) return json({ error: 'That file is too large — the limit is 10 MB.' }, 413);
      if (!kind.ok(new Uint8Array(buf, 0, 12))) return json({ error: 'That file is not what it says it is.' }, 415);
      const rand = [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
      const key = `proof-${Date.now()}-${rand}.${kind.ext}`;
      await env.PROOF.put(key, buf, { httpMetadata: {
        contentType: (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() } });
      return json({ ok: true, key });
    }

    /* ===== END admin + public write routes ===== */

    // A specification sheet, built from the catalogue as it stands right now.
    //   /spec/<category>/<range>/<product>.pdf   (optionally ?sku=…)
    if (path.startsWith('/spec/') && path.endsWith('.pdf')) {
      if (await tooFast(env.RL_SPEC, clientIp(request))) return slowDown();
      const parts = path.slice('/spec/'.length, -4).split('/').map(decoded);
      if (parts.some(part => !part)) return new Response('not found', { status: 404, headers: CORS });
      if (parts.length !== 3) return new Response('not found', { status: 404, headers: CORS });
      const subject = await specSubject(env.DB, parts[0], parts[1], parts[2]);
      if (!subject) return new Response('not found', { status: 404, headers: CORS });
      try {
        const bytes = await buildSpecSheet(env, subject, url.searchParams.get('sku'));
        const name = (subject.name || 'specification').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return new Response(bytes, { headers: {
          ...CORS,
          'content-type': 'application/pdf',
          'content-disposition': `inline; filename="ARMERA-${name}.pdf"`,
          'cache-control': 'public, max-age=300'
        } });
      } catch (e) {
        console.error('spec', e);
        return json({ error: 'That sheet could not be built just now.' }, 500);
      }
    }

    // For uptime monitors: proves the Worker and the database both answer.
    // Deliberately says nothing else — no counts, no configuration.
    if (path === '/health') {
      await env.DB.prepare('select 1').first();
      return json({ ok: true });
    }

    return new Response('not found', { status: 404, headers: CORS });
  },

  // One place to get CORS right: a credentialed request will not accept a
  // wildcard origin, so name the origin back whenever we trust it.
  async fetch(request, env) {
    let res;
    try {
      res = await handler.handle(request, env);
    } catch (e) {
      // The detail goes to the logs. The caller learns only that it failed.
      console.error('unhandled', request.method, new URL(request.url).pathname, e);
      res = json({ error: 'Something went wrong.' }, 500);
    }
    const headers = new Headers(res.headers);
    headers.set('x-content-type-options', 'nosniff');
    headers.set('referrer-policy', 'no-referrer');
    headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
    // Data replies are never meant to be shown as a page or framed. Files are
    // left alone here: browsers' built-in PDF viewers can trip over a strict
    // policy on the file itself, and serveFile sandboxes the risky types.
    if ((headers.get('content-type') || '').includes('application/json')) {
      headers.set('x-frame-options', 'DENY');
      headers.set('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    }
    // A credentialed request will not accept a wildcard origin, so name the
    // origin back whenever it is one we trust.
    const origin = request.headers.get('Origin') || '';
    if (trusted(origin)) {
      headers.set('access-control-allow-origin', origin);
      headers.set('access-control-allow-credentials', 'true');
      headers.append('vary', 'Origin');
    }
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
};

export default handler;
