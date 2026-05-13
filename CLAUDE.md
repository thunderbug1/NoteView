# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## General Rules

- **Always update documentation** (`docs/` directory and this file) when making changes that affect documented behavior, architecture, or data flow. Documentation should stay in sync with the code.

never use the find command with the -exec flag in bash commands, use fdfind instead.

## Coding Rules

- **Escape all user-controlled values in HTML.** Any value from blocks, tags, contacts, vault names, or AI output that gets inserted into `innerHTML` or HTML attributes must go through `escapeHtml()`. This includes `data-*` attributes, `value=""` attributes, and visible text inside template literals. The `Modal.create({title, content})` `content` parameter is raw HTML — callers are responsible for escaping dynamic parts.
- **Sanitize markdown-to-HTML output.** When rendering `marked.parse()` output into the DOM, pass it through `sanitizeHtml()` (strips `<script>`, `on*` attributes, `javascript:` URLs). Never insert raw `marked.parse()` output directly.
- **Clean up document-level event listeners.** Any `document.addEventListener('click', handler)` added for menus or popovers must be removed with `removeEventListener` in the close/dismiss handler. Otherwise listeners accumulate on every open.
- **Mutate in-memory state only after file operations succeed.** Don't `splice` arrays or modify block state before `removeEntry`/`createWritable` completes. If a file write fails, in-memory state should still reflect what's on disk.
- **When adding new `<script>` or `<link>` tags to `index.html`, also add them to `sw.js` `PRECACHE_URLS`.** The service worker precache must mirror all app resources for offline support. Bump `CACHE_NAME` and the `?v=` param together.
- **When rendering into the right sidebar (`#sidebarRight .sidebar-scroll`), coexist with other panels.** Use `insertAdjacentHTML` or targeted `outerHTML` replacement on your own container element. Never replace the entire `container.innerHTML` — it destroys other panels (backlinks, deadlines).
- **Don't export regex literals with the `g` flag on window globals.** The `lastIndex` property is mutable and shared across all callers. Use a getter that returns a fresh regex instead: `get MY_REGEX() { return /pattern/g; }`.
- **Don't use `setTimeout` to avoid race conditions.** Timeouts are fragile — they break under CPU throttling, busy event loops, and vary across devices. Use deterministic alternatives instead:
  - **Outside-click handlers:** Use `e.stopPropagation()` on the opening event, then attach the document listener immediately. Don't wrap `addEventListener` in `setTimeout(0)`.
  - **Focus after DOM insertion:** Since `Modal.create()` and `appendChild()` are synchronous, call `.focus()` directly — no delay needed.
  - **Wait for paint/layout:** Use `requestAnimationFrame` (double-rAF `requestAnimationFrame(() => requestAnimationFrame(fn))` to wait for a paint cycle).
  - **Wait for element insertion:** Use `MutationObserver` with a safety timeout fallback instead of polling with `setTimeout`.
  - **Scroll-then-focus:** `scrollIntoView` and `.focus()` are synchronous — call them together without delay.
  - **Autocomplete blur/click race:** Use `mousedown` + `e.preventDefault()` on dropdown items to prevent blur, rather than delaying hide with `setTimeout`.
  - Legitimate `setTimeout` uses are fine: debouncing, animation timing, retry backoff, safety cutoffs, and UI feedback delays.

## Project Overview

NoteView is a browser-based markdown note-taking and task management app with built-in git version control. It runs entirely client-side — no server, no build step, no framework. Data lives as plain `.md` files on the user's local filesystem via the File System Access API.

## Development

**Requirements:** Chromium-based browser (Chrome, Edge, Brave) for File System Access API support.

**Running:** Serve the project root with any static file server, or open `index.html` directly in a Chromium browser.

```bash
# Python
python3 -m http.server 8000

# Node
npx serve .
```

**No build step, no package manager needed for dev.** Dependencies are vendored locally in `vendor/` to ensure offline capability. To update vendored dependencies, run `scripts/vendor.sh` (this will create an ephemeral `node_modules/` to run esbuild, bundle CodeMirror, and download CDN scripts directly). CSS and JS are loaded directly via `<link>` and `<script>` tags.

**Cache busting:** The service worker uses a network-first strategy for scripts and styles, so individual `?v=` params are not needed on app files. When deploying changes, bump the `CACHE_NAME` in `sw.js` (e.g., `noteview-v4` to `noteview-v5`) and the `?v=` param on the `sw.js` registration line in `index.html`. This is only two places to update, regardless of how many files changed.

