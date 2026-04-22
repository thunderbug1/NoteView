# NoteView Full Codebase Audit

Date: 2026-04-22

## Summary

| Severity | Count |
|----------|-------|
| Critical | 11 |
| Major | 26 |
| Minor | 28 |
| Nit | 12 |

---

## Critical Findings

### C-1: XSS via `marked.parse()` in note modal
**File:** `js/views/document.js:3441-3459`
`marked.parse(rawContent)` output is inserted into `innerHTML` without sanitization. Markdown containing `<script>` tags or malicious HTML will execute arbitrary JavaScript.

### C-2: XSS via BadgeWidget unsanitized values
**File:** `js/widgets/codeMirrorWidgets.js:167,183,188,190`
`this.value` from inline fields like `[due:: <img src=x onerror=alert(1)>]` is injected directly into `innerHTML`.

### C-3: XSS via tag rename input attribute injection
**File:** `js/modals/tagModal.js:588`
`value="${oldTag}"` without escaping. A tag containing `"` breaks out of the attribute.

### C-4: XSS via `Modal.create()` unsanitized inputs
**File:** `js/utils/modal.js:37-49,99-102,142-144`
`title`, `message`, `confirmText`, `cancelText`, `placeholder`, `defaultValue` are interpolated directly into HTML.

### C-5: XSS via unsanitized tag/contact names in sidebar
**File:** `js/selectionManager.js:601,912`
Tag and contact names inserted into `data-tag` attributes and innerHTML without `escapeHtml()`.

### C-6: XSS via unsanitized vault names
**File:** `js/modals/vaultModal.js:37,140-143`
Vault names from `directoryHandle.name` interpolated into innerHTML without escaping.

### C-7: Concurrent `saveBlock` corrupts undo state
**File:** `js/store.js:1191`
Two overlapping `saveBlock` calls for the same block both capture `beforeState` from the same in-memory state. The second undo restores incorrect data.

### C-8: `saveBlock` file write failure leaves in-memory/disk state inconsistent
**File:** `js/store.js:1203-1212`
If `writable.write()` or `writable.close()` throws, in-memory block state is already updated but file has old content. No rollback.

### C-9: Batch undo/redo fails silently
**File:** `js/undoRedoManager.js:336-345`
AI batch sub-commands use `after`/`before` structure but `undoCreate`/`undoDelete` expect `blockData`.

### C-10: API keys stored in plaintext
**File:** `js/ai.js:98-100`
API keys written to `keys.json` in the vault directory in plaintext.

### C-11: Missing Content-Security-Policy
**File:** `index.html`
No CSP meta tag provides defense-in-depth against XSS vectors.

---

## Major Findings

### State & Concurrency

- **`editors.clear()` destroys all editors** (`document.js:3283`) — `createNewBlock()` clears all CodeMirror instances without clearing `originalContents`, `saveTimeouts`, `collapsedBlocks`.
- **`deleteBlock` splices array before file deletion** (`store.js:803`) — Failure leaves block removed from memory but file still on disk.
- **`beforeunload` closes IndexedDB mid-transaction** (`main.js:1873`) — In-flight transactions silently aborted.
- **`promotePlaceholder` race condition** (`document.js:3116-3231`) — `isPromoting` boolean guard insufficient for async error recovery.
- **`Object.assign` undo doesn't remove new properties** (`undoRedoManager.js:247`) — Properties added after snapshot persist through undo.
- **`_acceptBatchNote` index mismatch** (`ai.js:1153-1156`) — `filter(Boolean)` shifts indices relative to DOM `data-index`.
- **Stale `fs` reference during vault switch** (`gitStore.js`) — In-flight operations may use old handle.
- **`gitRemote.setRemote` saves config before git operation** (`gitRemote.js:15-33`) — Failure leaves inconsistent state.
- **Fast-forward-only pull fails with no recovery** (`gitRemote.js:66-77`) — No guidance for diverged histories.

### UI/UX

