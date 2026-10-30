# Cloudflare

The public site reads its content and files from Cloudflare (30 Oct 2026).
Supabase is still the place the admin writes to, and still holds everything —
nothing has been deleted from it.

## How it hangs together now

```
  admin  --writes-->  Supabase  --/sync-->  D1  --reads-->  the site
                                   ^                         |
                                   |                    R2 (files)
                          cron every 5 minutes
```

The admin saves to Supabase exactly as before, then pings the API's `/sync`,
which copies the content into D1 and rebuilds the catalogue tables from it. A
cron repeats that every five minutes, so a failed ping self-heals. Edits appear
on the site straight away.

Still on Supabase, because the admin reads them from there: analytics
(`page_views`) and guarantee registrations. They move when the admin's writes
and sign-in do.

**New uploads are the one gap.** The admin uploads files to Supabase Storage,
and the site now reads files from R2, so a newly uploaded image will 404 until
it is copied across. Re-run the file copy, or move uploads to R2, before the
admin is used for new photography.

| What | Where | Contents |
|---|---|---|
| Database | D1 `armera` (`3a4d04bb-…`) | `site_content` 13 rows, `page_views` 859 rows, `guarantee_registrations` (empty, schema only) |
| Files | R2 `armera-assets` | 1,293 objects, 265.9 MB — mirror of the `site-assets` bucket |
| Files | R2 `armera-instructions` | 6 objects, 6.6 MB — mirror of the `instructions` bucket |
| Site | Worker `armera-website` | Static build, `noindex`, at `armera-website.harry-01f.workers.dev` |

`schema.sql` is the D1 schema: the Postgres `jsonb` columns become `TEXT`
holding JSON, and `timestamptz` becomes `TEXT` holding ISO-8601 UTC, which
sorts and compares correctly as a string.

## Verification done at copy time

- All 13 `site_content` documents compared by content hash after parsing — identical.
- `page_views` row count and id range identical (859 rows, 1–859).
- Every one of the 1,299 files present in R2 at the identical byte size.
- Content checksums compared for all 1,299; the two instruction PDFs whose
  Supabase etag is a multipart hash (suffix `-1`) were additionally fetched from
  both sides and compared by SHA-256 — identical.

## Re-syncing before a switchover

The copy is a point in time. Anything changed in the admin afterwards lands in
Supabase only, so re-run the copy immediately before any cutover:

```
cd cloudflare && npx wrangler deploy -c migrate.wrangler.jsonc
# then re-run the export + copy steps, then delete the worker again
```

`migrate-worker.js` is copy-only — it never deletes from either side. It is
deployed temporarily, protected by a `MIGRATE_TOKEN` secret, and deleted once a
copy is verified so no public endpoint with bucket access is left running.

## Signing in

Two ways in, both ending at the same identity. `requireAuth()` accepts either,
so nothing else in the Worker needs to know which was used.

**Cloudflare Access.** Cloudflare authenticates the person and passes a signed
assertion; no password is stored or checked here. The code verifies that
assertion against the team's published keys, checks audience and expiry, then
still requires the address to exist and be enabled in `admin_users` — Access
says who you are, we decide whether you may. It stays dormant until
`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set, which needs armera.co.uk on
Cloudflare. That is the only thing here waiting on the domain.

**Email and password.** Works today on workers.dev. PBKDF2-SHA256 at 100,000
iterations, which is the most Workers permits — it rejects anything higher
outright. Sessions are HMAC-signed tokens in an HttpOnly, Secure cookie, valid
fourteen days. Eight failed attempts in fifteen minutes locks an address out,
and unknown accounts return the same message as wrong passwords so the form
cannot be used to find out who has an account.

The four admin accounts exist with no password set, and a null hash can never
match. `/auth/set-password` accepts a current Supabase session — verified by
asking Supabase, so no secret is shared — and writes the new hash. That bridge
exists so nobody needs reset emails during the changeover, and goes away when
the admin stops signing in through Supabase.

Credentialed endpoints accept only known origins; reads stay open.
