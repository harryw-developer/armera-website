# Cloudflare

Everything the website runs on. The full picture — layers, data, secrets,
backups and how to restore — is in [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

| Folder / file | What it is |
|---|---|
| `api/` | The `armera-api` Worker: database, files, sign-in, admin saves, spec sheets. Deploy with `npx wrangler deploy` from inside it. |
| `site/` | The `armera-website` Worker: serves the built pages in `site/public/` (generated, not in git). Deployed by `../deploy.sh`. |
| `schema.sql`, `catalogue-schema.sql`, `auth-schema.sql`, `setup-tokens.sql`, `session-hardening.sql` | The database structure, in the order it was applied. |

Supabase is no longer used by anything. The migration from it was completed
and verified on 30 October 2026 (all 13 content documents identical by
content, 1,299 files identical byte for byte); the working files from that
move are in `../backups/migration/`.
