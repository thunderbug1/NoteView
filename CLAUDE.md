# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

**Cache busting:** Script tags use query parameters (e.g., `js/store.js?v=8`). When editing JS files referenced with `?v=` params, bump the version number in `index.html` and `sw.js` PRECACHE_URLS to ensure users get the update.

### Single File Release Packaging
The entire application can be packaged into a single, fully offline `noteview.html` file (with all CSS, JS, and SVG assets inlined) using `node scripts/build-single-file.js`.
This process is automated via GitHub Actions (`.github/workflows/release.yml`). Creating and pushing a git tag (e.g., `git tag v1.0.0 && git push --tags`) automatically triggers the Action to bundle the standalone file and publish it as an attached asset to a GitHub Release.

## Architecture

### Global singleton objects (not classes)

All core modules are plain objects on `window` — there are no ES module imports between app scripts. Load order matters and is determined by `<script>` tag sequence in `index.html`.

- **`App`** (`js/main.js`) — Top-level controller. Initializes the app, handles routing between views, manages event listeners, modals (tag, assignee, new note). Also contains `ThemeManager`.
- **`Store`** (`js/store.js`) — Central state and file I/O. Manages `blocks` array, IndexedDB persistence, directory handle, file read/write, git commit on save, contact/mention tracking. Filtering logic lives in `Store.getFilteredBlocks()`.
- **`GitStore`** (`js/gitStore.js`) — Git operations abstraction over isomorphic-git. Init, commit, log, diff, restore.
- **`GitFs`** (`js/gitFs.js`) — Filesystem adapter that bridges the browser File System Access API with isomorphic-git's expected fs interface.
- **`GitRemote`** (`js/gitRemote.js`) — Push/pull to remote git repositories.
- **`SelectionManager`** (`js/selectionManager.js`) — Manages sidebar filter state: time selection, context tags (multi-select), contact filter (single-select). Updates tag counts and UI.
- **`UndoRedoManager`** (`js/undoRedoManager.js`) — Command-pattern undo/redo for block operations.
- **`SortManager`** (`js/utils/sortManager.js`) — Per-view sort configuration with multi-clause sorting.

### Views

Each view is a global object with a `render(blocks)` method called by `App.render()`:

- **`DocumentView`** (`js/views/document.js`) — Main markdown editor. Creates/manages CodeMirror 6 editor instances per block. Handles inline editing, auto-save with debounce, block metadata rendering.
- **`KanbanView`** (`js/views/kanban.js`) — Drag-and-drop task board. Columns map to task states (`[ ]`, `[/]`, `[x]`, `[b]`, `[-]`).
- **`TimelineView`** (`js/views/timeline.js`) — Git-history-based task timeline. Has its own cache that's invalidated on save/delete.
- **`HistoryView`** (`js/views/history.js`) — Version browser with side-by-side diff using CodeMirror's merge view.
- **`SettingsView`** (`js/views/settings.js`) — App configuration and keyboard shortcut customization.

### Data model

A **block** is a single markdown note with:
- `id` — Filename without `.md` extension
- `content` — Raw markdown text
- `tags` — Array of tag strings (from frontmatter)
- `lastUpdated`, `createdAt` — Timestamps from git
- Tasks parsed inline from markdown checkboxes with metadata (`[due:: ...]`, `[priority:: ...]`, `[assignee:: ...]`, `[dependsOn:: ...]`)

Blocks are stored as individual `.md` files in the user's chosen directory. Frontmatter (`---` block at top of file) holds tags. Every save triggers a git commit.

### CodeMirror integration

CodeMirror 6 modules load as ES modules via esm.sh in `index.html`, then are exported to `window.CodeMirror`. Views must wait for `window.CodeMirrorReady` event (see `DocumentView.waitForCodeMirror()`). Custom widgets (task checkboxes, metadata decorations) live in `js/widgets/codeMirrorWidgets.js`.

### Key patterns

- **`Store.saveBlock(block, options)`** — Central write path. Accepts options for content changes, property updates, commit messages. Captures before/after state for undo/redo.
- **`App.updateBlockProperty(id, property, value)`** — Convenience method that calls `Store.saveBlock`, then invalidates timeline cache, updates tag counts, and re-renders.
- **After any mutation** (save, delete), call `TimelineView.invalidateCache()` and `SelectionManager.updateTagCounts()` before re-rendering.
- **`Modal.create({title, content, modalClass, onClose})`** — Factory for modal dialogs. Returns the modal element with a `.close()` method.
- **Filtering pipeline**: `Store.getFilteredBlocks()` applies search → time filter → context tags → contact filter, with caching via `CacheManager`.

### Browser APIs used

- **File System Access API** (`showDirectoryPicker`) — Read/write markdown files
- **IndexedDB** — Persist directory handle, view preferences, current view
- **Service Worker** — Offline caching with network-first strategy for scripts/styles

## In-Depth Documentation

- [Data Flow & State Management](docs/data-flow.md) — State ownership, render cycle, block lifecycle, filtering pipeline, caching, undo/redo, persistence
- [CodeMirror Editor System](docs/codemirror-editor.md) — CM6 loading, editor lifecycle, custom widgets, auto-save, focus management, merge view, autocomplete
- [Git Integration](docs/git-integration.md) — GitFSAdapter, init/commit/history/diff/restore flow, remote operations, timeline data extraction
- [Task System](docs/task-system.md) — Task syntax and states, parsing, kanban drag-and-drop, timeline, context menus, computed tags, dependencies
- [Filtering & UI](docs/filtering-and-ui.md) — SelectionManager, filter groups, tag system, contacts, time filtering, modal factory, sidebar, theming, mobile
