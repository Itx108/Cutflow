#!/usr/bin/env bash
set -euo pipefail

echo "Reconstructing CutFlow base source..."
release_archive="$(mktemp --suffix=.tar.xz)"
trap 'rm -f "$release_archive"' EXIT
cat .cutflow-current/part*.b64 | base64 -d > "$release_archive"
xz -t "$release_archive"
tar -xJf "$release_archive" --strip-components=1

echo "Applying CutFlow v0.12.4 customer-privacy update..."
node .cutflow-v12-4/apply-privacy-v12-4.mjs

echo "Installing pinned dependencies..."
npm ci
echo "Building CutFlow..."
npm run build
