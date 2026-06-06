# Data Flow & State Management

This document covers how state flows through NoteView — from user interaction to disk persistence and back to the screen.

---

## State Ownership

State is split across three layers with clear ownership:

| State | Owner | File | Persisted? |
|-------|-------|------|------------|
| `blocks` array (all notes) | `Store` | `js/store.js` | `.md` files on disk |
| `searchQuery` | `Store` | `js/store.js` | No (session only) |
| `currentView` | `Store` | `js/store.js` | `localStorage` (`noteview-current-view`) |
| `viewPreferences` (sort config) | `Store` | `js/store.js` | `localStorage` (`noteview-view-preferences`) |
| `directoryHandle` | `Store` | `js/store.js` | IndexedDB (`NoteViewDB` → `handles` store) |
| `contacts` Map | `Store` | `js/store.js` | Derived from block content on every load/save |
| `selections` (time, context, contact) | `SelectionManager` | `js/selectionManager.js` | `localStorage` (`noteview-selection-state`, context only) |
| `undoStack` / `redoStack` | `UndoRedoManager` | `js/undoRedoManager.js` | IndexedDB (`undoRedoState` store) |
| Editor instances | `DocumentView.editors` | `js/views/document.js` | No (recreated on render) |
| Timeline data | `TimelineView._cache` | `js/views/timeline.js` | No (rebuilt from git on demand) |

### Rule of thumb

