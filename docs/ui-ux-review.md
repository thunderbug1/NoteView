# UI/UX Diligent Review — NoteView

> Review date: 2026-04-26
> Branch: `main` (commit dfd5993, clean working tree)

---

## Summary

The app has a solid design foundation — clean visual hierarchy, consistent spacing, good theme system, and well-structured CSS. However, there are significant issues in **accessibility**, **mobile touch support**, **destructive action safety**, and **error surfacing** that should be addressed.

---

## CRITICAL — Data loss / broken experience

### 1. Delete note in document view has zero confirmation

- **File:** `js/views/document.js:652`
- **Severity:** Critical
- Clicking "Delete note" from the 3-dot overflow menu immediately calls `App.deleteBlock(blockId)`. No confirmation dialog. One misclick and a note is gone.
- The kanban view does this correctly (`kanban.js:471` uses `Modal.confirm`), but the document view does not.
- **Suggested fix:** Wrap the delete call in `Modal.confirm('Delete this note permanently?', ...)` matching the kanban pattern.

### 2. Emptying an existing note auto-deletes on blur without confirmation

- **File:** `js/views/document.js:2739`
- **Severity:** Critical
- If a user accidentally clears all content from an existing note and clicks away, the note is silently deleted. While reasonable for newly-created empty blocks, this also destroys existing notes with no confirmation.
- **Suggested fix:** Only auto-delete if the block was created in the current session (track a `isNew` flag) or if the block had no prior content on disk. For existing notes, show a confirmation.

### 3. File write failures not surfaced to user

- **File:** `js/store.js:1298` and `js/views/document.js:3373`
- **Severity:** Critical
- `Store.saveBlock` rolls back in-memory state on write failure and re-throws, but the debounced save in `scheduleSave` has no `.catch()` handler. The save indicator stays at "saving..." permanently with no error feedback.
- **Suggested fix:** Add a `.catch(err => { saveIndicator.textContent = 'Save failed'; Common.showToast('Save failed: ' + err.message); })` in `scheduleSave`.

### 4. `App.deleteBlock` has no error handling

- **File:** `js/main.js:912`
- **Severity:** Critical
- `await Store.deleteBlock(id)` is called without try/catch. If file deletion fails, the error propagates unhandled and the block remains in an inconsistent in-memory state.
- **Suggested fix:** Wrap in try/catch, show a toast on failure, and leave the block in the array if deletion fails.

---

## MAJOR — Broken or missing features

### 5. No focus trap in modals (WCAG failure)

- **File:** `js/utils/modal.js:17-76`
- **Severity:** Major
- No `role="dialog"`, no `aria-modal="true"`, no focus trap. Keyboard users can Tab out of any modal into background content. This is a WCAG 2.1 AA violation.
- **Suggested fix:** Add `role="dialog"` and `aria-modal="true"` to the overlay div. Add a `keydown` listener that traps Tab/Shift+Tab within the modal. Register an Escape handler that calls `close()`.

### 6. No focus restoration on modal close

- **File:** `js/utils/modal.js:52-55`
- **Severity:** Major
- After closing any modal, focus is lost. Keyboard-only users have no idea where focus went.
- **Suggested fix:** Record `document.activeElement` on open, restore focus on close via `previouslyFocused.focus()`.

### 7. Kanban cards are not keyboard accessible

- **File:** `js/views/kanban.js:336`
- **Severity:** Major
- Cards are `<div draggable="true">` with click handlers but no `role="button"`, no `tabindex="0"`, and no Enter/Space activation. Keyboard users cannot open or interact with any kanban card.
- **Suggested fix:** Add `role="button" tabindex="0"` and a `keydown` handler that fires on Enter/Space.

### 8. Context menus have no keyboard navigation

- **File:** `js/menus/taskMenus.js:27` and `js/views/kanban.js:904, 999`
- **Severity:** Major
- Task menus, priority menus, and date menus have no `role="menu"`, no `role="menuitem"`, no `tabindex` on items, no arrow-key navigation, and no Escape-to-close. Keyboard-only interaction is impossible.
- **Suggested fix:** Add appropriate ARIA roles and a keyboard handler that supports ArrowUp/Down navigation, Enter to select, and Escape to close.

### 9. Hover-only buttons invisible on touch devices

- **Files:** `css/views/document.css:493, 536, 590, 644` and `css/views/kanban.css:59, 167`
- **Severity:** Major
- Block menu, task toggle, collapse, mic, AI, kanban add-task, and kanban action buttons all have `opacity: 0` / `display: none` and only appear on `:hover`. On touch devices (tablets above 768px), these features are completely invisible and undiscoverable.
- **Root cause:** The app uses `@media (max-width: 768px)` to detect "mobile" but never uses `@media (hover: hover)` or `@media (pointer: fine)`.
- **Suggested fix:** Use `@media (hover: hover)` to guard hover-dependent visibility. For `hover: none` devices, always show action buttons or reveal them on first tap (long-press or toggle).

