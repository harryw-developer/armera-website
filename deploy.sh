#!/bin/sh
# One site, two places it is published.
#
#   armera-website  — the Worker that serves the site, including /admin
#   docs/           — the same site for GitHub Pages, under /armera-website
#
# Both read content and files from armera-api, which is data only.
set -e
cd "$(dirname "$0")"

API=${API:-https://armera-api.harry-01f.workers.dev}

echo "— building —"
rm -rf cloudflare/site/public
INCLUDE_ADMIN=1 DATA_URL="$API" OUT_DIR=cloudflare/site/public node build.mjs
printf '/*\n  X-Robots-Tag: noindex\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n' > cloudflare/site/public/_headers

echo "— publishing to Cloudflare —"
(cd cloudflare/site && npx -y wrangler@latest deploy)

echo "— building for GitHub Pages —"
INCLUDE_ADMIN=1 DATA_URL="$API" BASE_PATH=/armera-website node build.mjs
echo "docs/ rebuilt — commit and push to publish"
