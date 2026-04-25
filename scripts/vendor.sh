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

echo "Done! Vendor files are ready."
