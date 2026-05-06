# File Attachment System — Concept

A design for binary file handling (images, PDFs, audio, documents) in NoteView with cloud-first storage, local caching, and integrated UI.

## Overview

The system adds two new global singletons — `AssetManager` (local cache + access tracking) and `AssetSync` (S3 remote operations) — following the existing module pattern. **The cloud (S3/R2) is the source of truth.** The local `.noteview/assets/` folder acts as a cache — files are fetched on demand and auto-purged after a period of non-access. The entire feature is gated behind a settings toggle.

**Design principles:**
- **Cloud-first** — remote S3 bucket is the durable store; local folder is a cache that can be emptied at any time
- **Registry-free** — no metadata database. The filesystem and cloud listing ARE the database. Context comes from notes.
- **No server required** — direct S3 API access via a vendored AWS Signature V4 signer. No worker, no proxy.
- **Cache with eviction** — files auto-purged from local after N days of non-access; re-fetched from cloud on next use
- **Non-intrusive** — binary files stay out of git, feature is fully optional

**Storage modes:**
- **Remote sync enabled (cloud-first):** Upload to cloud, cache locally. Auto-purge stale local copies. Cloud is source of truth.
- **Remote sync disabled (local-only):** Local `.noteview/assets/` is the only storage. No auto-purge. Works fully offline.

---

## 1. Data Model

### 1.1 Markdown Syntax

Asset references use a standard markdown image with the `asset:` URL scheme:

```markdown
![A sunset over the mountains](asset:sunset-2026-05-02.jpg)
![Quarterly report](asset:report-q3.pdf)
```

Why `asset:` over alternatives:
- Standard markdown syntax — any parser sees it as a broken image (harmless)
- Easy to parse with a simple regex: `/!\[([^\]]*)\]\(asset:([^)]+)\)/g`
- Alt text doubles as the display caption
- Non-image files render as inline file cards rather than `<img>` tags

### 1.2 No Registry — Filesystem + Cloud Are the Database

There is no `assets.json` or any metadata file. All information is derived:

| Data | Source |
|------|--------|
| File list (cloud) | S3 `ListObjectsV2` API call |
| File list (local) | Iterate `.noteview/assets/` directory |
| Caption | Markdown alt text: `![caption here](asset:file.jpg)` |
| File size, MIME type | `File` object from `getFileHandle()` or S3 metadata |
| Image dimensions | Computed on-the-fly from `<img>` naturalWidth/Height |
| Tags / context | Tags on the notes that reference the file |
| Used by which notes | Scan block content for `asset:filename` references |
| Last accessed | Tracked in localStorage for cache eviction |

**Tradeoffs of no registry:**
- Simpler — no metadata file to maintain, sync, or corrupt
- No dedup detection — uploading the same file twice creates two copies
- No standalone file tags/descriptions — all context comes from notes
- Sync state determined by comparing local directory listing vs remote listing

### 1.3 Vault Directory Structure

```
<vault-root>/
  .noteview/
    settings.json          # existing
    keys.json              # existing
    .gitignore             # extended to exclude assets
    assets/                # local cache (flat, no subdirectories)
      sunset-2026-05-02.jpg
      report-q3.pdf       # may or may not be present — it's a cache
  note1.md
  note2.md
```

The `.noteview/.gitignore` is extended:
```
keys.json
assets/
```

The local `assets/` folder is explicitly a **cache** — its contents may be incomplete. Files appear and disappear based on access patterns. The folder can be safely emptied at any time when remote sync is enabled.

### 1.4 File-to-Note Associations

Associations are **implicit** — derived from markdown content. A note containing `![](asset:photo.jpg)` is associated with `photo.jpg`.

`AssetManager.getNotesReferencingAsset(filename)` scans block content at runtime. `AssetManager.getAssetsReferencedByNote(blockId)` extracts asset filenames from a single block via regex. Both are cheap for the typical NoteView block count (hundreds, not millions).

---

## 2. Local Cache Layer

### 2.1 AssetManager Singleton

New file: `js/utils/assetManager.js` (~300 lines)

```javascript
const AssetManager = {
    enabled: false,
    _assetDirHandle: null,     // FileSystemDirectoryHandle
    _blobCache: new Map(),     // filename -> { blobUrl, timestamp }
    _accessLog: null,          // loaded from localStorage

    async init() { ... },
    async toggleEnabled(bool) { ... },
    async addFile(file) { ... },        // upload to cloud + cache locally
    async getFileUrl(filename) { ... },  // cache-first, cloud-fetch on miss
    async deleteFile(filename) { ... },  // delete from cloud + local cache
    async listLocalFiles() { ... },      // iterate directory
    getNotesReferencingAsset(filename) { ... },
    getAssetsReferencedByNote(blockId) { ... },

    // Cache management
    _recordAccess(filename) { ... },     // touch access log
    async purgeStaleCache() { ... },     // evict files not accessed in N days
    isCached(filename) { ... },          // check if in local cache
};
```

