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

        const container = document.getElementById('viewContainer');
        container.className = 'document-view';

        // Wait for CodeMirror to be loaded
        await this.waitForCodeMirror();

        const sorted = SortManager.sortItems('document', blocks);

        // Build HTML for blocks - use div containers for CodeMirror
        container.innerHTML = sorted.map(block => `
            <article class="block ${block.pinned ? 'block-pinned' : ''}" data-id="${block.id}">
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
            .map(tag => TagModal._renderBadge(tag))
            .join('');
    },

    isSpeechRecognitionSupported() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
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

        // Pin button
        parts.push(`
            <button class="pin-btn ${block.pinned ? 'pinned' : ''}" data-id="${block.id}" title="${block.pinned ? 'Unpin note' : 'Pin note'}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="${block.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76z"/></svg>
            </button>
        `);

        // Microphone / Speech-to-Text button
        if (this.isSpeechRecognitionSupported()) {
            parts.push(`
                <button class="mic-btn" data-id="${block.id}" title="Dictate text">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                </button>
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
        const taskFilters = ['Todo.open', 'Todo.blocked', 'Todo.unblocked', 'Status.unassigned'];
        const active = new Set();
        for (const f of taskFilters) {
            if (context.has(f)) active.add(f);
        }
        return active;
    },

    /**
     * Check whether a task line matches any of the active task filters.
     * Non-task lines (no checkbox) always return true (stay visible).
     */
    taskLineMatchesFilter(lineText, activeFilters) {
        const checkboxMatch = lineText.match(/^\s*[-*+]\s+\[([ xX\/bB\-])\]/);
        if (!checkboxMatch) return true; // non-task line, always visible

        const state = checkboxMatch[1];
        const isOpen = state === ' ' || state === '/';
        const isBlockedState = state === 'b' || state === 'B';
        const hasDependsOn = lineText.includes('[dependsOn::');
        const hasAssignee = lineText.includes('[assignee::');

        for (const filter of activeFilters) {
            if (filter === 'Todo.open' && isOpen) return true;
            if (filter === 'Todo.blocked' && (isBlockedState || hasDependsOn)) return true;
            if (filter === 'Todo.unblocked' && isOpen && !hasDependsOn) return true;
            if (filter === 'Status.unassigned' && !hasAssignee) return true;
        }
        return false;
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

                for (let lineNumber = startLine.number + 1; lineNumber <= endLine.number; lineNumber += 1) {
                    const blockLine = state.doc.line(lineNumber);
                    builder.push(Decoration.line({
                        attributes: {
                            class: 'md-fenced-block-hidden-line'
                        }
                    }).range(blockLine.from));
                }
            } else if (!selectionInsideBlock) {
                builder.push(Decoration.mark({ class: 'md-fenced-block-source' }).range(block.from, block.to));
            }
        }

        const activeTaskFilters = this.getActiveTaskFilter();
        let hideBelowIndent = null;

        for (let i = 1; i <= state.doc.lines; i++) {
            if (fencedBlockLines.has(i)) {
                continue;
            }

            const line = state.doc.line(i);

            // Per-line task filtering with sub-content hiding
            if (activeTaskFilters.size > 0) {
                const indent = line.text.match(/^(\s*)/)[1].length;
                const isTask = /^\s*[-*+]\s+\[([ xX\/bB\-])\]/.test(line.text);
                const matchesFilter = isTask && this.taskLineMatchesFilter(line.text, activeTaskFilters);

                // Update hide threshold (always, regardless of cursor position)
                if (isTask && matchesFilter) {
                    hideBelowIndent = null;
                } else if (isTask) {
                    // Non-matching task — set threshold only if not already hiding
                    // (keep parent's threshold so sibling content stays hidden)
                    if (hideBelowIndent === null) {
                        hideBelowIndent = indent;
                    }
                } else if (hideBelowIndent !== null && indent <= hideBelowIndent) {
                    // Non-task at or above threshold — exited hidden scope
                    hideBelowIndent = null;
                }

                // Apply hiding (skip lines with cursor)
                const shouldHide = isTask ? !matchesFilter : (hideBelowIndent !== null && indent > hideBelowIndent);
                if (shouldHide && !cursorLines.has(i)) {
                    builder.push(Decoration.line({
                        attributes: { class: 'md-task-filter-hidden-line' }
                    }).range(line.from));
                    continue;
                }
            }

            const hideSyntax = !cursorLines.has(i);
            this.applyLineDecorations(line, builder, hideSyntax, Decoration, i === state.doc.lines);
        }

        // Delegate sorting entirely to CodeMirror which understands how to resolve overlaps securely
        return Decoration.set(builder, true);
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
                            const iconTopStart = relativeTopStart + startBlock.height - 9;

                            marker.style.display = 'flex';
                            marker.style.top = `${iconTopStart}px`;

                            const scissorSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" x2="8.12" y1="4" y2="15.88"/><line x1="14.47" x2="20" y1="14.48" y2="20"/><line x1="8.12" x2="12" y1="8.12" y2="12"/></svg>';

                            if (isExtract) {
                                const relativeTopEnd = contentTop - blockRectTop + endBlock.top - scroller.scrollTop;
                                const iconTopEnd = relativeTopEnd + endBlock.height - 9;
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
        });
    },

    /**
     * Create DOM event handlers for paste and blur.
     */
    createDomEventHandlers(container) {
        const { EditorView } = window.CodeMirror;
        const self = this;
        return EditorView.domEventHandlers({
            paste: (event, view) => {
                const pastedText = event.clipboardData?.getData('text/plain');
                if (!self.shouldPromptForLargePaste(pastedText)) {
                    return false;
                }

                event.preventDefault();
                self.handleLargePaste(view, pastedText);
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

        const { EditorView, EditorState, basicSetup, markdown, languages, keymap, indentWithTab, placeholder } = window.CodeMirror;

        const self = this;
        const handleContentChange = (content) => self.handleContentChange(container.dataset.id, content);
        const createNewBlock = () => self.createNewBlock();
        const mentionCompletionSource = this.createMentionCompletionSource(container);

        const view = new EditorView({
            doc: (blockId === 'new' && initialContent === '') ? '' : (initialContent.endsWith('\n') ? initialContent : initialContent + '\n'),
            extensions: [
                basicSetup,
                markdown({ codeLanguages: languages }),
                keymap.of([indentWithTab]),
                EditorState.languageData.of(() => [{ autocomplete: mentionCompletionSource }]),
                EditorView.lineWrapping,
                this.createLivePreviewPlugin(),
                placeholder(blockId === 'new' ? 'Write a note...' : ''),
                this.getEditorTheme(),
                this.createUpdateListener(container, blockId, handleContentChange),
                this.createDomEventHandlers(container),
                this.createNewBlockKeymap(container, createNewBlock)
            ],
            parent: container
        });

        this.editors.set(blockId, view);
        this.originalContents.set(blockId, initialContent);
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
            if (!text.includes('[dependsOn::')) {
                builder.push(Decoration.widget({
                    widget: new widgets.AddDependencyWidget(from, line.to),
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
            this.decorateBareUrls.bind(this)
        ];
    },

    // Decorator: inline fields (e.g. [due:: 2026-03-25], [dependsOn:: ^id])
    decorateInlineFields(text, from, builder, hideSyntax, Decoration, usedRanges, widgets) {
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
        const tryFocus = (attempts = 0) => {
            const newBlock = document.querySelector('.block[data-id="new"]');
            const editor = this.editors.get('new');

            if (newBlock && editor) {
                newBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => editor.focus(), 150);
            } else if (attempts < 15) {
                setTimeout(() => tryFocus(attempts + 1), 50);
            }
        };
        tryFocus();
    }
};