### 10. Viewport meta missing `viewport-fit=cover`

- **File:** `index.html:5`
- **Severity:** Major
- `<meta name="viewport" content="width=device-width, initial-scale=1.0">` lacks `viewport-fit=cover`. This means all `env(safe-area-inset-*)` values in CSS evaluate to 0 on notched iPhones, undermining the safe-area handling already coded in multiple places.
- **Suggested fix:** Change to `content="width=device-width, initial-scale=1.0, viewport-fit=cover"`.

---

## MINOR — Edge cases, polish

### 11. No empty state for zero blocks / zero search results

- **File:** `js/views/document.js:60-115`
- **Severity:** Minor
- When all blocks are filtered out or search returns nothing, only the "new note" placeholder is shown. No "No notes match your filters" or "No results for 'query'" message.
- **Suggested fix:** After the new-block placeholder, add an empty-state div when `blocks.length === 0` that includes the search query if active.

### 12. No empty state for kanban with zero tasks

- **File:** `js/views/kanban.js:121-156`
- **Severity:** Minor
- Five empty columns with "(0)" counts but no guidance text.
- **Suggested fix:** Add a centered message above the board: "No tasks found. Create one with the + button on any column."

### 13. Sidebar edge swipe zones only 8px wide

- **File:** `css/layout.css:397`
- **Severity:** Minor
- The primary mobile navigation mechanism requires tapping an 8px strip at the screen edge. Far below the 44px minimum touch target.
- **Suggested fix:** Increase to at least 20px and add a subtle visual indicator (gradient fade) to make the zone discoverable.

### 14. FAB overlaps select action bar on narrow screens

- **File:** `css/components.css:1297` (select bar at `bottom: 2rem`) and `css/components.css:1089` (FAB at `bottom: 2rem; right: 2rem`)
- **Severity:** Minor
- Both fixed at the same bottom position. The select bar is visually obscured by the FAB.
- **Suggested fix:** Hide the FAB when select mode is active (set `display: none` on the FAB when `.select-action-bar` is visible).

### 15. FAB missing safe-area-inset-bottom

- **File:** `css/components.css:1089`
- **Severity:** Minor
- `bottom: 2rem` with no `env(safe-area-inset-bottom)`. On notched phones the FAB overlaps the home indicator.
- **Suggested fix:** `bottom: calc(2rem + env(safe-area-inset-bottom, 0px))`.

### 16. Mobile toolbar has no safe-area handling

- **File:** `css/views/document.css:991`
- **Severity:** Minor
- Fixed full-width toolbar with no `safe-area-inset-left`/`right`/`bottom` padding.
- **Suggested fix:** Add `padding-left: env(safe-area-inset-left, 0); padding-right: env(safe-area-inset-right, 0); padding-bottom: env(safe-area-inset-bottom, 0);`.

### 17. Multiple undersized touch targets

- **Severity:** Minor
- **Files and elements:**
  - `css/layout.css:332` — toolbar buttons (~30x28px)
  - `css/views/kanban.css:185` — kanban action buttons (~20x20px)
  - `css/views/document.css:493` — block-menu-btn (~24x24px)
  - `css/views/document.css:536` — task-toggle-btn (~24x24px)
  - `css/views/document.css:590` — collapse-btn (~24x24px)
  - `css/views/document.css:644` — mic-btn (~24x24px)
  - `css/views/ai.css:6-18` — ai-btn (~24x24px)
  - `css/components.css:1139` — icon-btn (~28x28px)
  - `css/components.css:155` — sort-config-btn (30x30px)
  - `css/components.css:1437` — select-action-btn on mobile (36x36px)
  - `css/components.css:453` — add-tag-btn (~16x16px)
  - `css/views/kanban.css:425` — kanban-swimlane-collapse (~10x10px)
  - `css/views/document.css:1320` — doc-group-collapse (~16x16px)
  - `css/views/timeline.css:88` — tl-collapse-btn (~20x20px)
- All below the 44x44px minimum recommended by Apple HIG and WCAG.
- **Suggested fix:** Add `min-width: 44px; min-height: 44px` to interactive buttons on mobile via a shared breakpoint rule, or use larger hit areas with `::after` pseudo-element expanders.

### 18. Toast system has no type differentiation

