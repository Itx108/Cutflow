#!/usr/bin/env bash
set -euo pipefail

echo "Reconstructing CutFlow production source..."
cat .cutflow-v11-2/part*.b64 > /tmp/cutflow-source.b64
base64 -d /tmp/cutflow-source.b64 > /tmp/cutflow-source.tar.xz
xz -t /tmp/cutflow-source.tar.xz

tar -xJf /tmp/cutflow-source.tar.xz --strip-components=1

echo "Applying CutFlow V12 production overlay..."
if [ -d "v12-overlay/app" ]; then
  mkdir -p app
  cp -R v12-overlay/app/. app/
fi
if [ -d "v12-overlay/components" ]; then
  mkdir -p components
  cp -R v12-overlay/components/. components/
fi

echo "Installing dependencies..."
npm install

echo "Building CutFlow..."
npm run build
