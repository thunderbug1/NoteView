#!/bin/bash
set -e

# Change into the project directory (where this script is located)
cd "$(dirname "$0")/.."

echo "Installing node dependencies..."
npm install

echo "Bundling CodeMirror..."
mkdir -p vendor
npm run vendor

echo "Downloading marked.js..."
curl -sL https://cdn.jsdelivr.net/npm/marked@15.0.12/marked.min.js -o vendor/marked.js

echo "Downloading isomorphic-git..."
curl -sL https://unpkg.com/isomorphic-git@1.24.5/index.umd.min.js -o vendor/isomorphic-git.js
# isomorphic-git HTTP client is maintained locally (no UMD build available upstream)
# See vendor/isomorphic-git-http.js — adapted from isomorphic-git/http/web/index.js

echo "Downloading qrcode-generator..."
curl -sL https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js -o vendor/qrcode-generator.js

echo "Downloading jsQR..."
curl -sL https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js -o vendor/jsQR.js

echo "Done! Vendor files are ready."
