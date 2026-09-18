#!/usr/bin/env bash
set -euo pipefail

echo "Reconstructing CutFlow base source..."
release_archive="$(mktemp --suffix=.tar.xz)"
privacy_patch="$(mktemp --suffix=.patch)"
trap 'rm -f "$release_archive" "$privacy_patch"' EXIT
cat .cutflow-current/part*.b64 | base64 -d > "$release_archive"
xz -t "$release_archive"
tar -xJf "$release_archive" --strip-components=1

echo "Applying CutFlow v0.12.4 customer-privacy update..."
cat .cutflow-v12-4/part*.patch > "$privacy_patch"
patch --batch --forward -p1 < "$privacy_patch"

echo "Installing pinned dependencies..."
npm ci
echo "Building CutFlow..."
npm run build