- **`showDuePopover` uses stale positions** (`codeMirrorWidgets.js:31,79`) — Document changes while popover is open cause wrong insertion point.
- **`DeadlinePanel.render()` destroys backlinks panel** (`deadlinePanel.js:82`) — Replaces entire sidebar innerHTML.
- **History `restoreVersion` saves twice** (`history.js:146-147`) — Two git commits for one restore.
- **Vault pre-warming fires permission prompts for ALL vaults** (`vaultModal.js:49-57`) — Permission dialog spam.
- **"Create" vault button just opens directory picker** (`vaultModal.js:298-302`) — Misleading UX.
- **Timeline incremental rebuild assumes linear history** (`timeline.js:360-365`) — Wrong after rebase.
- **TagModal `show`/`showBulk` 80% duplicated** — Maintenance hazard.

### Security

- **Password stored in HTML `value` attribute** (`settings.js:901-902`) — Visible in DOM inspector.
- **`showBlockContentModal` leaks document click listeners** (`main.js:1058`) — New permanent listener per menu open.

### Performance

- **28 synchronous `<script>` tags** (`index.html:204-247`) — No `defer` or `async`.
- **11 render-blocking CSS files** (`index.html:11-21`) — All synchronous.

### Reliability

- **SW precache incomplete** (`sw.js:3-43`) — Missing several JS/CSS files; broken offline.
- **SW version param out of sync** (`index.html:251` vs `sw.js:1`) — `?v=10` but `CACHE_NAME` is `v11`.
- **Unpinned `marked.js` version** (`scripts/vendor.sh:15`) — No integrity verification.
- **Vendor downloads without integrity checks** (`scripts/vendor.sh:15,18`) — Supply chain risk.

---

## Minor Findings

- `store.js:46` — Cache key only uses block IDs; depends on explicit invalidation
- `main.js:1275` — `startAIDictation` doesn't check SpeechRecognition availability
- `main.js:1374` — Stream parser does extra `reader.read()` after `[DONE]`
- `selectionManager.js:817` — `TaskParser` called per-block on every save
- `gitRemote.js:121-127` — Unpushed count wrong for >50 local commits
- `gitRemote.js:39` — Fragile branch name fallback can throw
- `ai.js:89` — `Date.now()` profile IDs can collide
- `ai.js:1356` — Toast stacking without deduplication
- `kanban.js:6` — `collapsedGroups` Map grows unbounded
- `timeline.js:40-43` — `commitSnapshots` stores full Map per commit, no eviction
- `document.js:2816,2824,2829,2833,2847` — `console.log` debug statements in production
- `document.js:3097` — Logs user content prefix (privacy concern)
- `history.js:108-110` — Previous EditorView not destroyed on rapid clicks
- `settings.js:395-398` — O(tags * blocks) tag count on main thread
- `components.css:1285,1287` — `color-mix()` without fallback
- `document.css:973-1028` — Mobile toolbar uses `prefers-color-scheme` instead of `data-theme`
- `components.css:33-55` — Badge colors hardcoded instead of CSS variables
- `document.css:811-822` — Template picker clipped on small screens
- `common.js:10-14` — `escapeHtml()` creates DOM element per call
- `taskParser.js:490-522` — Exported regex with `g` flag has mutable `lastIndex`
- `contactHelper.js:136-148` — Same mutable regex issue
- `backlinksPanel.js:54-73` — O(n*m) backlink search with no caching
- `assigneeModal.js:24` — Crash if contact deleted during modal display
- `build-single-file.js:41-42` — SW removal regex fragile
- `index.html:10` — `apple-touch-icon` uses SVG (not supported on iOS)
- `index.html:64` — Search input missing `aria-label`
- `layout.css:218-238` — `.view-selector` dead CSS

---

## Nit Findings

- `main.js:1288,1300` — Redundant null assignment in cleanup
- `store.js:1320-1326` — Frontmatter parsing handles non-array tags correctly
- `undoRedoManager.js:28` — Session ID collision risk is negligible
- `sw.js:78,105` — `cache: 'no-cache'` forces revalidation on every request
- `sw.js:112` — Silent `.catch()` swallows errors
- `css/views/timeline.css:324` / `css/views/settings.css:133` — Duplicate `fadeIn` animation
- `css/base.css:6-10` — Universal `*` reset may affect third-party widgets
- `css/layout.css:383` — `100dvh` without fallback (has `100vh` fallback, OK)
- `css/layout.css:281` — `.edit-tags-btn` dead CSS
- `index.html` — No `<noscript>` fallback
- `common.js:176` — Toast replaces all existing toasts
- `performance.js:49` — `JSON.stringify` memoization key can be expensive
