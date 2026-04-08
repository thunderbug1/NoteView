/**
 * Document View - Live markdown editing with CodeMirror 6
 * Features Obsidian-like live preview where markdown syntax is hidden
 * and rendered inline (e.g., **bold** shows as bold without asterisks)
 */

const DocumentView = {
    // Track CodeMirror editor instances by block ID
    editors: new Map(),
    newBlockContent: '',
    pendingNewTags: null,
    saveTimeouts: new Map(), // blockId -> timeoutId
    originalContents: new Map(), // blockId -> original content for change detection
    // Store widget class for access in closures
    MarkdownWidgetClass: null,
    // Task menus (initialized on first use)
    _taskMenus: null,

    /**
     * Get or initialize task menus
     */
    getTaskMenus() {
        if (!this._taskMenus) {
            this._taskMenus = TaskMenus.create(this);
        }
        return this._taskMenus;
    },

    async render(blocks) {
        const container = document.getElementById('viewContainer');
        container.className = 'document-view';

        // Wait for CodeMirror to be loaded
        await this.waitForCodeMirror();

        const sorted = SortManager.sortItems('document', blocks);

        // Build HTML for blocks - use div containers for CodeMirror
        container.innerHTML = sorted.map(block => `
            <article class="block" data-id="${block.id}">
                <div class="block-split-marker" data-id="${block.id}" title="Split note here">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" x2="8.12" y1="4" y2="15.88"/><line x1="14.47" x2="20" y1="14.48" y2="20"/><line x1="8.12" x2="12" y1="8.12" y2="12"/></svg>
                </div>
                ${this.renderBlockMetadata(block)}
                <div class="block-editor">
                    <div class="codemirror-container" data-id="${block.id}">${escapeHtml(block.content || '')}</div>
                    <span class="save-indicator" data-id="${block.id}">saved</span>
                </div>
            </article>
        `).join('') + `
            <article class="block empty" data-id="new">
                <div class="block-split-marker" data-id="new" title="Split note here">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" x2="8.12" y1="4" y2="15.88"/><line x1="14.47" x2="20" y1="14.48" y2="20"/><line x1="8.12" x2="12" y1="8.12" y2="12"/></svg>
                </div>
                <div class="block-tags">
                    ${this.getSelectedContextBadge()}
                </div>
                <div class="block-editor">
                    <div class="codemirror-container" data-id="new">${escapeHtml(this.newBlockContent)}</div>
                </div>
            </article>
        `;

        // Remove old event delegation listener if exists
        if (this._deleteHandler) {
            container.removeEventListener('click', this._deleteHandler);
        }
        // Add event delegation for delete button
        this._deleteHandler = this.handleDeleteClick.bind(this);
        container.addEventListener('click', this._deleteHandler);

        // Add event delegation for split marker click
        if (this._splitHandler) {
            container.removeEventListener('mousedown', this._splitHandler);
        }
        this._splitHandler = this.handleSplitMarkerClick.bind(this);
        container.addEventListener('mousedown', this._splitHandler);

        // Add event delegation for tag button click
        if (this._tagHandler) {
            container.removeEventListener('click', this._tagHandler);
        }
        this._tagHandler = this.handleTagClick.bind(this);
        container.addEventListener('click', this._tagHandler);

        this.attachEventListeners();
    },

    handleSplitMarkerClick(e) {
        const marker = e.target.closest('.block-split-marker');
        if (!marker) return;
        e.preventDefault();
        e.stopPropagation();
        
        const blockId = marker.dataset.id;
        const view = this.editors.get(blockId);
        if (!view) return;

        const head = view.state.selection.main.head;
        const line = view.state.doc.lineAt(head);
        this.handleSplitNote(view, line.from, line.to);
    },

    waitForCodeMirror() {
        return new Promise((resolve) => {
            if (window.CodeMirrorReady) {
                return resolve();
            }
            
            // Safety timeout to prevent app hang if dependency fails to load
            const timeout = setTimeout(() => {
                console.warn('CodeMirror failed to load within 5s');
                resolve();
            }, 5000);
            
            window.addEventListener('CodeMirrorReady', () => {
                clearTimeout(timeout);
                resolve();
            }, { once: true });
        });
    },

    getSelectedContextBadge() {
        const selectedTags = SelectionManager.getActiveTags();
        if (selectedTags.length === 0) return '';

        return selectedTags
            .map(tag => `<span class="badge">${Common.capitalizeFirst(tag)}</span>`)
            .join('');
    },

    // Render metadata header above block (like Obsidian/Tana)
    renderBlockMetadata(block) {
        const parts = [];

        // Tags
        const tags = block.tags || [];
        const selectedContexts = SelectionManager.selections?.context || new Set();
        const sortedTags = [...tags].sort((a, b) => {
            const aSelected = selectedContexts.has(a);
            const bSelected = selectedContexts.has(b);
            if (aSelected && !bSelected) return -1;
            if (!aSelected && bSelected) return 1;
            return a.localeCompare(b);
        });

        parts.push(`
            <div class="block-tags">
                ${sortedTags.map(tag => `
                    <span class="badge">${Common.capitalizeFirst(tag)}</span>
                `).join('')}
                <button class="add-tag-btn" data-id="${block.id}">+ Tag</button>
            </div>
        `);

        // Dates
        const dateParts = [];
        if (block.creationDate) {
            const created = new Date(block.creationDate);
            dateParts.push(`<span class="meta-date">Created ${Common.formatRelativeDate(created)}</span>`);
        }
        if (block.lastUpdated && block.lastUpdated !== block.creationDate) {
            const updated = new Date(block.lastUpdated);
            dateParts.push(`<span class="meta-date">Updated ${Common.formatRelativeDate(updated)}</span>`);
        }

        if (dateParts.length > 0) {
            parts.push(`
                <div class="block-dates">
                    ${dateParts.join(' · ')}
                    <button class="history-btn" data-id="${block.id}" title="View Revision History"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px; vertical-align:text-bottom;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> History</button>
                </div>
            `);
        }

        // Delete button (always shown, far right)
        parts.push(`
            <button class="delete-btn" data-id="${block.id}" title="Delete note">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
        `);

        if (parts.length > 0) {
            return `<div class="block-metadata">${parts.join('')}</div>`;
        }
        return '';
    },

    attachEventListeners() {
        const container = document.getElementById('viewContainer');

        // Initialize CodeMirror editors for each block
        container.querySelectorAll('.codemirror-container').forEach(cmContainer => {
            const blockId = cmContainer.dataset.id;
            const initialContent = cmContainer.textContent;

            // Clear the text content before initializing CodeMirror
            cmContainer.textContent = '';

            // Create CodeMirror instance
            this.createEditor(cmContainer, blockId, initialContent);
        });

        // History
        container.querySelectorAll('.history-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const blockId = e.currentTarget.dataset.id;
                if (blockId && blockId !== 'new') {
                    HistoryView.openHistory(blockId);
                }
            });
        });

    },

    // Event delegation for delete button
    handleDeleteClick(e) {
        const deleteBtn = e.target.closest('.delete-btn');
        if (!deleteBtn) return;
        e.preventDefault();
        e.stopPropagation();
        const blockId = deleteBtn.dataset.id;
        if (blockId && blockId !== 'new') {
            App.deleteBlock(blockId);
        }
    },

    handleTagClick(e) {
        const tagBtn = e.target.closest('.add-tag-btn');
        if (!tagBtn) return;
        e.preventDefault();
        e.stopPropagation();
        const blockId = tagBtn.dataset.id;
        if (blockId) {
            App.showTagModal(blockId);
        }
    },

    async handleSplitNote(view, from, to) {
        // Find the block ID of the current editor
        let editorContainer = view.dom.closest('.codemirror-container');
        if (!editorContainer) return;
        const blockId = editorContainer.dataset.id;
        let originalBlock = Store.blocks.find(b => b.id === blockId);
        if (!originalBlock && blockId !== 'new') return;

        const doc = view.state.doc;
        const selection = view.state.selection.main;
        
        let extractedContent = '';
        let newOriginalContent = '';

        if (!selection.empty && selection.from !== selection.to) {
            // Cut specific selected selection lines
            const startLine = view.state.doc.lineAt(selection.from);
            const endLine = view.state.doc.lineAt(selection.to);
            
            extractedContent = view.state.sliceDoc(startLine.from, endLine.to);
            
            // Reattach surrounding doc, being careful around newlines so we don't leave blank lines
            const before = view.state.sliceDoc(0, startLine.from);
            const after = view.state.sliceDoc(endLine.to);
            
            // Eat the newline if possible
            if (before.endsWith('\n') && after.startsWith('\n')) {
                newOriginalContent = before + after.substring(1);
            } else {
                newOriginalContent = before + after;
            }
            
        } else {
            // Split from the specified clicked line downwards
            newOriginalContent = view.state.sliceDoc(0, from);
            extractedContent = view.state.sliceDoc(from);
        }

        // Clean up text
        newOriginalContent = newOriginalContent.trimEnd() + '\n';
        extractedContent = extractedContent.trim();
        if (!extractedContent) return; // Nothing to split

        // Update the original block first
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: newOriginalContent }
        });
        
        let beforeState = null;
        if (originalBlock && !UndoRedoManager.isExecuting) {
            beforeState = JSON.parse(JSON.stringify(originalBlock));
        }

        if (blockId !== 'new') {
            this.handleContentChange(blockId, newOriginalContent);
            clearTimeout(this.saveTimeouts.get(blockId));
            App.saveBlockContent(blockId, newOriginalContent, { commit: true, skipUndo: true });
            this.originalContents.set(blockId, newOriginalContent);
        } else {
            this.handleContentChange('new', newOriginalContent);
        }

        // Create new block
        const newBlockParams = {
            content: extractedContent,
            skipUndo: true
        };
        // Inherit creationDate and tags if present
        if (originalBlock) {
            newBlockParams.creationDate = originalBlock.creationDate;
            newBlockParams.tags = originalBlock.tags ? [...originalBlock.tags] : [];
        }

        const newBlock = await Store.createBlock(newBlockParams.content, newBlockParams);
        
        // Add manual undo/redo tracking chunk
        if (beforeState && !UndoRedoManager.isExecuting) {
            const diff = UndoRedoManager.createDiff(beforeState, Store.blocks.find(b => b.id === blockId));
            await UndoRedoManager.executeCommand({
                type: 'batch',
                description: 'Split Note',
                commands: [
                    { type: 'update', blockId: blockId, before: diff.before, after: diff.after },
                    { type: 'create', blockId: newBlock.id, blockData: { ...newBlock } }
                ]
            });
        }
        
        // Save scroll position relative to the block
        let scrollOffset = 0;
        const blockElement = document.querySelector(`.block[data-id="${blockId}"]`);
        if (blockElement) {
            scrollOffset = blockElement.getBoundingClientRect().top;
        }
        
        // Save the cursor position where the split happened
        const cursorRestorePos = from;

        // Re-render blocks so the newly generated note spawns in the DOM
        App.render();

        // Restore scroll position and cursor AFTER CodeMirror finishes rebuilding (since render uses setTimeout)
        setTimeout(() => {
            if (blockId !== 'new') {
                const newBlockElement = document.querySelector(`.block[data-id="${blockId}"]`);
                if (newBlockElement) {
                    const newOffset = newBlockElement.getBoundingClientRect().top;
                    window.scrollBy(0, newOffset - scrollOffset);
                }
                
                // Re-focus original editor and restore the cursor near where it was split
                const newView = this.editors.get(blockId);
                if (newView) {
                    newView.focus();
                    const safePos = Math.min(cursorRestorePos, newView.state.doc.length);
                    newView.dispatch({ selection: { anchor: safePos, head: safePos } });
                }
            }
        }, 15);
    },

    showTaskMenu(x, y, view, from, to, currentState) {
        return this.getTaskMenus().showTaskMenu(x, y, view, from, to, currentState);
    },

    showPriorityMenu(x, y, view, from, to) {
        return this.getTaskMenus().showPriorityMenu(x, y, view, from, to);
    },

    appendInlineField(view, checkFrom, checkTo, key, value) {
        return this.getTaskMenus().appendInlineField(view, checkFrom, checkTo, key, value);
    },

    getCMWidgets() {
        if (this._cmWidgets) return this._cmWidgets;
        this._cmWidgets = CodeMirrorWidgets.create(this);
        return this._cmWidgets;
    },

    resolveTaskName(idStr) {
        if (!idStr.startsWith('^')) return idStr;
        const blocks = (window.Store && Store.blocks) || [];
        for (const block of blocks) {
            if ('^' + block.id === idStr) return block.id;
            if (block.content && block.content.includes(idStr)) {
                const lines = block.content.split('\n');
                for (const line of lines) {
                    if (line.includes(idStr)) {
                        let text = line.replace(/^\s*[-*+]\s+\[.*?\]\s*/, '');
                        text = text.replace(/\[(due|dependsOn)::[^\]]+\]/g, '');
                        text = text.replace(idStr, '');
                        return text.trim() || idStr;
                    }
                }
            }
        }
        return idStr;
    },

    createEditor(container, blockId, initialContent) {
        if (!window.CodeMirror) {
            console.error('CodeMirror not loaded');
            return;
        }

        const { EditorView, basicSetup, markdown, languages, Decoration, ViewPlugin, StateField, WidgetType, keymap, Prec, indentWithTab, placeholder } = window.CodeMirror;

        // We no longer use simple Widget replacement for everything.
        // We will use Decoration.mark to style, and Decoration.replace to hide syntax.
        const self = this;

        // Store reference for use in closures. Read current id dynamically to allow promotion.
        const handleContentChange = (content) => self.handleContentChange(container.dataset.id, content);
        const createNewBlock = () => self.createNewBlock();
        const newBlockContentGetter = () => self.newBlockContent;

        // Function to create decorations from document state
        function createDecorations(state, hasFocus) {
            const builder = [];
            
            // Get lines containing cursors ONLY if editor is focused
            const cursorLines = new Set();
            if (hasFocus) {
                for (const range of state.selection.ranges) {
                    cursorLines.add(state.doc.lineAt(range.head).number);
                }
            }

            for (let i = 1; i <= state.doc.lines; i++) {
                const line = state.doc.line(i);
                const hideSyntax = !cursorLines.has(i);
                self.applyLineDecorations(line, builder, hideSyntax, Decoration, i === state.doc.lines);
            }

            // Delegate sorting entirely to CodeMirror which understands how to resolve overlaps securely
            return Decoration.set(builder, true);
        }

        // View plugin to provide decorations to the view
        const livePreviewPlugin = ViewPlugin.fromClass(class {
            constructor(view) {
                this.decorations = createDecorations(view.state, view.hasFocus);
            }
            update(update) {
                if (update.docChanged || update.selectionSet || update.focusChanged) {
                    this.decorations = createDecorations(update.view.state, update.view.hasFocus);
                }
            }
        }, {
            decorations: (v) => v.decorations
        });

        // Create the editor view
        const view = new EditorView({
            doc: (blockId === 'new' && initialContent === '') ? '' : (initialContent.endsWith('\n') ? initialContent : initialContent + '\n'),
            extensions: [
                basicSetup,
                markdown({ codeLanguages: languages }),
                keymap.of([indentWithTab]),
                EditorView.lineWrapping,
                livePreviewPlugin,
                placeholder(blockId === 'new' ? 'Write a note...' : ''),
                EditorView.theme({
                    "&": {
                        fontFamily: 'Inter, -apple-system, sans-serif',
                        fontSize: '15px',
                        lineHeight: '1.6'
                    },
                    ".cm-content": {
                        padding: '0',
                        minHeight: '0'
                    },
                    ".cm-editor": {
                        minHeight: '0'
                    },
                    ".cm-focused": {
                        outline: 'none'
                    },
                    ".cm-foldGutter": {
                        width: '15px'
                    },
                    ".cm-foldGutter .cm-gutterElement": {
                        color: 'var(--text-muted, #94a3b8)',
                        cursor: 'pointer'
                    },
                    ".cm-foldGutter .cm-gutterElement:hover": {
                        color: 'var(--text-primary, #0f172a)'
                    },
                    // Live preview widget styles
                    ".md-header": {
                        fontWeight: '700',
                        color: 'var(--text-primary)',
                        display: 'inline-block'
                    },
                    ".md-header-1": { fontSize: '1.8em', padding: '0.1em 0' },
                    ".md-header-2": { fontSize: '1.5em', padding: '0.1em 0' },
                    ".md-header-3": { fontSize: '1.3em', padding: '0.1em 0' },
                    ".md-header-4": { fontSize: '1.1em', padding: '0.1em 0' },
                    ".md-header-5": { fontSize: '1.0em', padding: '0.1em 0' },
                    ".md-header-6": { fontSize: '0.9em', padding: '0.1em 0' },
                    ".md-strong": {
                        fontWeight: '700',
                        color: 'var(--text-color, #0f172a)'
                    },
                    ".md-emphasis": {
                        fontStyle: 'italic'
                    },
                    ".md-code": {
                        backgroundColor: 'var(--code-bg, #f1f5f9)',
                        color: 'var(--code-color, #0f172a)',
                        borderRadius: '3px',
                        padding: '2px 4px',
                        fontFamily: 'monospace',
                        fontSize: '0.9em'
                    },
                    ".md-link-text": {
                        color: 'var(--accent-color, #3b82f6)',
                        textDecoration: 'underline'
                    },
                    ".md-strikethrough": {
                        textDecoration: 'line-through'
                    },
                    ".md-task-checkbox": {
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '18px',
                        height: '18px',
                        border: '1.5px solid var(--border-color, #cbd5e1)',
                        borderRadius: '4px',
                        marginRight: '8px',
                        verticalAlign: 'text-bottom',
                        cursor: 'pointer',
                        color: 'transparent',
                        transition: 'all 0.15s ease'
                    },
                    ".md-task-checkbox:hover": {
                        borderColor: 'var(--accent-color, #3b82f6)'
                    },
                    ".state-done": {
                        backgroundColor: 'var(--accent-color, #3b82f6)',
                        borderColor: 'var(--accent-color, #3b82f6)',
                        color: 'white'
                    },
                    ".state-progress": {
                        borderColor: 'var(--warning-color, #f59e0b)'
                    },
                    ".state-progress .half-fill": {
                        width: '10px',
                        height: '10px',
                        backgroundColor: 'var(--warning-color, #f59e0b)',
                        borderRadius: '2px'
                    },
                    ".state-blocked": {
                        backgroundColor: 'var(--danger-color, #ef4444)',
                        borderColor: 'var(--danger-color, #ef4444)',
                        color: 'white'
                    },
                    ".state-canceled": {
                        backgroundColor: 'var(--bg-tertiary, #f1f5f9)',
                        borderColor: 'var(--border-color, #cbd5e1)',
                        color: 'var(--text-muted, #94a3b8)'
                    },
                    ".md-task-done": {
                        textDecoration: 'line-through',
                        color: 'var(--text-muted, #94a3b8)'
                    },
                    ".md-task-badge": {
                        display: 'inline-flex',
                        alignItems: 'center',
                        fontSize: '0.85em',
                        padding: '2px 6px',
                        borderRadius: '12px',
                        backgroundColor: 'var(--bg-secondary, #f8fafc)',
                        color: 'var(--text-secondary, #64748b)',
                        border: '1px solid var(--border-color, #e2e8f0)',
                        margin: '0 4px',
                        verticalAlign: 'text-bottom',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap'
                    },
                    ".badge-dependsOn": {
                        borderColor: 'var(--badge-todos-border, #fca5a5)',
                        backgroundColor: 'var(--badge-todos-bg, #fff1f2)',
                        color: 'var(--badge-todos-text, #9f1239)'
                    },
                    ".badge-due": {
                        borderColor: 'var(--badge-work-border, #bae6fd)',
                        backgroundColor: 'var(--badge-work-bg, #f0f9ff)',
                        color: 'var(--badge-work-text, #075985)'
                    },
                    ".badge-assignee": {
                        borderColor: 'var(--badge-time-border, #d8b4fe)',
                        backgroundColor: 'var(--badge-time-bg, #faf5ff)',
                        color: 'var(--badge-time-text, #6b21a8)'
                    },
                    ".badge-priority": {
                        borderColor: 'var(--border-color, #e2e8f0)',
                        backgroundColor: 'var(--bg-secondary, #f8fafc)',
                        color: 'var(--text-secondary, #64748b)'
                    },
                    ".badge-priority[data-priority='urgent']": {
                        borderColor: 'rgba(239, 68, 68, 0.3)',
                        backgroundColor: 'rgba(239, 68, 68, 0.05)',
                        color: '#ef4444',
                        fontWeight: '700'
                    },
                    ".badge-priority[data-priority='high']": {
                        borderColor: 'rgba(249, 115, 22, 0.3)',
                        backgroundColor: 'rgba(249, 115, 22, 0.05)',
                        color: '#f97316',
                        fontWeight: '600'
                    },
                    ".badge-priority[data-priority='medium']": {
                        borderColor: 'rgba(59, 130, 246, 0.3)',
                        backgroundColor: 'rgba(59, 130, 246, 0.05)',
                        color: '#3b82f6'
                    },
                    ".badge-priority[data-priority='low']": {
                        borderColor: 'rgba(148, 163, 184, 0.3)',
                        backgroundColor: 'rgba(148, 163, 184, 0.05)',
                        color: '#94a3b8'
                    },
                    ".badge-id": {
                        opacity: '0.7',
                        fontFamily: 'monospace',
                        fontSize: '0.8em'
                    },
                    ".md-task-badge:hover": {
                        backgroundColor: 'var(--bg-hover, #f1f5f9)'
                    },
                    ".md-add-deadline, .md-add-action": {
                        display: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-muted, #94a3b8)',
                        marginLeft: '8px',
                        verticalAlign: 'text-bottom',
                        padding: '2px 4px',
                        borderRadius: '4px'
                    },
                    ".md-add-deadline:hover, .md-add-action:hover": {
                        color: 'var(--accent-color, #3b82f6)',
                        backgroundColor: 'var(--bg-hover, #f1f5f9)'
                    },
                    ".cm-line:hover .md-add-deadline, .cm-line:hover .md-add-action": {
                        display: 'inline-flex'
                    },
                }),
                // Listen for content changes and cursor movements
                EditorView.updateListener.of((update) => {
                    if (update.selectionSet || update.focusChanged || update.docChanged || update.geometryChanged) {
                        const marker = document.querySelector(`.block-split-marker[data-id="${blockId}"]`);
                        if (marker) {
                            if (update.view.hasFocus) {
                                const sel = update.state.selection.main;
                                const isExtract = !sel.empty && sel.from !== sel.to;
                                
                                const startBlock = update.view.lineBlockAt(sel.from);
                                const endBlock = update.view.lineBlockAt(sel.to);
                                
                                const scroller = update.view.scrollDOM;
                                const blockEl = container.closest('.block');
                                
                                if (blockEl) {
                                    const contentTop = scroller.getBoundingClientRect().top;
                                    const blockRectTop = blockEl.getBoundingClientRect().top;
                                    
                                    const relativeTopStart = contentTop - blockRectTop + startBlock.top - scroller.scrollTop;
                                    const iconTopStart = relativeTopStart + (startBlock.height / 2) - 9;
                                    
                                    marker.style.display = 'flex';
                                    marker.style.top = `${iconTopStart}px`;
                                    
                                    const scissorSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" x2="8.12" y1="4" y2="15.88"/><line x1="14.47" x2="20" y1="14.48" y2="20"/><line x1="8.12" x2="12" y1="8.12" y2="12"/></svg>';
                                    
                                    if (isExtract) {
                                        const relativeTopEnd = contentTop - blockRectTop + endBlock.top - scroller.scrollTop;
                                        const iconTopEnd = relativeTopEnd + (endBlock.height / 2) - 9;
                                        const h = Math.max(18, iconTopEnd - iconTopStart + 18);
                                        
                                        marker.style.height = `${h}px`;
                                        marker.style.flexDirection = 'column';
                                        marker.style.justifyContent = 'space-between';
                                        marker.innerHTML = scissorSvg + scissorSvg;
                                        marker.title = "Extract block";
                                    } else {
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
                        if (content !== '' && !content.endsWith('\n')) {
                            update.view.dispatch({
                                changes: { from: content.length, to: content.length, insert: '\n' }
                            });
                        }
                        handleContentChange(content);
                    }
                }),
                EditorView.domEventHandlers({
                    blur: (event, view) => {
                        const currentId = container.dataset.id;
                        const content = view.state.doc.toString();
                        if (currentId !== 'new') {
                            // Skip blur handling during undo/redo execution
                            if (UndoRedoManager.isExecuting) {
                                return;
                            }
                             if (content.trim() === '') {
                                console.log('Deleting empty block on blur:', currentId);
                                App.deleteBlock(currentId);
                            } else {
                                // Only commit if content changed
                                const originalContent = self.originalContents.get(currentId);
                                if (content !== originalContent) {
                                    console.log('Committing block on blur:', currentId);
                                    App.saveBlockContent(currentId, content, { commit: true });
                                    self.originalContents.set(currentId, content);
                                }
                            }
                        }
                    }
                }),
                // Handle key bindings for creating new blocks using keymap (with high precedence)
                Prec.high(keymap.of([
                    {
                        key: 'Mod-Enter',
                        run: (target) => {
                            const currentId = container.dataset.id;
                            if (currentId === 'new') {
                                const content = target.state.doc.toString();
                                if (content.trim()) {
                                    console.log('Creating block via Mod+Enter', { currentId, content: content.substring(0, 50) });
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
                            const currentId = container.dataset.id;
                            if (currentId === 'new') {
                                const content = target.state.doc.toString();
                                if (content.trim()) {
                                    console.log('Creating block via Shift+Enter', { currentId, content: content.substring(0, 50) });
                                    createNewBlock();
                                    return true;
                                }
                            }
                            return false;
                        }
                    }
                ]))
            ],
            parent: container
        });

        // Store editor instance and original content
        this.editors.set(blockId, view);
        this.originalContents.set(blockId, initialContent);
    },

    // Apply decorations per line. If hideSyntax is true, we replace the markdown markers.
    applyLineDecorations(line, builder, hideSyntax, Decoration, isLastLine) {
        const text = line.text;
        const from = line.from;
        let usedRanges = [];
        
        // Ensure widgets are initialized
        const widgets = this.getCMWidgets();

        // 1. Task List Checkboxes
        const checkboxRegex = /^(\s*[-*+]\s+)\[([ xX\/bB\-])\]/g;
        let cbMatch;
        let lineHasCheckedTask = false;
        let isTaskLine = false;
        let taskLineStart = from;
        
        while ((cbMatch = checkboxRegex.exec(text)) !== null) {
            const matchFrom = from + cbMatch.index + cbMatch[1].length;
            const matchTo = matchFrom + 3; // "[ ]" length
            let taskState = cbMatch[2];
            if (taskState === ' ') taskState = ' ';

            if (hideSyntax) {
                builder.push(Decoration.replace({
                    widget: new widgets.CheckboxWidget(taskState, matchFrom, matchTo)
                }).range(matchFrom, matchTo));
            } else {
                const safeState = { ' ': 'todo', 'x': 'done', 'X': 'done', '/': 'progress', 'b': 'blocked', 'B': 'blocked', '-': 'canceled' }[taskState] || 'todo';
                builder.push(Decoration.mark({ class: `cm-task-check state-${safeState}` }).range(matchFrom, matchTo));
            }
            if (taskState === 'x' || taskState === 'X' || taskState === '-') {
                lineHasCheckedTask = true;
            }
            isTaskLine = true;
            taskLineStart = from + cbMatch[0].length;
            while (taskLineStart < line.to && /\s/.test(text[taskLineStart - from])) {
                taskLineStart += 1;
            }
        }

        if (isTaskLine) {
            if (!text.includes('[due::')) {
                builder.push(Decoration.widget({
                    widget: new widgets.AddDeadlineWidget(from, line.to),
                    side: 1
                }).range(line.to));
            }
            if (!text.includes('[assignee::')) {
                builder.push(Decoration.widget({
                    widget: new widgets.AddAssigneeWidget(from, line.to),
                    side: 1
                }).range(line.to));
            }
            if (!text.includes('[priority::')) {
                builder.push(Decoration.widget({
                    widget: new widgets.AddPriorityWidget(from, line.to),
                    side: 1
                }).range(line.to));
            }
            if (!text.includes('[dependsOn::')) {
                builder.push(Decoration.widget({
                    widget: new widgets.AddDependencyWidget(from, line.to),
                    side: 1
                }).range(line.to));
            }
        }

        // 3. Inline Fields (e.g. [due:: 2026-03-25], [dependsOn:: ^id])
        const inlineFieldRegex = /\[(due|dependsOn|assignee|priority)::\s*([^\]]+)\]/g;
        let fieldMatch;
        while ((fieldMatch = inlineFieldRegex.exec(text)) !== null) {
            const matchFrom = from + fieldMatch.index;
            const matchTo = matchFrom + fieldMatch[0].length;
            const type = fieldMatch[1];
            const value = fieldMatch[2].trim();

            if (hideSyntax) {
                builder.push(Decoration.replace({
                    widget: new widgets.BadgeWidget(type, value, matchFrom, matchTo)
                }).range(matchFrom, matchTo));
            } else {
                builder.push(Decoration.mark({ class: `md-inline-field badge-${type}` }).range(matchFrom, matchTo));
            }
            usedRanges.push({ from: matchFrom, to: matchTo });
        }

        // 3. Task Anchors (e.g. ^task-id)
        const anchorRegex = /(?:\s+)(\^[a-zA-Z0-9-_]+)\b/g;
        let anchorMatch;
        while ((anchorMatch = anchorRegex.exec(text)) !== null) {
            const matchFrom = from + anchorMatch.index + anchorMatch[0].indexOf(anchorMatch[1]);
            const matchTo = matchFrom + anchorMatch[1].length;
            const idValue = anchorMatch[1];

            if (hideSyntax) {
                builder.push(Decoration.replace({
                    widget: new widgets.BadgeWidget('id', idValue, matchFrom, matchTo)
                }).range(matchFrom, matchTo));
            } else {
                builder.push(Decoration.mark({ class: 'md-task-anchor badge-id' }).range(matchFrom, matchTo));
            }
            usedRanges.push({ from: matchFrom, to: matchTo });
        }

        if (lineHasCheckedTask) {
            builder.push(Decoration.mark({ class: 'md-task-done' }).range(taskLineStart, line.to));
        }

        // Header pattern
        const headerMatch = text.match(/^(#{1,6})\s+(.*)$/);
        if (headerMatch) {
            const level = headerMatch[1].length;
            const matchTo = from + line.text.length;
            let overlaps = usedRanges.some(r => from < r.to && matchTo > r.from);
            
            if (!overlaps) {
                builder.push(Decoration.mark({ class: `md-header md-header-${level}` }).range(from, line.to));
                if (hideSyntax) {
                    const syntaxEnd = from + level + 1; // # + space
                    builder.push(Decoration.replace({}).range(from, syntaxEnd));
                }
            }
        }

        // Inline patterns
        const patterns = [
            { regex: /\*\*(.+?)\*\*/g, class: 'md-strong', syntaxLen: 2 },
            { regex: /\*(.+?)\*/g, class: 'md-emphasis', syntaxLen: 1 },
            { regex: /~~(.+?)~~/g, class: 'md-strikethrough', syntaxLen: 2 },
            { regex: /`(.+?)`/g, class: 'md-code', syntaxLen: 1 }
        ];

        for (const pattern of patterns) {
            pattern.regex.lastIndex = 0;
            let match;
            while ((match = pattern.regex.exec(text)) !== null) {
                const matchFrom = from + match.index;
                const matchTo = matchFrom + match[0].length;

                let overlaps = usedRanges.some(r => matchFrom < r.to && matchTo > r.from);
                if (!overlaps) {
                    builder.push(Decoration.mark({ class: pattern.class }).range(matchFrom, matchTo));
                    if (hideSyntax) {
                        builder.push(Decoration.replace({}).range(matchFrom, matchFrom + pattern.syntaxLen));
                        builder.push(Decoration.replace({}).range(matchTo - pattern.syntaxLen, matchTo));
                    }
                    usedRanges.push({ from: matchFrom, to: matchTo });
                }
            }
        }

        // Links [text](url)
        const linkRegex = /\[(.+?)\]\((.+?)\)/g;
        let match;
        while ((match = linkRegex.exec(text)) !== null) {
            const matchFrom = from + match.index;
            const matchTo = matchFrom + match[0].length;

            let overlaps = usedRanges.some(r => matchFrom < r.to && matchTo > r.from);
            if (!overlaps) {
                if (hideSyntax) {
                    builder.push(Decoration.replace({
                        widget: new widgets.LinkWidget(match[1], match[2], matchFrom, matchTo)
                    }).range(matchFrom, matchTo));
                } else {
                    builder.push(Decoration.mark({ class: 'md-link-text' }).range(matchFrom, matchTo));
                }
                usedRanges.push({ from: matchFrom, to: matchTo });
            }
        }

        // Bare URLs
        const bareUrlRegex = /https?:\/\/\S+/g;
        while ((match = bareUrlRegex.exec(text)) !== null) {
            const matchFrom = from + match.index;
            const matchTo = matchFrom + match[0].length;

            let overlaps = usedRanges.some(r => matchFrom < r.to && matchTo > r.from);
            if (!overlaps) {
                if (hideSyntax) {
                    // Strip trailing punctuation that's unlikely to be part of the URL
                    let url = match[0];
                    while (/[.,;:!?)\]>}]$/.test(url) && url.length > 1) {
                        url = url.slice(0, -1);
                    }
                    const urlTo = matchFrom + url.length;
                    if (urlTo < matchTo) {
                        // Part of the match is trailing punctuation — only replace the URL portion
                        builder.push(Decoration.replace({
                            widget: new widgets.LinkWidget(url, url, matchFrom, urlTo)
                        }).range(matchFrom, urlTo));
                    } else {
                        builder.push(Decoration.replace({
                            widget: new widgets.LinkWidget(url, url, matchFrom, matchTo)
                        }).range(matchFrom, matchTo));
                    }
                } else {
                    builder.push(Decoration.mark({ class: 'md-link-text' }).range(matchFrom, matchTo));
                }
                usedRanges.push({ from: matchFrom, to: matchTo });
            }
        }
    },

    handleContentChange(blockId, content) {
        // Skip recording during undo/redo execution
        if (UndoRedoManager.isExecuting) return;

        // Debug logging
        if (blockId === 'new') {
            console.log('New block content changed:', {
                blockId,
                contentLength: content.length,
                content: content.substring(0, 50)
            });
        }

        // Handle new block
        if (blockId === 'new') {
            this.newBlockContent = content;
            const block = document.querySelector(`.block[data-id="new"]`);
            if (content.trim()) {
                block?.classList.remove('empty');
                // Promote immediately when content is added
                this.promotePlaceholder(content);
            }
        } else {
            // Debounced save for existing blocks
            this.scheduleSave(blockId, content);
        }
    },

    async promotePlaceholder(initialContent) {
        if (this.isPromoting) return;
        this.isPromoting = true;

        try {
            // Take snapshot of content to save
            const contentToSave = this.newBlockContent || initialContent;

            // 1. Create the block in the store, applying any pending tags
            const extraMeta = {};
            if (this.pendingNewTags && this.pendingNewTags.length > 0) {
                extraMeta.tags = this.pendingNewTags;
            }
            const newBlock = await Store.createBlock(contentToSave, extraMeta);
            this.pendingNewTags = null;

            // 2. Update DOM of the currently active placeholder
            const currentBlock = document.querySelector('.block[data-id="new"]');
            if (currentBlock) {
                currentBlock.dataset.id = newBlock.id;
                currentBlock.classList.remove('empty');
                
                const editorContainer = currentBlock.querySelector('.codemirror-container');
                if (editorContainer) {
                    editorContainer.dataset.id = newBlock.id;
                }

                // Inject save indicator if missing
                let saveIndicator = currentBlock.querySelector('.save-indicator');
                if (!saveIndicator) {
                    saveIndicator = document.createElement('span');
                    saveIndicator.className = 'save-indicator saved';
                    saveIndicator.dataset.id = newBlock.id;
                    saveIndicator.textContent = 'saved';
                    const editorDiv = currentBlock.querySelector('.block-editor');
                    if (editorDiv) {
                        editorDiv.appendChild(saveIndicator);
                    }
                } else {
                    saveIndicator.dataset.id = newBlock.id;
                }

                // Render metadata
                const metadataHtml = this.renderBlockMetadata(newBlock);
                if (metadataHtml) {
                    currentBlock.insertAdjacentHTML('afterbegin', metadataHtml);
                }

                // Update editors map
                const editor = this.editors.get('new');
                if (editor) {
                    this.editors.delete('new');
                    this.editors.set(newBlock.id, editor);
                }
                // Update original contents map
                const originalContent = this.originalContents.get('new');
                if (originalContent !== undefined) {
                    this.originalContents.delete('new');
                    this.originalContents.set(newBlock.id, originalContent);
                }
            }

            // Check if more content was typed while we were awaiting createBlock
            if (this.newBlockContent !== contentToSave) {
                this.scheduleSave(newBlock.id, this.newBlockContent);
            }

            // 3. Reset new block content
            this.newBlockContent = '';

            // 4. Inject a new placeholder at the end
            const container = document.getElementById('viewContainer');
            const newPlaceholderHtml = `
                <article class="block empty" data-id="new">
                    <div class="block-tags">
                        ${this.getSelectedContextBadge()}
                    </div>
                    <div class="block-editor">
                        <div class="codemirror-container" data-id="new"></div>
                    </div>
                </article>
            `;
            container.insertAdjacentHTML('beforeend', newPlaceholderHtml);

            // 5. Initialize editor for the new placeholder
            const newCmContainer = container.querySelector('.block[data-id="new"] .codemirror-container');
            if (newCmContainer) {
                this.createEditor(newCmContainer, 'new', '');
            }

            SelectionManager.updateTagCounts();
        } finally {
            this.isPromoting = false;
        }
    },

    scheduleSave(blockId, content) {
        const indicator = document.querySelector(`.save-indicator[data-id="${blockId}"]`);
        if (indicator) {
            indicator.textContent = 'saving...';
            indicator.classList.add('saving');
            indicator.classList.remove('saved');
        }

        // Clear existing timeout for THIS block
        const existingTimeout = this.saveTimeouts.get(blockId);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
        }

        // Schedule save for THIS block
        const timeout = setTimeout(async () => {
            this.saveTimeouts.delete(blockId);
            await App.saveBlockContent(blockId, content);
            
            if (indicator) {
                indicator.textContent = 'saved';
                indicator.classList.remove('saving');
                indicator.classList.add('saved');
                // Show undo hint
                if (UndoRedoManager.canUndo()) {
                    indicator.title = 'Press Ctrl+Z to undo';
                }
                // Hide saved indicator after 2 seconds
                setTimeout(() => {
                    if (indicator.textContent === 'saved') {
                        indicator.textContent = '';
                    }
                }, 2000);
            }
        }, 1000);
        
        this.saveTimeouts.set(blockId, timeout);
    },

    async createNewBlock() {
        const content = this.newBlockContent.trim();
        if (!content) return;

        console.log('Creating new block with content:', content);

        await Store.createBlock(content);
        this.newBlockContent = '';

        // Clear editors map to prevent memory leaks
        this.editors.clear();

        SelectionManager.updateTagCounts();
        await App.render();

        // Scroll to new empty block
        setTimeout(() => {
            const container = document.getElementById('viewContainer');
            container.scrollTop = container.scrollHeight;
        }, 100);
    },

    // Focus editor for a block
    focusEditor(blockId) {
        const editor = this.editors.get(blockId);
        if (editor) {
            editor.focus();
        }
    },

    // Focus the "new note" block at the bottom
    focusNewBlock() {
        const container = document.getElementById('viewContainer');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }

        // Try to focus immediately; retry after a short delay if editor isn't ready yet
        const tryFocus = (attempts = 0) => {
            const editor = this.editors.get('new');
            if (editor) {
                editor.focus();
                // Scroll again after focus in case layout shifted
                if (container) container.scrollTop = container.scrollHeight;
            } else if (attempts < 10) {
                setTimeout(() => tryFocus(attempts + 1), 50);
            }
        };
        tryFocus();
    }
};
