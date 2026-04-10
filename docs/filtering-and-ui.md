# Filtering System & UI Patterns

This document covers how NoteView manages filter state, renders sidebar controls, handles theming, modals, and responsive behavior.

---

## SelectionManager

`SelectionManager` (`js/selectionManager.js`) owns all filter selection state. Initialized during `App.completeInitialization()`.

### Selection state

```js
selections: {
    time: '',              // '' | 'today' | 'thisWeek' | 'thisMonth'
    context: new Set(),    // multi-select: user tags + computed tags
    contact: ''            // single-select: username string
}
```

### Persistence

Only `context` selections persist — stored as a JSON array in `localStorage` under `noteview-selection-state`. Time and contact selections reset on reload.

On `init()`:
1. `loadSelectionState()` — reads from localStorage, filters out non-string/empty entries
2. `normalizeContextSelection()` — removes stale tags that no longer exist
3. `updateSelectionUI()` — syncs DOM to match loaded state

### Update propagation

Every mutation method (`setTimeSelection`, `setContactSelection`, `addContextTag`, `removeContextTag`, `toggleContextTag`) follows the same pattern:

1. Mutate `this.selections`
2. `saveSelectionState()` (context only)
3. `updateSelectionUI()` — iterates all `.tag-radio-option` DOM elements, compares `data-group`/`data-tag` against selections, toggles `.selected` CSS class

After the mutation, the caller (event handlers in `App.setupEventListeners()`) invokes `App.render()`.

---

## Filter Groups

The sidebar exposes four filter groups with different selection semantics:

### Time (radio)

- **Container**: `#timeTags` in `index.html`
- **`data-group="time"`**
- **Options**: `""` (All), `"today"`, `"thisWeek"`, `"thisMonth"`
- **Behavior**: Mutually exclusive. Clicking the selected option (except "All") deselects it.
- **Event handler**: `App.setupEventListeners()` line 261

### Tags (multi-select)

- **Container**: `#contextTags` — populated dynamically by `SelectionManager.renderContextSidebar()`
- **`data-group="context"`**
- **Behavior**: Toggle-based. Multiple tags active simultaneously. Block must match ALL selected tags (AND logic).
- **Special**: Selecting `"untagged"` clears all other context tags first.

### Computed Tags (multi-select, same group)

- **Container**: `#computedTags` in `index.html`
- **`data-group="context"`** — shares the `selections.context` Set with user tags
- **Fixed options**: `allTodos`, `openTodos`, `blockedTodos`, `unblockedTodos`, `untagged`, `unassigned`
- **Filter logic**: Handled separately in `Store.getFilteredBlocks()` — each has custom matching logic (regex for content, TaskParser predicates for task properties)

### People (radio)

- **Container**: `#contactTags` — populated dynamically by `SelectionManager.renderContactsSidebar()`
- **`data-group="contact"`**
- **Behavior**: Single-select. Click to select, click again to deselect.
- **Event handler**: `App.setupEventListeners()` line 274

---

## Tag System

### Tag extraction

Tags come from YAML frontmatter in `.md` files, parsed by `parseFrontMatter()` in `js/store.js`:

```yaml
---
tags: ["work","personal"]
---
```

The `tags` field is parsed as JSON. Stored as `block.tags` (string array).

### Sidebar population

`SelectionManager.renderContextSidebar()` collects all unique tags across blocks via `getAllContextTags()`, merges with currently selected tags (to preserve selections for renamed/deleted blocks), sorts alphabetically, and renders `.tag-radio-option` elements.

### User tags vs computed tags

| Aspect | User Tags | Computed Tags |
|--------|-----------|---------------|
| Source | `block.tags` from frontmatter | Derived from block content at runtime |
| IDs | Arbitrary strings (`"work"`, `"project"`) | Fixed set: `allTodos`, `openTodos`, etc. |
| Sidebar | Dynamic, rebuilt on tag count update | Static HTML in `index.html` |
| Filter logic | `block.tags.includes(tag)` | Custom per-tag logic |
| Detection | `!isComputedContextTag(tag)` | `computedContextTags.includes(tag)` |

