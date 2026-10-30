// Two ways into the admin, both ending at the same identity: an email.
//
//  1. Cloudflare Access — Cloudflare authenticates the person and passes a
//     signed assertion. No password is stored or checked here. Dormant until
//     ACCESS_TEAM_DOMAIN and ACCESS_AUD are set, which needs the domain on
//     Cloudflare; until then the header is simply never present.
//  2. Email and password — PBKDF2-SHA256, with a signed session token.
//
// requireAuth() accepts either, so the rest of the Worker never needs to care
// which was used.

const enc = new TextEncoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/=+$/, '');
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

/* ---------- passwords ---------- */

// Workers refuses PBKDF2 above 100,000 iterations, so that is the ceiling.
// It is a sensible work factor rather than a generous one, which is part of
// why Cloudflare Access is the preferred way in and this is the fallback.
// The rate limit below does the heavy lifting against online guessing.
const ITERATIONS = 100000;
const MAX_ITERATIONS = 100000;

async function pbkdf2(password, salt, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return `${ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

// Constant-time so a wrong password cannot be found a byte at a time.
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function checkPassword(password, stored) {
  if (!stored) return false;                       // no password set: never matches
  const [iter, salt, hash] = stored.split('$');
  if (!iter || !salt || !hash) return false;
  if (Number(iter) > MAX_ITERATIONS) return false; // unverifiable here; must be reset
  try {
    const got = await pbkdf2(password, unb64(salt), Number(iter));
    return sameBytes(got, unb64(hash));
  } catch {
    return false;
  }
}

/* ---------- session tokens ---------- */

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' },
                                 false, ['sign', 'verify']);
}

export async function issueSession(email, secret, days = 14) {
  const payload = b64(enc.encode(JSON.stringify({
    email, exp: Date.now() + days * 86400000
  })));
  const sig = b64(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload)));
  return `${payload}.${sig}`;
}

export async function readSession(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64(sig), enc.encode(payload));
  if (!ok) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(unb64(payload)));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

/* ---------- Cloudflare Access ---------- */

let jwksCache = { at: 0, keys: null };

async function accessKeys(teamDomain) {
  if (jwksCache.keys && Date.now() - jwksCache.at < 3600000) return jwksCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) return null;
  const { keys } = await res.json();
  jwksCache = { at: Date.now(), keys };
  return keys;
}

// Verifies the assertion Cloudflare Access puts on the request.
export async function readAccess(request, env) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const [h, p, s] = token.split('.');
  if (!s) return null;
  const header = JSON.parse(new TextDecoder().decode(unb64(h)));
  const keys = await accessKeys(env.ACCESS_TEAM_DOMAIN);
  const jwk = keys && keys.find(k => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64(s), enc.encode(`${h}.${p}`));
  if (!ok) return null;
  const claims = JSON.parse(new TextDecoder().decode(unb64(p)));
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (claims.exp * 1000 < Date.now()) return null;
  return { email: (claims.email || '').toLowerCase(), via: 'access' };
}

/* ---------- the one entry point the rest of the Worker uses ---------- */

const cookie = (header, name) =>
  (header || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1);

export async function requireAuth(request, env) {
  const access = await readAccess(request, env);
  if (access) {
    const row = await env.DB.prepare('select email, display_name, prefs, disabled from admin_users where email = ?')
      .bind(access.email).first();
    if (!row || row.disabled) return null;          // Access let them in, we still decide
    return { ...row, via: 'access' };
  }

  const token = cookie(request.headers.get('Cookie'), 'armera_session')
             || (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  const session = await readSession(token, env.SESSION_SECRET);
  if (!session) return null;
  const row = await env.DB.prepare('select email, display_name, prefs, disabled from admin_users where email = ?')
    .bind(session.email).first();
  if (!row || row.disabled) return null;
  return { ...row, via: 'password' };
}

/* ---------- slowing down guessing ---------- */

export async function tooManyAttempts(db, email) {
  const since = new Date(Date.now() - 15 * 60000).toISOString();
  const row = await db.prepare('select count(*) as n from auth_attempts where email = ? and ok = 0 and at > ?')
    .bind(email, since).first();
  return row.n >= 8;
}

export async function recordAttempt(db, email, ok) {
  await db.prepare('insert into auth_attempts (email, at, ok) values (?, ?, ?)')
    .bind(email, new Date().toISOString(), ok ? 1 : 0).run();
}
