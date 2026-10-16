#!/bin/sh
# Copies the prebuilt Basecoat UI files (no build step needed) into public/vendor/basecoat/.
# Usage: scripts/vendor-basecoat.sh [version]   (default: the version pinned in package.json)
set -eu
cd "$(dirname "$0")/.."
VERSION="${1:-$(node -p "require('./package.json').devDependencies['basecoat-css']")}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
(cd "$TMP" && npm pack "basecoat-css@$VERSION" --silent >/dev/null && tar -xzf basecoat-css-*.tgz)
OUT=public/vendor/basecoat
mkdir -p "$OUT"
cp "$TMP/package/dist/basecoat.cdn.min.css" "$OUT/basecoat.cdn.min.css"
cp "$TMP/package/dist/js/all.min.js" "$OUT/basecoat.all.min.js"
cp "$TMP/package/LICENSE.md" "$OUT/LICENSE.md"
{
  echo "basecoat-css $VERSION"
  echo "source: https://www.npmjs.com/package/basecoat-css/v/$VERSION (dist/basecoat.cdn.min.css, dist/js/all.min.js)"
  echo "sha256:"
  (cd "$OUT" && sha256sum basecoat.cdn.min.css basecoat.all.min.js)
} > "$OUT/VERSION"
cat "$OUT/VERSION"
