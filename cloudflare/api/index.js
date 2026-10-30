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
  'access-control-allow-methods': 'GET, POST, OPTIONS'
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

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

    if (path === '/sync' && (request.method === 'POST' || request.method === 'GET')) {
      return json(await sync(env));
    }

    /* ---------- signing in ---------- */

    const origin = request.headers.get('Origin') || '';
    const credCors = TRUSTED.includes(origin)
      ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
          'vary': 'Origin' }
      : {};

    if (path === '/auth/login' && request.method === 'POST') {
      const { email, password } = await request.json().catch(() => ({}));
      const addr = String(email || '').trim().toLowerCase();
      if (!addr || !password) return json({ error: 'Email and password are required.' }, 400, credCors);
      if (await tooManyAttempts(env.DB, addr)) {
        return json({ error: 'Too many attempts. Try again in fifteen minutes.' }, 429, credCors);
      }
      const row = await env.DB.prepare('select email, display_name, password_hash, disabled from admin_users where email = ?')
        .bind(addr).first();
      const ok = row && !row.disabled && await checkPassword(password, row.password_hash);
      await recordAttempt(env.DB, addr, ok);
      if (!ok) return json({ error: 'Those details were not recognised.' }, 401, credCors);
      const token = await issueSession(row.email, env.SESSION_SECRET);
      await env.DB.prepare('update admin_users set last_seen = ? where email = ?')
        .bind(new Date().toISOString(), row.email).run();
      return json({ email: row.email, display_name: row.display_name, token }, 200, {
        ...credCors,
        'set-cookie': `armera_session=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${14 * 86400}`
      });
    }

    if (path === '/auth/logout') {
      return json({ ok: true }, 200, {
        ...credCors,
        'set-cookie': 'armera_session=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0'
      });
    }

    if (path === '/auth/me') {
      const who = await requireAuth(request, env);
      if (!who) return json({ error: 'not signed in' }, 401, credCors);
      return json({ email: who.email, display_name: who.display_name,
                    prefs: JSON.parse(who.prefs || '{}'), via: who.via }, 200, credCors);
    }

    // Bridge: while the admin still signs in with Supabase, let a signed-in
    // person set their Cloudflare password without needing a reset email.
    // The Supabase token is verified with Supabase, so no secret is needed here.
    if (path === '/auth/set-password' && request.method === 'POST') {
      const { password } = await request.json().catch(() => ({}));
      const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
      if (!bearer) return json({ error: 'Sign in first.' }, 401, credCors);
      if (!password || String(password).length < 10) {
        return json({ error: 'Use at least 10 characters.' }, 400, credCors);
      }
      const who = await fetch(`${SUPABASE}/auth/v1/user`, {
        headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${bearer}` }
      });
      if (!who.ok) return json({ error: 'That session was not accepted.' }, 401, credCors);
      const user = await who.json();
      const addr = (user.email || '').toLowerCase();
      const known = await env.DB.prepare('select email from admin_users where email = ?').bind(addr).first();
      if (!known) return json({ error: 'That account is not set up here yet.' }, 403, credCors);
      await env.DB.prepare('update admin_users set password_hash = ? where email = ?')
        .bind(await hashPassword(password), addr).run();
      return json({ ok: true, email: addr }, 200, credCors);
    }

    if (path === '/health') {
      const n = await env.DB.prepare('select count(*) as n from catalogue_products').first();
      const u = await env.DB.prepare('select count(*) as n, sum(password_hash is not null) as withpw from admin_users').first();
      return json({ ok: true, products: n.n, users: u.n, users_with_password: u.withpw || 0,
                    access_configured: Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) });
    }

    return new Response('not found', { status: 404, headers: CORS });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sync(env));
  }
};
