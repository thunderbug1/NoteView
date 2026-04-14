# Task Management System

This document covers how NoteView implements rich task management using inline markdown syntax — from parsing to the kanban board, timeline, and context menus.

---

## Task Syntax

Tasks are markdown checkboxes with custom states and inline metadata:

```markdown
- [ ] Design new landing page [due:: 2026-04-15] [priority:: high]
- [/] Implement search feature [assignee:: @alice]
- [x] Fix login bug [due:: 2026-04-10] [completed:: 2026-04-09]
- [b] Waiting on API docs
- [-] Deprecated approach
```

### Task States

| Char | State | CSS class | Meaning |
|------|-------|-----------|---------|
| `[ ]` | Todo | `state-todo` | Not started |
| `[/]` | In Progress | `state-progress` | Currently being worked on |
| `[x]` | Done | `state-done` | Completed |
| `[b]` | Blocked | `state-blocked` | Waiting on something |
| `[-]` | Canceled | `state-canceled` | No longer relevant |

State characters are case-insensitive (`[X]` and `[B]` normalize to `[x]` and `[b]`).

### Metadata Fields (Badges)

Badges use the syntax `[key:: value]` and can appear in any order after the task text:

| Field | Example | Purpose |
|-------|---------|---------|
| `due` | `[due:: 2026-04-15]` | Deadline date |
| `assignee` | `[assignee:: alice]` | Person responsible |
| `priority` | `[priority:: high]` | Priority level |
| `completed` | `[completed:: 2026-04-09]` | Completion date |
| `id` | `[id:: ^task-123]` | Explicit task ID |

Priority values (with sort rank): `urgent` (0), `high` (1), `medium` (2), `low` (4). Unknown priorities rank at 3.

---

## Task Parsing

`TaskParser` (`js/utils/taskParser.js`) extracts task objects from markdown content.

### Regex

```js
const CHECKBOX_REGEX = /^(\s*[-*+]\s+)\[([ xX\/bB\-])\](.*)$/gm;
const BADGE_REGEX = /\[([a-zA-Z0-9_]+)::\s*([^\]]+)\]/g;
```

- `CHECKBOX_REGEX` captures: prefix (whitespace + list marker), state character, remaining text
- `BADGE_REGEX` captures: key and value from inline fields

### parseTasksFromBlock(block)

Returns an array of task objects for a single block:

```js
{
    id: `task-${blockId}-${matchIndex}`,
    blockId: '2026-04-10-1234567890',
    state: ' ',              // normalized state char
    text: 'Design new landing page',  // clean text without badges
    originalText: 'Design new landing page [due:: 2026-04-15] [priority:: high]',
    matchIndex: 42,          // character offset in block content
    matchLength: 78,         // total match length
    badges: [
        { type: 'due', value: '2026-04-15' },
        { type: 'priority', value: 'high' }
    ],
    prefix: '- '             // list marker + whitespace
}
```

### parseTasksFromContent(content)

Used by TimelineView for diffing. Returns a `Map<string, {state, text, originalText, badges}>` keyed by clean task text (deduplicated with `#2`, `#3` suffixes).

### parseTasksFromBlocks(blocks)

Convenience that calls `parseTasksFromBlock()` for each block and flattens the results.

---

## State Classification Functions

TaskParser exposes predicate functions used by filtering, kanban, and timeline:

| Function | Logic |
|----------|-------|
| `isOpenTask(task)` | `state === ' '` or `state === '/'` |
| `isClosedTask(task)` | `state === 'x'` or `state === '-'` |
| `isBlockedTask(task)` | `state === 'b'` |
| `isUnblockedTask(task)` | `isOpenTask(task)` |
| `hasAssignee(task)` | Any badge with `type === 'assignee'` and non-empty value |
| `hasMention(task)` | Task text contains an `@mention` contact |
| `isUnassignedTask(task)` | No assignee badge, including inherited assignee context from parent tasks (optionally filtering out closed tasks) |
| `hasUnassignedTasks(tasks)` | Any task in the array is unassigned (optionally ignoring closed tasks) |

---

## Kanban View

`KanbanView` (`js/views/kanban.js`) renders a drag-and-drop board with columns for each task state.

### Column definitions

```js
columns: [
    { id: 'todo', label: 'Todo', state: ' ' },
    { id: 'progress', label: 'In Progress', state: '/' },
    { id: 'done', label: 'Done', state: 'x' },
    { id: 'blocked', label: 'Blocked', state: 'b' },
    { id: 'canceled', label: 'Canceled', state: '-' }
]
```

### Rendering flow

