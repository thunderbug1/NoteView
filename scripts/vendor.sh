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
curl -sL https://cdn.jsdelivr.net/npm/marked/marked.min.js -o vendor/marked.js

echo "Downloading isomorphic-git..."
curl -sL https://unpkg.com/isomorphic-git@1.24.5/index.umd.min.js -o vendor/isomorphic-git.js

echo "Done! Vendor files are ready."
