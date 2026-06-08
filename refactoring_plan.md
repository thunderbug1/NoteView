Refactoring Plan: js/views/document.js (4,474 lines → ~8 modules)
Constraints
- No build step, no ES modules. All scripts load via <script> tags in index.html. Modules communicate through window.DocumentView and other global singletons.
- Load order is critical. New files must be inserted in index.html at the correct position and added to sw.js PRECACHE_URLS. CACHE_NAME must be bumped each time.
- No automated tests. Refactoring must be conservative and incremental — each phase must leave the app in a functional, testable state.
- External callers must not break. 26 external entry points are consumed by 12 other files. Every public API must preserve its exact signature.
Directory Structure (Target)
js/views/
  document.js                 (~500 lines — the shell: render, public API, orchestration)
  document/
    collapseManager.js        (~130 lines)
    markdownParser.js         (~300 lines)
    autocomplete.js           (~100 lines)
    editorFactory.js          (~200 lines)
    extensions.js             (~350 lines)
    decorations.js            (~500 lines)
    speechRecognition.js      (~190 lines)
    inlineDiffOverlay.js      (~140 lines)
    wikilinkDragDrop.js       (~180 lines)
    blockMenu.js              (~130 lines)
    pasteHandler.js           (~170 lines)
    extractCutModal.js        (~200 lines)
    htmlRenderer.js           (~200 lines)
    navigation.js             (~120 lines)
    mobileToolbar.js          (~170 lines)
    contentManager.js         (~250 lines)
