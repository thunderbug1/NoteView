/**
 * Document View - Live markdown editing with CodeMirror 6
 * Features Obsidian-like live preview where markdown syntax is hidden
 * and rendered inline (e.g., **bold** shows as bold without asterisks)
 */

const DocumentView = {
    // Track CodeMirror editor instances by block ID
    editors: new Map(),
    // Track highlight positions by block ID (set before dispatching to trigger decoration)
    _highlightPositions: new Map(),
    newBlockContent: '',
    pendingNewTags: null,
    saveTimeouts: new Map(), // blockId -> timeoutId
    originalContents: new Map(), // blockId -> original content for change detection
    // Track which blocks are collapsed by block ID
    collapsedBlocks: new Map(),
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
    // Mobile toolbar state
    _mobileToolbar: null,
    _focusedEditor: null,

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
        // Stop any active speech recognition before re-rendering
        if (this._recordingBlockId) {
            this.stopSpeechRecognition();
        }

        // Clean up mobile keyboard handler before DOM rebuild
        this.cleanupMobileKeyboardHandler();

        const container = document.getElementById('viewContainer');
        container.className = 'document-view';

        // Wait for CodeMirror to be loaded
        await this.waitForCodeMirror();

        // Initialize mobile toolbar (once, only on touch devices)
        this.createMobileToolbar();

        const sorted = SortManager.sortItems('document', blocks);

        // Build HTML for blocks - use div containers for CodeMirror
        container.innerHTML = sorted.map(block => `
            <article class="block ${block.pinned ? 'block-pinned' : ''}" data-id="${block.id}">
                ${this.renderCollapseButton(block)}
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

        // Add event delegation for task toggle button click
        if (this._taskToggleHandler) {
            container.removeEventListener('click', this._taskToggleHandler);
        }
        this._taskToggleHandler = this.handleTaskToggleClick.bind(this);
        container.addEventListener('click', this._taskToggleHandler);

        // Add event delegation for pin button click
        if (this._pinHandler) {
            container.removeEventListener('click', this._pinHandler);
        }
        this._pinHandler = this.handlePinClick.bind(this);
        container.addEventListener('click', this._pinHandler);

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

        this.attachEventListeners();

        // Restore collapsed state after DOM rebuild
        this.restoreCollapsedState(sorted);

        // On mobile, disable scrolling when content fits to prevent elastic bouncing
        requestAnimationFrame(() => this.adjustScrollability());
    },

    adjustScrollability() {
        const container = document.getElementById('viewContainer');
        if (window.innerWidth > 768) {
            container.style.overflowY = '';
            return;
        }
        container.style.overflowY = container.scrollHeight <= container.clientHeight ? 'hidden' : '';
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
            .map(tag => TagModal._renderBadge(tag))
            .join('');
    },

    isSpeechRecognitionSupported() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    },

    renderCollapseButton(block) {
        const isCollapsed = this.collapsedBlocks.has(block.id);
        return `<button class="collapse-btn ${isCollapsed ? 'collapsed' : ''}" data-id="${block.id}" title="${isCollapsed ? 'Expand note' : 'Collapse note'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="${isCollapsed ? '15 18 9 12 15 6' : '6 9 12 15 18 9'}"/></svg>
        </button>`;
    },

    // Render metadata header above block (like Obsidian/Tana)
    renderBlockMetadata(block) {
        const parts = [];

        // Title (from first heading)
        const titleMatch = block.content?.match(/^#\s+(.+)$/m);
        if (titleMatch) {
            parts.push(`<span class="block-title">${Common.escapeHtml(titleMatch[1].trim())}</span>`);
        }

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
                ${sortedTags.map(tag => TagModal._renderBadge(tag)).join('')}
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

        // Task toggle button
        const actions = [];
        actions.push(`
            <button class="task-toggle-btn" data-id="${block.id}" title="Toggle task on current line (Alt+T)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
            </button>
        `);

        // Pin button
        actions.push(`
            <button class="pin-btn ${block.pinned ? 'pinned' : ''}" data-id="${block.id}" title="${block.pinned ? 'Unpin note' : 'Pin note'}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="${block.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76z"/></svg>
            </button>
        `);


        // Microphone / Speech-to-Text button
        if (this.isSpeechRecognitionSupported()) {
            actions.push(`
                <button class="mic-btn" data-id="${block.id}" title="Dictate text">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                </button>
            `);
        }

        // AI Assistant button (always shown, disabled when AI is off)
        if (window.AIAssistant) {
            const disabled = !AIAssistant.enabled;
            actions.push(`
                <button class="ai-btn${disabled ? ' ai-btn-disabled' : ''}" data-id="${block.id}" title="${disabled ? 'Enable AI in Settings to use' : 'AI Assistant (Ctrl+Shift+A)'}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>
                </button>
            `);
        }

        // Copy button
        actions.push(`
            <button class="copy-btn" data-id="${block.id}" title="Copy note text">
                <svg class="copy-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                <svg class="copied-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </button>
        `);

        // Delete button (always shown, far right)
        actions.push(`
            <button class="delete-btn" data-id="${block.id}" title="Delete note">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
        `);

        parts.push(`<div class="block-actions">${actions.join('')}</div>`);

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

        // Copy buttons
        container.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const blockId = e.currentTarget.dataset.id;
                if (!blockId) return;
                const editor = this.editors.get(blockId);
                const content = editor ? editor.state.doc.toString() : (Store.blocks.find(b => b.id === blockId)?.content || '');
                navigator.clipboard.writeText(content).then(() => {
                    btn.classList.add('copied');
                    setTimeout(() => btn.classList.remove('copied'), 1500);
                });
            });
        });

        // AI Assistant buttons
        container.querySelectorAll('.ai-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.classList.contains('ai-btn-disabled')) {
                    AIAssistant._showToast('Enable AI Features in Settings first');
                    return;
                }
                const blockId = btn.dataset.id;
                if (blockId && blockId !== 'new') {
                    AIAssistant.openOverlay(blockId);
                }
            });
        });

        // Setup mobile keyboard scroll handling
        this.setupMobileKeyboardHandler();
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

    handlePinClick(e) {
        const pinBtn = e.target.closest('.pin-btn');
        if (!pinBtn) return;
        e.preventDefault();
        e.stopPropagation();
        const blockId = pinBtn.dataset.id;
        if (blockId && blockId !== 'new') {
            const block = Store.blocks.find(b => b.id === blockId);
            if (block) {
                App.updateBlockProperty(blockId, 'pinned', !block.pinned,
                    block.pinned ? 'Unpin note' : 'Pin note');
            }
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

    shortcutToCM6(shortcut) {
        return shortcut
            .replace('Ctrl+', 'Mod-')
            .replace('Meta+', 'Mod-')
            .replace('Alt+', 'Alt-')
            .replace('Shift+', 'Shift-')
            .toLowerCase();
    },

    handleMicClick(e) {
        const micBtn = e.target.closest('.mic-btn');
        if (!micBtn) return;
        e.preventDefault();
        e.stopPropagation();
        const blockId = micBtn.dataset.id;
        if (!blockId) return;

        if (this._recordingBlockId === blockId) {
            this.stopSpeechRecognition();
        } else {
            this.startSpeechRecognition(blockId, micBtn);
        }
    },

    handleCollapseClick(e) {
        // Check for collapse button click
        const collapseBtn = e.target.closest('.collapse-btn');
        if (collapseBtn) {
            e.preventDefault();
            e.stopPropagation();
            const blockId = collapseBtn.dataset.id;
            if (blockId && blockId !== 'new') {
                if (this.collapsedBlocks.has(blockId)) {
                    this.expandBlock(blockId);
                } else {
                    this.collapseBlock(blockId);
                }
            }
            return;
        }
    },

    collapseBlock(blockId) {
        this.collapsedBlocks.set(blockId, true);
        const blockEl = document.querySelector(`.block[data-id="${blockId}"]`);
        if (!blockEl) return;

        const editorDiv = blockEl.querySelector('.block-editor');
        if (editorDiv) editorDiv.style.display = 'none';

        // Update button visual
        const collapseBtn = blockEl.querySelector('.collapse-btn');
        if (collapseBtn) {
            collapseBtn.classList.add('collapsed');
            collapseBtn.title = 'Expand note';
            const svg = collapseBtn.querySelector('polyline');
            if (svg) svg.setAttribute('points', '15 18 9 12 15 6');
        }

        blockEl.classList.add('block-collapsed');
    },

    expandBlock(blockId) {
        this.collapsedBlocks.delete(blockId);
        const blockEl = document.querySelector(`.block[data-id="${blockId}"]`);
        if (!blockEl) return;

        const editorDiv = blockEl.querySelector('.block-editor');
        if (editorDiv) editorDiv.style.display = '';

        // Update button visual
        const collapseBtn = blockEl.querySelector('.collapse-btn');
        if (collapseBtn) {
            collapseBtn.classList.remove('collapsed');
            collapseBtn.title = 'Collapse note';
            const svg = collapseBtn.querySelector('polyline');
            if (svg) svg.setAttribute('points', '6 9 12 15 18 9');
        }

        blockEl.classList.remove('block-collapsed');
    },

    restoreCollapsedState(blocks) {
        for (const block of blocks) {
            if (this.collapsedBlocks.has(block.id)) {
                const blockEl = document.querySelector(`.block[data-id="${block.id}"]`);
                if (!blockEl) continue;
                const editorDiv = blockEl.querySelector('.block-editor');
                if (editorDiv) editorDiv.style.display = 'none';
                blockEl.classList.add('block-collapsed');
            }
        }
    },

    startSpeechRecognition(blockId, btnElement) {
        // Stop any existing recording
        if (this._recognition) {
            this.stopSpeechRecognition();
        }

        const view = this.editors.get(blockId);
        if (!view) return;

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = '';

        this._recognition = recognition;
        this._recordingBlockId = blockId;
        this._isStopping = false;

        // Visual: activate the button
        btnElement.classList.add('recording');
        btnElement.title = 'Stop dictation';

        // Keep metadata bar visible during recording
        const block = btnElement.closest('.block');
        if (block) {
            block.classList.add('block-recording');
        }

        // Focus the editor so cursor position is known
        view.focus();

        recognition.onresult = (event) => {
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                if (result.isFinal) {
                    finalTranscript += result[0].transcript;
                }
            }

            if (finalTranscript) {
                const currentView = this.editors.get(blockId);
                if (currentView) {
                    this.insertTextAtSelection(currentView, finalTranscript);
                }
            }
        };

        recognition.onerror = (event) => {
            console.warn('Speech recognition error:', event.error);
            this.stopSpeechRecognition();
        };

        recognition.onend = () => {
            // Auto-restart if user didn't explicitly stop (Chrome pauses after silence)
            if (!this._isStopping && this._recordingBlockId === blockId) {
                try {
                    recognition.start();
                } catch (e) {
                    this.cleanupRecognition();
                }
            } else {
                this.cleanupRecognition();
            }
        };

        recognition.start();
    },

    stopSpeechRecognition() {
        this._isStopping = true;
        if (this._recognition) {
            this._recognition.stop();
        }
        this.cleanupRecognition();
    },

    cleanupRecognition() {
        const blockId = this._recordingBlockId;
        this._recognition = null;
        this._recordingBlockId = null;

        if (blockId) {
            const btn = document.querySelector(`.mic-btn[data-id="${blockId}"]`);
            if (btn) {
                btn.classList.remove('recording');
                btn.title = 'Dictate text';
            }
            const block = document.querySelector(`.block[data-id="${blockId}"]`);
            if (block) {
                block.classList.remove('block-recording');
            }
        }
    },

    createMobileToolbar() {
        if (this._mobileToolbar) return;
        if (!('ontouchstart' in window)) return;

        const toolbar = document.createElement('div');
        toolbar.className = 'mobile-toolbar hidden';
        toolbar.innerHTML = `
            <button class="mobile-indent-outdent" data-action="outdent" title="Outdent">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button class="mobile-indent-outdent" data-action="indent" title="Indent">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
        `;
        document.body.appendChild(toolbar);
        this._mobileToolbar = toolbar;

        toolbar.querySelectorAll('.mobile-indent-outdent').forEach(btn => {
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
                }
            }, { passive: false });
        });

        if (window.visualViewport) {
            const updatePosition = () => {
                if (!this._mobileToolbar || this._mobileToolbar.classList.contains('hidden')) return;
                const vv = window.visualViewport;
                const offset = window.innerHeight - vv.height - vv.offsetTop;
                toolbar.style.bottom = offset + 'px';
            };
            window.visualViewport.addEventListener('resize', updatePosition);
            window.visualViewport.addEventListener('scroll', updatePosition);
        }
    },

    showMobileToolbar() {
        if (!this._mobileToolbar) return;
        const vv = window.visualViewport;
        if (!vv) return;
        // Only show when virtual keyboard is open
        if (vv.height >= window.innerHeight * 0.8) return;
        this._mobileToolbar.classList.remove('hidden');
        const offset = window.innerHeight - vv.height - vv.offsetTop;
        this._mobileToolbar.style.bottom = offset + 'px';
    },

    hideMobileToolbar() {
        if (!this._mobileToolbar) return;
        this._mobileToolbar.classList.add('hidden');
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

    shouldPromptForLargePaste(text) {
        if (!text || typeof text !== 'string') {
            return false;
        }

        const normalized = text.replace(/\r\n/g, '\n');
        const lineCount = normalized.split('\n').length;
        const trimmed = normalized.trim();

        if (!trimmed || this.isFencedContent(trimmed)) {
            return false;
        }

        return lineCount >= this.fencedBlockThresholds.lines || normalized.length >= this.fencedBlockThresholds.chars;
    },

    isFencedContent(text) {
        return /^```[^\n`]*\n[\s\S]*\n```$/.test(text.trim());
    },

    summarizePastedText(text) {
        const normalized = text.replace(/\r\n/g, '\n');
        const lines = normalized.split('\n');

        return {
            chars: normalized.length,
            lines: lines.length,
            preview: lines.slice(0, 4).join('\n').trim()
        };
    },

    showLargePasteModal(text) {
        const summary = this.summarizePastedText(text);
        const preview = summary.preview || '(empty)';

        return new Promise((resolve) => {
            let resolved = false;
            const finish = (value) => {
                if (resolved) return;
                resolved = true;
                resolve(value);
            };

            const modal = Modal.create({
                title: 'Large Paste Detected',
                modalClass: 'tag-modal large-paste-modal',
                content: `
                    <div class="large-paste-summary">
                        <p>You pasted ${summary.lines} lines and ${summary.chars} characters. Insert it as a collapsible block?</p>
                        <pre class="large-paste-preview">${escapeHtml(preview)}</pre>
                    </div>
                    <div class="large-paste-actions">
                        <button class="settings-btn secondary" data-action="normal">Paste Normally</button>
                        <button class="settings-btn secondary" data-action="log">Paste As Log Block</button>
                        <button class="settings-btn primary" data-action="code">Paste As Code Block</button>
                    </div>
                `,
                onClose: () => finish(null)
            });

            modal.querySelectorAll('[data-action]').forEach((button) => {
                button.addEventListener('click', () => {
                    const action = button.dataset.action;
                    finish(action);
                    modal.close();
                });
            });
        });
    },

    normalizePastedText(text) {
        return text.replace(/\r\n/g, '\n').replace(/\u0000/g, '');
    },

    buildFencedPaste(view, text, kind) {
        const normalized = this.normalizePastedText(text);
        const selection = view.state.selection.main;
        const beforeChar = selection.from > 0 ? view.state.sliceDoc(selection.from - 1, selection.from) : '';
        const afterChar = selection.to < view.state.doc.length ? view.state.sliceDoc(selection.to, selection.to + 1) : '';
        const prefix = beforeChar && beforeChar !== '\n' ? '\n' : '';
        const suffix = afterChar && afterChar !== '\n' ? '\n' : '';
        const infoString = kind === 'log' ? 'log' : 'code';
        const body = normalized.endsWith('\n') ? normalized : `${normalized}\n`;

        return `${prefix}\`\`\`${infoString}\n${body}\`\`\`${suffix}`;
    },

    insertTextAtSelection(view, text) {
        const selection = view.state.selection.main;
        const anchor = selection.from + text.length;
        view.dispatch({
            changes: { from: selection.from, to: selection.to, insert: text },
            selection: { anchor, head: anchor },
            scrollIntoView: true
        });
        view.focus();
    },

    async handleLargePaste(view, text) {
        const action = await this.showLargePasteModal(text);
        if (!action) {
            view.focus();
            return;
        }

        if (action === 'normal') {
            this.insertTextAtSelection(view, this.normalizePastedText(text));
            return;
        }

        this.insertTextAtSelection(view, this.buildFencedPaste(view, text, action));
    },

    async handleExtractCut(view, selectedText, selection) {
        const result = await this.showExtractCutModal(selectedText);
        if (!result) {
            view.dispatch({ changes: { from: selection.from, to: selection.to, insert: '' } });
            view.focus();
            return;
        }

        const title = result.title || '';
        const content = title ? `# ${title}\n\n${selectedText}` : selectedText;

        await Store.createBlock(content);
        SelectionManager.updateTagCounts();
        TimelineView.invalidateCache();

        const replacement = title ? `[[${title}]]` : '';
        view.dispatch({
            changes: { from: selection.from, to: selection.to, insert: replacement },
            scrollIntoView: true
        });
        view.focus();
    },

    showExtractCutModal(text) {
        const lines = text.split('\n').length;
        const chars = text.length;

        return new Promise((resolve) => {
            let resolved = false;
            const finish = (value) => {
                if (resolved) return;
                resolved = true;
                resolve(value);
            };

            const modal = Modal.create({
                title: 'Extract to New Note',
                modalClass: 'tag-modal large-paste-modal extract-cut-modal',
                content: `
                    <div class="large-paste-summary">
                        <p>You cut ${lines} lines (${chars} characters). Extract into a new note?</p>
                    </div>
                    <div class="extract-cut-title-row">
                        <label for="extract-title-input">Title <span style="font-weight:normal;color:var(--text-muted)">(optional — needed to link back)</span></label>
                        <input type="text" id="extract-title-input" class="modal-prompt-input" placeholder="Enter note title..." value="" />
                    </div>
                    <div class="large-paste-actions">
                        <button class="settings-btn secondary" data-action="extract">Extract</button>
                        <button class="settings-btn primary" data-action="extract-link">Extract & Link</button>
                    </div>
                `,
                onClose: () => finish(null)
            });

            const input = modal.querySelector('#extract-title-input');
            setTimeout(() => { input.focus(); input.select(); }, 10);

            const submit = (withLink) => {
                const title = input.value.trim();
                if (withLink && !title) return;
                finish(withLink ? { title } : { title: '' });
                modal.close();
            };

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const title = input.value.trim();
                    finish(title ? { title } : { title: '' });
                    modal.close();
                }
                if (e.key === 'Escape') {
                    finish(null);
                    modal.close();
                }
            });

            modal.querySelector('[data-action="extract-link"]').addEventListener('click', () => submit(true));
            modal.querySelector('[data-action="extract"]').addEventListener('click', () => submit(false));
        });
    },

    getFencedBlocks(text) {
        const fencedBlocks = [];
        const regex = /(^|\r?\n)```([^\r\n`]*)\r?\n([\s\S]*?)\r?\n```(?=\r?\n|$)/g;
        let match;

        while ((match = regex.exec(text)) !== null) {
            const prefixLength = match[1].length;
            const blockText = match[0].slice(prefixLength);
            const from = match.index + prefixLength;
            const to = from + blockText.length;
            const info = (match[2] || '').trim();
            const body = (match[3] || '').replace(/\r\n/g, '\n');
            const lines = body ? body.split('\n') : [];
            const isLogLike = /^(log|text|console|output|json)$/i.test(info);
            const isCollapsible = lines.length >= this.fencedBlockThresholds.lines
                || body.length >= this.fencedBlockThresholds.chars
                || (isLogLike && lines.length >= 6);

            fencedBlocks.push({
                from,
                to,
                info,
                body,
                preview: lines.slice(0, this.fencedBlockThresholds.previewLines).join('\n'),
                lineCount: lines.length,
                charCount: body.length,
                isCollapsible,
                kind: isLogLike ? 'log' : 'code'
            });
        }

        return fencedBlocks;
    },

    buildFencedBlockLineSet(doc, fencedBlocks) {
        const blockedLines = new Set();

        for (const block of fencedBlocks) {
            const startLine = doc.lineAt(block.from).number;
            const endPosition = Math.max(block.from, block.to - 1);
            const endLine = doc.lineAt(endPosition).number;
            for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
                blockedLines.add(lineNumber);
            }
        }

        return blockedLines;
    },

    isSelectionInsideBlock(state, block) {
        return state.selection.ranges.some((range) => range.to >= block.from && range.from <= block.to);
    },

    focusFencedBlock(view, from) {
        view.dispatch({
            selection: { anchor: from, head: from },
            scrollIntoView: true
        });
        view.focus();
    },

    openFencedBlockModal(block) {
        const title = block.info ? `${Common.capitalizeFirst(block.info)} Block` : 'Code Block';
        const lineLabel = block.lineCount === 1 ? '1 line' : `${block.lineCount} lines`;

        Modal.create({
            title,
            modalClass: 'tag-modal content-modal fenced-block-modal',
            content: `
                <div class="fenced-block-modal-meta">
                    <span class="badge">${escapeHtml(block.kind)}</span>
                    <span class="meta-date">${lineLabel}</span>
                    <span class="meta-date">${block.charCount} chars</span>
                </div>
                <pre class="fenced-block-modal-content">${escapeHtml(block.body)}</pre>
            `
        });
    },

    getMentionSuggestions(blockId) {
        const allContacts = Array.from(Store.contacts.keys());
        if (allContacts.length === 0) return [];

        const block = Store.blocks.find(b => b.id === blockId);
        const referenceContext = new Set();

        if (block?.tags?.length) {
            block.tags.forEach(tag => referenceContext.add(tag));
        } else {
            SelectionManager.getExpandedActiveTags().forEach(tag => referenceContext.add(tag));
        }

        return allContacts.sort((a, b) => {
            const aTags = Store.contacts.get(a) || new Set();
            const bTags = Store.contacts.get(b) || new Set();
            const aMatchCount = Array.from(referenceContext).filter(tag => aTags.has(tag)).length;
            const bMatchCount = Array.from(referenceContext).filter(tag => bTags.has(tag)).length;

            if (aMatchCount !== bMatchCount) return bMatchCount - aMatchCount;
            return a.localeCompare(b);
        });
    },

    createMentionCompletionSource(container) {
        return (context) => {
            const word = context.matchBefore(/@[a-zA-Z0-9_]*/);
            if (!word) return null;

            const beforeChar = word.from > 0
                ? context.state.sliceDoc(word.from - 1, word.from)
                : '';
            const atBoundary = word.from === 0 || /\s|\(|\[|\{|"|'/.test(beforeChar);
            if (!atBoundary) return null;

            if (word.from === word.to && !context.explicit) return null;

            const typedQuery = word.text.slice(1).toLowerCase();
            const suggestions = this.getMentionSuggestions(container.dataset.id)
                .filter(contact => contact.toLowerCase().includes(typedQuery))
                .map(contact => ({
                    label: `@${contact}`,
                    type: 'variable',
                    apply: `@${contact}`
                }));

            if (suggestions.length === 0) {
                return null;
            }

            return {
                from: word.from,
                options: suggestions,
                validFor: /^@[a-zA-Z0-9_]*$/
            };
        };
    },

    createWikilinkCompletionSource(container) {
        return (context) => {
            const word = context.matchBefore(/\[\[[^\[\]|]*$/);
            if (!word) return null;

            if (word.from === word.to && !context.explicit) return null;

            const typedQuery = word.text.slice(2).toLowerCase();
            const suggestions = Store.blocks
                .map(b => ({ block: b, title: Store.getBlockTitle(b) }))
                .filter(({ title, block }) => title && title !== block.id || block.id.toLowerCase().includes(typedQuery))
                .map(({ block, title }) => {
                    const display = title || block.id;
                    return {
                        label: display,
                        type: 'text',
                        apply: `[[${display}]]`,
                        detail: block.tags?.length ? block.tags.join(', ') : ''
                    };
                })
                .filter(s => s.label.toLowerCase().includes(typedQuery));

            if (suggestions.length === 0) return null;

            return {
                from: word.from,
                options: suggestions,
                validFor: /^\[\[[^\[\]|]*$/
            };
        };
    },

    /**
     * Get the cached EditorView.theme() config object, creating it on first call.
     */
    getEditorTheme() {
        if (this._editorTheme) return this._editorTheme;
        const { EditorView } = window.CodeMirror;
        this._editorTheme = EditorView.theme({
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
            ".cm-tooltip.cm-tooltip-autocomplete": {
                border: '1px solid var(--border)',
                backgroundColor: 'var(--bg-primary, #ffffff)',
                borderRadius: '10px',
                boxShadow: '0 12px 30px rgba(15, 23, 42, 0.12)',
                overflow: 'hidden'
            },
            ".cm-tooltip-autocomplete ul": {
                fontFamily: 'inherit',
                padding: '4px'
            },
            ".cm-tooltip-autocomplete li": {
                borderRadius: '8px',
                padding: '6px 10px'
            },
            ".cm-tooltip-autocomplete li[aria-selected]": {
                backgroundColor: 'var(--bg-hover, #f1f5f9)',
                color: 'var(--text-primary, #0f172a)'
            },
            ".cm-completionLabel": {
                color: 'var(--text-primary, #0f172a)'
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
                color: 'var(--accent)',
                textDecoration: 'underline'
            },
            ".md-wikilink": {
                color: 'var(--accent)',
                backgroundColor: 'rgba(59, 130, 246, 0.08)',
                padding: '1px 5px',
                borderRadius: '4px',
                cursor: 'pointer',
                textDecoration: 'none',
                border: '1px solid rgba(59, 130, 246, 0.2)',
                whiteSpace: 'nowrap'
            },
            ".md-wikilink:hover": {
                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                borderColor: 'var(--accent)'
            },
            ".md-wikilink-broken": {
                color: 'var(--text-muted, #94a3b8)',
                backgroundColor: 'rgba(148, 163, 184, 0.08)',
                borderColor: 'rgba(148, 163, 184, 0.2)',
                textDecoration: 'line-through',
                textDecorationStyle: 'dotted'
            },
            ".md-wikilink-broken:hover": {
                backgroundColor: 'rgba(148, 163, 184, 0.15)'
            },
            ".md-wikilink-source": {
                color: 'var(--accent)',
                backgroundColor: 'rgba(59, 130, 246, 0.06)',
                borderRadius: '3px'
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
                border: '1.5px solid var(--border-light)',
                borderRadius: '4px',
                marginRight: '8px',
                verticalAlign: 'text-bottom',
                cursor: 'pointer',
                color: 'transparent',
                transition: 'all 0.15s ease'
            },
            ".md-task-checkbox:hover": {
                borderColor: 'var(--accent)'
            },
            ".state-done": {
                backgroundColor: 'var(--accent)',
                borderColor: 'var(--accent)',
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
                borderColor: 'var(--border-light)',
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
                border: '1px solid var(--border)',
                margin: '0 4px',
                verticalAlign: 'text-bottom',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
            },
            ".badge-due": {
                borderColor: 'var(--badge-work-border, #bae6fd)',
                backgroundColor: 'var(--badge-work-bg, #f0f9ff)',
                color: 'var(--badge-work-text, #075985)'
            },
            ".badge-due[data-urgency='overdue']": {
                borderColor: 'rgba(239, 68, 68, 0.3)',
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                color: '#ef4444',
                fontWeight: '600'
            },
            ".badge-due[data-urgency='upcoming-soon']": {
                borderColor: 'rgba(245, 158, 11, 0.3)',
                backgroundColor: 'rgba(245, 158, 11, 0.08)',
                color: '#f59e0b',
                fontWeight: '600'
            },
            ".badge-due[data-urgency='upcoming']": {
                borderColor: 'rgba(59, 130, 246, 0.25)',
                backgroundColor: 'rgba(59, 130, 246, 0.05)',
                color: 'var(--accent)'
            },
            ".badge-assignee": {
                borderColor: 'var(--badge-time-border, #d8b4fe)',
                backgroundColor: 'var(--badge-time-bg, #faf5ff)',
                color: 'var(--badge-time-text, #6b21a8)'
            },
            ".badge-priority": {
                borderColor: 'var(--border)',
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
                color: 'var(--accent)',
                backgroundColor: 'var(--bg-hover, #f1f5f9)'
            },
            ".cm-line:hover .md-add-deadline, .cm-line:hover .md-add-action": {
                display: 'inline-flex'
            },
        });
        return this._editorTheme;
    },

    /**
     * Get the set of active task-related context filters that require per-line filtering.
     * Returns only filters that should hide non-matching task lines (excludes Todo.all).
     */
    getActiveTaskFilter() {
        const context = SelectionManager.selections?.context;
        if (!context || context.size === 0) return new Set();
        const taskFilters = ['Todo.open', 'Todo.inProgress', 'Todo.done', 'Todo.blocked', 'Todo.canceled', 'Todo.unblocked', 'Status.unassigned'];
        const active = new Set();
        for (const f of taskFilters) {
            if (context.has(f)) active.add(f);
        }
        return active;
    },

    /**
     * Check whether a task line matches all of the active task filters.
     * Non-task lines (no checkbox) always return true (stay visible).
     */
    taskLineMatchesFilter(lineText, activeFilters) {
        const checkboxMatch = lineText.match(/^\s*[-*+]\s+\[([ xX\/bB\-])\]/);
        if (!checkboxMatch) return true; // non-task line, always visible

        const state = checkboxMatch[1];
        const isOpen = state === ' ' || state === '/';
        const isInProgress = state === '/';
        const isDone = state === 'x' || state === 'X';
        const isBlockedState = state === 'b' || state === 'B';
        const isCanceled = state === '-';
        const hasAssignee = lineText.includes('[assignee::');

        for (const filter of activeFilters) {
            if (filter === 'Todo.open' && !isOpen) return false;
            if (filter === 'Todo.inProgress' && !isInProgress) return false;
            if (filter === 'Todo.done' && !isDone) return false;
            if (filter === 'Todo.blocked' && !isBlockedState) return false;
            if (filter === 'Todo.canceled' && !isCanceled) return false;
            if (filter === 'Todo.unblocked' && !isOpen) return false;
            if (filter === 'Status.unassigned' && hasAssignee) return false;
        }
        return true;
    },

    /**
     * Compute which line indices should be hidden based on active task filters.
     * Returns a Set of 0-based indices.
     * Shared by buildDecorations (display) and export (file output).
     */
    getHiddenTaskLineIndices(lineTexts, activeTaskFilters) {
        const hidden = new Set();
        if (!activeTaskFilters || activeTaskFilters.size === 0) return hidden;

        // Pre-compute line metadata
        const lineInfo = lineTexts.map(text => {
            const indent = text.match(/^(\s*)/)[1].length;
            const isTask = /^\s*[-*+]\s+\[([ xX\/bB\-])\]/.test(text);
            const matchesFilter = isTask && this.taskLineMatchesFilter(text, activeTaskFilters);
            return { indent, isTask, matchesFilter };
        });

        // Build hidden set
        let hideBelowIndent = null;

        for (let i = 0; i < lineInfo.length; i++) {
            const { indent, isTask, matchesFilter } = lineInfo[i];

            if (isTask && matchesFilter) {
                hideBelowIndent = null;
            } else if (isTask) {
                if (hideBelowIndent === null) {
                    hideBelowIndent = indent;
                }
            } else if (hideBelowIndent !== null && indent <= hideBelowIndent) {
                hideBelowIndent = null;
            }

            const shouldHide = isTask
                ? !matchesFilter
                : (hideBelowIndent !== null && indent > hideBelowIndent);

            if (shouldHide) hidden.add(i);
        }

        return hidden;
    },

    /**
     * Filter markdown content, removing lines that don't match active task filters.
     */
    filterContentLines(content, activeTaskFilters) {
        if (!activeTaskFilters || activeTaskFilters.size === 0) return content;
        const lines = content.split('\n');
        const hidden = this.getHiddenTaskLineIndices(lines, activeTaskFilters);
        return lines.filter((_, i) => !hidden.has(i)).join('\n');
    },

    /**
     * Build the decoration set from editor state.
     */
    buildDecorations(state, hasFocus) {
        const { Decoration } = window.CodeMirror;
        const builder = [];
        const fencedBlocks = this.getFencedBlocks(state.doc.toString());
        const fencedBlockLines = this.buildFencedBlockLineSet(state.doc, fencedBlocks);

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
                const endLine = state.doc.lineAt(Math.max(block.from, block.to - 1));

                builder.push(Decoration.replace({
                    widget: new widgets.FencedBlockWidget(block),
                    inclusive: false
                }).range(startLine.from, startLine.to));

                builder.push(Decoration.line({
                    attributes: {
                        class: 'md-fenced-block-summary-line'
                    }
                }).range(startLine.from));

                // Replace interior lines (including closing ```) with nothing.
                // Decoration.replace() updates CM's height map so the gutter
                // collapses in sync with the content.
                if (endLine.number > startLine.number) {
                    const interiorFrom = state.doc.line(startLine.number + 1).from;
                    const interiorTo = endLine.number < state.doc.lines
                        ? state.doc.line(endLine.number + 1).from
                        : endLine.to;
                    builder.push(Decoration.replace({}).range(interiorFrom, interiorTo));
                }
            } else if (!selectionInsideBlock) {
                builder.push(Decoration.mark({ class: 'md-fenced-block-source' }).range(block.from, block.to));
            }
        }

        const activeTaskFilters = this.getActiveTaskFilter();

        // Build 0-based index set of hidden lines (shared with export)
        const allLineTexts = [];
        for (let i = 1; i <= state.doc.lines; i++) allLineTexts.push(state.doc.line(i).text);
        const hiddenLines = this.getHiddenTaskLineIndices(allLineTexts, activeTaskFilters);

        // Detect orphaned tasks: visible tasks whose parent task was hidden
        const orphanedLines = new Set();
        const taskAncestors = []; // stack of { indent, hidden }
        for (let i = 0; i < allLineTexts.length; i++) {
            const text = allLineTexts[i];
            const indent = text.match(/^(\s*)/)[1].length;
            const isTask = /^\s*[-*+]\s+\[([ xX\/bB\-])\]/.test(text);

            if (isTask) {
                while (taskAncestors.length > 0 && taskAncestors[taskAncestors.length - 1].indent >= indent) {
                    taskAncestors.pop();
                }

                if (!hiddenLines.has(i) && taskAncestors.length > 0 && taskAncestors[taskAncestors.length - 1].hidden) {
                    orphanedLines.add(i);
                }

                taskAncestors.push({ indent, hidden: hiddenLines.has(i) });
            }
        }

        // Hidden task lines are handled by a separate StateField extension (see
        // createHiddenLineExtension) which CAN use cross-line Decoration.replace() —
        // something ViewPlugin decorations cannot do.  Here we only skip already-hidden
        // lines and detect orphaned tasks.
        for (let i = 1; i <= state.doc.lines; i++) {
            if (fencedBlockLines.has(i)) continue;

            const line = state.doc.line(i);

            // Skip lines hidden by the StateField, but NOT cursor lines — the
            // StateField preserves those so they still need syntax decorations.
            if (hiddenLines.has(i - 1) && !cursorLines.has(i)) continue;

            // Mark orphaned tasks whose parent was filtered out
            if (orphanedLines.has(i - 1)) {
                builder.push(Decoration.line({ attributes: { class: 'cm-orphaned-task-line' } }).range(line.from));
            }

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
        if (!activeTaskFilters || activeTaskFilters.size === 0) {
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
        const self = this;
        return StateField.define({
            create(state) {
                return self.buildHiddenLineDecorations(state);
            },
            update(deco, tr) {
                if (tr.docChanged || tr.selection) {
                    return self.buildHiddenLineDecorations(tr.state);
                }
                return deco.map(tr.changes);
            },
            provide: f => EditorView.decorations.from(f)
        });
    },

    /**
     * Create the live preview ViewPlugin that manages decorations.
     */
    createLivePreviewPlugin() {
        const { ViewPlugin } = window.CodeMirror;
        const self = this;
        return ViewPlugin.fromClass(class {
            constructor(view) {
                this.decorations = self.buildDecorations(view.state, view.hasFocus);
            }
            update(update) {
                if (update.docChanged || update.selectionSet || update.focusChanged) {
                    this.decorations = self.buildDecorations(update.view.state, update.view.hasFocus);
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
        return EditorView.updateListener.of((update) => {
            if (update.selectionSet || update.focusChanged || update.docChanged || update.geometryChanged) {
                const marker = document.querySelector(`.block-split-marker[data-id="${blockId}"]`);
                if (marker) {
                    if (update.view.hasFocus) {
                        if (update.state.doc.lines <= 1) {
                            marker.style.display = 'none';
                            return;
                        }

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

                            marker.style.display = 'flex';

                            const scissorSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" x2="8.12" y1="4" y2="15.88"/><line x1="14.47" x2="20" y1="14.48" y2="20"/><line x1="8.12" x2="12" y1="8.12" y2="12"/></svg>';

                            if (isExtract) {
                                const relativeTopEnd = contentTop - blockRectTop + endBlock.top - scroller.scrollTop;
                                const bottomEdge = relativeTopEnd + endBlock.height;
                                const h = Math.max(18, bottomEdge - relativeTopStart + 18);

                                marker.style.top = `${relativeTopStart - 9}px`;
                                marker.style.height = `${h}px`;
                                marker.style.flexDirection = 'column';
                                marker.style.justifyContent = 'space-between';
                                marker.innerHTML = scissorSvg + scissorSvg;
                                marker.title = "Extract block";
                            } else {
                                const iconTopStart = relativeTopStart + startBlock.height - 9;
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
                if (content !== '' && !content.endsWith('\n')) {
                    update.view.dispatch({
                        changes: { from: content.length, to: content.length, insert: '\n' }
                    });
                }
                handleContentChange(content);
            }
        });
    },

    /**
     * Create DOM event handlers for paste and blur.
     */
    createDomEventHandlers(container) {
        const { EditorView } = window.CodeMirror;
        const self = this;
        return EditorView.domEventHandlers({
            focus: (event, view) => {
                const blockId = container.dataset.id;
                if (blockId && blockId !== 'new') {
                    self._focusedBlockId = blockId;
                }
            },
            paste: (event, view) => {
                const pastedText = event.clipboardData?.getData('text/plain');
                if (!self.shouldPromptForLargePaste(pastedText)) {
                    return false;
                }

                event.preventDefault();
                self.handleLargePaste(view, pastedText);
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
                navigator.clipboard.writeText(selectedText);
                self.handleExtractCut(view, selectedText, selection);
                return true;
            },
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
        });
    },

    /**
     * Create the keymap extension for new-block key bindings (Mod-Enter, Shift-Enter).
     */
    createNewBlockKeymap(container, createNewBlock) {
        const { keymap, Prec } = window.CodeMirror;
        const self = this;
        const toggleTaskKey = Store.shortcuts?.toggleTask
            ? self.shortcutToCM6(Store.shortcuts.toggleTask)
            : 'Mod-Shift-t';
        return Prec.high(keymap.of([
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
            },
            {
                key: toggleTaskKey,
                run: (view) => {
                    self.toggleTaskOnCurrentLine(view);
                    return true;
                }
            }
        ]));
    },

    /**
     * Create a CodeMirror editor instance for a block.
     */
    createEditor(container, blockId, initialContent) {
        if (!window.CodeMirror) {
            console.error('CodeMirror not loaded');
            return;
        }

        const { EditorView, EditorState, basicSetup, markdown, languages, keymap, indentWithTab, placeholder, foldService } = window.CodeMirror;

        const self = this;
        const handleContentChange = (content) => self.handleContentChange(container.dataset.id, content);
        const createNewBlock = () => self.createNewBlock();
        const mentionCompletionSource = this.createMentionCompletionSource(container);
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
                            // Delay to allow toolbar button clicks to register
                            setTimeout(() => {
                                if (this._focusedEditor === update.view) {
                                    this._focusedEditor = null;
                                    this.hideMobileToolbar();
                                }
                            }, 150);
                        }
                    }
                })
            ],
            parent: container
        });

        this.editors.set(blockId, view);
        this.originalContents.set(blockId, initialContent);
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
        const self = this;

        const field = StateField.define({
            create() { return Decoration.none; },
            update(deco, tr) {
                const pos = self._highlightPositions.get(blockId);
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

        console.log('[scroll] line:', line.number, '/', view.state.doc.lines, 'matchIndex:', matchIndex, 'pos:', pos);

        // Dispatch to trigger StateField update (highlight decoration)
        view.dispatch({
            selection: { anchor: line.from },
            scrollIntoView: true
        });

        console.log('[scroll] after dispatch scrollHeight:', scroller.scrollHeight, 'clientHeight:', scroller.clientHeight, 'scrollTop:', scroller.scrollTop);

        // Refine scroll position using actual coordinates
        const refineScroll = (label) => {
            const coords = view.coordsAtPos(line.from);
            console.log('[scroll] refine', label, 'coords:', coords);
            if (coords) {
                const editorRect = scroller.getBoundingClientRect();
                const lineY = coords.top - editorRect.top + scroller.scrollTop;
                console.log('[scroll] centering to:', Math.max(0, lineY - scroller.clientHeight / 2));
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
            console.log('[scroll] estimating: ratio:', ratio, 'scrollHeight:', scroller.scrollHeight, 'target:', Math.max(0, estimated));
            scroller.scrollTop = Math.max(0, estimated);
        }

        // After CM renders at the estimated position, refine with actual coords
        setTimeout(() => {
            if (!refineScroll('50ms')) setTimeout(() => refineScroll('150ms'), 100);
        }, 50);
    },

    // Apply decorations per line. If hideSyntax is true, we replace the markdown markers.
    applyLineDecorations(line, builder, hideSyntax, Decoration, isLastLine) {
        const text = line.text;
        const from = line.from;
        const usedRanges = [];

        // Ensure widgets are initialized
        const widgets = this.getCMWidgets();

        // 1. Task List Checkboxes (kept inline due to interdependencies with task-done styling)
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

        // 2. Add-field widgets for task lines
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
        }

        // 3. Run registered line decorators
        for (const decorator of this._lineDecorators) {
            decorator(text, from, builder, hideSyntax, Decoration, usedRanges, widgets);
        }

        // 4. Task-done styling for checked/canceled tasks
        if (lineHasCheckedTask) {
            builder.push(Decoration.mark({ class: 'md-task-done' }).range(taskLineStart, line.to));
        }
    },

    // Registry of line decorator functions. Each takes (text, from, builder, hideSyntax, Decoration, usedRanges, widgets).
    get _lineDecorators() {
        return [
            this.decorateInlineFields.bind(this),
            this.decorateTaskAnchors.bind(this),
            this.decorateHeaders.bind(this),
            this.decorateInlineFormats.bind(this),
            this.decorateLinks.bind(this),
            this.decorateBareUrls.bind(this),
            this.decorateWikilinks.bind(this)
        ];
    },

    // Decorator: inline fields (e.g. [due:: 2026-03-25], [assignee:: @user])
    decorateInlineFields(text, from, builder, hideSyntax, Decoration, usedRanges, widgets) {
        const inlineFieldRegex = /\[(due|assignee|priority)::\s*([^\]]+)\]/g;
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
    },

    // Decorator: task anchors (e.g. ^task-id)
    decorateTaskAnchors(text, from, builder, hideSyntax, Decoration, usedRanges, widgets) {
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
    },

    // Decorator: markdown headers (#{1,6})
    decorateHeaders(text, from, builder, hideSyntax, Decoration, usedRanges) {
        const headerMatch = text.match(/^(#{1,6})\s+(.*)$/);
        if (headerMatch) {
            const level = headerMatch[1].length;
            const matchTo = from + text.length;
            let overlaps = usedRanges.some(r => from < r.to && matchTo > r.from);

            if (!overlaps) {
                builder.push(Decoration.mark({ class: `md-header md-header-${level}` }).range(from, from + text.length));
                if (hideSyntax) {
                    const syntaxEnd = from + level + 1; // # + space
                    builder.push(Decoration.replace({}).range(from, syntaxEnd));
                }
            }
        }
    },

    // Decorator: inline formatting patterns (bold, italic, strikethrough, code)
    decorateInlineFormats(text, from, builder, hideSyntax, Decoration, usedRanges) {
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
    },

    // Decorator: markdown links [text](url)
    decorateLinks(text, from, builder, hideSyntax, Decoration, usedRanges, widgets) {
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
    },

    // Decorator: bare URLs (http/https)
    decorateBareUrls(text, from, builder, hideSyntax, Decoration, usedRanges, widgets) {
        const bareUrlRegex = /https?:\/\/\S+/g;
        let match;
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

            // Show hint if the new note is hidden by active filters
            const reasons = Store.getBlockingFilters(newBlock);
            if (reasons.length > 0) {
                const labels = reasons.map(r => r.label).join(', ');
                Common.showToast('Note created but hidden by filter: ' + labels, {
                    actionLabel: 'Show all',
                    action: () => {
                        SelectionManager.clearAllFilters();
                        App.render();
                    }
                });
            }
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

        const self = this;
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
                const toolbarHeight = self._mobileToolbar ? self._mobileToolbar.offsetHeight : 0;
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
    },

    // Focus the "new note" block at the bottom
    focusNewBlock() {
        const tryFocus = (attempts = 0) => {
            const newBlock = document.querySelector('.block[data-id="new"]');
            const editor = this.editors.get('new');

            if (newBlock && editor) {
                if (window.innerWidth <= 768) {
                    // On mobile, focus first to trigger keyboard, then let
                    // visualViewport handler + fallback scroll into position
                    editor.focus();
                    setTimeout(() => {
                        newBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 300);
                } else {
                    newBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    setTimeout(() => editor.focus(), 150);
                }
            } else if (attempts < 15) {
                setTimeout(() => tryFocus(attempts + 1), 50);
            }
        };
        tryFocus();
    },

    // Navigate to a block by wikilink target — scroll into view in document, or open modal if filtered out
    navigateToBlock(targetId) {
        const block = Store.findBlockByWikilink(targetId);
        if (!block) {
            this.openNoteModal(targetId);
            return;
        }
        const blockEl = document.querySelector(`.block[data-id="${CSS.escape(block.id)}"]`);
        if (blockEl) {
            blockEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const editor = this.editors.get(block.id);
            if (editor) setTimeout(() => editor.focus(), 150);
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
            renderedContent = marked.parse(rawContent);
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

    // Decorator: wikilinks [[target]] and [[target|display]]
    decorateWikilinks(text, from, builder, hideSyntax, Decoration, usedRanges, widgets) {
        const wikilinkRegex = /\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]/g;
        let match;
        while ((match = wikilinkRegex.exec(text)) !== null) {
            const matchFrom = from + match.index;
            const matchTo = matchFrom + match[0].length;

            let overlaps = usedRanges.some(r => matchFrom < r.to && matchTo > r.from);
            if (!overlaps) {
                const targetId = match[1].trim();
                const displayText = match[2] ? match[2].trim() : targetId;

                if (hideSyntax) {
                    const blockExists = !!Store.findBlockByWikilink(targetId);
                    builder.push(Decoration.replace({
                        widget: new widgets.WikilinkWidget(displayText, targetId, matchFrom, matchTo, blockExists)
                    }).range(matchFrom, matchTo));
                } else {
                    builder.push(Decoration.mark({ class: 'md-wikilink-source' }).range(matchFrom, matchTo));
                }
                usedRanges.push({ from: matchFrom, to: matchTo });
            }
        }
    }
};
