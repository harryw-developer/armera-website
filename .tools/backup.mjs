// Back up everything ARMERA's website holds on Cloudflare.
//
//   node .tools/backup.mjs            everything (database + every stored file)
//   node .tools/backup.mjs --quick    the editable content only (seconds)
//
// What it writes, and where:
//
//   backups/site_content-<date>.json        inside the repo. The catalogue and
//       page wording exactly as the site serves them. Nothing personal.
//
//   ../backups-private/<date>/d1.sql        OUTSIDE the repo, on purpose: the
//   ../backups-private/<date>/manifest.json whole database, which includes
//   ../backups-private/files/<bucket>/…     customers' guarantee registrations,
//       sign-in records and proof-of-purchase files. Never commit these.
//
// The files folder is a mirror that only ever grows: a file removed from the
// site stays in the mirror, so it can be put back. Only new or changed files
// are downloaded, so a second run takes a fraction of the first.
//
// It only reads from Cloudflare. Restoring is a deliberate, separate act —
// see ARCHITECTURE.md ("Getting it back").
import { writeFileSync, mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.DATA_URL || 'https://armera-api.harry-01f.workers.dev';
const DATABASE = 'armera';
const BUCKETS = ['armera-assets', 'armera-instructions', 'armera-guarantee-proof'];
const PRIVATE = process.env.BACKUP_DIR || join(ROOT, '..', 'backups-private');
const QUICK = process.argv.includes('--quick');
const UA = { 'User-Agent': 'armera-backup' };

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

/* ---------- 1. the editable content, as the site serves it ---------- */
const res = await fetch(`${API}/rest/v1/site_content?select=key,data,updated_at`, { headers: UA });
if (!res.ok) throw new Error(`The content API said ${res.status}`);
const rows = await res.json();
if (!Array.isArray(rows) || rows.length < 9) throw new Error(`Only ${rows.length} content rows came back — refusing to call that a backup.`);
mkdirSync(join(ROOT, 'backups'), { recursive: true });
writeFileSync(join(ROOT, 'backups', `site_content-${stamp}.json`), JSON.stringify(rows, null, 1));
console.log(`Content: ${rows.length} rows -> backups/site_content-${stamp}.json`);
if (QUICK) process.exit(0);

/* ---------- 2. the whole database ---------- */
const runDir = join(PRIVATE, stamp);
mkdirSync(runDir, { recursive: true });
const sqlFile = join(runDir, 'd1.sql');
execFileSync('npx', ['-y', 'wrangler@latest', 'd1', 'export', DATABASE, '--remote', '--output', sqlFile],
             { cwd: join(ROOT, 'cloudflare', 'api'), stdio: ['ignore', 'ignore', 'inherit'] });
const sql = readFileSync(sqlFile, 'utf8');
const tables = {};
for (const m of sql.matchAll(/^INSERT INTO "?([A-Za-z0-9_]+)"?/gm)) tables[m[1]] = (tables[m[1]] || 0) + 1;
if (!tables.site_content || !tables.catalogue_products) throw new Error('The database export is missing the catalogue — not a usable backup.');
console.log(`Database: ${(statSync(sqlFile).size / 1048576).toFixed(1)} MB -> ${sqlFile}`);

/* ---------- 3. every stored file ---------- */
// Signed in the same way wrangler is. The token is read, used, and never shown.
function token() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  for (const p of [join(homedir(), 'Library/Preferences/.wrangler/config/default.toml'),
                   join(homedir(), '.config/.wrangler/config/default.toml'),
                   join(homedir(), '.wrangler/config/default.toml')]) {
    if (!existsSync(p)) continue;
    const m = readFileSync(p, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/);
    if (m) return m[1];
  }
  throw new Error('Not signed in to Cloudflare. Run: npx wrangler login');
}
// wrangler refreshes its own sign-in when asked anything; the export above did that.
const auth = { ...UA, Authorization: `Bearer ${token()}` };
const cf = async path => {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: auth });
  if (!r.ok) throw new Error(`Cloudflare said ${r.status} for ${path.split('?')[0]}`);
  return r;
};
const account = (await (await cf('/accounts')).json()).result[0].id;

const files = {};
let fetched = 0, kept = 0, bytes = 0;
for (const bucket of BUCKETS) {
  const list = [];
  let cursor = '';
  do {
    const page = await (await cf(`/accounts/${account}/r2/buckets/${bucket}/objects?per_page=1000${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`)).json();
    list.push(...page.result);
    cursor = page.result_info && page.result_info.is_truncated ? page.result_info.cursor : '';
  } while (cursor);

  files[bucket] = list.map(o => ({ key: o.key, size: o.size, etag: o.etag, type: o.http_metadata && o.http_metadata.contentType }));
  // remember what each mirrored file was, so an unchanged one is not fetched again
  const seenFile = join(PRIVATE, 'files', `${bucket}.seen.json`);
  const seen = existsSync(seenFile) ? JSON.parse(readFileSync(seenFile, 'utf8')) : {};

  const todo = list.filter(o => {
    if (o.key.includes('..') || o.key.startsWith('/')) return false;        // never write outside the folder
    const dest = join(PRIVATE, 'files', bucket, o.key);
    const same = existsSync(dest) && statSync(dest).size === o.size && seen[o.key] === o.etag;
    if (same) kept++;
    return !same;
  });
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const o = todo[next++];
      const dest = join(PRIVATE, 'files', bucket, o.key);
      mkdirSync(dirname(dest), { recursive: true });
      const r = await cf(`/accounts/${account}/r2/buckets/${bucket}/objects/${o.key.split('/').map(encodeURIComponent).join('/')}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length !== o.size) throw new Error(`${bucket}/${o.key}: got ${buf.length} bytes, expected ${o.size}`);
      writeFileSync(dest, buf);
      seen[o.key] = o.etag;
      fetched++; bytes += buf.length;
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  mkdirSync(join(PRIVATE, 'files'), { recursive: true });
  writeFileSync(seenFile, JSON.stringify(seen));
  console.log(`Files: ${bucket} — ${list.length} files, ${(list.reduce((n, o) => n + o.size, 0) / 1048576).toFixed(0)} MB`);
}

writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({
  taken: new Date().toISOString(), database: DATABASE, rows_per_table: tables, files
}, null, 1));
console.log(`Downloaded ${fetched} new or changed files (${(bytes / 1048576).toFixed(0)} MB); ${kept} already up to date.`);
console.log(`Rows: ${Object.entries(tables).map(([t, n]) => `${t} ${n}`).join(', ')}`);
console.log(`\nFull backup is in ${PRIVATE}\nIt holds customer details. Keep a copy somewhere other than this computer, and never in the repo.`);
