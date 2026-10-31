// ARMERA data API.
//
// Serves the site's content out of D1 and its files out of R2, speaking the
// small dialect of PostgREST that the front end already uses — so the site
// changes only where it points, not how it asks.
//
// The admin still writes to Supabase, so /sync copies Supabase's content back
// into D1. The admin pings it after every save, and a cron runs it every five
// minutes as a safety net. The sync only ever copies Supabase -> D1 and never
// deletes, so a stray call can do no harm.

import { requireAuth, hashPassword, checkPassword, issueSession,
         tooManyAttempts, recordAttempt } from './auth.js';

const SUPABASE = 'https://pcouznwpyhtfrleedcsv.supabase.co';

// Only these origins may send credentials. Anything else gets the public,
// credential-free CORS used for reads.
const TRUSTED = [
  'https://armera-website.harry-01f.workers.dev',
  'https://harryw-developer.github.io',
  'https://armera.co.uk',
  'https://www.armera.co.uk',
  'http://localhost:4173'
];

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
    rows = rows.concat(docs.results.map(r => ({ key: r.key, data: JSON.parse(r.data), updated_at: r.updated_at })));
  }

  if (wanted) rows = rows.filter(r => wanted.includes(r.key));
  if ((url.searchParams.get('order') || '').startsWith('key')) rows.sort((a, b) => a.key.localeCompare(b.key));

  const cols = select.split(',').map(s => s.trim());
  if (!cols.includes('*')) rows = rows.map(r => Object.fromEntries(cols.filter(c => c in r).map(c => [c, r[c]])));
  return rows;
}

/* ---------- files ---------- */

async function serveFile(bucket, key, request) {
  if (!key) return new Response('not found', { status: 404 });
  const obj = await bucket.get(key);
  if (!obj) return new Response('not found', { status: 404, headers: CORS });
  const headers = new Headers(CORS);
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  const inm = request.headers.get('if-none-match');
  if (inm && inm === obj.httpEtag) return new Response(null, { status: 304, headers });
  return new Response(obj.body, { headers });
}

/* ---------- keeping D1 in step with Supabase ---------- */

// Rebuild the catalogue tables for one category document.
async function rebuildCategory(env, key, doc) {
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
  await env.DB.batch(stmts);
}

