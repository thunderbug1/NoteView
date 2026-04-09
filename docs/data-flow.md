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

`Store.loadBlocks()` is called during `Store.init()` and `Store.changeDirectory()`:

1. Iterates `directoryHandle.values()`, skipping `.git` and non-`.md` files
2. For each `.md` file: reads text, calls `parseFrontMatter(content)` to extract tags/metadata
3. Pushes `{ id, filename, fileHandle, ...parsed }` to `blocks` array
4. Calls `extractContacts()` to populate the contacts Map
5. Invalidates the filtered blocks cache

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
3. Removes file via `directoryHandle.removeEntry(fileName)`
4. Splices block from `blocks` array
5. Re-extracts contacts and invalidates cache

---

## Filtering Pipeline

`Store.getFilteredBlocks()` applies filters in this order:

```
All blocks
  → Time filter (if SelectionManager.selections.time is set)
  → Context tag filter (AND logic for all selected tags)
  → Computed tag filter (allTodos, openTodos, etc.)
  → Contact filter (if SelectionManager.selections.contact is set)
  → Search filter (content + tags substring match)
  → Return filtered array
```

### Caching

The result is cached using `CacheManager.createCache()` (`js/utils/cacheManager.js`). The cache key is a composite string:

```js
`${timeSelection}|${contextSelection}|${contactSelection}|${searchQuery}|${timeProperty}|${blocksHash}`
```

Where `blocksHash` is all block IDs joined with commas. This means the cache automatically invalidates when:
- Any filter selection changes (different key)
- A block is added or removed (different block IDs)
- The search query changes

The cache is also explicitly invalidated (`_filteredBlocksCache.invalidate()`) on every `saveBlock()`, `deleteBlock()`, and `loadBlocks()` call.

### Context tag AND logic

When multiple context tags are selected, a block must match **all** of them:

```js
const requiredTags = Array.from(contextSelection).filter(t => !SelectionManager.isComputedContextTag(t));
const hasAllTags = requiredTags.every(tag => block.tags?.includes(tag));
```

Computed tags (allTodos, openTodos, etc.) are checked separately with their own logic.

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

**Document view**: `lastUpdated`, `creationDate`, `id`
**Kanban view**: `priority`, `deadline`, `assignee`, `text`, `sourceOrder`

### Sorting flow

`SortManager.sortItems(view, items)`:

1. Loads clauses from `Store.getSortConfig(view)`, falling back to defaults if empty
2. Builds a field map from `getFieldDefinitions(view)`
3. Sorts a copy of the items array using `compareItems()` which iterates clauses in order
4. Each clause's comparator handles null/undefined values (valid values sort before invalid)

### Comparator helpers

- `compareDates(a, b)` — Parses ISO strings, NaN sorts last
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
