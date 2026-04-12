# CodeMirror 6 Editor System

This document covers how NoteView integrates CodeMirror 6 for markdown editing — from CDN loading to custom widgets, auto-save, and diff views.

---

## Loading & Initialization

### CDN Loading

CodeMirror modules load as ES modules in `index.html` (line 188):

```html
<script type="module">
    import {EditorView, basicSetup} from "https://esm.sh/codemirror";
    import {markdown} from "https://esm.sh/@codemirror/lang-markdown";
    import {languages} from "https://esm.sh/@codemirror/language-data";
    // ... more imports ...

    window.CodeMirror = { EditorView, basicSetup, Prec, keymap, markdown, ... };
    window.CodeMirrorReady = true;
    window.dispatchEvent(new Event('CodeMirrorReady'));
</script>
```

All CM6 modules are exported to `window.CodeMirror` for use by regular (non-module) scripts. The `CodeMirrorReady` event signals that the editor API is available.

### Ready Gate

`DocumentView.waitForCodeMirror()` returns a Promise that resolves immediately if `CodeMirrorReady` is already `true`, or waits for the event:

```js
async waitForCodeMirror() {
    if (window.CodeMirrorReady) return;
    return new Promise(resolve => {
        window.addEventListener('CodeMirrorReady', resolve, { once: true });
    });
}
```

Every view that uses CodeMirror calls `await this.waitForCodeMirror()` before creating editors.

---

## Editor Lifecycle

### Per-Block Editors

DocumentView manages a `Map<string, EditorView>` at `DocumentView.editors`:

- **Key**: Block ID (or `'new'` for the new-note placeholder, `'new-modal'` for the modal editor)
- **Value**: CodeMirror `EditorView` instance

### Creation

`DocumentView.createEditor(container, blockId, initialContent)` assembles extensions from helper methods and creates the EditorView:

1. Calls `createMentionCompletionSource(container)` for @-autocomplete
2. Calls `createLivePreviewPlugin()` for the decoration ViewPlugin
3. Calls `getEditorTheme()` (cached) for editor styling
4. Calls `createUpdateListener(container, blockId, handleContentChange)` for split-marker positioning and content change dispatch
5. Calls `createDomEventHandlers(container)` for paste and blur handling
6. Calls `createNewBlockKeymap(container, createNewBlock)` for Mod-Enter/Shift-Enter bindings
7. Creates the `EditorView` with all extensions
8. Stores the editor in `DocumentView.editors` and initial content in `DocumentView.originalContents`

### Destruction

Editors are destroyed during re-render. Since `DocumentView.render()` replaces `viewContainer.innerHTML`, all existing editor DOM elements are removed. Before that happens, any pending save timeouts are cleared.

### Main View vs Modal Editors

- **Main view editors**: Created during `DocumentView.render()` for each block card. One per block.
- **Modal editors**: Created in `App.showBlockContentModal()` and `App.showNewNoteModal()`. Use `'new-modal'` or the block ID as key. Destroyed when the modal closes.

---

## Custom Widgets

`js/widgets/codeMirrorWidgets.js` exports a factory `createCodeMirrorWidgets(documentView)` that returns widget classes. Each widget extends `CodeMirror.WidgetType` and replaces a range of text with a DOM element.

### CheckboxWidget

Replaces `- [x]`, `- [/]`, `- [b]`, `- [-]`, `- [ ]` with interactive styled checkboxes.

- **Left click**: Toggles between `[x]` (done) and `[ ]` (todo)
- **Right click**: Opens the task context menu (via `DocumentView.showTaskMenu()`)
- **CSS class**: `md-task-checkbox state-{todo|done|progress|blocked|canceled}`

### BadgeWidget

Replaces inline metadata like `[due:: 2026-04-15]` with styled badge chips.

Supported types with icons:
- `due` — Calendar icon
- `assignee` — Person icon, clicking opens `App.showAssigneeModal()`
- `priority` — Flag icon with color (urgent=red, high=orange, medium=blue, low=gray)
- `dependsOn` — Blocked icon, resolves `^task-id` to readable name
- `id` — Link icon

### LinkWidget

Replaces markdown links `[text](url)` with rendered `<a>` elements. Truncates long URLs intelligently using URL parsing.

### FencedBlockWidget

Collapses code blocks and log paste blocks exceeding the threshold (`fencedBlockThresholds: { lines: 12, chars: 800, previewLines: 6 }`).

Shows:
- Language/info label
- Line count
- First few lines as preview
- "Edit" button (focuses the block in the editor)
- "Open" button (opens a modal with the full block content)

### Action Widgets (AddDeadlineWidget, AddAssigneeWidget, AddPriorityWidget, AddDependencyWidget)

