/**
 * Document View - Live markdown editing with CodeMirror 6
 * Features Obsidian-like live preview where markdown syntax is hidden
 * and rendered inline (e.g., **bold** shows as bold without asterisks)
 */

// StateEffect to force hidden-line StateField rebuild when external filters change
let _filterChangedEffect;
function getFilterChangedEffect() {
    if (!_filterChangedEffect && window.CodeMirror?.StateEffect) {
        _filterChangedEffect = window.CodeMirror.StateEffect.define();
    }
    return _filterChangedEffect;
}

const DocumentView = {
    // Track CodeMirror editor instances by block ID
    editors: new Map(),
    // Track highlight positions by block ID (set before dispatching to trigger decoration)
    _highlightPositions: new Map(),
    newBlockContent: '',
    pendingNewTags: null,
    saveTimeouts: new Map(), // blockId -> timeoutId
    originalContents: new Map(), // blockId -> original content for change detection
    // Flag to prevent auto-save during modal editing or mobile note creation
    _isInModalOrCreation: false,
    // Track which blocks are collapsed by block ID
    collapsedBlocks: new Map(),
    // Track blocks expanded by click that should re-collapse on blur
    _autoCollapseOnBlur: new Set(),
    // Track which groups are collapsed by group key
    collapsedGroups: new Map(),
    fencedBlockThresholds: {
        lines: 12,
        chars: 800,
        previewLines: 6
    },
    // Store widget class for access in closures
    MarkdownWidgetClass: null,
    // Task menus (initialized on first use)
    _taskMenus: null,
    _cmWidgets: null,
    _editorTheme: null,
    // Speech recognition state
    _recognition: null,
    _recordingBlockId: null,
    _isStopping: false,
    _recognitionRestartCount: 0,
    _maxRecognitionRestarts: 10,
    // Mobile toolbar state
    _mobileToolbar: null,
    _focusedEditor: null,
    // Drag-and-drop wikilink state
    _dragState: { active: false },
    _dragMoveHandler: null,
    _dragEndHandler: null,

    /**
     * Get or initialize task menus
     */
    getTaskMenus() {
        if (!this._taskMenus) {
            this._taskMenus = TaskMenus.create(this);
        }
        return this._taskMenus;
    },

    clearVaultState() {
        this.editors.clear();
        this._highlightPositions.clear();
        this.newBlockContent = '';
        this.pendingNewTags = null;
        this.saveTimeouts.clear();
        this.originalContents.clear();
        this._isInModalOrCreation = false;
        this.collapsedBlocks.clear();
        this._autoCollapseOnBlur.clear();
        this.collapsedGroups.clear();
        this._focusedEditor = null;
        this._dragState = { active: false };
        this._dragMoveHandler = null;
        this._dragEndHandler = null;
        this._mobileToolbar?.remove();
        this._mobileToolbar = null;
        this.cleanupMobileKeyboardHandler();
    },

    async render(blocks, options = {}) {
        const container = document.getElementById('viewContainer');

        // Handle vault not loaded state
        if (!Store.directoryHandle && blocks.length === 0) {
            container.innerHTML = `
                <div class="document-empty-vault">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                    <h3>Vault is loading...</h3>
                    <p>Your notes will appear shortly.</p>
                </div>
            `;
            return;
        }

        // Flush and commit pending auto-saves before DOM rebuild to prevent stale writes and guarantee data persistence
        await this.flushAllPendingSaves();

        // Clear stale highlight positions from previous render
        this._highlightPositions.clear();

        // Stop any active speech recognition before re-rendering
        if (this._recordingBlockId) {
            this.stopSpeechRecognition();
        }

        // Clean up mobile keyboard handler before DOM rebuild
        this.cleanupMobileKeyboardHandler();

        container.className = 'document-view';

        // Wait for CodeMirror to be loaded
        await this.waitForCodeMirror();

        // Initialize mobile toolbar (once, only on touch devices)
        this.createMobileToolbar();

        const sorted = SortManager.sortItems('document', blocks);

        // Save scroll anchor before DOM rebuild
        const scrollAnchor = this._saveScrollAnchor();

        const activeBlockId = options.preRenderFocusedBlockId || null;

        const { groupBy } = options;
        let html;

        if (groupBy) {
            const grouped = GroupManager.groupByNamespace(sorted, groupBy);
            // Prune stale collapsed groups
            const activeGroupKeys = new Set(grouped.map(g => g.key));
            for (const key of [...this.collapsedGroups.keys()]) {
                if (!activeGroupKeys.has(key)) this.collapsedGroups.delete(key);
            }
            html = this.renderGroupedBlocks(grouped, groupBy);
        } else {
            html = this.renderFlatBlocks(sorted);
        }

        const placeholderHtml = `
            <article class="block empty" data-id="new">
                <div class="block-tags">
                    ${this.getSelectedContextBadge()}
                </div>
                <div class="block-editor">
                    <div class="codemirror-container" data-id="new">${escapeHtml(this.newBlockContent)}</div>
                </div>
            </article>
        `;

        html = placeholderHtml + html;

        container.innerHTML = html;

        // Remove old event delegation listener if exists
        if (this._splitHandler) {
            container.removeEventListener('mousedown', this._splitHandler);
        }
        this._splitHandler = this.handleSplitMarkerClick.bind(this);
        container.addEventListener('mousedown', this._splitHandler);
        if (this._splitKeyHandler) {
            container.removeEventListener('keydown', this._splitKeyHandler);
        }
        this._splitKeyHandler = (e) => {
            if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.block-split-marker')) {
                e.preventDefault();
                this.handleSplitMarkerClick(e);
            }
        };
        container.addEventListener('keydown', this._splitKeyHandler);

        // Add event delegation for tag button click
        if (this._tagHandler) {
            container.removeEventListener('click', this._tagHandler);
        }
        this._tagHandler = this.handleTagClick.bind(this);
        container.addEventListener('click', this._tagHandler);

        // Add event delegation for task toggle button click
        if (this._taskToggleHandler) {
            container.removeEventListener('click', this._taskToggleHandler);
        }
        this._taskToggleHandler = this.handleTaskToggleClick.bind(this);
        container.addEventListener('click', this._taskToggleHandler);

        // Add event delegation for mic button click
        if (this._micHandler) {
            container.removeEventListener('click', this._micHandler);
        }
        this._micHandler = this.handleMicClick.bind(this);
        container.addEventListener('click', this._micHandler);

        // Add event delegation for collapse button click
        if (this._collapseHandler) {
            container.removeEventListener('click', this._collapseHandler);
        }
        this._collapseHandler = this.handleCollapseClick.bind(this);
        container.addEventListener('click', this._collapseHandler);

        // Add event delegation for group collapse
        if (this._groupCollapseHandler) {
            container.removeEventListener('click', this._groupCollapseHandler);
        }
        this._groupCollapseHandler = this.handleGroupCollapseClick.bind(this);
        container.addEventListener('click', this._groupCollapseHandler);

        // AI Assistant button click delegation
        if (this._aiBtnHandler) {
            container.removeEventListener('click', this._aiBtnHandler);
        }
        this._aiBtnHandler = this.handleAiButtonClick.bind(this);
        container.addEventListener('click', this._aiBtnHandler);

        // Clone Context button click delegation
        if (this._cloneContextHandler) {
            container.removeEventListener('click', this._cloneContextHandler);
        }
        this._cloneContextHandler = this.handleCloneContextClick.bind(this);
        container.addEventListener('click', this._cloneContextHandler);

        // Drag handle mousedown delegation
        if (this._dragStartHandler) {
            container.removeEventListener('mousedown', this._dragStartHandler);
        }
        this._dragStartHandler = this.handleDragStart.bind(this);
        container.addEventListener('mousedown', this._dragStartHandler);

        this.attachEventListeners();

        // Restore collapsed state after DOM rebuild
        this.restoreCollapsedState(sorted);

        // Restore scroll position and focus after DOM rebuild
        requestAnimationFrame(() => {
            this._restoreScrollFromAnchor(scrollAnchor);
            
            if (activeBlockId) {
                const editor = this.editors.get(activeBlockId);
                if (editor && !editor.hasFocus) {
                    editor.focus();
                }
            }
        });
    },


    handleSplitMarkerClick(e) {
        const marker = e.target.closest('.block-split-marker');
        if (!marker) return;
        e.preventDefault();
        e.stopPropagation();

        const blockId = marker.dataset.id;
        const view = this.editors.get(blockId);
        if (!view) return;

        const selection = view.state.selection.main;
        if (!selection.empty && selection.from !== selection.to) {
            const selectedText = view.state.sliceDoc(selection.from, selection.to);
            if (selectedText.trim()) {
                this.handleExtractCut(view, selectedText, selection);
                return;
            }
        }

        const head = selection.head;
        const line = view.state.doc.lineAt(head);
        this.handleSplitNote(view, line.from, line.to);
    },

    // Track CodeMirror loading state
    _codeMirrorLoading: null,

    async waitForCodeMirror() {
        if (window.CodeMirrorReady) {
            return;
        }

        // Show loading state
        const container = document.getElementById('viewContainer');
        if (container && !container.querySelector('.codemirror-loading')) {
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'codemirror-loading';
            loadingDiv.innerHTML = '<div class="loading-spinner"></div><p>Loading editor...</p>';
            container.appendChild(loadingDiv);
        }

        // Start loading if not already in progress
        if (!this._codeMirrorLoading) {
            this._codeMirrorLoading = (async () => {
                try {
                    await this._loadCodeMirror();
                } catch (err) {
                    this._codeMirrorLoading = null;
                    console.error('Failed to load CodeMirror:', err);
                    throw err;
                }
            })();
        }

        try {
            await this._codeMirrorLoading;
        } finally {
            // Remove loading indicator
            const loadingEl = container?.querySelector('.codemirror-loading');
            if (loadingEl) loadingEl.remove();
        }
    },

    async _loadCodeMirror() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'vendor/codemirror.js';
            script.async = true;
            
            const timeout = setTimeout(() => {
                reject(new Error('CodeMirror loading timeout'));
            }, 10000);

            script.onload = () => {
                clearTimeout(timeout);
                // Wait for CodeMirrorReady event to be dispatched
                if (window.CodeMirrorReady) {
                    resolve();
                } else {
                    window.addEventListener('CodeMirrorReady', resolve, { once: true });
                }
            };

            script.onerror = () => {
                clearTimeout(timeout);
                reject(new Error('Failed to load CodeMirror script'));
            };

            document.head.appendChild(script);
        });
    },

    attachEventListeners() {
        const container = document.getElementById('viewContainer');

        // Initialize CodeMirror editors for each block
        const activeBlockIds = new Set();
        container.querySelectorAll('.codemirror-container').forEach(cmContainer => {
            const blockId = cmContainer.dataset.id;
            activeBlockIds.add(blockId);

            // Reuse existing editor if available
            const existingEditor = this.editors.get(blockId);
            if (existingEditor) {
                cmContainer.textContent = '';
                cmContainer.appendChild(existingEditor.dom);

                // Sync editor content with Store if changed externally (e.g., kanban drag)
                const block = Store.blocks.find(b => b.id === blockId);
                if (block) {
                    const freshContent = block.content || '';
                    const normalizedFresh = freshContent.endsWith('\n') ? freshContent : freshContent + '\n';
                    const currentContent = existingEditor.state.doc.toString();
                    if (normalizedFresh !== currentContent) {
                        existingEditor.dispatch({
                            changes: { from: 0, to: existingEditor.state.doc.length, insert: normalizedFresh }
                        });
                    }
                    this.originalContents.set(blockId, normalizedFresh);
                }

                // Force hidden-line StateField to rebuild for the current filter state
                const effect = getFilterChangedEffect();
                if (effect) existingEditor.dispatch({ effects: effect.of(undefined) });
                return;
            }

            const initialContent = cmContainer.textContent;
            cmContainer.textContent = '';
            this.createEditor(cmContainer, blockId, initialContent);
        });

        // Initialize inline diff editors for blocks with pending AI changes
        container.querySelectorAll('.inline-diff-overlay').forEach(overlay => {
            const body = overlay.querySelector('.inline-diff-body');
            if (!body || body.dataset.initialized) return;
            body.dataset.initialized = 'true';
            const chat = AIAssistant._chats?.find(c => c.id === overlay.dataset.chatId);
            const msg = chat?.messages.find(m => m.id === overlay.dataset.diffId);
            if (msg) this._createInlineDiffEditor(body, msg.original, msg.modified);
            this.wireInlineDiffEvents(overlay.closest('article'));
        });

        // Clean up orphaned editors (blocks no longer in the DOM)
        for (const [id, editor] of this.editors) {
            if (!activeBlockIds.has(id)) {
                editor.destroy();
                this.editors.delete(id);
                this.originalContents.delete(id);
            }
        }

        // Clear _focusedEditor if it was destroyed
        if (this._focusedEditor) {
            let stillExists = false;
            for (const editor of this.editors.values()) {
                if (editor === this._focusedEditor) {
                    stillExists = true;
                    break;
                }
            }
            if (!stillExists) {
                this._focusedEditor = null;
            }
        }

        // 3-dot block menu buttons
        container.querySelectorAll('.block-menu-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showBlockMenu(btn);
            });
        });

        // Setup mobile keyboard scroll handling
        this.setupMobileKeyboardHandler();
    },

    showBlockMenu(btn) {
        this.closeBlockMenu();
        const blockId = btn.dataset.id;
        if (!blockId || blockId === 'new') return;
        const block = Store.blocks.find(b => b.id === blockId);
        const isPinned = block?.pinned;

        const menu = document.createElement('div');
        menu.className = 'task-context-menu block-action-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', 'Block actions');
        menu.innerHTML = `
            <div class="menu-item" data-action="pin" role="menuitem" tabindex="-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="${isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:0.5rem"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76z"/></svg>
                ${isPinned ? 'Unpin note' : 'Pin note'}
            </div>
            <div class="menu-item" data-action="copy" role="menuitem" tabindex="-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:0.5rem"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                Copy note text
            </div>
            <div class="menu-item" data-action="history" role="menuitem" tabindex="-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:0.5rem"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                Revision history
            </div>
            <div class="menu-item" data-action="sendtovault" role="menuitem" tabindex="-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:0.5rem"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="19" x2="12" y2="11"></line><polyline points="8 15 12 11 16 15"></polyline></svg>
                Send to vault
            </div>
            <div class="menu-divider" role="separator"></div>
            <div class="menu-item menu-item-danger" data-action="delete" role="menuitem" tabindex="-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:0.5rem"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                Delete note
            </div>
        `;

        const rect = btn.getBoundingClientRect();
        menu.style.left = `${rect.right - 180}px`;
        const menuTop = rect.bottom + 4;
        menu.style.top = `${menuTop}px`;
        document.body.appendChild(menu);

        // Adjust if menu goes off bottom of viewport and focus first item
        requestAnimationFrame(() => {
            const menuRect = menu.getBoundingClientRect();
            if (menuRect.bottom > window.innerHeight) {
                menu.style.top = `${rect.top - menuRect.height - 4}px`;
            }
            const firstItem = menu.querySelector('[role="menuitem"]');
            if (firstItem) firstItem.focus();
        });

        const closeHandler = (evt) => {
            if (!menu.contains(evt.target) && evt.target !== btn) {
                this.closeBlockMenu();
            }
        };

        const handleAction = async (evt) => {
            const item = evt.target.closest('.menu-item');
            if (!item) return;
            const action = item.dataset.action;
            if (action === 'pin' && block) {
                App.updateBlockProperty(blockId, 'pinned', !block.pinned,
                    block.pinned ? 'Unpin note' : 'Pin note');
            } else if (action === 'copy') {
                const editor = this.editors.get(blockId);
                const content = editor ? editor.state.doc.toString() : (block?.content || '');
                navigator.clipboard.writeText(content).catch(() => Common.showToast('Clipboard access denied'));
            } else if (action === 'history') {
                HistoryView.openHistory(blockId);
            } else if (action === 'sendtovault') {
                this.closeBlockMenu();
                SendToVault.show(blockId, btn);
                return;
            } else if (action === 'delete') {
                this.closeBlockMenu();
                const confirmed = await Modal.confirm({
                    title: 'Delete Note',
                    message: 'Delete this note permanently?',
                    confirmText: 'Delete',
                    cancelText: 'Cancel'
                });
                if (confirmed) {
                    await App.deleteBlock(blockId, { showToast: true });
                }
                return;
            }
            this.closeBlockMenu();
        };

        menu.addEventListener('click', handleAction);
        document.addEventListener('click', closeHandler);
        document.addEventListener('scroll', closeHandler, true);

        // Keyboard navigation for menu
        const keyHandler = (evt) => {
            const items = [...menu.querySelectorAll('[role="menuitem"]')];
            const idx = items.indexOf(document.activeElement);
            if (evt.key === 'Escape') {
                this.closeBlockMenu();
                btn.focus();
            } else if (evt.key === 'ArrowDown' || evt.key === 'ArrowRight') {
                evt.preventDefault();
                const next = idx < items.length - 1 ? idx + 1 : 0;
                items[next].focus();
            } else if (evt.key === 'ArrowUp' || evt.key === 'ArrowLeft') {
                evt.preventDefault();
                const prev = idx > 0 ? idx - 1 : items.length - 1;
                items[prev].focus();
            } else if (evt.key === 'Enter' || evt.key === ' ') {
                evt.preventDefault();
                if (items[idx]) items[idx].click();
            }
        };
        menu.addEventListener('keydown', keyHandler);

        menu._cleanup = () => {
            document.removeEventListener('click', closeHandler);
            document.removeEventListener('scroll', closeHandler, true);
            menu.removeEventListener('keydown', keyHandler);
        };
    },

    closeBlockMenu() {
        const existing = document.querySelector('.block-action-menu');
        if (existing) {
            existing._cleanup?.();
            existing.remove();
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

    handleTaskToggleClick(e) {
        const btn = e.target.closest('.task-toggle-btn');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const blockId = btn.dataset.id;
        if (!blockId) return;
        const view = this.editors.get(blockId);
        if (view) {
            this.toggleTaskOnCurrentLine(view);
            view.focus();
        }
    },

    toggleTaskOnCurrentLine(view) {
        const state = view.state;
        const pos = state.selection.main.head;
        const line = state.doc.lineAt(pos);
        const result = TaskParser.toggleTaskOnLine(line.text);
        view.dispatch({
            changes: { from: line.from, to: line.to, insert: result.newText },
            selection: { anchor: line.from + result.newText.length }
        });
    },

    toggleHeadingOnCurrentLine(view, level) {
        const state = view.state;
        const pos = state.selection.main.head;
        const line = state.doc.lineAt(pos);
        const text = line.text;

        const match = text.match(/^(#{1,6})\s+(.*)$/);
        const oldPrefixMatch = text.match(/^(#{1,6})\s+/);
        const oldPrefixLen = oldPrefixMatch ? oldPrefixMatch[0].length : 0;

        let newText;
        let newPrefixLen;

        if (match) {
            const currentLevel = match[1].length;
            if (currentLevel === level) {
                // Toggle off
                newText = match[2];
                newPrefixLen = 0;
            } else {
                // Change heading level
                newText = "#".repeat(level) + " " + match[2];
                newPrefixLen = level + 1;
            }
        } else {
            // Add heading
            newText = "#".repeat(level) + " " + text;
            newPrefixLen = level + 1;
        }

        const delta = newPrefixLen - oldPrefixLen;
        const newPos = Math.max(line.from + newPrefixLen, Math.min(line.from + newText.length, pos + delta));

        view.dispatch({
            changes: { from: line.from, to: line.to, insert: newText },
            selection: { anchor: newPos }
        });
    },

    shortcutToCM6(shortcut) {
        return shortcut
            .replace('Ctrl+', 'Mod-')
            .replace('Meta+', 'Mod-')
            .replace('Alt+', 'Alt-')
            .replace('Shift+', 'Shift-')
            .toLowerCase();
    },

    async showTemplatePicker(anchorBtn, blockId) {
        // Remove any existing picker
        const existing = document.querySelector('.template-picker');
        if (existing) { existing.remove(); return; }

        const templates = await AppSettings.getTemplates();
        if (templates.length === 0) return;

        const block = anchorBtn.closest('.block');
        if (!block) return;

        const picker = document.createElement('div');
        picker.className = 'template-picker';
        picker.innerHTML = templates.map(t =>
            `<button class="template-picker-item" data-template-id="${t.id}">${escapeHtml(t.name)}</button>`
        ).join('');

        block.style.position = 'relative';
        block.appendChild(picker);

        const applyTemplate = async (e) => {
            const item = e.target.closest('.template-picker-item');
            if (!item) return;

            const templateId = item.dataset.templateId;
            const template = templates.find(t => t.id === templateId);
            picker.remove();
            document.removeEventListener('click', closeOnOutside);

            const effectiveId = blockId || anchorBtn.dataset.id || 'new';
            if (template && template.content) {
                const view = this.editors.get(effectiveId);
                if (view) {
                    const { snippet } = window.CodeMirror;
                    snippet(template.content)(view, null, 0, view.state.doc.length);
                    view.focus();
                }
            } else {
                // Blank template — just focus
                const view = this.editors.get(effectiveId);
                if (view) view.focus();
            }
        };
        picker.addEventListener('click', applyTemplate);

        // Close on outside click
        const closeOnOutside = (ev) => {
            if (!picker.contains(ev.target)) {
                picker.remove();
                document.removeEventListener('click', closeOnOutside);
            }
        };
        document.addEventListener('click', closeOnOutside);
    },

    handleCloneContextClick(e) {
        const btn = e.target.closest('.clone-context-btn');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const blockId = btn.dataset.id;
        if (!blockId) return;

        const block = Store.blocks.find(b => b.id === blockId);
        if (block) {
            App.showNewNoteModal('type', { cloneTags: [...(block.tags || [])] });
        }
    },

    handleAiButtonClick(e) {
        const btn = e.target.closest('.ai-btn');
        if (!btn) return;
        e.stopPropagation();
        if (btn.classList.contains('ai-btn-disabled')) {
            showToast('Enable AI Features in Settings first');
            return;
        }
        const blockId = btn.dataset.id;
        if (blockId && blockId !== 'new') {
            AIAssistant.openPanel(blockId);
        }
    },

    // --- Drag-and-drop wikilink handlers (pointer events) ---

    handleDragStart(e) {
        const handle = e.target.closest('.drag-handle-btn');
        if (!handle) return;
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        const article = handle.closest('article.block');
        const blockId = handle.dataset.blockId;
        const block = Store.blocks.find(b => b.id === blockId);
        if (!block) return;

        const title = Store.getBlockTitle(block);
        this._dragState = {
            active: false,
            startX: e.clientX,
            startY: e.clientY,
            sourceBlockId: blockId,
            sourceTitle: title || '',
            sourceArticle: article,
            targetBlockId: null,
            indicator: null,
        };

        if (!this._dragMoveHandler) {
            this._dragMoveHandler = this._handleDragMove.bind(this);
            this._dragEndHandler = this._handleDragEnd.bind(this);
        }
        document.addEventListener('mousemove', this._dragMoveHandler);
        document.addEventListener('mouseup', this._dragEndHandler);
        // Safety cleanup if mouseup never fires (e.g. window loses focus)
        if (!this._dragBlurHandler) {
            this._dragBlurHandler = () => {
                if (this._dragState?.active !== undefined) {
                    document.removeEventListener('mousemove', this._dragMoveHandler);
                    document.removeEventListener('mouseup', this._dragEndHandler);
                    this._dragState = { active: false };
                    document.querySelectorAll('.wikilink-drop-target,.dragging-source').forEach(el => {
                        el.classList.remove('wikilink-drop-target', 'dragging-source');
                    });
                    document.body.classList.remove('is-dragging-wikilink');
                    const indicator = document.querySelector('.wikilink-drop-indicator');
                    if (indicator) indicator.remove();
                }
            };
            document.addEventListener('visibilitychange', this._dragBlurHandler);
        }
    },

    _handleDragMove(e) {
        const ds = this._dragState;
        if (!ds.sourceBlockId) return;

        // Activate after 5px movement
        if (!ds.active) {
            const dx = e.clientX - ds.startX;
            const dy = e.clientY - ds.startY;
            if (dx * dx + dy * dy < 25) return;
            ds.active = true;
            ds.sourceArticle.classList.add('dragging-source');
            document.body.classList.add('is-dragging-wikilink');

            ds.indicator = document.createElement('div');
            ds.indicator.className = 'wikilink-drop-indicator';
            document.body.appendChild(ds.indicator);
        }

        // Find block under cursor (hide source to avoid hitting it)
        ds.sourceArticle.style.pointerEvents = 'none';
        const hitEl = document.elementFromPoint(e.clientX, e.clientY);
        ds.sourceArticle.style.pointerEvents = '';

        const targetBlock = hitEl?.closest('article.block');

        // Clear previous highlights
        document.querySelectorAll('.wikilink-drop-target').forEach(el => el.classList.remove('wikilink-drop-target'));

        if (!targetBlock || targetBlock.dataset.id === 'new' || targetBlock.dataset.id === ds.sourceBlockId) {
            ds.targetBlockId = null;
            if (ds.indicator) ds.indicator.style.display = 'none';
            return;
        }

        targetBlock.classList.add('wikilink-drop-target');
        ds.targetBlockId = targetBlock.dataset.id;

        // Position indicator line at bottom of target block
        if (ds.indicator) {
            const rect = targetBlock.getBoundingClientRect();
            ds.indicator.style.display = '';
            ds.indicator.style.top = rect.bottom + 'px';
            ds.indicator.style.left = rect.left + 'px';
            ds.indicator.style.width = rect.width + 'px';
        }
    },

    _handleDragEnd(e) {
        document.removeEventListener('mousemove', this._dragMoveHandler);
        document.removeEventListener('mouseup', this._dragEndHandler);
        if (this._dragBlurHandler) {
            document.removeEventListener('visibilitychange', this._dragBlurHandler);
            this._dragBlurHandler = null;
        }

        const ds = this._dragState;
        if (!ds.active) {
            this._dragState = { active: false };
            return;
        }

        // Clean up visual feedback
        if (ds.sourceArticle) ds.sourceArticle.classList.remove('dragging-source');
        if (ds.indicator) ds.indicator.remove();
        document.body.classList.remove('is-dragging-wikilink');
        document.querySelectorAll('.wikilink-drop-target').forEach(el => el.classList.remove('wikilink-drop-target'));

        // Insert wikilink into target
        if (ds.targetBlockId && ds.targetBlockId !== ds.sourceBlockId) {
            const wikilink = ds.sourceTitle
                ? `[[${ds.sourceBlockId}|${ds.sourceTitle}]]`
                : `[[${ds.sourceBlockId}]]`;

            const editor = this.editors.get(ds.targetBlockId);
            const targetBlock = Store.blocks.find(b => b.id === ds.targetBlockId);
            if (!targetBlock) { this._dragState = { active: false }; return; }

            if (editor && this._focusedBlockId === ds.targetBlockId) {
                this.insertTextAtSelection(editor, wikilink);
            } else {
                const content = targetBlock.content || '';
                const newContent = content.endsWith('\n') ? content + wikilink : content + '\n' + wikilink;
                App.saveBlockContent(ds.targetBlockId, newContent, {
                    commit: true,
                    commitMessage: `Link to ${ds.sourceTitle || ds.sourceBlockId}`
                });
                // Sync CodeMirror editor with the new content
                if (editor) {
                    const normalized = newContent.endsWith('\n') ? newContent : newContent + '\n';
                    editor.dispatch({
                        changes: { from: 0, to: editor.state.doc.length, insert: normalized }
                    });
                    this.originalContents.set(ds.targetBlockId, normalized);
                }
            }
            Common.showToast(`Linked to ${ds.sourceTitle || ds.sourceBlockId}`);
        }

        this._dragState = { active: false };
    },

    createMobileToolbar() {
        if (!('ontouchstart' in window)) return;

        // Create toolbar DOM and button listeners (once)
        if (!this._mobileToolbar) {
            const toolbar = document.createElement('div');
            toolbar.className = 'mobile-toolbar hidden';
            toolbar.innerHTML = `
                <button class="mobile-toolbar-btn" data-action="newNote" title="New Note">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                </button>
                <button class="mobile-toolbar-btn" data-action="outdent" title="Outdent">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 8 3 12 7 16"></polyline><line x1="11" y1="4" x2="21" y2="4"></line><line x1="11" y1="9" x2="21" y2="9"></line><line x1="11" y1="14" x2="21" y2="14"></line><line x1="11" y1="19" x2="21" y2="19"></line></svg>
                </button>
                <button class="mobile-toolbar-btn" data-action="indent" title="Indent">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 8 7 12 3 16"></polyline><line x1="11" y1="4" x2="21" y2="4"></line><line x1="11" y1="9" x2="21" y2="9"></line><line x1="11" y1="14" x2="21" y2="14"></line><line x1="11" y1="19" x2="21" y2="19"></line></svg>
                </button>
                <button class="mobile-toolbar-btn" data-action="h1" title="Heading 1">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="4" y1="4" x2="4" y2="20"></line>
                        <line x1="12" y1="4" x2="12" y2="20"></line>
                        <line x1="4" y1="12" x2="12" y2="12"></line>
                        <line x1="18" y1="8" x2="18" y2="20"></line>
                        <polyline points="15 11 18 8"></polyline>
                    </svg>
                </button>
                <button class="mobile-toolbar-btn" data-action="h2" title="Heading 2">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="4" y1="4" x2="4" y2="20"></line>
                        <line x1="12" y1="4" x2="12" y2="20"></line>
                        <line x1="4" y1="12" x2="12" y2="12"></line>
                        <path d="M15 10a2.5 2.5 0 0 1 5 0c0 4-5 6-5 10h5"></path>
                    </svg>
                </button>
                <button class="mobile-toolbar-btn" data-action="h3" title="Heading 3">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="4" y1="4" x2="4" y2="20"></line>
                        <line x1="12" y1="4" x2="12" y2="20"></line>
                        <line x1="4" y1="12" x2="12" y2="12"></line>
                        <path d="M15 10h5l-3 4h3a3 3 0 0 1 0 6h-5"></path>
                    </svg>
                </button>
                <button class="mobile-toolbar-btn" data-action="toggleTask" title="Toggle task">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
                </button>
            `;
            document.body.appendChild(toolbar);
            this._mobileToolbar = toolbar;

            toolbar.querySelectorAll('.mobile-toolbar-btn').forEach(btn => {
                btn.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                });
                btn.addEventListener('touchstart', (e) => {
                    e.preventDefault();
                    const action = btn.dataset.action;
                    const view = this._focusedEditor;
                    if (!view) return;

                    const { indentMore, indentLess } = window.CodeMirror;
                    if (action === 'indent') {
                        indentMore(view);
                    } else if (action === 'outdent') {
                        indentLess(view);
                    } else if (action === 'h1') {
                        this.toggleHeadingOnCurrentLine(view, 1);
                    } else if (action === 'h2') {
                        this.toggleHeadingOnCurrentLine(view, 2);
                    } else if (action === 'h3') {
                        this.toggleHeadingOnCurrentLine(view, 3);
                    } else if (action === 'toggleTask') {
                        this.toggleTaskOnCurrentLine(view);
                    } else if (action === 'newNote') {
                        App.handleNewNote();
                    }
                }, { passive: false });
            });
        }

        // Re-attach viewport handlers every render (cleanup removes them)
        if (window.visualViewport) {
            if (this._mobileViewportHandler) {
                window.visualViewport.removeEventListener('resize', this._mobileViewportHandler);
                window.visualViewport.removeEventListener('scroll', this._mobileViewportHandler);
            }
            const updatePosition = () => {
                if (!this._mobileToolbar) return;
                const vv = window.visualViewport;
                if (!vv) return;
                const keyboardOpen = vv.height < window.innerHeight * 0.8;
                if (keyboardOpen && this._focusedEditor) {
                    this._mobileToolbar.classList.remove('hidden');
                    const offset = window.innerHeight - vv.height - vv.offsetTop;
                    this._mobileToolbar.style.bottom = offset + 'px';
                } else if (!keyboardOpen) {
                    this._mobileToolbar.classList.add('hidden');
                }
            };
            this._mobileViewportHandler = updatePosition;
            window.visualViewport.addEventListener('resize', updatePosition);
            window.visualViewport.addEventListener('scroll', updatePosition);
        }
    },

    showMobileToolbar() {
        if (!this._mobileToolbar) return;
        const vv = window.visualViewport;
        if (vv && vv.height < window.innerHeight * 0.8) {
            this._mobileToolbar.classList.remove('hidden');
            const offset = window.innerHeight - vv.height - vv.offsetTop;
            this._mobileToolbar.style.bottom = offset + 'px';
        }
        const fab = document.getElementById('fabNewNote');
        if (fab) fab.style.display = 'none';
    },

    hideMobileToolbar() {
        if (!this._mobileToolbar) return;
        this._mobileToolbar.classList.add('hidden');
        const fab = document.getElementById('fabNewNote');
        if (fab) fab.style.display = '';
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


    // Focus editor for a block
    focusEditor(blockId) {
        const editor = this.editors.get(blockId);
        if (editor) {
            editor.focus();
        }
    },

    // Get the ID of the currently focused block
    getFocusedBlockId() {
        return this._focusedBlockId || null;
    },

    // Mobile keyboard scroll handling
    _mobileKeyboardHandler: null,

    setupMobileKeyboardHandler() {
        if (window.innerWidth > 768) return;
        if (!window.visualViewport) return;
        if (this._mobileKeyboardHandler) return;

                const handleViewportResize = () => {
            const vv = window.visualViewport;
            const keyboardHeight = window.innerHeight - vv.height;

            if (keyboardHeight > 50) {
                // Ensure scrolling is enabled when keyboard is open
                const container = document.getElementById('viewContainer');
                container.style.overflowY = 'auto';

                // Find the focused editor
                const focusedEditor = document.querySelector('.cm-editor.cm-focused');
                if (!focusedEditor) return;

                const block = focusedEditor.closest('.block');
                if (!block) return;

                // Account for mobile toolbar height
                const toolbarHeight = DocumentView._mobileToolbar ? DocumentView._mobileToolbar.offsetHeight : 0;
                const containerRect = container.getBoundingClientRect();
                const blockRect = block.getBoundingClientRect();

                const visibleTop = containerRect.top;
                const visibleBottom = containerRect.bottom - toolbarHeight;
                const visibleHeight = visibleBottom - visibleTop;

                const blockTop = blockRect.top - visibleTop;
                const blockBottom = blockRect.bottom - visibleTop;

                if (blockBottom > visibleHeight || blockTop < 0) {
                    const offset = blockTop - (visibleHeight - blockRect.height) / 2;
                    container.scrollTo({
                        top: container.scrollTop + offset,
                        behavior: 'smooth'
                    });
                }
            }
        };

        window.visualViewport.addEventListener('resize', handleViewportResize);
        this._mobileKeyboardHandler = handleViewportResize;
    },

    cleanupMobileKeyboardHandler() {
        if (this._mobileKeyboardHandler && window.visualViewport) {
            window.visualViewport.removeEventListener('resize', this._mobileKeyboardHandler);
            this._mobileKeyboardHandler = null;
        }
        if (this._mobileViewportHandler && window.visualViewport) {
            window.visualViewport.removeEventListener('resize', this._mobileViewportHandler);
            window.visualViewport.removeEventListener('scroll', this._mobileViewportHandler);
            this._mobileViewportHandler = null;
        }
        this.hideMobileToolbar();
    },

    // Focus the "new note" block at the bottom
    focusNewBlock() {
        const doFocus = () => {
            const newBlock = document.querySelector('.block[data-id="new"]');
            const editor = this.editors.get('new');

            if (newBlock && editor) {
                if (window.innerWidth <= 768) {
                    editor.focus();
                    requestAnimationFrame(() => {
                        const toolbarHeight = this._mobileToolbar && !this._mobileToolbar.classList.contains('hidden')
                            ? this._mobileToolbar.offsetHeight : 0;
                        const container = document.getElementById('viewContainer');
                        const containerRect = container.getBoundingClientRect();
                        const blockRect = newBlock.getBoundingClientRect();
                        const visibleHeight = containerRect.height - toolbarHeight;
                        const scrollTarget = container.scrollTop + blockRect.top - containerRect.top - (visibleHeight - blockRect.height) / 2;
                        container.scrollTo({ top: scrollTarget, behavior: 'smooth' });
                    });
                } else {
                    newBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    editor.focus();
                }
                return true;
            }
            return false;
        };

        // Try immediately in case the element is already in the DOM
        if (doFocus()) return;

        // Disconnect any previous focus observer
        if (this._focusObserver) {
            this._focusObserver.disconnect();
            this._focusObserver = null;
        }

        // Watch for the block element to be inserted
        const container = document.getElementById('viewContainer');
        let observer;
        const cleanup = () => {
            if (observer) { observer.disconnect(); observer = null; }
            if (this._focusObserver === observer) this._focusObserver = null;
        };

        const attemptFocus = () => {
            if (doFocus()) {
                cleanup();
            }
        };

        observer = new MutationObserver(() => {
            if (document.querySelector('.block[data-id="new"]')) {
                // Element exists but editor might not be ready yet — use rAF to wait for CM init
                requestAnimationFrame(attemptFocus);
            }
        });
        observer.observe(container, { childList: true, subtree: true });
        this._focusObserver = observer;

        // Safety: stop trying after 1 second
        setTimeout(() => {
            cleanup();
            if (!doFocus()) {
                console.warn('focusNewBlock: could not find new block editor after 1s');
            }
        }, 1000);
    },

    // Navigate to a block by wikilink target — scroll into view in document, or open modal if filtered out
    navigateToBlock(targetId) {
        const block = Store.findBlockByWikilink(targetId);
        if (!block) {
            this.openNoteModal(targetId);
            return;
        }
        RecentAccessTracker.touch(block.id);
        const blockEl = document.querySelector(`.block[data-id="${CSS.escape(block.id)}"]`);
        if (blockEl) {
            blockEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const editor = this.editors.get(block.id);
            if (editor) editor.focus();
        } else {
            this.openNoteModal(targetId);
        }
    },

    // Open a modal showing the referenced note's content (or a "create" option)
    openNoteModal(targetId) {
        const block = Store.findBlockByWikilink(targetId);

        if (!block) {
            Modal.create({
                title: 'Note Not Found',
                modalClass: 'tag-modal content-modal note-modal',
                content: `
                    <div class="note-modal-not-found">
                        <p>No note found with name: <strong>${Common.escapeHtml(targetId)}</strong></p>
                        <button class="note-modal-create-btn" data-target="${Common.escapeHtml(targetId)}">Create this note</button>
                    </div>
                `
            });
            const btn = document.querySelector('.note-modal-create-btn');
            if (btn) {
                btn.addEventListener('click', () => {
                    const closestModal = btn.closest('.tag-modal-overlay');
                    if (closestModal) closestModal.remove();
                    App.createNewBlockWithId(targetId);
                });
            }
            return;
        }

        let renderedContent;
        const rawContent = block.content || '';
        if (window.marked && typeof window.marked.parse === 'function') {
            renderedContent = Common.sanitizeHtml(marked.parse(rawContent));
        } else {
            renderedContent = `<pre class="note-modal-raw">${Common.escapeHtml(rawContent)}</pre>`;
        }

        const tags = (block.tags && block.tags.length > 0)
            ? `<div class="note-modal-tags">${block.tags.map(t => `<span class="badge">${Common.escapeHtml(t)}</span>`).join(' ')}</div>`
            : '';

        Modal.create({
            title: Common.escapeHtml(block.id),
            modalClass: 'tag-modal content-modal note-modal',
            content: `
                <div class="note-modal-header-info">
                    ${tags}
                </div>
                <div class="note-modal-content">
                    ${renderedContent}
                </div>
            `
        });
    },

};

Object.assign(DocumentView, DocumentMarkdownParser);
Object.assign(DocumentView, DocumentSpeechRecognition);
Object.assign(DocumentView, DocumentHtmlRenderer);
Object.assign(DocumentView, DocumentContentManager);
Object.assign(DocumentView, DocumentDiffHelper);
Object.assign(DocumentView, DocumentInteractions);
Object.assign(DocumentView, DocumentEditorSetup);
Object.assign(DocumentView, DocumentDecorations);
