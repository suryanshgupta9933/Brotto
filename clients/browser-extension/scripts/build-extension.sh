#!/usr/bin/env bash
set -euo pipefail

EXT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$EXT_DIR/dist"
OUT_DIR="$EXT_DIR/build"
NAME=$(basename "$EXT_DIR")
VERSION=$(node -p "require('$EXT_DIR/package.json').version")
ZIP="$OUT_DIR/${NAME}-${VERSION}.zip"

mkdir -p "$OUT_DIR"

# Run existing build (produces dist/ with manifest.json, *.js, *.html)
cd "$EXT_DIR"
node build.mjs

# Zip the dist/ folder
cd "$BUILD_DIR"
rm -f "$ZIP"
zip -r "$ZIP" . -x "*.map"

echo "Built $ZIP"
ls -lh "$ZIP"