---

## Contact System

### @mention extraction

`ContactHelper` (`js/utils/contactHelper.js`) extracts contacts from two patterns:

1. **@mentions**: `/(?:^|\s)@([a-zA-Z0-9_]+)(?!\S)/g` — matches `@username` at word boundaries, excludes emails
2. **Assignee badges**: `/\[assignee::\s*([^\]]+)\]/g` — matches `[assignee:: name]` in task text

`extractContacts(content)` returns the union as a `Set` of lowercase usernames.

### Store.contacts Map

`Store.contacts` is a `Map<string, Set<string>>` mapping each username to their associated tags:

```js
// Built by Store.extractContacts()
contacts: {
    "alice" => Set { "work", "project" },
    "bob" => Set { "personal" }
}
```

This enables context-aware sorting: when context tags are selected, contacts sharing those tags rank higher.

### Contact filtering

`ContactHelper.hasContact(content, name)` checks both mentions and assignee badges. Used in `Store.getFilteredBlocks()` to filter blocks by contact.

`ContactHelper.hasTaskContact(task, name)` checks task-level badges and mentions in the task's `originalText`.

`ContactHelper.hasEventContact(event, name)` wraps task contact checking for timeline events.

### Contact sidebar rendering

`SelectionManager.renderContactsSidebar()`:

1. Sorts contacts by context relevance (matching tags first, then alphabetically)
2. Sets opacity to `0.4` for contacts not matching any active context tag
3. Renders `.tag-radio-option` elements with `@username` labels

---

## Time Filtering

`TimeFilter` (`js/utils/timeFilter.js`) provides `checkTimeFilter(date, selection)`:

| Selection | Logic |
|-----------|-------|
| `''` | Always passes |
| `'today'` | `date.toDateString() === now.toDateString()` |
| `'thisWeek'` | `date >= startOfWeek` (Sunday midnight) |
| `'thisMonth'` | `date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()` |

The date property used is configurable via `Store.timeProperty` (defaults to `'lastUpdated'`).

### Tag count dimming

`SelectionManager.updateTagCounts()` scans blocks to compute boolean flags (`hasToday`, `hasThisWeek`, `hasThisMonth`) and sets opacity `0.4` on time filter options with no matching blocks.

---

## Modal System

`Modal` (`js/utils/modal.js`) provides three factory functions.

### Modal.create(options)

Returns an object with `element`, `close()`, `querySelector()`, `querySelectorAll()`.

| Option | Type | Description |
|--------|------|-------------|
| `title` | string | Header title |
| `content` | string | HTML body |
| `headerContent` | string | Custom header HTML (overrides title + close button) |
| `width` | string | Inline width style |
| `overlayClass` | string | CSS class for overlay backdrop |
| `modalClass` | string | CSS class for modal panel |
| `onClose` | Function | Callback on close |

**DOM structure**:

```html
<div class="tag-modal-overlay">
  <div class="tag-modal">
    <div class="tag-modal-header">
      <h3>{title}</h3>
      <button class="close-modal">&times;</button>
    </div>
    <div class="tag-modal-body">{content}</div>
  </div>
</div>
```

Close triggers: close button click, overlay background click, or `modal.close()`.

### Modal.confirm(options)

Returns `Promise<boolean>`. Confirm dialog with Cancel/Confirm buttons.

### Modal.prompt(options)

Returns `Promise<string|null>`. Text input dialog with Enter/Escape handling.

### Common modal patterns

