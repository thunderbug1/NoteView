# Git Version Control System

This document covers how NoteView uses isomorphic-git to provide built-in version control for markdown notes.

---

## Architecture Overview

NoteView implements git entirely in the browser using [isomorphic-git](https://isomorphic-git.org/), which requires a Node.js-style `fs` interface. The `GitFSAdapter` class bridges the browser's File System Access API to this interface.

```
Store (block save/delete)
  → GitStore.commitBlock()
    → isomorphic-git add() + commit()
      → GitFSAdapter.promises.writeFile/readFile/mkdir/readdir/stat/...
        → File System Access API (FileSystemDirectoryHandle)
```

### Module roles

| Module | File | Responsibility |
|--------|------|----------------|
| `GitStore` | `js/gitStore.js` | High-level git operations (init, commit, log, diff, restore) |
| `GitFSAdapter` | `js/gitFs.js` | Filesystem adapter implementing `fs.promises` for isomorphic-git |
| `GitRemote` | `js/gitRemote.js` | Push/pull to remote repositories |
| `Store` | `js/store.js` | Orchestrates git via GitStore during block mutations |

---

## GitFSAdapter

`GitFSAdapter` (`js/gitFs.js`) is the critical bridge. It wraps a `FileSystemDirectoryHandle` and exposes a `promises` object that isomorphic-git expects.

### Path resolution

All methods resolve relative paths (e.g., `"2026-04-10-1234567890.md"`, `".git/HEAD"`) by traversing the directory handle tree:

```js
async _resolvePath(path, create = false, isFile = true) {
    const parts = path.split('/').filter(p => p);
    let currentHandle = this.rootHandle;
    for (let i = 0; i < parts.length; i++) {
        const isLast = i === parts.length - 1;
        if (isLast && isFile) {
            return await currentHandle.getFileHandle(part, { create });
        } else {
            currentHandle = await currentHandle.getDirectoryHandle(part, { create });
        }
    }
    return currentHandle;
}
```

### Implemented methods

| Method | Implementation |
|--------|---------------|
| `readFile(path, options)` | Resolves path → `getFile()` → `arrayBuffer()` → `TextDecoder` if `encoding === 'utf8'` |
| `writeFile(path, data)` | Resolves path with `create: true` → `createWritable()` → `write(data)` → `close()` |
| `stat(path)` / `lstat(path)` | Tries file handle first, then directory. Returns stat object with `isDirectory()`, `isFile()`, `size`, `mtime` |
| `readdir(path)` | Resolves to directory handle → iterates keys |
| `mkdir(path)` | Resolves path with `create: true` and `isFile: false` |
| `rmdir(path)` | Resolves parent → `removeEntry(dirName, { recursive: true })` |
| `unlink(path)` | Resolves parent → `removeEntry(fileName)` |
| `readlink()` / `symlink()` / `chmod()` | Stubs — not needed for isomorphic-git's core operations |

---

## Initialization

### Flow

1. User selects a directory via `window.showDirectoryPicker()` or a saved handle is restored
2. `Store.openDirectory(handle)` or `Store.init()` calls `GitStore.init(directoryHandle)`
3. `GitStore.init()`:
   - References `window.git` (isomorphic-git loaded from CDN)
   - Creates a `new GitFSAdapter(directoryHandle)`
   - Exposes `adapter.promises` as `GitStore.fs`
   - Calls `git.init({ fs, dir: '/' })` to initialize a git repo if one doesn't exist

### Author config

All commits use a fixed author:

```js
author: {
    name: 'NoteView User',
    email: 'user@noteview.local'
}
```

---

## Commit Flow

Commits happen through `GitStore.commitBlock(filename, message)`:

1. `git.add({ fs, dir, filepath: filename })` — stages the file
2. `git.commit({ fs, dir, author, message })` — creates a commit with all staged changes
3. Returns the commit SHA

### When commits are triggered

Not every save creates a git commit. Commits are triggered by:

| Action | Commit? | Message |
|--------|---------|---------|
| User edits content (auto-save debounce) | No | — |
| `App.saveBlockContent()` with `commit: true` | Yes | Provided or `"Update {filename}"` |
| `Store.createBlock()` | Yes | `"Create note {id}"` |
| `App.updateBlockProperty()` | Yes | Provided by caller |
| `App.deleteBlock()` | No | (File is deleted from filesystem, next commit will reflect the deletion) |
| Kanban drag (state change) | Yes | `"Move task to {state}"` |
| Badge edit in kanban | Yes | `"Update properties for '{task}'"` |

### Commit messages in Store.saveBlock

When `Store.saveBlock(block, options)` is called with `options.commit = true`:

```js
if (commit) {
    const message = commitMessage || `Update ${fileName}`;
    await GitStore.commitBlock(fileName, message);
}
```

---

## History & Diff

### Per-file history

`GitStore.getHistory(filename)` returns commit history for a specific file:

```js
const commits = await git.log({ fs, dir, filepath: filename });
return commits.map(c => ({
    oid: c.oid,
    message: c.commit.message,
    timestamp: c.commit.author.timestamp * 1000,
    author: c.commit.author.name
}));
```

### Getting file content at a commit

`GitStore.getFileAtCommit(filename, oid)` reconstructs a file's content at a specific commit:

1. Reads the commit → gets tree OID
2. Reads the tree → finds the file entry
3. Reads the blob → decodes with `TextDecoder`

### Full history (for timeline)

`GitStore.getFullHistory(maxCount)` returns all commits (limited to 200 by default) without filtering by file:

```js
const commits = await git.log({ fs, dir, depth: maxCount });
```

### All files at a commit

`GitStore.getAllFilesAtCommit(oid)` reads every `.md` file from a commit's tree:

1. Reads commit → tree
2. Iterates tree entries, filters `.md` blobs
3. Returns `{ filename: content }` map

---

## Restore/Revert

`HistoryView.restoreVersion()` (`js/views/history.js`):

1. Confirms with the user
2. Calls `App.updateBlockProperty(blockId, 'content', selectedOldContent)` — this saves and commits
3. Calls `App.saveBlockContent(blockId, selectedOldContent)` for additional safety
4. Closes the history modal and re-renders

This creates a new commit that restores the old content, preserving the full history.

---

## Remote Operations

`GitRemote` (`js/gitRemote.js`) handles push/pull to remote git repositories.

### Configuration

Remote config (URL, branch) is persisted in IndexedDB via `Store.saveRemoteConfig()` / `Store.getRemoteConfig()`.

### Operations

- **Push**: `git.push({ fs, dir, remote, ref })` — pushes the current branch
- **Pull**: `git.pull({ fs, dir, remote, ref, author })` — pulls and merges

Remote operations are user-initiated from the Settings view.

---

## Timeline Data Extraction

`TimelineView` (`js/views/timeline.js`) builds a task timeline by diffing task state across git commits. Uses a two-layer caching strategy for performance.

### buildTimeline()

1. Gets full commit history (up to 100 commits) via `GitStore.getFullHistory(100)`
2. Reverses to chronological order (oldest first)
3. Checks if an incremental rebuild is possible (new commits appended since last build)
4. For each commit (via `_processCommit()`):
   - **First commit**: reads all files via `GitStore.getAllFilesAtCommit(oid)`
   - **Subsequent commits**: uses `GitStore.getChangedFilesBetween(parentOid, childOid)` with isomorphic-git's `walk()` + two `TREE` walkers to discover only changed files, then merges with previous task snapshot
   - Diffs against the previous commit's tasks via `TimelineView.diffTasks()`
5. Returns events sorted newest-first

### getChangedFilesBetween(parentOid, childOid)

Uses `git.walk()` with two `TREE({ref})` walkers to compare consecutive commits. Only files whose blob OIDs differ are read — most commits touch 1-2 files, so this eliminates ~95% of blob reads compared to reading all files at every commit. Falls back to `getAllFilesAtCommit()` on error.

### diffTasks(prevAllTasks, currAllTasks, commit)

Compares task maps between two commits and produces events:

| Event type | When |
|------------|------|
| `created` | Task key exists in current but not previous |
| `changed` | Task exists in both, state differs |
| `removed` | Task key exists in previous but not current, or file was deleted |

Events include: `taskText`, `oldState`, `newState`, `timestamp`, `commitMessage`, `blockId`, `tags`, `oid`, `parents`.

### Caching (two layers)

**Layer 1 — Filtered events cache** (`_cache`): `CacheManager.createCache()` instance keyed by time/context/contact/search selections. Only needs rebuilding when selections change.

**Layer 2 — Raw data cache** (`_rawDataCache`): Stores per-commit task snapshots keyed by HEAD OID. Survives filter changes. On `invalidateCache()` (triggered by save/delete), only the events cache is cleared — the raw data cache enables incremental rebuilds where only new commits are processed instead of all 100.

- `invalidateCache()` — clears filtered events cache only (called after save/delete/property update)
- `invalidateRawDataCache()` — clears raw data cache for full rebuild (called after git pull, vault switch, directory change)

---

## .gitignore

The `.git` directory is excluded during `Store.loadBlocks()`:

```js
for await (const entry of this.directoryHandle.values()) {
    if (entry.name === '.git') continue;
    // ... process .md files
}
```

No explicit `.gitignore` file is created — isomorphic-git manages the `.git` directory internally and only committed files appear in git operations.