async function sync(env) {
  const res = await fetch(`${SUPABASE}/rest/v1/site_content?select=key,data,updated_at`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` }
  });
  if (!res.ok) return { ok: false, status: res.status };
  const rows = await res.json();

  const stmts = [];
  for (const r of rows) {
    stmts.push(env.DB.prepare('insert or replace into site_content (key, data, updated_at) values (?, ?, ?)')
      .bind(r.key, JSON.stringify(r.data), r.updated_at || new Date().toISOString()));
  }

  // rebuild the catalogue tables from the documents that just arrived
  const cats = rows.filter(r => /^\d\d-/.test(r.key));
  if (cats.length) {
    stmts.push(env.DB.prepare('delete from catalogue_variants'));
    stmts.push(env.DB.prepare('delete from catalogue_products'));
    stmts.push(env.DB.prepare('delete from catalogue_ranges'));
    stmts.push(env.DB.prepare('delete from catalogue_categories'));
    let rid = 0, pid = 0, vid = 0;
    const pick = (o, keys) => {
      const extra = {};
      for (const k of Object.keys(o)) if (!keys.includes(k)) extra[k] = o[k];
      return Object.keys(extra).length ? JSON.stringify(extra) : null;
    };
    const js = v => (v === undefined || v === null) ? null : JSON.stringify(v);
    cats.sort((a, b) => a.key.localeCompare(b.key));
    cats.forEach((row, ci) => {
      const c = row.data;
      stmts.push(env.DB.prepare('insert into catalogue_categories (key,slug,name,hero,extra,position) values (?,?,?,?,?,?)')
        .bind(row.key, c.slug, c.name, js(c.hero), pick(c, ['slug','name','hero','ranges']), ci));
      (c.ranges || []).forEach((r, ri) => {
        rid++;
        stmts.push(env.DB.prepare('insert into catalogue_ranges (id,category_key,slug,name,title,tagline,footnote,hero,alt_hero,swatches,addons,features,extra,position) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .bind(rid, row.key, r.slug, r.name, r.title ?? null, r.tagline ?? null, r.footnote ?? null,
                js(r.hero), js(r.altHero), js(r.swatches), js(r.addons), js(r.features),
                pick(r, ['slug','name','title','tagline','footnote','hero','altHero','swatches','addons','features','products']), ri));
        (r.products || []).forEach((p, pi) => {
          pid++;
          stmts.push(env.DB.prepare('insert into catalogue_products (id,range_id,slug,name,image,dims,note,footnote,spec,drawing,basin_link,images_by_code,gallery,goes_with,extra,position) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .bind(pid, rid, p.slug, p.name, p.image ?? null, p.dims ?? null, p.note ?? null, p.footnote ?? null,
                  p.spec ?? null, p.drawing ?? null, p.basinLink ?? null, js(p.imagesByCode), js(p.gallery), js(p.goesWith),
                  pick(p, ['slug','name','image','dims','note','footnote','spec','drawing','basinLink','imagesByCode','gallery','goesWith','variants']), pi));
          (p.variants || []).forEach((v, vi) => {
            vid++;
            stmts.push(env.DB.prepare('insert into catalogue_variants (id,product_id,sku,finish,price,code,image,extra,position) values (?,?,?,?,?,?,?,?,?)')
              .bind(vid, pid, v.sku, v.finish ?? null, v.price ?? null, v.code ?? null, v.image ?? null,
                    pick(v, ['sku','finish','price','code','image']), vi));
          });
        });
      });
    });
  }

  await env.DB.batch(stmts);
  return { ok: true, documents: rows.length, categories: cats.length };
}

const handler = {
  async handle(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // A credentialed request will not accept a wildcard origin, so the
    // preflight has to name the origin back when we trust it.
    const reqOrigin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') {
      const headers = TRUSTED.includes(reqOrigin)
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
        return json({ error: String(e).slice(0, 200) }, 500);
      }
    }

    if (path.startsWith('/assets/')) {
      return serveFile(env.ASSETS, decodeURIComponent(path.slice('/assets/'.length)), request);
    }
    if (path.startsWith('/instructions/')) {
      return serveFile(env.INSTRUCTIONS, decodeURIComponent(path.slice('/instructions/'.length)), request);
    }

    // the same listing shape the storage API returned, for the instructions page
    if (path.startsWith('/storage/v1/object/list/')) {
      const which = path.slice('/storage/v1/object/list/'.length);
      const bucket = which === 'instructions' ? env.INSTRUCTIONS : which === 'site-assets' ? env.ASSETS : null;
      if (!bucket) return json([], 200);
      const out = [];
      let cursor;
      do {
        const page = await bucket.list({ limit: 1000, cursor });
        for (const o of page.objects) {
          out.push({ name: o.key, id: o.key,
                     metadata: { size: o.size, mimetype: o.httpMetadata?.contentType || 'application/octet-stream' } });
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      return json(out);
    }

    // The admin now writes to D1 directly, so pulling from Supabase would
    // overwrite real edits. Kept behind a flag for a one-off re-import only.
    if (path === '/sync' && (request.method === 'POST' || request.method === 'GET')) {
      if (env.ALLOW_SUPABASE_PULL !== 'yes') {
        return json({ ok: true, skipped: 'D1 is authoritative; Supabase is no longer pulled from.' });
      }
      return json(await sync(env));
    }

    /* ---------- signing in ---------- */

    const credCors = TRUSTED.includes(reqOrigin)
      ? { 'access-control-allow-origin': reqOrigin, 'access-control-allow-credentials': 'true',
          'vary': 'Origin' }
      : {};

    if (path === '/auth/login' && request.method === 'POST') {
      const { email, password } = await request.json().catch(() => ({}));
      const addr = String(email || '').trim().toLowerCase();
      if (!addr || !password) return json({ error: 'Email and password are required.' }, 400, credCors);
      if (await tooManyAttempts(env.DB, addr)) {
        return json({ error: 'Too many attempts. Try again in fifteen minutes.' }, 429, credCors);
      }
      const row = await env.DB.prepare(
        'select email, display_name, password_hash, disabled, session_epoch from admin_users where email = ?')
        .bind(addr).first();
      const ok = row && !row.disabled && await checkPassword(password, row.password_hash);
      await recordAttempt(env.DB, addr, ok);
      if (!ok) return json({ error: 'Those details were not recognised.' }, 401, credCors);
      const token = await issueSession(row.email, env.SESSION_SECRET, 14, row.session_epoch || 0);
      await env.DB.prepare('update admin_users set last_seen = ? where email = ?')
        .bind(new Date().toISOString(), row.email).run();
      // The token goes back in the body only. No cookie: see requireAuth.
      return json({ email: row.email, display_name: row.display_name, token }, 200, credCors);
    }

    if (path === '/auth/logout') {
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
      const { token, password } = await request.json().catch(() => ({}));
      if (!token || !password) return json({ error: 'Link and password are both needed.' }, 400, credCors);
      if (String(password).length < 10) return json({ error: 'Use at least 10 characters.' }, 400, credCors);
      const row = await env.DB.prepare('select email, setup_expires from admin_users where setup_token = ?')
        .bind(token).first();
      if (!row) return json({ error: 'That link is not valid.' }, 401, credCors);
      if (!row.setup_expires || new Date(row.setup_expires) < new Date()) {
        return json({ error: 'That link has expired. Ask for a new one.' }, 401, credCors);
      }
      await env.DB.prepare(`update admin_users set password_hash = ?, setup_token = null,
          setup_expires = null, session_epoch = session_epoch + 1 where email = ?`)
        .bind(await hashPassword(password), row.email).run();
      return json({ ok: true, email: row.email }, 200, credCors);
    }

    // Changing a password while signed in.
    if (path === '/auth/change-password' && request.method === 'POST') {
      const who = await requireAuth(request, env);
      if (!who) return json({ error: 'not signed in' }, 401, credCors);
      const { password } = await request.json().catch(() => ({}));
      if (!password || String(password).length < 10) {
        return json({ error: 'Use at least 10 characters.' }, 400, credCors);
      }
      await env.DB.prepare(
        'update admin_users set password_hash = ?, session_epoch = session_epoch + 1 where email = ?')
        .bind(await hashPassword(password), who.email).run();
      return json({ ok: true, note: 'Other sessions have been signed out.' }, 200, credCors);
    }

    /* ===== BEGIN admin + public write routes (keep together) ===== */

    if (path.startsWith('/admin/') || path === '/prefs') {
      const who = await requireAuth(request, env);
      if (!who) return json({ error: 'not signed in' }, 401, credCors);

      if (path.startsWith('/admin/content/') && request.method === 'POST') {
        const key = decodeURIComponent(path.slice('/admin/content/'.length));
        const data = await request.json();
        const now = new Date().toISOString();
        await env.DB.prepare('insert or replace into site_content (key, data, updated_at) values (?,?,?)')
          .bind(key, JSON.stringify(data), now).run();
        if (/^[0-9][0-9]-/.test(key)) await rebuildCategory(env, key, data);
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
        const { status } = await request.json();
        await env.DB.prepare('update guarantee_registrations set status = ? where id = ?').bind(status, id).run();
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
        const cut = rest.indexOf('/');
        const bucket = pickBucket(rest.slice(0, cut));
        const key = decodeURIComponent(rest.slice(cut + 1));
        if (!bucket || !key) return json({ error: 'where?' }, 400, credCors);
        await bucket.put(key, request.body, {
          httpMetadata: { contentType: request.headers.get('content-type') || 'application/octet-stream',
                          cacheControl: 'public, max-age=31536000' } });
        return json({ ok: true, key }, 200, credCors);
      }

      if (path.startsWith('/admin/file/')) {
        const rest = path.slice('/admin/file/'.length);
        const cut = rest.indexOf('/');
        const bucket = pickBucket(rest.slice(0, cut));
        const key = decodeURIComponent(rest.slice(cut + 1));
        if (request.method === 'DELETE') {
          await bucket.delete(key);
          return json({ ok: true }, 200, credCors);
        }
        return serveFile(bucket, key, request);
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
        const { email, display_name } = await request.json().catch(() => ({}));
        const addr = String(email || '').trim().toLowerCase();
        if (!addr || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) {
          return json({ error: 'That does not look like an email address.' }, 400, credCors);
        }
        const existing = await env.DB.prepare('select email from admin_users where email = ?').bind(addr).first();
        if (existing) return json({ error: 'That person is already on the list.' }, 409, credCors);
        const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
        const expires = new Date(Date.now() + 7 * 86400000).toISOString();
        await env.DB.prepare(
          'insert into admin_users (email, display_name, prefs, setup_token, setup_expires) values (?,?,?,?,?)')
          .bind(addr, (display_name || '').trim() || addr.split('@')[0], '{}', token, expires).run();
        return json({ ok: true, email: addr, token, expires }, 200, credCors);
      }

      if (path.startsWith('/admin/users/')) {
        const rest = path.slice('/admin/users/'.length);
        const makeLink = rest.endsWith('/link');
        const addr = decodeURIComponent(makeLink ? rest.slice(0, -5) : rest).toLowerCase();
        const target = await env.DB.prepare('select email, disabled from admin_users where email = ?')
          .bind(addr).first();
        if (!target) return json({ error: 'No such person.' }, 404, credCors);

        // a new one-time link, for someone who never set a password or forgot it
        if (makeLink && request.method === 'POST') {
          const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
          const expires = new Date(Date.now() + 7 * 86400000).toISOString();
          await env.DB.prepare('update admin_users set setup_token = ?, setup_expires = ? where email = ?')
            .bind(token, expires, addr).run();
          return json({ ok: true, email: addr, token, expires }, 200, credCors);
        }

        if (request.method === 'POST') {
          const { display_name, disabled } = await request.json().catch(() => ({}));
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
        const body = await request.json();
        const prefs = { ...JSON.parse(who.prefs || '{}'), ...(body.prefs || {}) };
        await env.DB.prepare('update admin_users set prefs = ?, display_name = coalesce(?, display_name) where email = ?')
          .bind(JSON.stringify(prefs), body.display_name ?? null, who.email).run();
        return json({ ok: true, prefs }, 200, credCors);
      }

      return json({ error: 'not found' }, 404, credCors);
    }

    if (path === '/track' && request.method === 'POST') {
      const v = await request.json().catch(() => null);
      if (!v || !v.path || !v.session_id) return json({ ok: false }, 400);
      await env.DB.prepare('insert into page_views (path,page_type,item_name,item_ref,referrer_host,device,session_id) values (?,?,?,?,?,?,?)')
        .bind(String(v.path).slice(0, 300), v.page_type ?? null, v.item_name ?? null, v.item_ref ?? null,
              v.referrer_host ?? null, v.device ?? null, String(v.session_id).slice(0, 40)).run();
      return json({ ok: true });
    }

    if (path === '/guarantee' && request.method === 'POST') {
      const g = await request.json().catch(() => null);
      const need = ['first_name','last_name','email','address1','town','postcode','retailer_name','purchase_date'];
      if (!g || need.some(k => !g[k])) return json({ error: 'Some required details are missing.' }, 400);
      const cols = ['title','first_name','last_name','email','address1','address2','town','postcode','country',
                    'retailer_name','purchase_date','developer_name','moved_in_date','installer_name',
                    'installer_address1','installer_address2','installer_town','installer_postcode',
                    'installer_country','products','proof_file','notes'];
      const vals = cols.map(c => c === 'products' ? JSON.stringify(g.products || []) : (g[c] ?? null));
      await env.DB.prepare(`insert into guarantee_registrations (${cols.join(',')}) values (${cols.map(() => '?').join(',')})`)
        .bind(...vals).run();
      return json({ ok: true });
    }

    if (path.startsWith('/guarantee-proof/') && request.method === 'PUT') {
      const key = decodeURIComponent(path.slice('/guarantee-proof/'.length));
      const len = Number(request.headers.get('content-length') || 0);
      if (!key || len > 10 * 1024 * 1024) return json({ error: 'too large' }, 400);
      await env.PROOF.put(key, request.body, {
        httpMetadata: { contentType: request.headers.get('content-type') || 'application/octet-stream' } });
      return json({ ok: true, key });
    }

    /* ===== END admin + public write routes ===== */

    if (path === '/health') {
      const n = await env.DB.prepare('select count(*) as n from catalogue_products').first();
      const u = await env.DB.prepare('select count(*) as n, sum(password_hash is not null) as withpw from admin_users').first();
      return json({ ok: true, products: n.n, users: u.n, users_with_password: u.withpw || 0,
                    access_configured: Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) });
    }

    return new Response('not found', { status: 404, headers: CORS });
  },

  // One place to get CORS right: a credentialed request will not accept a
  // wildcard origin, so name the origin back whenever we trust it.
  async fetch(request, env) {
    const res = await handler.handle(request, env);
    const origin = request.headers.get('Origin') || '';
    if (!TRUSTED.includes(origin)) return res;
    const headers = new Headers(res.headers);
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-credentials', 'true');
    headers.append('vary', 'Origin');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  },

  async scheduled(event, env, ctx) {
    // Nothing to pull any more — D1 is the record. Left in place so a
    // scheduled job exists if one is wanted later (a backup, say).
    if (env.ALLOW_SUPABASE_PULL === 'yes') ctx.waitUntil(sync(env));
  }
};

export default handler;
