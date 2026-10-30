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