1. `KanbanView.render(blocks)` calls `extractTasks(blocks)` to get all tasks
2. Tasks are filtered by sidebar selections (context tags, contacts)
3. Tasks are sorted per column using `SortManager.sortItems('kanban', tasks)`
4. Each column renders its task cards with badge chips

### Task filtering

`KanbanView.extractTasks(blocks)` first parses all tasks, then applies sidebar filters:

- Contact filter: checks `ContactHelper.hasTaskContact(task, contactSelection)`
- Computed tag filters: `openTodos`, `blockedTodos`, `unblockedTodos`, `unassigned` — each checks the corresponding TaskParser predicate. `unassigned` is based on assignee badges across all task states, and nested tasks inherit assignee context from assigned parent tasks.

Nested tasks inherit assignment context from their ancestor tasks, so a child checkbox under an assigned parent is not treated as unassigned unless it sits under an unassigned branch.

### Drag-and-drop state changes

When a card is dropped on a different column:

1. The drag payload contains: `blockId`, `matchIndex`, `matchLength`, `prefix`, `columnId`
2. On drop, the target column's state character is determined
3. The source content is spliced at `matchIndex + prefix.length + 1` to replace the state char
4. Guard check: verifies `[` and `]` brackets are at expected positions before replacing
5. Calls `App.saveBlockContent()` with `commit: true` and message `"Move task to {state}"`

### Action buttons

Hovering over a kanban card reveals action buttons for missing metadata fields:
- Calendar icon to add a due date (hidden if `[due::]` already present)
- Person icon to add an assignee (hidden if `[assignee::]` already present)
- Flag icon to add a priority (hidden if `[priority::]` already present)

Each button opens the corresponding picker (date input, assignee modal, or priority menu) and updates the task inline. On mobile, buttons are always visible.

### Card click

Clicking a kanban card (not a badge, not an action button) opens `App.showBlockContentModal(blockId)` — a modal with a full CodeMirror editor for the source note.

---

## Timeline View

`TimelineView` (`js/views/timeline.js`) reconstructs task history from git commits. See [git-integration.md](git-integration.md) for the full build process.

### Event types

| Type | Visual | Description |
|------|--------|-------------|
| `created` | Green dot + "Created as {state}" badge | New task appeared in a commit |
| `changed` | Blue dot + arrow transition (old → new) | Task state changed between commits |
| `removed` | Gray dot + "Removed" badge | Task disappeared from a commit |

### Filtering

`TimelineView.filterEvents(events)` applies the same sidebar filters as the block list:
- Time filter on event timestamp
- Context tag filter on the event's associated block tags
- Computed tag filters (openTodos, blockedTodos, etc.) check the event's task state
- Contact filter via `ContactHelper.hasEventContact()`
- Search filter on task text, block ID, and commit message

### Diff modal

Clicking a timeline event's note name opens a diff modal showing the changes at that commit, with a toggle between "Diff" and "This Version" views.

---

## Task Context Menus

`TaskMenus` (`js/menus/taskMenus.js`) provides right-click context menus for tasks in the editor.

Created via `TaskMenus.create(documentView)` — returns an object with `showTaskMenu()`.

### Menu actions

The task menu appears on right-click of a `CheckboxWidget` and offers:
- Change state (Todo, In Progress, Done, Blocked, Canceled)
- Each option dispatches a CodeMirror change replacing the state character

---

## Computed Tags

These sidebar filter options are computed at runtime from block content:

| Tag | Filter logic | Used in |
|-----|-------------|---------|
| `allTodos` | Block content matches `/\[[ xX\/bB\-]\]/` | Block filtering, Kanban |
| `openTodos` | Block content matches `/\[[ \/]\]/` | Block filtering, Kanban |
| `blockedTodos` | `TaskParser.isBlockedTask()` for any task | Block filtering, Kanban |
| `unblockedTodos` | `TaskParser.isUnblockedTask()` for any task | Block filtering, Kanban |
| `unassigned` | `TaskParser.hasUnassignedTasks(..., { onlyActive: true })` for block tasks, plus task-level matching in Kanban/Timeline | Block filtering, Kanban, Timeline |
| `untagged` | `block.tags` is empty or absent | Block filtering |

In `Store.getFilteredBlocks()`, computed tags are checked after regular tag matching. A block must pass ALL selected filters (AND logic).

---

### Priority sorting

`TaskParser.getPriorityRank(task)` returns a numeric rank for sorting:
- `urgent` = 0, `high` = 1, `medium` = 2, (unrecognized) = 3, `low` = 4
- Used by `SortManager` for kanban sort with `direction: 'asc'` (lowest number = highest priority first)