Phase 1: Foundation — Establish Public API Contract & Fix Leaks (no new files)
Goal: Document the exact public surface expected by 12 external callers. Replace private field leaks with proper getter/setter methods.
Step 1.1: Define and stabilize the public API
Add explicit @public JSDoc annotations on all 26 consumed methods (see table below). Add @private / /** @internal */ on everything else. This makes the extraction boundary visible without changing any behavior.
Step 1.2: Replace private field leaks with accessors
Three underscore-prefixed fields are written/read externally:
Field	External Callers
_isInModalOrCreation	newNoteModal.js, capture.js
_focusedEditor	main.js, syncManager.js
_focusedBlockId	main.js
Update external callers to use new methods, then rename the fields to truly private (e.g., __isInModalOrCreation).
Step 1.3: Expose cleanupRecognition() publicly
newNoteModal.js calls stopSpeechRecognition() (public) but also needs cleanup on modal close. Currently cleanupRecognition() is internal but needed by newNoteModal.js:598,616 — make it public.
Phase 2: Extract Standalone Modules (no DocumentView internal coupling)
These modules depend only on window globals (Store, App, Modal, Common, etc.) and CodeMirror — they do not access this.editors, this.collapsedBlocks, or other DocumentView state. Extract first because they have the lowest risk.
Step 2.1: js/views/document/markdownParser.js (~300 lines)
Contains pure parsing functions with no dependency on DocumentView state:
Method
getFencedBlocks(text)
getTables(text, fencedBlocks)
parseMediaItem(lineText)
parseNoteLine(lineText)
getMediaGalleries(text, fencedBlocks, tables)
buildGalleryLineSet(doc, mediaGalleries)
buildTableLineSet(doc, tables)
buildFencedBlockLineSet(doc, fencedBlocks)
isSelectionInsideBlock(state, block)
focusFencedBlock(view, from)
detectMediaUrl(text)
_getCachedParse(doc)
Deduplication opportunity: Merge buildGalleryLineSet, buildTableLineSet, buildFencedBlockLineSet into a single buildLineSet(doc, items, offsetFn).
Export pattern: window.DocumentMarkdownParser = { getFencedBlocks, getTables, ... }
Load order: After CodeMirror but before DocumentView (used by buildDecorations, buildCollapsedBlockDecorations, etc.)
Step 2.2: js/views/document/autocomplete.js (~100 lines)
Method
getMentionSuggestions(blockId)
createMentionCompletionSource(container, resolveBlockId)
createWikilinkCompletionSource(container)
These take container and callback params — no dependency on this. Export as window.DocumentAutocomplete.
Step 2.3: js/views/document/blockMenu.js (~130 lines)
Method
showBlockMenu(btn)
closeBlockMenu()
Depends on: Store, App, Modal, HistoryView, Common, SendToVault, SelectionManager, navigator.clipboard. No DocumentView state except editors.get(blockId) for copy/DL — accept editor as parameter or look up from a passed reference.
Signature change: showBlockMenu(btn) parses blockId from btn.dataset.id. Keep this interface. Extract the editor lookup (this.editors.get(blockId)) up into DocumentView and pass the editor in.
Step 2.4: js/views/document/collapseManager.js (~130 lines)
Method
renderCollapseButton(block)
handleCollapseClick(e)
handleGroupCollapseClick(e)
collapseBlock(blockId)
expandBlock(blockId)
restoreCollapsedState(blocks)
Deduplication: Merge collapseBlock and expandBlock into setBlockCollapsed(blockId, collapsed).
Depends on this.collapsedBlocks, this.collapsedGroups, this._autoCollapseOnBlur, this.editors (for re-rendering collapsed decorations). All passed as parameters or accessed via the DocumentView reference.
Phase 3: Extract Editor Infrastructure
These modules depend on CodeMirror internals and decorate the editor pipeline.
Step 3.1: js/views/document/decorations.js (~500 lines)
All 10 line decorator functions + the _lineDecorators registry + applyLineDecorations + buildDecorations + buildHiddenLineDecorations + buildCollapsedBlockDecorations:
Method
get _lineDecorators()
decorateInlineFields(...)
decorateTaskAnchors(...)
decorateHeaders(...)
decorateInlineFormats(...)
decorateImages(...)
decorateVideos(...)
decorateEmbeds(...)
decorateLinks(...)
decorateBareUrls(...)
decorateWikilinks(...)
applyLineDecorations(...)
buildDecorations(state, hasFocus)
buildHiddenLineDecorations(state)
buildCollapsedBlockDecorations(state, hasFocus)
Deduplication: The overlaps check pattern (repeated in all 10 decorators) should be extracted to a helper: checkOverlap(usedRanges, matchFrom, matchTo).
Step 3.2: js/views/document/extensions.js (~350 lines)
All CodeMirror extension factory methods:
Method
createHiddenLineExtension()
createCollapsedBlockExtension()
createLivePreviewPlugin()
createUpdateListener(container, blockId, handleContentChange)
createDomEventHandlers(container)
createNewBlockKeymap(container, createNewBlock)
createIndentFolding()
createHighlightExtension(blockId)
getEditorTheme()
shortcutToCM6(shortcut)
Deduplication: createHiddenLineExtension and createCollapsedBlockExtension share the same StateField.define pattern with effect-based invalidation. Extract a createStateFieldExtension(effect, createFunc, updateFunc, provideFunc) factory.
Step 3.3: js/views/document/editorFactory.js (~200 lines)
Method
waitForCodeMirror()
_loadCodeMirror()
createEditor(container, blockId, initialContent, extraExtensions)
attachEventListeners()
removeBlockElement(blockId)
This is the main coupling point — createEditor wires together everything from decorations, extensions, and autocomplete modules. It also manages this.editors, this.originalContents, this._focusedEditor.
Phase 4: Extract Feature Modules
Step 4.1: js/views/document/speechRecognition.js (~190 lines)
Method
isSpeechRecognitionSupported()
handleMicClick(e)
startSpeechRecognition(blockId, btnElement)
stopSpeechRecognition()
cleanupRecognition()
Depends on window.SpeechRecognition/webkitSpeechRecognition and this.editors (for insertTextAtSelection).
Cross-cutting dedup: The same transcript-deduplication algorithm (startsWith check) is duplicated in capture.js:405-503 and newNoteModal.js:81-174. After extracting this module, capture.js and newNoteModal.js should be refactored to use a shared SpeechManager (see Cross-Cutting Refactorings below).
Step 4.2: js/views/document/inlineDiffOverlay.js (~140 lines)
Method
renderInlineDiffOverlay(blockId, pendingDiffs)
_createInlineDiffEditor(container, original, modified)
showPendingInlineDiffs()
wireInlineDiffEvents(article)
Cross-cutting dedup: _createInlineDiffEditor is identical to ai.js:_createDiffEditor and the inline _renderBatchReviewItem setup in ai.js. After extraction, create a shared DiffEditor utility in js/utils/diffEditor.js used by all three modules (see Cross-Cutting Refactorings).
Step 4.3: js/views/document/wikilinkDragDrop.js (~180 lines)
Method
handleDragStart(e)
_handleDragMove(e)
_handleDragEnd(e)
Depends on Store, App, Common, this._dragState.
Also includes drag handle rendering in renderBlockMetadata() (lines 662–666) — extract the button HTML generation to a helper in this module.
Step 4.4: js/views/document/pasteHandler.js (~170 lines)
Method
shouldPromptForLargePaste(text)
isFencedContent(text)
summarizePastedText(text)
normalizePastedText(text)
buildFencedPaste(view, text, kind)
insertTextAtSelection(view, text, annotations)
handleMediaUrlPaste(view, mediaInfo)
handleLargePaste(view, text)
showLargePasteModal(text)
showMediaUrlModal(mediaInfo)
Deduplication: showLargePasteModal and showMediaUrlModal share the same resolved/finish promise pattern and data-action button wiring. Extract a createActionModal(title, bodyHtml, actions, options) helper.
Step 4.5: js/views/document/extractCutModal.js (~200 lines)
Method
handleExtractCut(view, selectedText, selection)
showExtractCutModal(text, view)
Also the openFencedBlockModal (lines 2721–2737) and openNoteModal (lines 4398–4447) — small modal helpers that could live here or in a dedicated modal module.
Step 4.6: js/views/document/htmlRenderer.js (~200 lines)
Method
renderFlatBlocks(blocks)
renderGroupedBlocks(grouped, namespace)
renderBlockHtml(block)
renderBlockMetadata(block)
updateBlockMetadata(blockId)
updateBlockTags(blockId)
renderTagsHtml(block)
getSelectedContextBadge()
Note: This module generates HTML strings returned to render() which sets container.innerHTML. Keep the HTML generation side-effect-free (pure string returns).
Step 4.7: js/views/document/mobileToolbar.js (~170 lines)
Method
createMobileToolbar()
showMobileToolbar()
hideMobileToolbar()
setupMobileKeyboardHandler()
cleanupMobileKeyboardHandler()
Step 4.8: js/views/document/navigation.js (~120 lines)
Method
focusEditor(blockId)
getFocusedBlockId()
_saveScrollAnchor()
_restoreScrollFromAnchor(anchor)
focusNewBlock()
navigateToBlock(targetId)
highlightAndScrollTo(blockId, view, matchIndex)
openNoteModal(targetId)
Step 4.9: js/views/document/contentManager.js (~250 lines)
Method
handleContentChange(blockId, content, skipUndo)
promotePlaceholder(initialContent)
cancelAllPendingSaves()
flushAllPendingSaves()
scheduleSave(blockId, content, options)
createNewBlock()
handleSplitNote(view, from, to)
_pickTagsBeforeCreate(initialTags)
Also handleTaskToggleClick (1020–1032), toggleTaskOnCurrentLine (1034–1043), toggleHeadingOnCurrentLine (1045–1082) — these are small editor actions that fit with content mutation.
Phase 5: Reshape the Shell — What Remains in document.js
After extraction, document.js shrinks to ~400-500 lines containing:
1. State declarations (editors map, saveTimeouts, originalContents, collapsedBlocks, etc.) — these are accessed by all sub-modules via the shared DocumentView reference
2. render() method — the main orchestrator that calls into sub-modules
3. showTemplatePicker() — small, self-contained
4. Task menu delegation — showTaskMenu, showPriorityMenu, appendInlineField (3-line stubs delegating to TaskMenus)
5. getCMWidgets() — lazy-init for CodeMirrorWidgets
6. Event delegation setup — the 10 _xxxHandler references and addEventListener/removeEventListener calls currently in render() (lines 164–235)
The shell also re-exports all public methods from sub-modules by assigning them onto DocumentView:
Object.assign(DocumentView, CollapseManager, MarkdownParser, /* ... */);
Cross-Cutting Refactorings (Parallel to Phases 2-5)
CR-1: Shared CodeMirror Diff Editor Utility
Files affected: document.js, ai.js (2 copies), history.js, timeline.js
Extract js/utils/diffEditor.js:
window.DiffEditor = {
    async waitForCodeMirror() { /* delegate to DocumentView.waitForCodeMirror */ },
    createMergeView(container, original, modified, options = {}) {
        // options: { mergeControls, extensions }
        // Unified setup replicated 5 times currently
    }
};
Lines saved: ~60 per copy × 5 copies = ~300 lines eliminated.
CR-2: Shared SpeechManager
Files affected: document.js, capture.js, newNoteModal.js
Extract js/utils/speechManager.js:
window.SpeechManager = {
    isSupported() { /* feature check */ },
    createSession({ onResult, onError, onEnd, onStart }) {
        // Returns { start(), stop(), cleanup() }
        // Handles: continuous, interim, auto-restart (capped), transcript dedup
    }
};
The two transcript targets diverge: CodeMirror insertion vs textarea append vs preview div. Use a callback onResult(transcript, isFinal) abstraction so all three callers can plug in their own insertion logic.
Lines saved: ~200 lines across 3 files.
CR-3: Tag Badge Rendering Unification
Files affected: tagModal.js, document.js, newNoteModal.js, selectionManager.js, common.js
Move tagModal.js:_renderBadge(tag) to js/utils/tagBadge.js as the single canonical renderer. Update common.js:renderBadges() to delegate to it. Update selectionManager.js inline <span class="tag-badge"> patterns to call the shared utility.
CR-4: Queued Note Flush Dedup in store.js
Merge _flushNotesFromDB and _flushNotesFromLocalStorage by extracting the common block-construction + save logic:
async _createAndSaveQueuedNote(note) {
    const id = `${...}`;  // ID generation
    const block = { id, content: note.content, tags: note.options.tags || [] };
    await this.saveBlock(block, { commit: true, commitMessage: `Create note ${id}`, skipUndo: true });
    this.blocks.push(block);
    return block;
}
Lines saved: ~90 lines.
Phase 6: Load Order & index.html Changes
For each new file, add a <script> tag in index.html at the correct position. New sub-modules of DocumentView must load after their dependencies (CodeMirror, Store, App, Modal) but before any module that calls into DocumentView.
Current relevant load order (lines 310–315):
<script src="js/views/history.js"></script>     <!-- 310 -->
<script src="js/views/document.js"></script>     <!-- 311 -->
<script src="js/views/timeline.js"></script>     <!-- 312 -->
<script src="js/views/kanban.js"></script>       <!-- 313 -->
<script src="js/views/settings.js"></script>     <!-- 314 -->
<script src="js/views/capture.js"></script>      <!-- 315 -->
New load order should be:
<!-- Phase 2: Standalone modules (no DocumentView coupling) -->
<script src="js/views/document/markdownParser.js"></script>
<script src="js/views/document/autocomplete.js"></script>
<script src="js/views/document/collapseManager.js"></script>
<script src="js/views/document/blockMenu.js"></script>

