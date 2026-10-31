#!/bin/sh
# One site, two places it is published.
#
#   armera-website  — the Worker that serves the site, including /admin
#   docs/           — the same site for GitHub Pages, under /armera-website
#
# Both read their content and files from armera-api, which is data only:
# D1, R2, auth and the admin's write endpoints. It serves no pages.
set -e
cd "$(dirname "$0")"

API=${API:-https://armera-api.harry-01f.workers.dev}

echo "— building —"
rm -rf /tmp/armera-public
INCLUDE_ADMIN=1 DATA_URL="$API" OUT_DIR=/tmp/armera-public node build.mjs
printf '/*\n  X-Robots-Tag: noindex\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n' > /tmp/armera-public/_headers

echo "— publishing to Cloudflare —"
npx -y wrangler@latest deploy --assets=/tmp/armera-public --name armera-website --compatibility-date 2026-10-23

echo "— building for GitHub Pages —"
INCLUDE_ADMIN=1 DATA_URL="$API" BASE_PATH=/armera-website node build.mjs
echo "docs/ rebuilt — commit and push to publish"