### 2.2 Access Tracking

Access timestamps stored in `localStorage` under the key `noteview-asset-access`:

```json
{
  "sunset-2026-05-02.jpg": 1714657200000,
  "report-q3.pdf": 1714398000000
}
```

Updated every time `getFileUrl()` is called (even for cache hits). This is lightweight — a single JSON read/write to localStorage.

### 2.3 Auto-Purge (Cache Eviction)

Files not accessed within the purge threshold are deleted from the local cache. Default: 30 days (configurable in settings).

**Purge flow:**
1. Read access log from localStorage
2. For each cached file, check if `Date.now() - lastAccessed > threshold`
3. Delete stale files from `.noteview/assets/` directory
4. Remove stale entries from access log
5. **Never delete from cloud** — only local cache is affected

**When purge runs:**
- On app initialization (after loading vault)
- Periodically in the background (once per day, using a timestamp check)

**Files referenced in currently-loaded notes are never purged.** Before purging, check if the filename appears in any block's content that's currently rendered. This ensures visible images don't disappear.

### 2.4 Upload Flow

When **remote sync is enabled:**
1. Generate safe filename: `{originalBase}-{date}.{ext}`
2. Upload to cloud (S3 PUT) — this is the durable write
3. Cache locally in `.noteview/assets/` — avoids re-downloading immediately
4. Cache blob URL in memory
5. Return the stored filename

When **remote sync is disabled:**
1. Generate safe filename
2. Write to `.noteview/assets/` via File System Access API
3. Cache blob URL in memory
4. Return the stored filename

### 2.5 File Retrieval

```
getFileUrl(filename):
  1. Check blob cache → return if fresh
  2. Check local cache (.noteview/assets/) → create blob URL → record access → return
  3. If remote sync enabled → fetch from cloud → save to local cache → record access → return blob URL
  4. If remote sync disabled and not local → return null (missing file)
```

On step 3, the cloud fetch is async. If the file is being displayed in a note (CM6 widget or preview), the UI shows a loading placeholder while the fetch completes, then swaps in the image/file card.

### 2.6 Blob URL Cache

In-memory `Map<string, { blobUrl, timestamp }>` with bounds:
- Max 50 entries
- Max 30-minute TTL
- LRU eviction — oldest entry revoked via `URL.revokeObjectURL()`

