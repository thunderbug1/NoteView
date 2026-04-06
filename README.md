# NoteView

A modern, browser-based note-taking and task management app with built-in git version control. Write in markdown, manage tasks across multiple views, and keep a full history of every change — all running locally in your browser with **zero lock-in**.

Your data lives as plain markdown files on your own filesystem. No proprietary formats, no cloud dependency, no server required.

## Features

### Live Markdown Editor

An Obsidian-like editing experience powered by [CodeMirror 6](https://codemirror.net/). Markdown syntax hides when you're not editing, giving you a clean reading view while retaining full markdown power. Auto-saves with a 1-second debounce.

### Rich Task Management

Go beyond simple checkboxes. Tasks support custom states and inline metadata:

```markdown
- [ ] Design new landing page [due:: 2026-04-15] [priority:: high]
- [/] Implement search feature [assignee:: @alice]
- [x] Fix login bug [due:: 2026-04-10] [completed:: 2026-04-09]
- [b] Waiting on API docs [dependsOn:: ^backend-api]
- [-] Deprecated approach
```

**Task states:**

| State | Meaning |
|-------|---------|
| `[ ]` | Todo |
| `[/]` | In Progress |
| `[x]` | Done |
| `[b]` | Blocked |
| `[-]` | Canceled |

**Metadata fields:** due dates, assignees, priorities, and cross-task dependencies — all inline in your markdown.

### Multiple Views

Switch between views to interact with your notes in the way that suits your current workflow:

- **Document View** — Full markdown editor with live preview
- **Kanban View** — Drag-and-drop board organized by task state
- **Timeline View** — Vertical timeline of task status changes pulled from git history
- **History View** — Browse past versions, compare diffs, and restore any previous version
- **Settings View** — Configure the app and view keyboard shortcuts

### Built-in Version Control

Every save is automatically committed to a local git repository using [isomorphic-git](https://isomorphic-git.org/). This gives you:

- A complete history of every change to every note
- A timeline view that tracks when tasks moved between states
- Side-by-side diff viewing between any two versions
- One-click restore of previous versions
- Optional push/pull to a remote git repository for backup or collaboration

### Filtering & Organization

Find what you need fast with multi-layered filtering:

- **Tags** — Organize notes with frontmatter tags, click to filter
- **Computed tags** — Smart collections like `allTodos`, `openTodos`, `blockedTodos`, `unblockedTodos`
- **Time filters** — Show notes from today, this week, or this month
- **Contacts** — Filter by @mentions and assignees
- **Search** — Real-time full-text search across all notes

### No Lock-In

Your notes are plain `.md` files in a folder you choose. Use any markdown editor to open them. Walk away from NoteView at any time and your data remains perfectly readable and portable.

### Offline-First & No Backend

The entire app runs in your browser. No account, no server, no cloud. It uses the browser's File System Access API to read and write your local files. Works offline once loaded.

## Tech Stack

- **Vanilla JavaScript** — No framework, no build step
- [CodeMirror 6](https://codemirror.net/) — Editor with custom markdown widgets
- [Marked.js](https://marked.js.org/) — Markdown rendering
- [isomorphic-git](https://isomorphic-git.org/) — Full git implementation in JavaScript
- **File System Access API** — Direct local file access
- **IndexedDB** — Persistent settings and state

## Getting Started

1. Serve the project directory with any static file server, or just open `index.html` in a Chromium-based browser (Chrome, Edge, Brave) for File System Access API support
2. Click **Open Vault** and select a folder where your markdown notes will live
3. Start writing

## Project Structure

```
index.html              # App shell
css/                    # Stylesheets (base, layout, components, per-view)
js/
  main.js               # App initialization and routing
  store.js              # Central data management and file operations
  gitStore.js           # Git operations abstraction
  gitFs.js              # Git filesystem adapter
  gitRemote.js          # Remote git push/pull
  selectionManager.js   # Tag and filter state
  undoRedoManager.js    # Undo/redo command pattern
  views/
    document.js         # Document/editor view
    kanban.js           # Kanban board view
    timeline.js         # Task timeline view
    history.js          # Version history with diff viewer
    settings.js         # Settings view
  menus/
    taskMenus.js        # Task context menus
  widgets/
    codeMirrorWidgets.js # Custom CodeMirror extensions
  utils/
    taskParser.js       # Extracts tasks from markdown
    timeFilter.js       # Date-based filtering
    contactHelper.js    # @mention and contact utilities
    cacheManager.js     # Performance caching
    modal.js            # Modal dialog system
    common.js           # Shared helpers
    performance.js      # Performance monitoring
```

## Screenshots

*Coming soon*

## License

*Add your license here*