- **Store** owns data that maps to files on disk or browser storage.
- **SelectionManager** owns ephemeral filter state (what's selected in the sidebar).
- **Views** own their rendering state (editor instances, caches) but never duplicate Store data.

---

## The Render Cycle

Every visual update follows this sequence:

```
User action (edit, click filter, switch view)
  → Mutate state (Store, SelectionManager, etc.)
  → App.render()
    → Store.getFilteredBlocks()  (with caching)
      → SortManager.sortItems(currentView, filtered)
    → View.render(sortedBlocks)
    → App.updateUndoRedoUI()
```

### What triggers a re-render

1. **Content edit** → `App.saveBlockContent()` → `Store.saveBlock()` → `TimelineView.invalidateCache()` + `SelectionManager.updateTagCounts()` + `App.render()`
2. **Filter change** → `SelectionManager.set*()` → `App.render()`
3. **View switch** → `App.setView()` → `Store.setCurrentView()` → `App.render()`
4. **Block delete** → `App.deleteBlock()` → `Store.deleteBlock()` → same invalidation + render
5. **Block create** → `Store.createBlock()` → same invalidation + render
6. **Undo/Redo** → `UndoRedoManager.undo()/redo()` → state mutation + `App.render()`

### After any mutation, you must:

```js
TimelineView.invalidateCache();
SelectionManager.updateTagCounts();
App.render();
```

This pattern appears in `App.saveBlockContent()`, `App.deleteBlock()`, and `App.updateBlockProperty()`.

---

## Block Lifecycle

### Creation

`Store.createBlock(content, extraMetadata)` (`js/store.js`):

1. Generates ID: `${YYYY-MM-DD}-${Date.now()}`
2. Infers tags from `extraMetadata.tags` or `SelectionManager.getActiveTags()`
3. Calls `Store.saveBlock(block, { commit: true, commitMessage: 'Create note ...' })`
4. Pushes block onto `Store.blocks` array
5. Records undo command (type: `'create'`)
6. Returns the block object

### Loading

`Store.loadBlocks()` is called during `Store._activateVault()`:

1. Iterates `directoryHandle.values()`, skipping `.git` and non-`.md` files
2. Loads full block cache from IndexedDB (`blockCache` store, keyed by vault name)
3. Compares file mtimes with cached mtimes:
   - **Cache hit (mtime matches)**: Uses cached block data (including content) without reading file
   - **Cache miss or stale**: Reads file text, calls `parseFrontMatter(content)` to extract tags/metadata
4. Merges cached and newly-read data into `blocks` array
5. Updates IndexedDB cache with any changed/new blocks
6. Calls `extractContacts()` to populate the contacts Map
7. Invalidates the filtered blocks cache

**Performance**: First load with 50 files takes ~5-10s. Subsequent loads with cache hit take ~1-2s (instant). Cache invalidation happens on save/delete.

### Saving

`Store.saveBlock(block, options)` is the central write path:

1. Captures `beforeState` (deep copy) for undo if this is an update
2. Applies any updates from `options` via `Object.assign(block, updates)`
3. Sets `block.lastUpdated` to current ISO timestamp
4. Serializes block to markdown via `serializeBlock(block)` (writes frontmatter)
5. Writes to disk via File System Access API (`getFileHandle` → `createWritable` → `write` → `close`)
6. Updates contacts (`extractContacts()`)
7. Invalidates filtered blocks cache
8. Records undo command (type: `'update'`) if fields beyond `lastUpdated` changed
9. If `options.commit === true`, calls `GitStore.commitBlock(filename, message)` to git add + commit

**Important**: Not every save triggers a git commit. Only saves with `commit: true` (explicit saves, property changes) create commits. Auto-saves from the editor debounce do NOT commit unless explicitly requested.

### Deletion

`Store.deleteBlock(id)`:

1. Finds block index in `Store.blocks`
2. Records undo command (type: `'delete'`) with full block data
3. Records deletion in `RecentAccessTracker.recordDeletion()` (persistent trash log)
4. Removes file via `directoryHandle.removeEntry(fileName)`
5. Splices block from `blocks` array
6. Re-extracts contacts and invalidates cache

---

## Recent Access Tracking

`RecentAccessTracker` (`js/utils/recentAccessTracker.js`) tracks when blocks are viewed and deleted, stored per-vault in localStorage (separate from .md files and git).

### Access tracking

`touch(blockId)` records a timestamp when a block is viewed. Tracked at:
- Editor focus (`DocumentView.createDomEventHandlers()` focus handler)
- Wikilink navigation (`DocumentView.navigateToBlock()`)
- Block creation (`Store.createBlock()`)

Access timestamps feed the `lastAccessed` sort field in SortManager.

### Trash log

`recordDeletion(block)` stores the full block object when deleted. Capped at 50 entries, auto-pruned by age. Survives page reloads.

The trash panel is accessible via right-click on the recent toolbar button. Each entry shows the note title and relative time with a "Restore" button that recreates the .md file via `Store.saveBlock()`.

### Persistence

Data stored in localStorage under `noteview-recent-access::<vaultName>` as `{ access: { blockId: timestamp }, trash: [...] }`. Initialized on vault load, pruned of stale entries after `loadBlocks()`.

---

## Filtering Pipeline

`Store.getFilteredBlocks()` applies filters in this order:

```
All blocks
  → Separate pinned blocks (always shown, bypass all filters)
  → Time filter (if SelectionManager.selections.time is set)
  → Context tag filter (AND logic for all selected tags)
    → Includes path: group selections (block must have ANY tag in that group)
    → Includes computed tags (Todo.*, Status.*) checked against task content
  → Excluded tag filter (NOT logic — block must NOT have any excluded tag)
  → Contact filter (if SelectionManager.selections.contact is set)
  → Search filter (content + tags substring match)
  → Combine: pinned blocks first (unfiltered), then filtered unpinned blocks
  → Return combined array
```

 ### Caching

**Filtered blocks cache**: The result is cached using `CacheManager.createCache()` (`js/utils/cacheManager.js`). The cache key is a composite string:

```js
`${timeSelection}|${contextSelection}|${excludedSelection}|${contactSelection}|${searchQuery}|${timeProperty}|${blocksHash}`
```

Where `blocksHash` is all block IDs joined with commas. This means the cache automatically invalidates when:
- Any filter selection changes (different key)
- A block is added or removed (different block IDs)
- The search query changes
- The excluded set changes

The cache is also explicitly invalidated (`_filteredBlocksCache.invalidate()`) on every `saveBlock()`, `deleteBlock()`, and `loadBlocks()` call.

**Block content cache**: Full block data (content + metadata) is cached in IndexedDB (`blockCache` store) for instant reloads. Cache key is `blockCache::<vaultName>::<filename>`. On load, files are compared by mtime:
- If mtime matches cache: Use cached data (no filesystem read)
- If mtime differs or file missing: Read file and update cache

Cache is invalidated on:
- Block save: `_invalidateBlockCache(filename)` removes entry
- Block delete: Same invalidation
- Vault switch: Each vault has separate cache namespace

### Context tag AND logic

When multiple context tags are selected, a block must match **all** of them:

```js
const requiredTags = Array.from(contextSelection).filter(t => !SelectionManager.isComputedContextTag(t));
```

Individual tags use `block.tags.includes(tag)`. `path:` prefixed selections check if the block has ANY tag in that group via `Common.parseHierarchicalTag()`. Computed tags (`Todo.*`, `Status.*`) are checked separately — the block must have at least one task satisfying all selected computed tag conditions.

### Excluded tag NOT logic

Tags can be excluded (right-click in sidebar) via `SelectionManager.selections.excluded`. A block matching any excluded tag is filtered out. Excluded tags also support `path:` prefixes and computed tags (e.g., excluding `Todo.done` removes blocks with completed tasks).

### Pinned blocks

Blocks with `block.pinned === true` bypass all filters and always appear at the top of the result list.

---

## Sorting

`SortManager` (`js/utils/sortManager.js`) provides per-view, multi-clause sorting.

### Configuration

Sort config is stored per view in `Store.viewPreferences[view].sort.clauses`:

```js
// Example: document view default
clauses: [
    { field: 'lastUpdated', direction: 'desc' },
    { field: 'id', direction: 'asc' }
]
```

Each clause has a `field` and `direction`. Fields are defined per view in `SortManager.getFieldDefinitions(view)`.

### Available fields by view

**Document view**: `lastUpdated`, `creationDate`, `id`, `lastAccessed`
**Kanban view**: `priority`, `deadline`, `assignee`, `text`, `sourceOrder`

### Sorting flow

`SortManager.sortItems(view, items)`:

1. Loads clauses from `Store.getSortConfig(view)`, falling back to defaults if empty
2. Builds a field map from `getFieldDefinitions(view)`
3. Sorts a copy of the items array using `compareItems()` which iterates clauses in order
4. Each clause's comparator handles null/undefined values (valid values sort before invalid)

### Comparator helpers

- `compareDates(a, b)` — Parses ISO strings and timestamps, missing/invalid dates sort as 0 (oldest)
- `compareNumbers(a, b)` — NaN/Infinity sorts last
- `compareStrings(a, b)` — Uses `localeCompare` with numeric sorting, empty strings sort last

---

## Undo/Redo

`UndoRedoManager` (`js/undoRedoManager.js`) implements the command pattern.

### Command types

| Type | Recorded by | Undo action | Redo action |
|------|-------------|-------------|-------------|
| `create` | `Store.createBlock()` | Delete block + file | Recreate block + file |
| `update` | `Store.saveBlock()` | Revert changed fields to `before` state | Apply `after` state |
| `delete` | `Store.deleteBlock()` | Recreate block + file | Delete block + file |
| `batch` | Batch operations | Undo each sub-command in reverse | Redo each sub-command in order |

### Diff capture

`UndoRedoManager.createDiff(before, after)` only stores fields that actually changed:

```js
const fields = ['content', 'tags', 'creationDate', 'lastUpdated'];
```

If only `lastUpdated` changed (a common case with no real user edit), no command is recorded.

### Execution guard

`UndoRedoManager.isExecuting` is set to `true` during undo/redo operations. This prevents `Store.saveBlock()` from recording new commands while replaying state changes.

### Persistence

Undo/redo state is persisted to IndexedDB (`undoRedoState` store) keyed by session ID. Session ID is stored in `sessionStorage`, so undo history survives page reloads within the same browser tab but not across tabs.

---

## Persistence

### File System Access API

The user's vault directory is accessed via `window.showDirectoryPicker()`. The `FileSystemDirectoryHandle` is persisted in IndexedDB so the app can re-request access on reload (with permission check).

### IndexedDB (`NoteViewDB`)

| Store | Key | Value |
|-------|-----|-------|
| `handles` | `'directoryHandle'` | The serialized directory handle |
| `handles` | `'remoteConfig'` | Git remote URL and branch |
| `handles` | `'shortcuts'` | Custom keyboard shortcuts |
| `undoRedoState` | `sessionId` | Undo/redo stacks + session metadata |

### localStorage

| Key | Value |
|-----|-------|
| `noteview-current-view` | Active view name (`'document'`, `'kanban'`, etc.) |
| `noteview-view-preferences` | JSON object with per-view sort config |
| `noteview-selection-state` | JSON with `context` array (selected sidebar tags) |
| `noteview-theme` | `'light'` or `'dark'` |

### Markdown files

Each block is a `.md` file with optional YAML frontmatter:

```markdown
---
tags: ["work","project"]
creationDate: "2026-04-10T08:00:00.000Z"
lastUpdated: "2026-04-10T08:30:00.000Z"
---

Note content goes here.
```

`serializeBlock()` (`js/store.js`) generates this format. `parseFrontMatter()` parses it back, handling stacked frontmatter blocks (newest metadata wins).