- **File:** `js/utils/common.js:196`
- **Severity:** Minor
- All toasts look identical whether they convey success, error, or info. No color variants.
- **Suggested fix:** Add a `type` parameter (`'success' | 'error' | 'info'`) and apply background color variants (green/red/blue).

### 19. Toasts replace each other instantly

- **File:** `js/utils/common.js:197`
- **Severity:** Minor
- `document.querySelectorAll('.nv-toast').forEach(t => t.remove())` — if two rapid operations fire, the first toast disappears unread.
- **Suggested fix:** Stack toasts vertically or queue them so each gets its full display duration.

### 20. Inconsistent confirm dialogs

- **Files:** `js/views/settings.js:362, 435, 948`, `js/syncManager.js:282, 305`
- **Severity:** Minor
- Some destructive actions use `confirm()` (browser native), others use `Modal.confirm()`, and one uses `alert()`. Should standardize to `Modal.confirm()`.
- **Suggested fix:** Replace all `confirm()` and `alert()` calls with `Modal.confirm()` or `Common.showToast()`.

### 21. Git commit failure after deletion silently swallowed

- **File:** `js/store.js:872-876`
- **Severity:** Minor
- Only logged to console. User not notified of potential sync inconsistency.
- **Suggested fix:** Surface via `Common.showToast('Git commit failed after deletion. Your changes may not sync.', { type: 'error' })`.

### 22. Close button has no accessible name

- **File:** `js/utils/modal.js:39`
- **Severity:** Minor
- `<button class="close-modal">&times;</button>` — screen readers announce "multiplication sign" or nothing.
- **Suggested fix:** Add `aria-label="Close"`.

### 23. Assignee clear and tag modal items use `<div>` as buttons

- **Files:** `js/modals/assigneeModal.js:35`, `js/modals/tagModal.js:441`
- **Severity:** Minor
- Clickable `<div>` elements without `role="button"`, `tabindex`, or keyboard handlers.
- **Suggested fix:** Change to `<button>` elements or add `role="button" tabindex="0"` and Enter/Space keydown handlers.

### 24. Kanban swimlane collapse button has no aria-label

- **File:** `js/views/kanban.js:239`
- **Severity:** Minor
- Only contains `&#9654;` / `&#9660;` arrow characters. No accessible name.
- **Suggested fix:** Add `aria-label="Expand/Collapse group"` and `aria-expanded="true/false"`.

### 25. Block metadata bar invisible on mobile touch

- **File:** `css/views/document.css:69-108`
- **Severity:** Minor
- On mobile, the metadata bar has `opacity: 0; height: 0` and only appears on `:hover` or `:focus-within`. The mobile override (line 1261-1267) makes it `position: relative` but does NOT override the opacity/height, so tags and dates remain invisible.
- **Suggested fix:** In the mobile media query, add:
  ```css
  .document-view .block .block-metadata {
      opacity: 1;
      height: auto;
      padding: 0.25rem 0.5rem;
  }
  ```

### 26. Kanban card sticky hover on touch

- **File:** `css/views/kanban.css:99`
- **Severity:** Minor
- `transform: translateY(-2px)` on `:hover` creates a "stuck" elevated state on touch devices.
- **Suggested fix:** Guard with `@media (hover: hover)`:
  ```css
  @media (hover: hover) {
      .kanban-card:hover { transform: translateY(-2px); }
  }
  ```

---

## Accessibility Audit Summary

| Category | Finding | File | Line(s) |
|----------|---------|------|---------|
| No modal role/aria-modal | Missing ARIA on all modals | `js/utils/modal.js` | 29 |
| No focus trap in modals | Keyboard can escape modals | `js/utils/modal.js` | 17-76 |
| No focus restore on modal close | Focus lost after closing any modal | `js/utils/modal.js` | 52-55 |
| Close button no aria-label | Screen reader reads "multiplication sign" | `js/utils/modal.js` | 39 |
| No Escape in generic modal | Only `createPrompt` handles Escape | `js/utils/modal.js` | 17-76 |
| Task menu: no role, no keyboard nav | Entirely mouse-dependent | `js/menus/taskMenus.js` | 27-103 |
| Priority menu: no role, no keyboard nav | Entirely mouse-dependent | `js/menus/taskMenus.js` | 114-180 |
| Date menu: no role, no Escape | No keyboard support | `js/views/kanban.js` | 893-983 |
| Priority menu: no role, no Escape | No keyboard support | `js/views/kanban.js` | 988-1031 |
| Swimlane collapse: no aria-label/expanded | No accessible name | `js/views/kanban.js` | 239 |
| Kanban cards not keyboard accessible | No role, tabindex, or key handler | `js/views/kanban.js` | 336 |
| Kanban badges not keyboard accessible | Clickable spans with no role/tabindex | `js/views/kanban.js` | 343 |
| Assignee clear div not keyboard accessible | Div acting as button | `js/modals/assigneeModal.js` | 35 |
| Tag modal items divs, no role/tabindex | Div acting as buttons | `js/modals/tagModal.js` | 441, 452 |
| Modal overflow listener leak on modal close | Document click listener not cleaned up | `js/main.js` | 1244 |
| No focus sent to confirm dialog buttons | Confirm buttons never receive focus | `js/utils/modal.js` | 87-118 |
| Kanban toggle no aria-pressed | Toggle state not communicated | `js/views/kanban.js` | 114 |