Blob URLs are used for rendering in CodeMirror widgets and note preview. They are never cached by the service worker (they're in-memory only).

---

## 3. Remote Sync Layer

### 3.1 Direct S3 API — No Server Required

Remote sync talks directly to the S3-compatible API endpoint (R2, AWS, MinIO, Garage) from the browser. A vendored AWS Signature V4 signer generates authenticated requests. No server, no worker, no proxy.

**How it works:**
1. User configures endpoint URL, bucket name, access key, and secret key in settings
2. Credentials stored in `.noteview/keys.json` (same pattern as AI API keys, already gitignored)
3. `AssetSync` uses the vendored signer to create signed S3 requests
4. Browser sends requests directly to the S3 endpoint

**Why this is safe enough:**
- Same threat model as storing AI API keys — the user is already trusting the browser with secrets
- S3 tokens can be scoped to a single bucket with read/write only
- Revocable by rotating the token
- NoteView runs locally on the user's own machine, not a shared server

### 3.2 Vendored AWS Signature V4 Signer

New file: `vendor/s3signer.js` (~200 lines)

A minimal implementation of [AWS Signature Version 4](https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-authenticating-requests.html) — the signing algorithm used by all S3-compatible APIs.

**What it does:**
- Takes `{ method, url, headers, body, region, service, accessKey, secretKey }`
- Computes the canonical request string
- Signs it with HMAC-SHA256
- Returns the signed `Authorization` header

**What it does NOT do:**
- No full SDK — just the signing function
- No XML parsing — S3 list responses parsed minimally with regex or DOMParser
- No multipart upload — simple PUT for files under ~100 MB (covers the NoteView use case)

**Algorithm outline:**
```
1. Create canonical request: METHOD\npath\nquery\nsignedHeaders\nhash(body)
2. Create string to sign: "AWS4-HMAC-SHA256\n{timestamp}\n{credentialScope}\nhash(canonicalRequest)"
3. Derive signing key: HMAC chain over date, region, service, "aws4_request"
4. Signature: HMAC(signingKey, stringToSign)
5. Authorization header: "AWS4-HMAC-SHA256 Credential={...}, SignedHeaders={...}, Signature={...}"
```

All operations use `crypto.subtle` (Web Crypto API) — no external dependencies.

### 3.3 S3 Bucket Structure

```
<bucket>/
  assets/
    sunset-2026-05-02.jpg
    report-q3.pdf
```

Flat structure. The cloud bucket holds the complete set of all files. The local cache may hold a subset. Each user has their own bucket, so no per-user prefix needed.

### 3.4 AssetSync Singleton

New file: `js/utils/assetSync.js` (~200 lines)

```javascript
const AssetSync = {
    enabled: false,
    _config: {
        endpoint: '',     // e.g. "https://<account>.r2.cloudflarestorage.com"
        bucket: '',
        region: 'auto',   // R2 uses "auto"
        accessKey: '',
        secretKey: ''
    },
    _syncing: false,

    async init() { ... },
    async saveConfig(config) { ... },  // writes to keys.json
    async uploadFile(filename, fileHandle) { ... },
    async downloadFile(filename) { ... },
    async deleteFile(filename) { ... },
    async listRemote() { ... },
    async testConnection() { ... }
};
```

**S3 operations used:**

| Operation | S3 API | Purpose |
|-----------|--------|---------|
| Upload | `PUT /{bucket}/assets/{filename}` | Upload file body |
| Download | `GET /{bucket}/assets/{filename}` | Download file |
| List | `GET /{bucket}/?list-type=2&prefix=assets/` | List remote files |
| Delete | `DELETE /{bucket}/assets/{filename}` | Delete remote file |

All requests are signed with the vendored Sig V4 signer.

**Credentials** stored in `.noteview/keys.json` (already gitignored):
```json
{
  "ai": { ... },
  "assetSync": {
    "endpoint": "https://abc123.r2.cloudflarestorage.com",
    "bucket": "noteview-assets",
    "region": "auto",
    "accessKey": "...",
    "secretKey": "..."
  }
}
```

### 3.5 No Full Sync Needed

Because the local folder is a cache, not a replica, there's no need for a full bidirectional sync. The model is simpler:

- **Upload**: Push new files to cloud immediately on add. Local cache keeps a copy.
- **Download**: Pull from cloud on demand when a file is accessed and not cached locally.
- **Delete**: Delete from cloud + local cache simultaneously.
- **No background sync loop** — files are pushed on upload and pulled on access.

This is a significant simplification over a full sync system. There's no "sync state" to track — the cloud always has the truth, and the local cache is just a performance optimization.

### 3.6 Conflict Resolution

If a file exists both locally and in the cloud with different content (e.g., user uploaded a new version from another device), **the cloud version wins** — it's the source of truth. The local cached copy is replaced.

This can happen when:
1. User accesses a file locally (cached)
2. Uploads a new version of the same file from another device
3. Local cache entry becomes stale
4. On next access, the cloud version is downloaded and replaces the local copy

### 3.7 Sync Triggers

Since the model is push-on-upload / pull-on-access, explicit sync triggers are minimal:
- **Upload** — always immediate when remote sync is enabled
- **Delete** — always immediate when remote sync is enabled
- **Pull** — on demand, when `getFileUrl()` has a cache miss
- **"Sync Now"** — optional button that fetches the remote file listing for the file manager

### 3.8 CORS Requirement

For the browser to make direct S3 requests, the bucket must have a CORS policy allowing the NoteView origin. For R2:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "DELETE"],
    "AllowedHeaders": ["Authorization", "Content-Type", "x-amz-content-sha256", "x-amz-date"],
    "ExposeHeaders": ["ETag"]
  }
]
```

This is a one-time bucket configuration. R2 CORS is set via the Cloudflare dashboard or `wrangler r2 bucket cors`. For other S3 providers, similar CORS config is needed.

---

## 4. UI/UX Design

### 4.1 Feature Flag in Settings

New collapsible section "File Attachments" in `SettingsView.render()`, using the same toggle pattern as AI Configuration:

```
[File Attachments]
  Enable File Attachments [toggle]
  ├── Manage Files... [button → opens file manager modal]
  ├── Remote Storage [toggle]
  │   ├── Endpoint [input: "https://abc.r2.cloudflarestorage.com"]
  │   ├── Bucket [input: "noteview-assets"]
  │   ├── Region [input: "auto"]
  │   ├── Access Key [password input]
  │   ├── Secret Key [password input]
  │   ├── [Test Connection] [button]
  │   └── Cache: "12 cached, 45 in cloud · 48.2 MB local"
  ├── Cache retention [dropdown: 7 days / 30 days / 90 days / Never]
  └── [Purge Cache Now] [button: "Free 48.2 MB"]
