/**
 * DocumentEditorSetup - CodeMirror editor creation and extensions
 */
const DocumentEditorSetup = {
    /**
     * Get the cached EditorView.theme() config object, creating it on first call.
     */
    getEditorTheme() {
        return EditorTheme.get();
    },

    /**
     * Get the set of active task-related context filters that require per-line filtering.
     * Returns only filters that should hide non-matching task lines (excludes Todo.all).
     */
    /**
     * Check whether a task line matches all of the active task filters.
     * Non-task lines (no checkbox) always return true (stay visible).
     */
    /**
     * Compute which line indices should be hidden based on active task filters.
     * Returns a Set of 0-based indices.
     */
    /**
     * Filter markdown content, removing lines that don't match active task filters.
     */
    // Cache parsed fenced blocks and tables per doc to avoid redundant regex passes
    _parseCache: new WeakMap(),
    _getCachedParse(doc) {
        if (this._parseCache.has(doc)) return this._parseCache.get(doc);
        const text = doc.toString();
        const fencedBlocks = this.getFencedBlocks(text);
        const tables = this.getTables(text, fencedBlocks);
        const mediaGalleries = this.getMediaGalleries(text, fencedBlocks, tables);
        const result = { fencedBlocks, tables, mediaGalleries };
        this._parseCache.set(doc, result);
        return result;
    },

    /**
     * Build the decoration set from editor state.
     */
    buildDecorations(state, hasFocus) {
        const { Decoration } = window.CodeMirror;
        const builder = [];
        const { fencedBlocks, tables, mediaGalleries } = this._getCachedParse(state.doc);
        const fencedBlockLines = this.buildFencedBlockLineSet(state.doc, fencedBlocks);
        const tableLines = this.buildTableLineSet(state.doc, tables);
        const galleryLines = this.buildGalleryLineSet(state.doc, mediaGalleries);

        // Get lines containing cursors ONLY if editor is focused
        const cursorLines = new Set();
        if (hasFocus) {
            for (const range of state.selection.ranges) {
                cursorLines.add(state.doc.lineAt(range.head).number);
            }
        }

        const widgets = this.getCMWidgets();
        for (const block of fencedBlocks) {
            const selectionInsideBlock = hasFocus && this.isSelectionInsideBlock(state, block);

            if (block.isCollapsible && !selectionInsideBlock) {
                const startLine = state.doc.lineAt(block.from);

                builder.push(Decoration.replace({
                    widget: new widgets.FencedBlockWidget(block),
                    inclusive: false
                }).range(startLine.from, startLine.to));

                builder.push(Decoration.line({
                    attributes: {
                        class: 'md-fenced-block-summary-line'
                    }
                }).range(startLine.from));
            } else if (!selectionInsideBlock) {
                builder.push(Decoration.mark({ class: 'md-fenced-block-source' }).range(block.from, block.to));
            }
        }

        for (const table of tables) {
            const selectionInsideTable = hasFocus && this.isSelectionInsideBlock(state, table);

            if (!selectionInsideTable) {
                const startLine = state.doc.lineAt(table.from);

                builder.push(Decoration.replace({
                    widget: new widgets.TableWidget(table),
                    inclusive: false
                }).range(startLine.from, startLine.to));

                builder.push(Decoration.line({
                    attributes: { class: 'md-table-summary-line' }
                }).range(startLine.from));
            } else {
                builder.push(Decoration.mark({ class: 'md-table-source' }).range(table.from, table.to));
            }
        }

        for (const gallery of mediaGalleries) {
            const startLine = state.doc.lineAt(gallery.from);
            const endLine = state.doc.lineAt(Math.max(gallery.from, gallery.to - 1));

            let cursorInGallery = false;
            for (const range of state.selection.ranges) {
                const line = state.doc.lineAt(range.head).number;
                if (line >= startLine.number && line <= endLine.number) {
                    cursorInGallery = true;
                    break;
                }
            }
            if (!cursorInGallery) {
                builder.push(Decoration.replace({
                    widget: new widgets.MediaGalleryWidget(gallery),
                    inclusive: false
                }).range(startLine.from, startLine.to));

                builder.push(Decoration.line({
                    attributes: { class: 'md-gallery-summary-line' }
                }).range(startLine.from));
            }
        }

        const activeTaskFilters = this.getActiveTaskFilter();

        // Build 0-based index set of hidden lines (shared with export)
        const allLineTexts = [];
        for (let i = 1; i <= state.doc.lines; i++) allLineTexts.push(state.doc.line(i).text);
        const hiddenLines = this.getHiddenTaskLineIndices(allLineTexts, activeTaskFilters);

        // Hidden task lines and collapsed block/table interiors are handled by
        // separate StateField extensions (see createHiddenLineExtension and
        // createCollapsedBlockExtension) which CAN use cross-line
        // Decoration.replace() — something ViewPlugin decorations cannot do.
        for (let i = 1; i <= state.doc.lines; i++) {
            if (fencedBlockLines.has(i)) continue;
            if (tableLines.has(i)) continue;
            if (galleryLines.has(i)) continue;

            const line = state.doc.line(i);

            // Skip lines hidden by the StateField, but NOT cursor lines — the
            // StateField preserves those so they still need syntax decorations.
            if (hiddenLines.has(i - 1) && !cursorLines.has(i)) continue;

            const hideSyntax = !cursorLines.has(i);
            this.applyLineDecorations(line, builder, hideSyntax, Decoration, i === state.doc.lines);
        }

        // Delegate sorting entirely to CodeMirror which understands how to resolve overlaps securely
        return Decoration.set(builder, true);
    },

    /**
     * Build cross-line Decoration.replace() ranges for hidden task lines.
     * Called from a StateField (NOT a ViewPlugin) so it CAN span line breaks,
     * which properly removes hidden regions from CM's height map and keeps the
     * gutter in sync.
     */
    buildHiddenLineDecorations(state) {
        const { Decoration } = window.CodeMirror;
        const activeTaskFilters = this.getActiveTaskFilter();
        const excludeFilters = TaskParser.getActiveExcludedTaskFilter();
        if ((!activeTaskFilters || activeTaskFilters.size === 0) && (!excludeFilters || excludeFilters.size === 0)) {
            return Decoration.none;
        }

        const allLineTexts = [];
        for (let i = 1; i <= state.doc.lines; i++) allLineTexts.push(state.doc.line(i).text);
        const hiddenLines = this.getHiddenTaskLineIndices(allLineTexts, activeTaskFilters);

        if (hiddenLines.size === 0) return Decoration.none;

        // Lines with the cursor are never hidden (user needs to see/edit them).
        // Unlike the ViewPlugin version, we don't check hasFocus — always
        // preserve the cursor line.  Better UX when switching focus to sidebar.
        const cursorLines = new Set();
        for (const range of state.selection.ranges) {
            cursorLines.add(state.doc.lineAt(range.head).number);
        }

        // Group consecutive hidden (non-cursor) lines into replace spans
        const builder = [];
        let spanStart = null;

        for (let i = 1; i <= state.doc.lines; i++) {
            const isHidden = hiddenLines.has(i - 1);
            const hasCursor = cursorLines.has(i);

            if (isHidden && !hasCursor) {
                if (spanStart === null) {
                    spanStart = state.doc.line(i).from;
                }
            } else {
                if (spanStart !== null) {
                    const endPos = state.doc.line(i).from;
                    builder.push(Decoration.replace({}).range(spanStart, endPos));
                    spanStart = null;
                }
            }
        }
        // Flush trailing span (last lines of document)
        if (spanStart !== null) {
            builder.push(Decoration.replace({}).range(spanStart, state.doc.line(state.doc.lines).to));
        }

        return builder.length > 0 ? Decoration.set(builder, true) : Decoration.none;
    },

    /**
     * Create a StateField extension for hidden task line decorations.
     * StateField-based decorations CAN span line breaks (unlike ViewPlugin
     * decorations), so hidden line regions are properly removed from CM's
     * height map and the gutter syncs correctly.
     */
    createHiddenLineExtension() {
        const { StateField, EditorView } = window.CodeMirror;
        const effect = getFilterChangedEffect();
        return StateField.define({
            create(state) {
                return DocumentView.buildHiddenLineDecorations(state);
            },
            update(deco, tr) {
                if (tr.docChanged || tr.selectionSet || (effect && tr.effects.some(e => e.is(effect)))) {
                    return DocumentView.buildHiddenLineDecorations(tr.state);
                }
                return deco.map(tr.changes);
            },
            provide: f => EditorView.decorations.from(f)
        });
    },

    /**
     * Build cross-line Decoration.replace() ranges for collapsed fenced-block
     * and table interiors.  Called from a StateField (NOT a ViewPlugin) so it
     * CAN span line breaks, which properly removes hidden regions from CM's
     * height map and keeps the gutter in sync.
     */
    buildCollapsedBlockDecorations(state, hasFocus) {
        const { Decoration } = window.CodeMirror;
        const { fencedBlocks, tables, mediaGalleries } = this._getCachedParse(state.doc);
        const builder = [];

        for (const block of fencedBlocks) {
            const selectionInsideBlock = hasFocus && this.isSelectionInsideBlock(state, block);
            if (!block.isCollapsible || selectionInsideBlock) continue;

            const startLine = state.doc.lineAt(block.from);
            const endLine = state.doc.lineAt(Math.max(block.from, block.to - 1));
            if (endLine.number > startLine.number) {
                const interiorFrom = state.doc.line(startLine.number + 1).from;
                const interiorTo = endLine.number < state.doc.lines
                    ? state.doc.line(endLine.number + 1).from
                    : endLine.to;
                builder.push(Decoration.replace({}).range(interiorFrom, interiorTo));
            }
        }

        for (const table of tables) {
            const selectionInsideTable = hasFocus && this.isSelectionInsideBlock(state, table);
            if (selectionInsideTable) continue;

            const startLine = state.doc.lineAt(table.from);
            const endLine = state.doc.lineAt(Math.max(table.from, table.to - 1));
            if (endLine.number > startLine.number) {
                const interiorFrom = state.doc.line(startLine.number + 1).from;
                const interiorTo = endLine.number < state.doc.lines
                    ? state.doc.line(endLine.number + 1).from
                    : endLine.to;
                builder.push(Decoration.replace({}).range(interiorFrom, interiorTo));
            }
        }

        for (const gallery of mediaGalleries) {
            const startLine = state.doc.lineAt(gallery.from);
            const endLine = state.doc.lineAt(Math.max(gallery.from, gallery.to - 1));

            let cursorInGallery = false;
            for (const range of state.selection.ranges) {
                const line = state.doc.lineAt(range.head).number;
                if (line >= startLine.number && line <= endLine.number) {
                    cursorInGallery = true;
                    break;
                }
            }
            if (cursorInGallery) continue;

            if (endLine.number > startLine.number) {
                const interiorFrom = state.doc.line(startLine.number + 1).from;
                const interiorTo = endLine.number < state.doc.lines
                    ? state.doc.line(endLine.number + 1).from
                    : endLine.to;
                builder.push(Decoration.replace({}).range(interiorFrom, interiorTo));
            }
        }

        return builder.length > 0 ? Decoration.set(builder, true) : Decoration.none;
    },

    createCollapsedBlockExtension() {
        const { StateField, EditorView } = window.CodeMirror;
                const effect = getFilterChangedEffect();
        let focused = false;
        return [
            EditorView.updateListener.of((update) => {
                if (update.focusChanged) focused = update.view.hasFocus;
            }),
            StateField.define({
                create(state) {
                    return DocumentView.buildCollapsedBlockDecorations(state, false);
                },
                update(deco, tr) {
                    const selectionChanged = tr.selection !== tr.startState.selection;
                    if (tr.docChanged || selectionChanged || (effect && tr.effects.some(e => e.is(effect)))) {
                        return DocumentView.buildCollapsedBlockDecorations(tr.state, focused);
                    }
                    return deco.map(tr.changes);
                },
                provide: f => EditorView.decorations.from(f)
            })
        ];
    },

    /**
     * Create the live preview ViewPlugin that manages decorations.
     */
    createLivePreviewPlugin() {
        const { ViewPlugin } = window.CodeMirror;
                return ViewPlugin.fromClass(class {
            constructor(view) {
                this.decorations = DocumentView.buildDecorations(view.state, view.hasFocus);
            }
            update(update) {
                if (update.docChanged || update.selectionSet || update.focusChanged) {
                    this.decorations = DocumentView.buildDecorations(update.view.state, update.view.hasFocus);
                }
            }
        }, {
            decorations: (v) => v.decorations
        });
    },

    /**
     * Create the update listener extension for content changes and split-marker positioning.
     */
    createUpdateListener(container, blockId, handleContentChange) {
        const { EditorView } = window.CodeMirror;
        let lastLine = -1;
        return EditorView.updateListener.of((update) => {
            if (update.selectionSet || update.focusChanged || update.docChanged || update.geometryChanged) {
                const marker = document.querySelector(`.block-split-marker[data-id="${CSS.escape(blockId)}"]`);
                if (marker) {
                    if (update.view.hasFocus) {
                        if (update.state.doc.lines <= 1) {
                            marker.style.display = 'none';
                            lastLine = -1;
                            return;
                        }

                        const sel = update.state.selection.main;
                        const isExtract = !sel.empty && sel.from !== sel.to;
                        const curLine = update.state.doc.lineAt(sel.from).number;

                        // Skip expensive layout queries on pure selection changes within the same line
                        const needsGeometry = update.docChanged || update.geometryChanged || update.focusChanged || isExtract || lastLine !== curLine;
                        lastLine = curLine;

                        if (!needsGeometry) return;

                        const blockEl = container.closest('.block');

                        if (blockEl) {
                            const blockRect = blockEl.getBoundingClientRect();
                            const startCoords = update.view.coordsAtPos(sel.from);
                            if (!startCoords) { marker.style.display = 'none'; return; }

                            const startLineTop = startCoords.top - blockRect.top;
                            const startLineHeight = startCoords.bottom - startCoords.top;

                            marker.style.display = 'flex';

                            const scissorSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" x2="8.12" y1="4" y2="15.88"/><line x1="14.47" x2="20" y1="14.48" y2="20"/><line x1="8.12" x2="12" y1="8.12" y2="12"/></svg>';

                            if (isExtract) {
                                const endCoords = update.view.coordsAtPos(sel.to);
                                if (!endCoords) { marker.style.display = 'none'; return; }

                                const endLineBottom = endCoords.bottom - blockRect.top;
                                const h = Math.max(18, endLineBottom - startLineTop + 18);

                                marker.style.top = `${startLineTop - 9}px`;
                                marker.style.height = `${h}px`;
                                marker.style.flexDirection = 'column';
                                marker.style.justifyContent = 'space-between';
                                marker.innerHTML = scissorSvg + scissorSvg;
                                marker.title = "Extract block";
                            } else {
                                const iconTopStart = startLineTop + startLineHeight - 9;
                                marker.style.top = `${iconTopStart}px`;
                                marker.style.height = '18px';
                                marker.style.flexDirection = 'row';
                                marker.style.justifyContent = 'center';
                                marker.innerHTML = scissorSvg;
                                marker.title = "Split note here";
                            }
                        }
                    } else {
                        marker.style.display = 'none';
                    }
                }
            }

            if (update.docChanged) {
                const content = update.state.doc.toString();
                const isAutocomplete = update.transactions.some(tr => tr.isUserEvent('input.complete'));
                handleContentChange(content, isAutocomplete);
            }
        });
    },

    /**
     * Create DOM event handlers for paste and blur.
     */
    createDomEventHandlers(container) {
        const { EditorView } = window.CodeMirror;
                return EditorView.domEventHandlers({
            focus: (event, view) => {
                const blockId = view.dom?.closest?.('.codemirror-container')?.dataset?.id || container.dataset.id;
                if (blockId && blockId !== 'new') {
                    DocumentView._focusedBlockId = blockId;
                    RecentAccessTracker.touch(blockId);
                }
            },
            contextmenu: (event, view) => {
                if (event.target.closest?.('.cm-task-check')) {
                    const pos = view.posAtCoords(event);
                    if (pos != null) {
                        const line = view.state.doc.lineAt(pos);
                        const match = line.text.match(/^(\s*[-*+]\s+)\[([ xX\/bB\-])\]/);
                        if (match) {
                            const from = line.from + match[1].length;
                            const to = from + 3;
                            event.preventDefault();
                            DocumentView.showTaskMenu(event.pageX, event.pageY, view, from, to, match[2]);
                        }
                    }
                }
            },
            paste: (event, view) => {
                const pastedText = event.clipboardData?.getData('text/plain');

                const mediaInfo = DocumentView.detectMediaUrl(pastedText);
                if (mediaInfo) {
                    event.preventDefault();
                    DocumentView.handleMediaUrlPaste(view, mediaInfo);
                    return true;
                }

                if (!DocumentView.shouldPromptForLargePaste(pastedText)) {
                    return false;
                }

                event.preventDefault();
                DocumentView.handleLargePaste(view, pastedText);
                return true;
            },
            cut: (event, view) => {
                const selection = view.state.selection.main;
                if (selection.from === selection.to) return false;
                const selectedText = view.state.sliceDoc(selection.from, selection.to);
                if (!selectedText.trim()) return false;

                const lines = selectedText.split('\n').length;
                if (lines < 3 && selectedText.length < 200) return false;

                event.preventDefault();
                navigator.clipboard.writeText(selectedText).catch(() => Common.showToast('Clipboard access denied'));
                DocumentView.handleExtractCut(view, selectedText, selection);
                return true;
            },
            blur: async (event, view) => {
                const currentId = view.dom?.closest?.('.codemirror-container')?.dataset?.id || container.dataset.id;
                const content = view.state.doc.toString();
                if (currentId !== 'new' && currentId !== 'new-modal') {
                    // Skip blur handling during undo/redo or AI streaming
                    const isUndoRedo = typeof UndoRedoManager !== 'undefined' && UndoRedoManager.isExecuting;
                    const isAiActive = typeof NewNoteModal !== 'undefined' && (NewNoteModal._aiIsStreaming || NewNoteModal._aiDictationActive);
                    if (isUndoRedo || isAiActive) {
                        return;
                    }
                    // Guard against double-blur: skip if block was already deleted
                    if (!Store.blocks.find(b => b.id === currentId)) {
                        return;
                    }
                    if (content.trim() === '') {
                        const originalContent = DocumentView.originalContents.get(currentId);
                        if (originalContent && originalContent.trim() !== '') {
                            const isMobile = 'ontouchstart' in window;
                            if (isMobile) {
                                Common.showToast('Empty note — will be cleaned up', {
                                    actionLabel: 'Delete',
                                    action: () => App.deleteBlock(currentId, { showToast: true })
                                });
                            } else {
                                const confirmed = await Modal.confirm({
                                    title: 'Delete Empty Note',
                                    message: 'This note is now empty. Delete it?',
                                    confirmText: 'Delete',
                                    cancelText: 'Keep'
                                });
                                if (confirmed) {
                                    App.deleteBlock(currentId, { showToast: true });
                                }
                            }
                        } else {
                            App.deleteBlock(currentId);
                        }
                    } else {
                        // Only commit if content changed
                        const originalContent = DocumentView.originalContents.get(currentId);
                        if (content !== originalContent) {
                            App.saveBlockContent(currentId, content, { commit: true });
                            DocumentView.originalContents.set(currentId, content);
                        }
                    }
                }
            }
        });
    },

    /**
     * Create the keymap extension for new-block key bindings (Mod-Enter, Shift-Enter).
     */
    createNewBlockKeymap(container, createNewBlock) {
        const { keymap, Prec } = window.CodeMirror;
                const toggleTaskKey = Store.shortcuts?.toggleTask
            ? DocumentView.shortcutToCM6(Store.shortcuts.toggleTask)
            : 'Mod-Shift-t';
        return Prec.high(keymap.of([
            {
                key: 'Enter',
                run: (view) => {
                    const state = view.state;
                    const sel = state.selection.main;
                    if (!sel.empty) return false;

                    const pos = sel.head;
                    const line = state.doc.lineAt(pos);
                    const lineText = line.text;

                    // Empty list item (just a marker) — exit the list without extra blank lines
                    const emptyListMatch = lineText.match(/^(\s*)([-*+]\s+|\d+[.)]\s+)$/);
                    if (emptyListMatch) {
                        const indent = emptyListMatch[1];
                        view.dispatch({
                            changes: { from: line.from, to: line.to, insert: indent + '\n' },
                            selection: { anchor: line.from + indent.length + 1 },
                            userEvent: 'input',
                            scrollIntoView: true
                        });
                        return true;
                    }

                    return false;
                }
            },
            {
                key: 'Mod-Enter',
                run: (target) => {
                    const currentId = target.dom?.closest?.('.codemirror-container')?.dataset?.id || container.dataset.id;
                    if (currentId === 'new') {
                        const content = target.state.doc.toString();
                        if (content.trim()) {
                            createNewBlock();
                            return true;
                        }
                    }
                    return false;
                }
            },
            {
                key: 'Shift-Enter',
                run: (target) => {
                    const currentId = target.dom?.closest?.('.codemirror-container')?.dataset?.id || container.dataset.id;
                    if (currentId === 'new') {
                        const content = target.state.doc.toString();
                        if (content.trim()) {
                            createNewBlock();
                            return true;
                        }
                    }
                    return false;
                }
            },
            {
                key: toggleTaskKey,
                run: (view) => {
                    DocumentView.toggleTaskOnCurrentLine(view);
                    return true;
                }
            }
        ]));
    },

    /**
     * Create a CodeMirror editor instance for a block.
     */
    createEditor(container, blockId, initialContent, extraExtensions = []) {
        if (!window.CodeMirror) {
            console.error('CodeMirror not loaded');
            return;
        }

        const { EditorView, EditorState, basicSetup, markdown, languages, keymap, indentWithTab, placeholder, foldService } = window.CodeMirror;

                // Mutable reference — set after EditorView construction so the closure
        // can resolve the blockId from the *live* DOM (handles editor reuse during re-renders).
        let editorView = null;
        const resolveBlockId = () => editorView?.dom?.closest?.('.codemirror-container')?.dataset?.id || container.dataset.id;
        const handleContentChange = (content) => DocumentView.handleContentChange(resolveBlockId(), content);
        const createNewBlock = () => DocumentView.createNewBlock();
        const mentionCompletionSource = this.createMentionCompletionSource(container, resolveBlockId);
        const wikilinkCompletionSource = this.createWikilinkCompletionSource(container);

        const view = new EditorView({
            doc: (blockId === 'new' && initialContent === '') ? '' : (initialContent.endsWith('\n') ? initialContent : initialContent + '\n'),
            extensions: [
                basicSetup,
                markdown({ codeLanguages: languages }),
                keymap.of([indentWithTab]),
                EditorState.languageData.of(() => [{ autocomplete: mentionCompletionSource }, { autocomplete: wikilinkCompletionSource }]),
                EditorView.lineWrapping,
                this.createHiddenLineExtension(),
                ...this.createCollapsedBlockExtension(),
                this.createLivePreviewPlugin(),
                this.createIndentFolding(),
                placeholder(blockId === 'new' ? 'Write a note...' : ''),
                this.getEditorTheme(),
                this.createUpdateListener(container, blockId, handleContentChange),
                this.createDomEventHandlers(container),
                this.createNewBlockKeymap(container, createNewBlock),
                this.createHighlightExtension(blockId),
                EditorView.updateListener.of((update) => {
                    if (update.focusChanged && update.view.hasFocus) {
                        this._focusedEditor = update.view;
                        this.showMobileToolbar();
                    } else if (update.focusChanged && !update.view.hasFocus) {
                        if (this._focusedEditor === update.view) {
                            this._focusedEditor = null;
                            this.hideMobileToolbar();
                        }
                        // Re-collapse block if it was expanded by click
                        if (this._autoCollapseOnBlur.has(blockId)) {
                            this._autoCollapseOnBlur.delete(blockId);
                            this.collapseBlock(blockId);
                        }
                    }
                }),
                ...extraExtensions
            ],
            parent: container
        });

        editorView = view;
        this.editors.set(blockId, view);
        // Normalize to match editor's trailing-\n convention to avoid spurious saves
        const normalizedContent = (blockId === 'new' && initialContent === '') ? '' : (initialContent.endsWith('\n') ? initialContent : initialContent + '\n');
        this.originalContents.set(blockId, normalizedContent);
    },

    /**
     * Create a foldService extension that makes indented list regions foldable.
     * Supplements the built-in heading/blockquote folding from the markdown language.
     */
    createIndentFolding() {
        const { foldService } = window.CodeMirror;
        return foldService.of((state, lineStart, lineEnd) => {
            const line = state.doc.lineAt(lineStart);
            const text = line.text;
            // Match indented list items (tabs or 2+ spaces followed by list marker)
            const indentMatch = text.match(/^(\t| {2,})[-*+] /) || text.match(/^(\t| {2,})\d+\. /);
            if (!indentMatch) return null;
            const baseIndent = indentMatch[1].length;
            // Fold from end of current line to end of the indented block
            let endLine = line.number;
            while (endLine < state.doc.lines) {
                const nextLine = state.doc.line(endLine + 1);
                const nextText = nextLine.text;
                if (nextText.trim() === '') { endLine++; continue; }
                const nextIndent = nextText.match(/^(\s*)/)[1].length;
                if (nextIndent < baseIndent) break;
                endLine++;
            }
            if (endLine === line.number) return null;
            return { from: line.to, to: state.doc.line(endLine).to };
        });
    },

    /**
     * Create a CM6 extension that manages task-highlight line decorations.
     * blockId is captured in the closure so the field knows which position to look up.
     */
    createHighlightExtension(blockId) {
        const { StateField, Decoration, EditorView } = window.CodeMirror;
        
        const field = StateField.define({
            create() { return Decoration.none; },
            update(deco, tr) {
                const pos = DocumentView._highlightPositions.get(blockId);
                if (pos == null) return Decoration.none;
                const p = Math.min(pos, tr.state.doc.length);
                const line = tr.state.doc.lineAt(p);
                const d = Decoration.line({ attributes: { class: 'cm-task-highlight' } });
                return Decoration.set([d.range(line.from)]);
            },
            provide: f => EditorView.decorations.from(f)
        });

        return field;
    },

    /**
     * Scroll a CodeMirror editor to a task line and apply a persistent highlight.
     * @param {string} blockId - Block ID (key into _highlightPositions)
     * @param {EditorView} view - CodeMirror EditorView instance
     * @param {number} matchIndex - Character offset of the task in the document
     */
    highlightAndScrollTo(blockId, view, matchIndex) {
        if (matchIndex == null) return;
        const pos = Math.min(matchIndex, view.state.doc.length);
        this._highlightPositions.set(blockId, pos);

        const line = view.state.doc.lineAt(pos);
        const scroller = view.scrollDOM;

        // Dispatch to trigger StateField update (highlight decoration)
        view.dispatch({
            selection: { anchor: line.from },
            scrollIntoView: true
        });

        // Refine scroll position using actual coordinates
        const refineScroll = (label) => {
            const coords = view.coordsAtPos(line.from);
            if (coords) {
                const editorRect = scroller.getBoundingClientRect();
                const lineY = coords.top - editorRect.top + scroller.scrollTop;
                scroller.scrollTop = Math.max(0, lineY - scroller.clientHeight / 2);
                return true;
            }
            return false;
        };

        if (refineScroll('immediate')) return;

        // scrollIntoView didn't reach the line — estimate proportionally using total scroll height
        const totalLines = view.state.doc.lines;
        if (totalLines > 1 && scroller.scrollHeight > scroller.clientHeight) {
            const ratio = (line.number - 1) / (totalLines - 1);
            const estimated = ratio * scroller.scrollHeight - scroller.clientHeight / 2;
            scroller.scrollTop = Math.max(0, estimated);
        }

        // After CM renders at the estimated position, refine with actual coords
        let rafId;
        const refineLoop = () => {
            if (refineScroll('smooth')) {
                return; // got coordinates, done
            }
            rafId = requestAnimationFrame(refineLoop);
        };
        rafId = requestAnimationFrame(refineLoop);
        // Safety: stop trying after 500ms
        setTimeout(() => cancelAnimationFrame(rafId), 500);
    },
};