### Single File Release Packaging
The entire application can be packaged into a single, fully offline `noteview.html` file (with all CSS, JS, and SVG assets inlined) using `node scripts/build-single-file.js`.
This process is automated via GitHub Actions (`.github/workflows/release.yml`). Creating and pushing a git tag (e.g., `git tag v1.0.0 && git push --tags`) automatically triggers the Action to bundle the standalone file and publish it as an attached asset to a GitHub Release.

## Architecture

### Global singleton objects (not classes)

All core modules are plain objects on `window` — there are no ES module imports between app scripts. Load order matters and is determined by `<script>` tag sequence in `index.html`.

- **`App`** (`js/main.js`) — Top-level controller. Initializes the app, handles routing between views, manages event listeners. Also contains `ThemeManager`. Delegates modal logic to dedicated modules.
- **`Store`** (`js/store.js`) — Central state and file I/O. Manages `blocks` array, IndexedDB persistence, directory handle, file read/write, git commit on save, contact/mention tracking. Filtering logic lives in `Store.getFilteredBlocks()`.
- **`GitStore`** (`js/gitStore.js`) — Git operations abstraction over isomorphic-git. Init, commit, log, diff, merge base.
- **`GitFSAdapter`** (`js/gitFs.js`) — Class exported as `window.GitFSAdapter`. Filesystem adapter that bridges the browser File System Access API with isomorphic-git's expected `fs.promises` interface.
- **`GitRemote`** (`js/gitRemote.js`) — Push/pull to remote git repositories.
- **`SyncManager`** (`js/syncManager.js`) — Orchestrates automatic git remote syncing. Handles triggers (interval, idle, commit threshold), network status tracking, toolbar indicator, and three-way merge conflict resolution with per-file UI. Delegates push/pull to `GitRemote`.
- **`AIAssistant`** (`js/ai.js`) — Right-side chat panel with multiple concurrent chats, context management, and Transform/Ask modes. Integrates OpenAI-compatible LLM endpoints for note transformation and Q&A. Supports multiple model profiles, configurable presets, streaming responses, inline diff cards, batch review modals, note creation from Ask mode (via `<<<CREATE_NOTE>>>` markers) or Transform mode without context, and per-chat context (visible notes, selected notes). Chat state is vault-specific (cleared on vault switch). API keys stored separately in `.noteview/keys.json`. Settings accessible via gear icon in panel header or the Settings view. Capture view AI (format/interpret dictated text) operates independently of the chat panel.
- **`BlockSelector`** (`js/blockSelector.js`) — Multi-select mode for bulk operations. Document view selects entire blocks; kanban view selects individual tasks.
- **`SelectionManager`** (`js/selectionManager.js`) — Manages sidebar filter state: time selection, context tags (multi-select with exclusion), contact filter (single-select), and context navigation history. Updates tag counts and UI.
- **`UndoRedoManager`** (`js/undoRedoManager.js`) — Command-pattern undo/redo for block operations, including batch commands. State persisted to IndexedDB per session.
- **`SortManager`** (`js/utils/sortManager.js`) — Per-view sort configuration with multi-clause sorting.
- **`RecentAccessTracker`** (`js/utils/recentAccessTracker.js`) — Tracks per-block last-accessed timestamps and recently deleted blocks in localStorage. Provides `lastAccessed` sort field and trash log for selective undelete.
- **`AppSettings`** (`js/utils/appSettings.js`) — File-based settings persistence in `.noteview/settings.json` (shareable config) and `.noteview/keys.json` (API keys, auto-excluded from git).
- **`GroupManager`** (`js/utils/groupManager.js`) — Groups blocks by tag namespace for hierarchical tag display.
- **`TagModal`** (`js/modals/tagModal.js`) — Tag selection and creation modal for blocks.
- **`AssigneeModal`** (`js/modals/assigneeModal.js`) — Contact selection modal for task assignment.
- **`VaultModal`** (`js/modals/vaultModal.js`) — Vault management: dropdown switcher, manager modal, vault switching.
- **`CaptureView`** (`js/views/capture.js`) — Mobile-only capture-first view. Shows creation method grid (Write, Dictate, AI Dictate, Task, Template) with a "Browse notes" button. Default view on mobile (≤ 768px). Hidden in sidebar view switcher on desktop.

### Views

Each view is a global object with a `render(blocks)` method called by `App.render()`:

- **`DocumentView`** (`js/views/document.js`) — Main markdown editor. Creates/manages CodeMirror 6 editor instances per block. Handles inline editing, auto-save with debounce, block metadata rendering, speech-to-text dictation via Web Speech API. Editor construction is split into helper methods: `getEditorTheme()`, `buildDecorations()`, `createLivePreviewPlugin()`, `createUpdateListener()`, `createDomEventHandlers()`, `createNewBlockKeymap()`. Line decorations use a registry pattern via `applyLineDecorations()` with pluggable `_lineDecorators`. Speech recognition is managed through `startSpeechRecognition()`, `stopSpeechRecognition()`, and `cleanupRecognition()`, with a mic button in the block metadata bar.
- **`KanbanView`** (`js/views/kanban.js`) — Drag-and-drop task board. Columns map to task states (`[ ]`, `[/]`, `[x]`, `[b]`, `[-]`). Event handling split into `setupCardDragDrop()`, `setupCardClickHandlers()`, `setupMobileInteractions()`, `setupColumnDropTargets()`.
- **`TimelineView`** (`js/views/timeline.js`) — Git-history-based task timeline. Has its own cache that's invalidated on save/delete.
- **`HistoryView`** (`js/views/history.js`) — Version browser with side-by-side diff using CodeMirror's merge view.
- **`SettingsView`** (`js/views/settings.js`) — App configuration: vault info, sync settings, AI model profiles, keyboard shortcut customization. Also provides `openAISettingsModal()` for the AI panel's gear icon (profiles CRUD, presets, import from vault, test connection).

### Data model

A **block** is a single markdown note with:
- `id` — Filename without `.md` extension
- `content` — Raw markdown text
- `tags` — Array of tag strings (from frontmatter)
- `lastUpdated`, `creationDate` — Timestamps
- Tasks parsed inline from markdown checkboxes with metadata (`[due:: ...]`, `[priority:: ...]`, `[assignee:: ...]`)

Blocks are stored as individual `.md` files in the user's chosen directory. Frontmatter (`---` block at top of file) holds tags and metadata. Only saves with `commit: true` (explicit saves, property changes, block creation) trigger git commits; auto-saves from editor debounce do not.

### CodeMirror integration

CodeMirror 6 is loaded as a vendored bundle from `vendor/codemirror.js`, which sets `window.CodeMirror` (all CM6 exports) and `window.CodeMirrorReady = true`, then dispatches the `CodeMirrorReady` event. Views must wait for this event (see `DocumentView.waitForCodeMirror()`). Custom widgets (task checkboxes, metadata decorations) live in `js/widgets/codeMirrorWidgets.js`.

### Key patterns

- **`Store.saveBlock(block, options)`** — Central write path. Accepts options for content changes, property updates, commit messages. Captures before/after state for undo/redo.
- **`App.updateBlockProperty(id, property, value)`** — Convenience method that calls `Store.saveBlock`, then invalidates timeline cache, updates tag counts, and re-renders.
- **After any mutation** (save, delete), call `TimelineView.invalidateCache()` and `SelectionManager.updateTagCounts()` before re-rendering.
- **`Modal.create({title, content, modalClass, onClose})`** — Factory for modal dialogs. Returns an object with `{ element, close(), querySelector(), querySelectorAll() }`.
- **Filtering pipeline**: `Store.getFilteredBlocks()` applies: pinned blocks (always shown) → time filter → context tags (AND logic, includes `path:` group selections) → excluded tags (NOT logic) → contact filter → search filter, with caching via `CacheManager`.

### Browser APIs used

- **File System Access API** (`showDirectoryPicker`) — Read/write markdown files
- **Web Speech API** (`SpeechRecognition`) — On-device speech-to-text dictation in DocumentView. Mic button in block metadata bar toggles recording; transcribed text inserts at cursor. Only available in Chromium browsers; button is hidden when unsupported.
- **IndexedDB** — Persist directory handle, view preferences, current view
- **Service Worker** — Offline caching with network-first strategy for scripts/styles

## In-Depth Documentation

- [Data Flow & State Management](docs/data-flow.md) — State ownership, render cycle, block lifecycle, filtering pipeline, caching, undo/redo, persistence
- [CodeMirror Editor System](docs/codemirror-editor.md) — CM6 loading, editor lifecycle, custom widgets, auto-save, focus management, merge view, autocomplete
- [Git Integration](docs/git-integration.md) — GitFSAdapter, init/commit/history/diff flow, remote operations, timeline data extraction
- [Task System](docs/task-system.md) — Task syntax and states, parsing, kanban drag-and-drop, timeline, context menus, computed tags, dependencies
- [Filtering & UI](docs/filtering-and-ui.md) — SelectionManager, filter groups, tag system, contacts, time filtering, modal factory, sidebar, theming, mobile
- [AI Assistant System](docs/ai-system.md) — Chat panel architecture, multi-chat model, context management, Transform/Ask modes, streaming, diff cards, batch review, settings integration
- [Media Embeds & Custom Syntax](docs/media-embeds.md) — Media URL auto-detection, gallery grids, video timestamps, image thumbnails, wikilinks, inline fields, task syntax
