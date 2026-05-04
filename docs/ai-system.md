# AI Assistant System

## Overview

The AI assistant is a **right-side chat panel** (`#aiPanel`) that slides in from the right edge of the viewport. It supports multiple concurrent chats, two explicit modes (Transform and Ask), and a per-chat context manager for adding notes. The panel is independent of the existing right sidebar (`#sidebarRight` — backlinks, deadlines).

## Architecture

### Panel Layout

```
#aiPanel (fixed, 400px, overlays main content)
├── .ai-panel-header        — Brand, settings gear, close button, "N awaiting review" badge
├── .ai-chat-tabs           — Scrollable tab bar, one per chat, + new chat button
├── .ai-chat-active         — Content of the selected tab
│   ├── .ai-chat-toolbar    — Model selector dropdown, Transform/Ask mode toggle
│   ├── .ai-context-section — Collapsible: context notes list, "Add visible", "Select notes..."
│   ├── .ai-chat-messages   — Scrollable message history
│   └── .ai-chat-footer     — Preset chips, textarea input, send/stop button
```

### Data Model

Each chat is an independent object:

```javascript
{
    id: 'chat-1',
    title: 'Summarize note...',       // Auto-set from first user message
    mode: 'transform',                 // 'transform' | 'ask'
    modelId: 'profile-123',            // Selected model profile
    contextBlockIds: Set(['note-id']), // Notes in context
    messages: [],                       // { id, role, content, type, ... }
    state: 'idle',                     // 'idle' | 'streaming' | 'awaiting_input' | 'error'
    abortController: null,             // Per-chat abort for streaming
    streamingResponse: '',             // Accumulated streaming text
    diffEditorView: null               // CodeMirror diff instance
}
```

Chats live in `AIAssistant._chats[]`. State is **vault-specific** — cleared on vault switch via `init()`. Not persisted across page reloads.

### State Transitions

```
idle → streaming       (user sends message)
streaming → idle       (Ask mode completes, or Transform produces no changes)
streaming → awaiting_input  (Transform produces a diff or batch results)
streaming → error      (API error)
awaiting_input → idle  (user accepts/rejects all diffs)
```

Tab status indicators:
- `idle`: no indicator
- `streaming`: spinner animation
- `awaiting_input`: **purple pulsing glow** (`ai-tab-pulse` keyframe)
- `error`: red dot

## Modes

### Transform Mode (default)

System prompt: "Return only the modified markdown. No code fences, no commentary."

- **Single note in context**: Response shows as an inline **diff card** with Accept/Reject buttons. Uses CodeMirror's `unifiedMergeView`. Accepting calls `Store.saveBlock()` with undo capture.
- **Multiple notes in context**: Response is parsed via `<<<NOTE:id>>>` markers. Shows as a **batch result card** with a compact status list. "Review all" opens the existing batch review modal.
- **No changes**: Shows "No changes detected" system message.

### Ask Mode

System prompt: "Answer the user's question based on the provided notes. Be concise."

- Response renders as markdown (via `marked.parse()` + `sanitizeHtml()`)
- No diff, no accept/reject
- Context notes included as reference material

## Context Manager

Each chat has its own `contextBlockIds` Set. Three ways to add notes:

1. **Per-block AI button** (document.js) — Creates a new chat with that block in context
2. **Selection mode AI button** (blockSelector.js) — Creates a new chat with all selected blocks
3. **Context section buttons** (inside the chat):
   - "Add visible notes" — adds all blocks from `Store.getFilteredBlocks()` (respects tag/search filters)
   - "Select notes..." — opens a checklist modal of all blocks

Context is a **snapshot at request time** — edits to a note after adding it to context are not reflected in the AI request.

## Entry Points

| Trigger | Action |
|---------|--------|
| Toolbar AI button | `togglePanel()` — opens/closes panel |
| `Ctrl+Shift+A` | `togglePanel(blockId)` — with focused note |
| `Ctrl+Shift+B` | `togglePanel()` — same as toolbar |
| Per-block AI button | `openPanel(blockId)` — new chat with note |
| Selection mode AI | `bulkSendToAI()` — new chat with selected notes |
| Settings gear (panel header) | `openSettingsModal()` |

## Concurrent Chats

Multiple chats can stream simultaneously. Each has its own `abortController` and `streamingResponse`. Switching tabs shows the correct chat state. Closing a tab aborts its in-flight request. Closing the panel does **not** cancel requests — they continue in the background.

## Message Types

| Role | Type | Description |
|------|------|-------------|
| `user` | — | Instruction text + context count badge |
| `assistant` | `streaming` | Real-time streaming text placeholder |
| `assistant` | `markdown` | Rendered markdown (Ask mode) |
| `assistant` | `diff` | Inline diff card with Accept/Reject (single-note Transform) |
| `assistant` | `batch` | Batch result card with "Review all" button (multi-note Transform) |
| `system` | `error` | Error message with optional retry button |
| `system` | `info` | "No changes detected", etc. |

## Batch Review

Multi-note transforms show a batch result card in the chat. Clicking "Review all" opens a modal that reuses the existing batch review UI:

- Left sidebar: list of notes with status indicators (pending, accepted, rejected, unchanged, error, new)
- Right panel: CodeMirror diff preview
- Actions: Accept/Reject individual or all
- New notes: accepted via `Store.createBlock()`
- Undo: batch operations create atomic undo commands via `UndoRedoManager`

## Settings

Accessible via:
- **Gear icon** in panel header → `AIAssistant.openSettingsModal()` → `SettingsView.openAISettingsModal()`
- **Settings view** in the sidebar

The settings modal includes:
- Master enable/disable toggle
- Model profiles CRUD (name, endpoint URL, API key, model name)
- **Test Connection** button (sends minimal request to verify endpoint/key)
- Manage Presets button (opens preset management modal)
- Import from Vault button (copies AI config from another vault)

Profile editing uses `Modal.create()` instead of inline expansion.

## Capture View AI (Independent)

The mobile capture view (`js/views/capture.js`) has its own AI flow for formatting/interpreting dictated text. It calls `AIAssistant._processWithAI()` directly with non-streaming requests. This is completely independent of the chat panel and not affected by it.

## CSS Variables

AI-specific variables in `css/base.css`:

```css
--ai-accent: #8b5cf6;          /* Purple — distinct from blue --accent */
--ai-accent-light: rgba(139, 92, 246, 0.1);
```

Also added semantic colors:
```css
--danger: #ef4444;              /* Red — for errors, reject buttons */
--success: #22c55e;             /* Green — for accept buttons, success states */
```

Dark theme variants provided for all.

## Files

| File | Purpose |
|------|---------|
| `js/ai.js` | AIAssistant module — panel lifecycle, multi-chat, streaming, diff, batch |
| `css/views/ai.css` | Panel CSS, chat styles, diff cards, batch cards, animations, dark theme, mobile |
| `css/base.css` | `--ai-accent`, `--danger`, `--success` CSS variables |
| `index.html` | `#aiPanel` element, `#aiPanelOverlay` (mobile) |
| `js/main.js` | Toolbar button wiring, keyboard shortcuts, panel close on settings view |
| `js/views/document.js` | Per-block AI button → `openPanel(blockId)` |
| `js/blockSelector.js` | Selection mode AI → `bulkSendToAI()` creates new chat |
| `js/views/settings.js` | `openAISettingsModal()`, `_showProfileFormInContainer()` with Test Connection |
| `js/views/capture.js` | Independent AI for dictate (not connected to panel) |
