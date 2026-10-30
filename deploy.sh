#!/bin/sh
# Two builds, two places.
#   public  — the site, reading the API across at armera-api.workers.dev, no admin
#   admin   — the same site plus the admin, same-origin with its own API, on
#             admin.hayesbrow.com where Cloudflare Access can gate it
set -e
cd "$(dirname "$0")"

echo "— admin bundle (same-origin, includes the admin) —"
INCLUDE_ADMIN=1 DATA_URL='' OUT_DIR=cloudflare/api/public node build.mjs
printf '/*\n  X-Robots-Tag: noindex\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n' > cloudflare/api/public/_headers
(cd cloudflare/api && npx -y wrangler@latest deploy)

echo "— public site on Cloudflare —"
rm -rf /tmp/armera-public
OUT_DIR=/tmp/armera-public node build.mjs
printf '/*\n  X-Robots-Tag: noindex\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n' > /tmp/armera-public/_headers
npx -y wrangler@latest deploy --assets=/tmp/armera-public --name armera-website --compatibility-date 2026-10-23

echo "— public site for GitHub Pages —"
BASE_PATH=/armera-website node build.mjs
echo "docs/ rebuilt — commit and push to publish"
