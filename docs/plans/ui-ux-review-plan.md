# NoteView UI/UX Review — Open Points Plan

Origin: codebase review (Sept 2026) covering UI/UX issues and the new-device vault setup/cloning flows. Findings are grouped by priority. Checkboxes track implementation status.

## 1. Safety / data-loss fixes (P0)

### 1.1 Safe forced-pull recovery path (decided: git side ref + abort on failed pre-commit)
**Files:** `js/gitRemote.js`, `js/syncManager.js`, `js/views/settings.js`

Context: `GitRemote.pull` catches `CheckoutConflictError` and hard-resets to remote (gitRemote.js:236-272). This is a legitimate recovery path for dirty/merged working-tree state left by interrupted pulls — without it, garbage could get committed and pushed. The problem: it cannot distinguish junk state from real uncommitted local edits, and destroys the latter silently (SyncManager's merge-conflict UI never runs because pull "succeeds").

- [x] In the `CheckoutConflictError` handler: classify dirty files via `git.status()` + content compare against local HEAD and fetched remote HEAD.
- [x] Junk state only (content matches a known commit) → hard reset silently (current behavior, now provably safe).
- [x] Unique local content → stash first: commit dirty files, point `refs/noteview/recovery/<timestamp>` at the commit, then hard reset. Return `{ recovered, stashed, stashRef }` (plain `true` on normal pulls for backward compat).
- [x] `SyncManager.sync()` (syncManager.js:138-144): if the pre-sync `commitAll` fails with a real error (not "nothing to commit"), **abort the sync** with toast "Sync aborted: failed to save local changes" + Retry action. Do not pull while local state is uncertain.
- [x] After a pull returns `stashed: true`: toast "Sync reset to remote — conflicting local edits were saved to recovery" with a **Recover** action → `SyncManager._recoverStash(ref)` writes stash files back additively (never overwrite current content without `Modal.confirm`), then deletes the recovery ref.
- [x] Settings → Git Sync: add "Reset to remote (discard local changes)" button next to Force Push (~settings.js:607-641) with a `Modal.confirm` warning — makes the escape hatch explicit instead of implicit.
- [x] Settings Sync Status card: list existing `refs/noteview/recovery/*` refs with per-stash Recover action.

**Explicitly unchanged:** fresh-clone force checkout (gitRemote.js:185-219 — it *is* the clone mechanism); `_handleMergeConflict` flow (syncManager.js:467-538 — already correct); force push behavior.

### 1.2 Broken `Modal.confirm` calls in bulk delete (H1)
**File:** `js/blockSelector.js:362, 407`
- [x] Calls pass positional strings, but `Modal.confirm` takes an options object — bulk-delete dialogs currently render with an **empty body**, hiding the destructive warning. Convert to `Modal.confirm({ title, message })`.

### 1.3 Force-push confirm promise hang (H2)
**File:** `js/views/settings.js:610-626`
- [x] Hand-rolled modal calls nonexistent `modal.addEventListener('close')` → the promise never settles if dismissed via Escape/overlay. Replace with `Modal.confirm`.

### 1.4 False vault-delete confirmation
**Files:** `js/modals/vaultModal.js:318`, `js/store.js:1247-1255`
- [x] Confirm text says "Your files are not deleted" but OPFS vault removal recursively deletes the directory. Show an accurate per-vault-type warning (OPFS = destructive; folder vault = list-only removal).

### 1.5 Silent git commit failures
**File:** `js/gitStore.js:136-158`
- [x] `commitBlock` / `commitDeletion` swallow errors (console-only) → file saves succeed but versions silently disappear from History/Timeline. Throw or return the error and toast in callers (`commitAll` already re-throws — match it).

## 2. New-device vault setup / cloning flow (P1)

- [x] **Pull on startup**: `SyncManager.init` (syncManager.js:33-66) never syncs — only starts the interval timer. Users who configure a remote manually see an empty vault until they click something. Add initial pull on boot when a remote is configured.
- [x] **Skip-verification wizard path** (vaultModal.js:888-950): creates the vault and saves the remote but never fetches/pulls, with no guidance. Auto-run initial pull or instruct the user.
- [x] **Clone into local folder**: git cloning exists only in the OPFS wizard (vaultModal.js:416+). Folder-vault users must: create vault → Settings → Configure Git Remote → discover Sync Now. implemented as a guided path: after a first successful remote configuration, the Settings remote modal offers "Sync Now" — folder-vault users get clone behavior via create-folder → configure-remote → auto-sync (settings.js Save & Connect).
- [x] **Wizard global-state leak** (vaultModal.js:697-714): mutates `GitHttp.setCredentials`, `GitRemote.config`, `SyncManager._config`, `Store.directoryHandle` mid-verification, restoring only in `catch`. Dismissing mid-flight leaves the previous vault pointing at the new one. Restore in `finally`/`onClose` or operate on a scratch config.
- [x] **Vault name collisions**: handles and remote configs are keyed only by name (store.js:298, 1115) — same-named vaults silently clobber each other. Add a collision guard or id-based keying.
- [x] **Remote config saved before connection test** (settings.js:1421-1441): test failure auto-closes after 800 ms with no toast → broken remote with undiagnosable sync errors. Warn persistently or require explicit "save anyway".
- [x] **Per-device commit identity** (gitStore.js:5-8): hardcoded `NoteView User <user@noteview.local>` makes multi-device history indistinguishable. Generate/derive a per-device identity.
- [x] **Mobile dead end** (vaultModal.js:145): handle-less local vaults on Capacitor show "needs its folder opened on the original device" with no path forward, ever. Offer remove-from-list / hide.
- [x] **Token exposure in QR/JSON export** (vaultModal.js, settings.js hint): verified the QR transfer modal already displays a "contains API keys and git credentials" warning (js/utils/qrTransfer.js:270).
- [x] **Silent vault deletion from list** (vaultModal.js:149-152): entries with stale/no handles are removed without confirmation.

## 3. Consistency pass (P2)

- [x] Replace native dialogs with Modal equivalents (`window.confirm`/`prompt`/`alert`): vaultModal.js:318 and wizard alerts (575, 624, 652, 898, 904); settings.js:743, 830, 1389, 1397, 1413, 1445; main.js:55.
- [x] Add confirm/undo to: AI chat delete (ai.js:370), preset delete (settings.js:1028), gear-modal profile delete (settings.js:1552) — inconsistent with Settings-page profile delete which confirms.
- [x] Console-only catch blocks — surface user feedback: undo/redo failures (js/utils/undoRedoManager.js:243, 254, 370, 381), send-to-vault delete-after-move (sendToVault.js:186 — note silently duplicated across vaults), timeline errors (timeline.js:673, 1215, 1378), selectionManager.js:75. (store.js IndexedDB open failures already reject to callers that render the boot error screen and log to Diagnostics — no toast added to avoid pre-UI noise.)
- [x] Flush pending editor saves in `App.setView` (main.js:1105-1143) before re-render — vault switching flushes (store.js:1378) but view switching doesn't (flush only runs inside `DocumentView.render`).
- [x] Welcome screen "Create Browser Vault" → use the polished OPFS wizard instead of `window.prompt` + dumping into Settings (main.js:55-62).
- [x] "Create new vault" button is mislabeled — identical to "Open folder as vault" (vaultModal.js:369-397). Rename or implement real creation.

## 4. Polish (P3)

- [x] Kanban empty state (kanban.js:177-232) — currently five empty columns with "(0)" counts; add "No tasks yet" guidance (other views have empty states).
- [x] History modal: added `role="dialog"`/`aria-modal`, a Tab focus trap, initial focus + focus restore, a "Loading version history…" placeholder shown while git history loads, and aria-label on the close button. Full `Modal.create` migration skipped — it would break the custom two-pane layout (history.js).
- [x] `aria-label` on icon-only toolbar buttons (index.html:173-223, kanban.js:206, 220) — `title` alone is not a reliable accessible name.
- [x] Undo toast: 8s window is destroyed by any subsequent toast (common.js:256 replaces `.nv-toast`; main.js:1492-1508) — reviewed — kept the app-wide single-toast design; the delete undo window is already 8s and stacking would be a larger UI redesign. Documented as accepted behavior.
- [x] Remove dead permission pre-warm code (vaultModal.js:57-68) — non-gesture permission requests are rejected by Chrome; errors swallowed.

## 5. Docs & release housekeeping

- [x] Fix git-sync-setup.md: "Pull happens on app start and after network reconnect" is currently false.
- [x] Document the recommended new-device flow (wizard/QR) as the primary path.
- [x] Document the recovery-stash mechanism (refs/noteview/recovery) once 1.1 ships.
- [x] Per repo rules: update `docs/` and CLAUDE.md for any behavior changes; when deploying, bump `CACHE_NAME` in sw.js, `App.VERSION` in main.js, and the sw-register `?v=` param together.

## Verification

No test framework in the repo — verify manually:

1. Junk dirty state (simulated leftover index) → sync resets silently, vault works.
2. Real unique local edit + simulated `commitAll` failure → sync aborts with toast; no data change.
3. Real unique local edit + checkout conflict → recovery ref created, vault reset, toast offers Recover, recovered content matches, ref cleaned up.
4. Fresh clone on empty vault → unchanged behavior.
5. Normal clean sync → unchanged behavior; `unpushed` count still accurate.
6. Bulk-delete dialogs show full warning text; force-push dialog settles on Escape/overlay dismiss.
7. `node scripts/build-single-file.js` builds cleanly.
