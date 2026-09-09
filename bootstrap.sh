#!/usr/bin/env bash
set -euo pipefail

echo "Reconstructing CutFlow production source..."
cat .cutflow-fixed/part*.b64 > /tmp/cutflow-source.b64
base64 -d /tmp/cutflow-source.b64 > /tmp/cutflow-source.tar.xz
xz -t /tmp/cutflow-source.tar.xz

tar -xJf /tmp/cutflow-source.tar.xz --strip-components=1

echo "Installing dependencies..."
npm install

echo "Building CutFlow..."
npm run build