<!-- Phase 3: Editor infrastructure -->
<script src="js/views/document/decorations.js"></script>
<script src="js/views/document/extensions.js"></script>
<script src="js/views/document/editorFactory.js"></script>

<!-- Phase 4: Feature modules -->
<script src="js/views/document/speechRecognition.js"></script>
<script src="js/views/document/inlineDiffOverlay.js"></script>
<script src="js/views/document/wikilinkDragDrop.js"></script>
<script src="js/views/document/pasteHandler.js"></script>
<script src="js/views/document/extractCutModal.js"></script>
<script src="js/views/document/htmlRenderer.js"></script>
<script src="js/views/document/mobileToolbar.js"></script>
<script src="js/views/document/navigation.js"></script>
<script src="js/views/document/contentManager.js"></script>

<!-- The shell: assembles everything, must load last -->
<script src="js/views/document.js"></script>
Cross-cutting utilities:
<!-- Cross-cutting: before any consumers -->
<script src="js/utils/speechManager.js"></script>
<script src="js/utils/diffEditor.js"></script>
<script src="js/utils/tagBadge.js"></script>
Risk Assessment & Mitigation
Risk	Probability	Impact
Breaking external callers	High	High
this binding errors	High	Medium
Load order race	Medium	Medium
Circular dependency	Low	High
CM6 extension state loss	Medium	Medium
Missed PRECACHE_URLS entry	High	Low
Execution Order (Recommended)
1. Phase 1 (1-3 days) — Public API, fix private field leaks. Test manually with vault open.
2. CR-1, CR-2, CR-3, CR-4 (2-3 days) — Cross-cutting dedups. Extract shared utilities independently of DocumentView.
3. Phase 2 (2-3 days) — Extract standalone modules one at a time, testing after each.
4. Phase 3 (2-3 days) — Extract editor infrastructure. This is the highest-risk phase — do decorations first (pure functions), then extensions, then editorFactory last.
5. Phase 4 (3-5 days) — Extract feature modules in dependency order (htmlRenderer first since render() depends on it; contentManager last since it's the most coupled).
6. Phase 5 (1 day) — Clean up the shell, remove dead code, final PRECACHE_URLS audit.
Total estimated effort: 11-18 days for one developer.
Would you like me to expand any specific phase with more granular step-by-step instructions, or shall I proceed to implement Phase 1?