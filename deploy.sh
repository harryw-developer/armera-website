#!/bin/sh
# Builds the site and publishes it.
#
#   armera-website  — the Cloudflare Worker that serves the site, including /admin
#   docs/           — the public pages only, for GitHub Pages (no admin, and
#                     GitHub cannot send security headers, so it is a mirror
#                     at best — retire it at launch)
#
# Both read content and files from armera-api, which is data only.
#
#   ./deploy.sh                 pre-launch: search engines are kept out
#   INDEXABLE=1 SITE_URL=https://www.armera.co.uk ./deploy.sh     the launch build
set -e
cd "$(dirname "$0")"

API=${API:-https://armera-api.harry-01f.workers.dev}

echo "— building —"
rm -rf cloudflare/site/public
INCLUDE_ADMIN=1 DATA_URL="$API" OUT_DIR=cloudflare/site/public node build.mjs

echo "— publishing to Cloudflare —"
(cd cloudflare/site && npx -y wrangler@latest deploy)

echo "— building for GitHub Pages (public pages only) —"
DATA_URL="$API" BASE_PATH=/armera-website node build.mjs
echo "docs/ rebuilt — commit and push to publish"