| Modal | Trigger | Purpose |
|-------|---------|---------|
| Tag modal | `App.showTagModal(blockId)` | Multi-select tags for a block |
| Assignee modal | `App.showAssigneeModal(onSelect, tags)` | Select or create assignee |
| Content modal | `App.showBlockContentModal(blockId)` | Full CodeMirror editor in modal |
| New note modal | `App.showNewNoteModal()` | Create note from non-document views |
| Sort config | `SortManager.openSortModal(view, onChange)` | Multi-clause sort configuration |
| Kanban edit | `KanbanView.showEditModal(task, block)` | Edit task metadata |
| History | `HistoryView.openHistory(blockId)` | Version browser with diff |
| Timeline diff | `TimelineView.openDiffModal(...)` | Diff view for timeline events |

---

## Sidebar

### Structure (`index.html`)

```
aside#sidebar
  div.app-header          — Logo, undo/redo, theme toggle
  div.sidebar-scroll      — Scrollable area
    section: View selector   (Document, Timeline, Kanban)
    section: Search input    (#searchInput, 300ms debounce)
    section: Sort            (Configure button)
    section: Filter groups
      div.tag-group: Time    (All, Today, This Week, This Month)
      div.tag-group: Tags    (dynamic, from renderContextSidebar)
      div.tag-group: Computed Tags (static HTML)
      div.tag-group: People  (dynamic, from renderContactsSidebar)
  div.sidebar-footer      — Settings link

aside#sidebarRight (mobile only)
  div.app-header          — "Details" heading
  div.sidebar-scroll      — Content placeholder (empty)
```

### Tag counts and dimming

`SelectionManager.updateTagCounts()` is called after every block save, delete, and initialization:

1. Scans all blocks to compute tag counts and boolean flags for computed categories
2. Rebuilds context sidebar via `renderContextSidebar()`
3. Iterates all `.tag-radio-option` elements, sets `opacity: 0.4` for options with zero matching blocks (unless currently selected)
4. Updates contacts sidebar via `renderContactsSidebar()`

### Search

The search input uses a 300ms debounce (from `js/utils/common.js`). Empty searches trigger immediate render. Filtering matches against both `block.content` and `block.tags` (case-insensitive).

---

## Theme System

`ThemeManager` (defined in `js/main.js` line 957):

### Initialization

1. Reads `localStorage` key `noteview-theme`
2. Falls back to OS preference via `window.matchMedia('(prefers-color-scheme: dark)')`
3. Calls `setTheme(theme)`

### setTheme(theme)

```js
document.documentElement.setAttribute('data-theme', theme);
localStorage.setItem('noteview-theme', theme);
```

### CSS variable switching

`css/base.css` defines two variable sets:
- Light: under `:root`
- Dark: under `:root[data-theme="dark"]`

All components reference CSS variables (`var(--bg-primary)`, `var(--text-primary)`, etc.) — no hardcoded colors.

---

## Mobile & Responsive

### CSS breakpoints

At `max-width: 768px` (`css/layout.css`):
- Left sidebar becomes fixed-position, hidden off-screen (`left: -280px`)
- Right sidebar (`#sidebarRight`) slides from the right (`right: -280px`)
- `.sidebar-open` class animates either sidebar into view with 0.3s ease
- Semi-transparent overlay appears
- `body.sidebar-open` prevents background scrolling
- View container padding reduced from `2rem` to `1rem`
- Sort config rows switch to single-column layout

### Touch swipe gestures

Implemented in `App.setupEventListeners()`. Both sidebars share one overlay and only one can be open at a time.

**Left sidebar (swipe right):**
- Zone 10–50px from left edge: any right-swipe >50px opens it
- Zone 50–120px from left edge: opens if swipe distance >80px (forgiving)
- Zone 0–10px is ignored to avoid conflicting with OS back gesture
- Left-swipe while open closes it

**Right sidebar (swipe left):**
- Same zone logic mirrored from the right edge
- Swipe left from right edge (10–50px: any swipe; 50–120px: needs >80px distance)
- Right-swipe while open closes it

Both gestures require minimum 50px horizontal distance and max 30px vertical variance. Overlay click closes whichever sidebar is open.