```

When the toggle is off, all asset UI is hidden and `AssetManager.enabled === false`.

### 4.2 Attachment Button in Block Metadata Bar

A paperclip button added to the existing `block-actions` area (between the AI button and the overflow menu). It only appears when `AssetManager.enabled` is true.

**Click flow:**
1. Opens a hidden `<input type="file" multiple>` with broad accept types
2. For each selected file, calls `AssetManager.addFile(file)`
   - If remote sync enabled: uploads to cloud, caches locally
   - If remote sync disabled: saves to local folder only
3. Inserts `![originalName](asset:stored-filename.ext)` at the cursor position
4. Shows a brief toast: "Added 3 files"

### 4.3 Drag-and-Drop

Files dragged from the OS onto a block editor are detected in the existing `drop` event handler (`createDomEventHandlers`). If `dataTransfer.files` is present:
1. Process each file through `AssetManager.addFile()`
2. Insert the corresponding `asset:` syntax at the drop position
3. Show a brief visual indicator (drop zone highlight)

### 4.4 Clipboard Paste

Extended in the existing `paste` handler. If `clipboardData.items` contains `image/*` types:
1. Extract as `File` object
2. Name it `clipboard-{date}.png`
3. `AssetManager.addFile()` + insert syntax

### 4.5 Inline Rendering in Notes

**CodeMirror live preview** — a new `_lineDecorators` entry `decorateAssets`:
- Scans each line for `![...](asset:...)` pattern
- **Cached file found:** Image → inline `<img>` thumbnail (max-width 300px). Other → file card widget.
- **Cache miss (cloud available):** Shows a loading placeholder with a spinner. Triggers async fetch from cloud. When complete, swaps in the real widget.
- **Cache miss (offline / no cloud):** Shows a "File not cached — go online to fetch" placeholder.

**Note preview modal** (via `marked.parse()`) — a custom renderer intercepts `asset:` URLs:
```javascript
image(href, title, text) {
  if (href?.startsWith('asset:')) {
    const filename = href.slice(6);
    const url = AssetManager.getFileUrlSync(filename);
    if (url) return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}" ...>`;
    if (AssetSync.enabled) {
      // Async fetch triggered — for the modal, show placeholder
      AssetManager.getFileUrl(filename); // triggers cloud fetch for next time
      return `<span class="asset-loading">⏳ ${escapeHtml(text)}</span>`;
    }
    return `<span class="asset-missing">[Not cached: ${escapeHtml(filename)}]</span>`;
  }
  return false; // default renderer
}
```

### 4.6 File Manager Modal

A modal (not a sidebar panel) opened from "Manage Files..." in settings. Uses `Modal.create()` with a 640px width.

**Layout (cloud mode):**
```
┌──────────────────────────────────────────────┐
│ File Manager                            [×]  │
├──────────────────────────────────────────────┤
│ [🔍 Search files...]        [+ Upload]       │
│ Showing 45 files · 12 cached locally         │
├──────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│ │  [thumb]  │ │  [☁]     │ │ [📄]     │      │
│ │ photo.jpg │ │ old.png  │ │ report.pdf│     │
│ │ 2.4 MB    │ │ 800 KB   │ │ 1.2 MB   │      │
│ │ ✓ cached  │ │ ☁ cloud  │ │ ✓ cached  │      │
│ │ used in 3 │ │ used in 1 │ │ unused   │      │
│ │ [📥][🗑️] │ │ [📥][🗑️] │ │ [📥][🗑️] │      │
│ └──────────┘ └──────────┘ └──────────┘      │
└──────────────────────────────────────────────┘
```

**Grid of cards**, each showing:
- Thumbnail (if cached locally) or cloud icon (☁ if not cached)
- Filename, size
- Cache status: "✓ cached" or "☁ cloud only"
- "Used in N notes" — from scanning block content
- Actions:
  - **📥 Cache** (download from cloud to local) / **Evict** (remove from local cache, keep in cloud)
  - **Insert** into current note
  - **🗑️ Delete** (removes from cloud + local, with confirmation)

**Search** filters by filename.

**Upload** button triggers the same file picker as the attachment button.

**Unused files indicator** — files not referenced by any note are visually distinguished (dimmed or with an "unused" badge).

**Layout (local-only mode, no cloud):**
Same grid but without cloud indicators. Files are either present or missing. No cache/evict actions. Simpler.

### 4.7 Block Deletion Cleanup

When deleting a block, check if any referenced assets are used only by that block. If so, prompt: *"This note references 2 files that no other note uses. Delete from cloud too?"* — with "Keep in cloud" / "Delete everywhere" options.

### 4.8 Mobile

- **Attachment button** in the mobile toolbar (paperclip icon)
- **File manager** adapts to full-screen via existing modal CSS
- **No drag-and-drop** — file picker is the primary upload method
- **Image preview** — tapping opens full-screen image modal
- **Cache-aware** — images not cached show a "tap to fetch" overlay, then download and display
- **Thumbnails** — 120px on mobile, 200px on desktop

---

## 5. Integration Points

### 5.1 Script Loading

In `index.html`, after `appSettings.js`:
```html
<script src="vendor/s3signer.js"></script>
<script src="js/utils/assetManager.js"></script>
<script src="js/utils/assetSync.js"></script>
```

New CSS: `css/views/assets.css` for asset manager and inline preview styles.

All added to `sw.js` `PRECACHE_URLS` with bumped `CACHE_NAME`.

### 5.2 Initialization

In `App.completeInitialization()`, after `AppSettings.load()`:
```javascript
await AssetManager.init();
await AssetSync.init();
await AssetManager.purgeStaleCache(); // clean up old cached files
```

### 5.3 Search Integration

`Store.getFilteredBlocks()` search extended to match asset filenames referenced in blocks:
```javascript
const assetMatch = AssetManager.enabled &&
    AssetManager.getAssetsReferencedByNote(block.id)
        .some(fn => fn.toLowerCase().includes(searchLower));
```

### 5.4 Service Worker

- Asset blob URLs are in-memory only — not cached by service worker
- S3 endpoint requests excluded from SW cache (different origin)
- New JS/CSS files added to precache list

### 5.5 Export

`asset:` references are preserved as-is in markdown exports. Binary files are not bundled. A future "Export with attachments" could create a zip.

---

## 6. Security Considerations

- All `asset:` URLs resolved through `AssetManager` — never from user input directly
- Filenames sanitized on upload (no path traversal — only flat filenames with `[a-zA-Z0-9_.-]`)
- File metadata displayed in HTML (filenames) goes through `escapeHtml()`
- `marked.parse()` output still passes through `sanitizeHtml()`
- S3 credentials stored in `keys.json` (gitignored) — same pattern as AI API keys
- S3 tokens should be scoped to a single bucket with read/write only
- CORS policy on the bucket limits which origins can make requests
- Sig V4 signing uses `crypto.subtle` — no external dependencies
- Streaming uploads/downloads — no full file buffering in JS

---

## 7. File Structure

**New files:**
```
vendor/s3signer.js             ~200 lines — AWS Sig V4 signing (vendored, no deps)
js/utils/assetManager.js       ~300 lines — local cache + access tracking + auto-purge
js/utils/assetSync.js          ~200 lines — S3 upload/download/list/delete
css/views/assets.css           ~120 lines
```

**Files to modify:**
```
index.html                     add <script> and <link> tags
sw.js                          add to PRECACHE_URLS, bump CACHE_NAME
js/views/document.js           attachment button, paste/drop handlers, asset decorations
js/views/settings.js           File Attachments section
js/store.js                    optional: extend search filter
js/main.js                     init calls
scripts/vendor.sh              add s3signer.js to vendoring
```

---

## 8. Implementation Phases

| Phase | Scope | Depends on |
|-------|-------|------------|
| 1 | Data layer — `AssetManager` with directory ops, blob cache, access tracking | — |
| 2 | Settings — feature flag, directory structure, gitignore | Phase 1 |
| 3 | Upload — attachment button, file picker, drag-and-drop, paste | Phase 1 |
| 4 | Rendering — CM6 asset decorations with loading states, marked renderer | Phase 1 |
| 5 | File manager — modal UI with browse, search, cache status, delete | Phase 1 |
| 6 | Remote sync — `s3signer.js`, `AssetSync`, cloud push/pull, S3 settings UI | Phase 1–2 |
| 7 | Auto-purge — cache eviction based on access log, settings for retention | Phase 1, 6 |
| 8 | Polish — search integration, block deletion cleanup, mobile testing | Phase 3–5 |
