// Snapshot everything the admin can change, so there is always a way back.
// Run:  node .tools/backup.mjs        (writes backups/site_content-<date>.json)
// It only reads. Restoring is a deliberate, separate act — see README.
import { writeFileSync, mkdirSync } from 'node:fs';

const SUPABASE_URL = 'https://pcouznwpyhtfrleedcsv.supabase.co';
const ANON_KEY = process.env.ARMERA_ANON_KEY ||
  (await import('node:fs')).readFileSync(new URL('../build.mjs', import.meta.url), 'utf8')
    .match(/const ANON_KEY = '([^']*)'/)[1];

const res = await fetch(`${SUPABASE_URL}/rest/v1/site_content?select=key,data,updated_at`, {
  headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }
});
if (!res.ok) throw new Error(`Supabase said ${res.status}`);
const rows = await res.json();

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
mkdirSync(new URL('../backups/', import.meta.url), { recursive: true });
const file = new URL(`../backups/site_content-${stamp}.json`, import.meta.url);
writeFileSync(file, JSON.stringify(rows, null, 1));

const sizes = rows.map(r => `${r.key} (${JSON.stringify(r.data).length} bytes)`).join('\n  ');
console.log(`Saved ${rows.length} rows to backups/site_content-${stamp}.json\n  ${sizes}`);