---

## Mobile Responsive Audit Summary

| Category | Finding | File | Line(s) |
|----------|---------|------|---------|
| Viewport meta missing viewport-fit=cover | Safe-area insets evaluate to 0 | `index.html` | 5 |
| Sidebar edge zones only 8px wide | Below 44px touch target minimum | `css/layout.css` | 397 |
| Toolbar buttons undersized (~30x28px) | No min-height/min-width | `css/layout.css` | 332-343 |
| Kanban action buttons tiny (~20x20px) | No min-height/min-width | `css/views/kanban.css` | 185-194 |
| Kanban add-task button hidden on tablets | Hover-only, breakpoint too narrow | `css/views/kanban.css` | 59-74 |
| Block action buttons invisible on touch | Hover-only, no fallback | `css/views/document.css` | 493-567 |
| Block metadata bar invisible on mobile | Opacity/height not overridden | `css/views/document.css` | 69-108 |
| Collapse button positioned off-screen on mobile | `left: -1.75rem` unreachable | `css/views/document.css` | 604 |
| Mobile toolbar overlaps FAB | Same z-index (1000) | `css/views/document.css` | 991-1004 |
| Select action bar overlaps FAB | Same bottom position | `css/components.css` | 1297-1312 |
| FAB missing safe-area-inset-bottom | Overlaps home indicator | `css/components.css` | 1089 |
| Mobile toolbar no safe-area padding | Content clipped on notched phones | `css/views/document.css` | 991 |
| Left sidebar no bottom safe-area | Footer clipped by home indicator | `css/layout.css` | 419-430 |
| Kanban sticky hover on touch | translateY gets stuck | `css/views/kanban.css` | 99-103 |
| No @media (hover:hover) used anywhere | Systemic touch device gap | All CSS files | — |

---

## Empty / Loading / Error State Audit Summary

| Category | Finding | File | Line(s) |
|----------|---------|------|---------|
| No empty state for filtered blocks | Just shows empty editor area | `js/views/document.js` | 60-115 |
| No empty state for kanban zero tasks | Five empty columns, no guidance | `js/views/kanban.js` | 121-156 |
| No search results empty state | No "No results for query" message | `js/views/document.js` | 60-115 |
| Save failure not surfaced to user | Save indicator stuck at "saving..." | `js/store.js` / `js/views/document.js` | 1298, 3373 |
| Delete failure not caught | Error propagates unhandled | `js/main.js` | 912 |
| Git commit failure silently swallowed | Console log only | `js/store.js` | 872-876 |
| AI dictation has no cancel during processing | Locked state, no escape | `js/ai.js` | 1504-1518 |
| Force push failure uses alert() | Inconsistent with toast pattern | `js/syncManager.js` | 305 |
| Toast no type differentiation | All toasts look the same | `js/utils/common.js` | 196 |
| Toasts replace each other instantly | First toast disappears unread | `js/utils/common.js` | 197 |
| Settings uses native confirm() | Inconsistent with Modal.confirm | `js/views/settings.js` | 362, 435, 948 |
| Force push uses native confirm() | Inconsistent with Modal.confirm | `js/syncManager.js` | 282 |

---

## Recommended Fix Priority

| Priority | Finding | Effort |
|----------|---------|--------|
| 1 | #1 + #2: Add confirmation before deleting notes | Small |
| 2 | #3 + #4: Surface write/delete errors to the user | Small |
| 3 | #10: Add `viewport-fit=cover` to viewport meta | One line |
| 4 | #9: Use `@media (hover: hover)` for hover-only elements | Medium |
| 5 | #25: Override metadata bar opacity on mobile | Small |
| 6 | #5-8: Add basic modal and menu keyboard accessibility | Medium |
| 7 | #22-24: Add aria-labels to icon-only buttons | Small |
| 8 | #14-16: Safe-area and FAB overlap fixes | Small |
| 9 | #11-12: Empty state messages | Small |
| 10 | #17: Enlarge touch targets on mobile | Medium |
| 11 | #18-20: Toast improvements and confirm dialog consistency | Small |
