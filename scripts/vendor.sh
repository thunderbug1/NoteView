#!/bin/bash
set -e

# Change into the project directory (where this script is located)
cd "$(dirname "$0")/.."

echo "Installing node dependencies..."
npm install

echo "Bundling CodeMirror..."
mkdir -p vendor
npm run vendor

verify_sha256() {
    local file="$1" expected="$2"
    local actual
    actual=$(sha256sum "$file" | cut -d' ' -f1)
    if [ "$actual" != "$expected" ]; then
        echo "ERROR: SHA-256 mismatch for $file"
        echo "  expected: $expected"
        echo "  actual:   $actual"
        exit 1
    fi
    echo "  Verified: $file"
}

echo "Downloading marked.js..."
curl -sL https://cdn.jsdelivr.net/npm/marked@15.0.12/marked.min.js -o vendor/marked.js
# Update the hash below when upgrading marked version
# verify_sha256 vendor/marked.js "<expected-sha256>"

echo "Downloading isomorphic-git..."
curl -sL https://unpkg.com/isomorphic-git@1.24.5/index.umd.min.js -o vendor/isomorphic-git.js
# verify_sha256 vendor/isomorphic-git.js "<expected-sha256>"

echo "Downloading qrcode-generator..."
curl -sL https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js -o vendor/qrcode-generator.js
# verify_sha256 vendor/qrcode-generator.js "<expected-sha256>"

echo "Downloading jsQR..."
curl -sL https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js -o vendor/jsQR.js
# verify_sha256 vendor/jsQR.js "<expected-sha256>"

echo "Done! Vendor files are ready."
echo "NOTE: Uncomment and fill in verify_sha256 calls with actual hashes for full integrity checking."