Small icon buttons appended to task lines that don't yet have the corresponding metadata. Each opens the appropriate picker:
- **AddDeadlineWidget**: Hidden `<input type="date">` that opens the browser calendar
- **AddAssigneeWidget**: Opens `App.showAssigneeModal()`
- **AddPriorityWidget**: Opens `DocumentView.showPriorityMenu()` (a positioned context menu)
- **AddDependencyWidget**: Opens a `prompt()` dialog for task ID input

All action widgets call `documentView.appendInlineField(view, from, to, fieldName, value)` to insert the badge text into the editor.

---

## Auto-Save Flow

Each editor registers an update listener via `DocumentView.createUpdateListener()`:

```
Editor update → debounce(1000ms) → compare content to original
  → if changed: App.saveBlockContent(blockId, newContent)
    → Store.saveBlock(block, { content })
      → write to disk
      → update contacts
      → invalidate caches
```

Key details:
- **Debounce**: 1 second after the last keystroke (managed via `DocumentView.saveTimeouts` Map)
- **Change detection**: Compares current doc content to `DocumentView.originalContents` for the block
- **Save indicator**: A `<span class="save-indicator">` next to each editor shows "saved" / "saving..." status

---

## Editor Focus Management

### focusEditor(blockId)

`DocumentView.focusEditor(id)` scrolls to the block's card and focuses the CodeMirror editor:

1. Finds the `.codemirror-container[data-id="${id}"]` element
2. Scrolls it into view
3. Gets the editor from `DocumentView.editors`
4. Calls `editor.focus()`

### focusNewBlock()

`DocumentView.focusNewBlock()` focuses the empty "new note" placeholder at the bottom of the document view.

### Click-to-deselect

`App.setupEventListeners()` attaches a mousedown handler on `#main` that blurs the active editor when clicking outside any `.cm-editor`:

```js
document.getElementById('main').addEventListener('mousedown', (e) => {
    const insideEditor = e.target.closest('.cm-editor');
    const onInteractive = e.target.closest('button, input, a, select');
    if (!insideEditor && !onInteractive) {
        e.preventDefault();
        document.activeElement?.blur();
    }
});
```

The `e.preventDefault()` is critical — without it, the browser repositions the CM cursor before blur fires (a two-click bug).

---

## Merge View (Diff)

### HistoryView diffs

`HistoryView.loadDiff(oid)` (`js/views/history.js`) creates a read-only CodeMirror editor with `unifiedMergeView`:

```js
new EditorView({
    doc: currentContent,
    extensions: [
        basicSetup,
        markdown({ codeLanguages: languages }),
        unifiedMergeView({
            original: previousContent,
            mergeControls: false
        }),
        EditorView.editable.of(false),
        EditorState.readOnly.of(true)
    ],
    parent: container
});
```

The current content is the main document; the selected historical version is shown as the "original" with insertions highlighted in green and deletions in red.

### TimelineView diffs

`TimelineView.openDiffModal()` works similarly but adds a toggle between "Diff" and "This Version" views. The diff editor is stored in `TimelineView.currentDiffEditor` and destroyed when the modal closes.

---

## Autocomplete (@mentions)

CodeMirror's `autocompletion` extension is configured in `DocumentView.createEditor()`. When the user types `@`, a completion popup suggests known contacts from `Store.contacts`:

```js
autocompletion({
    override: [(context) => {
        // Check if cursor is after @
        // Query Store.contacts for matches
        // Return completion options
    }]
})
```

Contact data comes from `Store.contacts` (a `Map<string, Set<string>>` mapping usernames to their associated tags).

---

## Key Bindings

Custom keymaps applied to editors:

- **Tab**: `indentWithTab` — inserts tab character (not focus change)
- **Escape**: Handled by modals for close, by CodeMirror for closing autocomplete
- **Ctrl+Enter**: In the new-note modal, triggers save

Undo/redo (`Ctrl+Z` / `Ctrl+Y`) is handled separately: when focus is inside a CodeMirror editor, CM handles its own undo; when focus is outside, `UndoRedoManager` handles app-level undo.

---

## Adding a New Widget

1. Create a class extending `WidgetType` in `js/widgets/codeMirrorWidgets.js` inside the `createCodeMirrorWidgets()` factory
2. Implement `toDOM(view)` to return a DOM element, `eq(other)` for update comparison, and `ignoreEvent()` for event handling
3. Add the decoration logic either in `DocumentView.buildDecorations()` (for fenced-block-level decorations) or as a new decorator method in `DocumentView._lineDecorators` (for line-level decorations). The `_lineDecorators` getter returns an array of bound methods called by `applyLineDecorations()`
4. Add any event handlers that dispatch editor changes via `view.dispatch()`
