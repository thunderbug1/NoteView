/**
 * NoteView - Main App Controller
 */

const App = {
    isInitialized: false,



    showDirectoryPicker() {
        const container = document.getElementById('viewContainer');
        container.innerHTML = `
            <div class="directory-picker">
                <div class="picker-content">
                    <h1>Welcome to NoteView</h1>
                    <p>Select a folder to store your notes</p>
                    <button id="selectFolderBtn" class="select-folder-btn">
                        <span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:bottom; margin-right:4px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg></span>
                        <span>Select Folder</span>
                    </button>
                    <p class="picker-hint">Your notes will be stored as markdown files in the selected folder.</p>
                </div>
            </div>
        `;

        const selectBtn = document.getElementById('selectFolderBtn');
        if (selectBtn) {
            selectBtn.addEventListener('click', () => this.selectDirectory());
        }
    },

    async selectDirectory() {
        try {
            const container = document.getElementById('viewContainer');
            container.innerHTML = '<div class="loading">Loading notes...</div>';

            const initialized = await Store.init();
            if (initialized) {
                await this.completeInitialization();
            } else {
                // Store.init returned false — no saved handle, show native picker (we're in a user gesture)
                const handle = await window.showDirectoryPicker();
                await Store.openDirectory(handle);
                await this.completeInitialization();
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                // User cancelled, show picker again
                this.showDirectoryPicker();
            } else {
                this.showError(err.message || 'Failed to load directory');
            }
        }
    },

    async init() {
        ThemeManager.init();
        // Hide FAB until a vault is opened
        const fab = document.getElementById('fabNewNote');
        if (fab) fab.style.display = 'none';
        // Auto-load on startup
        try {
            const container = document.getElementById('viewContainer');
            if (container) container.innerHTML = '<div class="loading">Loading notes...</div>';

            const initialized = await Store.init();
            if (initialized) {
                await this.completeInitialization();
            } else {
                this.showDirectoryPicker();
            }
        } catch (err) {
            // If permission needed, show button with the handle
            if (err.needsPermission) {
                this.showPermissionButton(err.handle);
            } else if (err.name === 'NotAllowedError' || err.message?.includes('permission')) {
                this.showPermissionButton();
            } else if (err.name === 'AbortError') {
                this.showDirectoryPicker();
            } else {
                this.showError(err.message || 'Failed to load directory');
            }
        }
    },

    showPermissionButton(handle = null) {
        const container = document.getElementById('viewContainer');
        container.innerHTML = `
            <div class="directory-picker">
                <div class="picker-content">
                    <h1>NoteView</h1>
                    <p>Click to access your notes folder</p>
                    <button id="grantPermissionBtn" class="select-folder-btn">
                        <span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:bottom; margin-right:4px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg></span>
                        <span>Open Notes</span>
                    </button>
                    <p class="picker-hint">Grant access to continue where you left off.</p>
                </div>
            </div>
        `;

        const grantBtn = document.getElementById('grantPermissionBtn');
        if (grantBtn) {
            grantBtn.addEventListener('click', async () => {
                const container = document.getElementById('viewContainer');
                container.innerHTML = '<div class="loading">Loading notes...</div>';

                try {
                    // Use passed handle or get from store
                    const savedHandle = handle || await Store.getDirectoryHandle();
                    if (savedHandle) {
                        const permission = await savedHandle.requestPermission({ mode: 'readwrite' });
                        if (permission === 'granted') {
                            Store.directoryHandle = savedHandle;
                            await GitStore.init(savedHandle);
                            await Store.loadBlocks();
                            await this.completeInitialization();
                        } else {
                            this.showDirectoryPicker();
                        }
                    } else {
                        this.showDirectoryPicker();
                    }
                } catch (err) {
                    this.showDirectoryPicker();
                }
            });
        }
    },

    async completeInitialization() {
        // Show FAB now that a vault is open
        const fab = document.getElementById('fabNewNote');
        if (fab) fab.style.display = '';
        console.log('[App] completeInitialization:start', {
            isInitialized: this.isInitialized,
            currentView: Store.currentView,
            blockCount: Store.blocks.length
        });
        if (this.isInitialized) {
            SelectionManager.init();
            SelectionManager.updateTagCounts();
            this.updateVaultSwitcherName();
            this.render();
            console.log('[App] completeInitialization:reenter', {
                currentView: Store.currentView,
                context: Array.from(SelectionManager.selections.context)
            });
            return;
        }
        this.isInitialized = true;
        await GitRemote.init();
        this.setupEventListeners();
        SelectionManager.init();
        SelectionManager.updateTagCounts();
        this.updateVaultSwitcherName();
        this.render();
        console.log('[App] completeInitialization:done', {
            currentView: Store.currentView,
            context: Array.from(SelectionManager.selections.context)
        });
    },

    showError(message) {
        const container = document.getElementById('viewContainer');
        container.innerHTML = `
            <div class="error-message">
                <h2><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 8px;"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg> Error</h2>
                <p>${escapeHtml(message)}</p>
                <button id="retryBtn" class="retry-btn">Try Again</button>
            </div>
        `;

        const retryBtn = document.getElementById('retryBtn');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => location.reload());
        }
    },

    setupEventListeners() {
        // Mobile sidebar slide
        const sidebar = document.getElementById('sidebar');
        const sidebarRight = document.getElementById('sidebarRight');
        const overlay = document.getElementById('sidebarOverlay');
        const sidebarEdgeLeft = document.getElementById('sidebarEdgeLeft');
        const sidebarEdgeRight = document.getElementById('sidebarEdgeRight');
        const screenWidth = () => window.innerWidth;

        function openSidebar() {
            sidebar.classList.add('sidebar-open');
            sidebarEdgeLeft?.classList.add('hidden');
            overlay.classList.add('active');
            document.body.classList.add('sidebar-open');
        }
        function closeSidebar() {
            sidebar.classList.remove('sidebar-open');
            sidebarEdgeLeft?.classList.remove('hidden');
            overlay.classList.remove('active');
            document.body.classList.remove('sidebar-open');
        }
        function openSidebarRight() {
            sidebarRight.classList.add('sidebar-open');
            sidebarEdgeRight?.classList.add('hidden');
            overlay.classList.add('active');
            document.body.classList.add('sidebar-open');
        }
        function closeSidebarRight() {
            sidebarRight.classList.remove('sidebar-open');
            sidebarEdgeRight?.classList.remove('hidden');
            overlay.classList.remove('active');
            document.body.classList.remove('sidebar-open');
        }

        overlay?.addEventListener('click', () => {
            closeSidebar();
            closeSidebarRight();
        });
        sidebarEdgeLeft?.addEventListener('click', openSidebar);
        sidebarEdgeRight?.addEventListener('click', openSidebarRight);

        // Desktop right sidebar toggle
        const sidebarRightToggle = document.getElementById('sidebarRightToggle');
        sidebarRightToggle?.addEventListener('click', () => {
            const collapsed = sidebarRight.classList.toggle('collapsed');
            sidebarRightToggle.classList.toggle('shifted', collapsed);
            sidebarRightToggle.classList.toggle('rotated', collapsed);
        });

        // Touch swipe for sidebars
        let touchStartX = 0, touchStartY = 0;
        document.addEventListener('touchstart', e => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }, { passive: true });
        document.addEventListener('touchend', e => {
            const dx = e.changedTouches[0].clientX - touchStartX;
            const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
            if (Math.abs(dx) < 50 || dy > 30) return;
            const w = screenWidth();

            // Open left sidebar: swipe right starting from left edge
            // Use an expanding zone: closer to edge needs less distance,
            // further from edge is still accepted if gesture is decisive
            if (dx > 0 && !sidebar.classList.contains('sidebar-open') &&
                !sidebarRight.classList.contains('sidebar-open')) {
                // Zones: 0-10px (OS gesture area, skip), 10-50px (strong match), 50-120px (forgiving)
                const fromLeft = touchStartX;
                if ((fromLeft > 10 && fromLeft < 50) ||
                    (fromLeft >= 50 && fromLeft < 120 && dx > 80)) {
                    openSidebar();
                    return;
                }
            }
            // Close left sidebar: swipe left while open
            if (dx < 0 && sidebar.classList.contains('sidebar-open')) {
                closeSidebar();
                return;
            }
            // Open right sidebar: swipe left starting from right edge
            if (dx < 0 && !sidebarRight.classList.contains('sidebar-open') &&
                !sidebar.classList.contains('sidebar-open')) {
                const fromRight = w - touchStartX;
                if ((fromRight > 10 && fromRight < 50) ||
                    (fromRight >= 50 && fromRight < 120 && Math.abs(dx) > 80)) {
                    openSidebarRight();
                    return;
                }
            }
            // Close right sidebar: swipe right while open
            if (dx > 0 && sidebarRight.classList.contains('sidebar-open')) {
                closeSidebarRight();
                return;
            }
        });

        // PWA install prompt
        let deferredPrompt = null;
        const installBanner = document.getElementById('installBanner');
        const installBtn = document.getElementById('installBtn');
        const installDismissBtn = document.getElementById('installDismissBtn');

        window.addEventListener('beforeinstallprompt', e => {
            e.preventDefault();
            deferredPrompt = e;
            // Only show on mobile
            if (window.innerWidth <= 768 && installBanner) {
                installBanner.classList.add('visible');
            }
        });

        installBtn?.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            await deferredPrompt.userChoice;
            deferredPrompt = null;
            if (installBanner) installBanner.classList.remove('visible');
        });

        installDismissBtn?.addEventListener('click', () => {
            if (installBanner) installBanner.classList.remove('visible');
        });

        // Deselect / defocus editor when clicking anywhere outside a CM editor —
        // this covers both the gap between blocks/sidebar AND the block's own padding area.
        // #main is stable and never re-rendered, so this listener is attached once.
        // e.preventDefault() is critical: without it the browser repositions the CM
        // text cursor to the Y-coordinate of the click before blur() fires (2-click bug).
        document.getElementById('main').addEventListener('mousedown', (e) => {
            const insideEditor = e.target.closest('.cm-editor');
            const onInteractive = e.target.closest('button, input, a, select');
            const onDraggable = e.target.closest('[draggable="true"]');
            if (!insideEditor && !onInteractive && !onDraggable) {
                e.preventDefault();
                document.activeElement?.blur();
            }
        });

        // Search - debounced for performance
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            const debouncedSearch = debounce((value) => {
                Store.searchQuery = value;
                this.render();
            }, 300);

            searchInput.addEventListener('input', (e) => {
                const value = e.target.value;
                // Immediate feedback for empty search
                if (value === '') {
                    Store.searchQuery = '';
                    this.render();
                } else {
                    debouncedSearch(value);
                }
            });
        }


        SortManager.initSidebar(() => this.render());
        SortManager.updateSidebar();
        // Time property selector
        // Tag options - different behavior per group
        document.querySelectorAll('.tag-radio-option').forEach(option => {
            option.addEventListener('click', (e) => {
                if (e.target.closest('.delete-tag-btn') || option.classList.contains('add-new-context-tag')) return;
                
                const group = option.dataset.group;
                const tag = option.dataset.tag;
                const wasSelected = option.classList.contains('selected');

                if (group === 'view') {
                    // View selector
                    if (!wasSelected) {
                        this.setView(tag);
                        document.querySelectorAll(`.tag-radio-option[data-group="view"]`).forEach(opt => {
                            opt.classList.remove('selected');
                        });
                        option.classList.add('selected');
                    }
                } else if (group === 'time') {
                    // Time tags: mutually exclusive (radio behavior)
                    if (wasSelected && tag !== '') {
                        // Click selected tag to deselect
                        SelectionManager.setTimeSelection('');
                        option.classList.remove('selected');
                    } else {
                        // Select this tag, deselect others
                        SelectionManager.setTimeSelection(tag);
                        document.querySelectorAll(`.tag-radio-option[data-group="time"]`).forEach(opt => {
                            opt.classList.remove('selected');
                        });
                        option.classList.add('selected');
                    }
                } else if (group === 'contact') {
                    // Contact tags: single select (radio behavior) like time, but can be cleared
                    if (wasSelected) {
                        SelectionManager.setContactSelection('');
                        option.classList.remove('selected');
                    } else {
                        SelectionManager.setContactSelection(tag);
                        document.querySelectorAll(`.tag-radio-option[data-group="contact"]`).forEach(opt => {
                            opt.classList.remove('selected');
                        });
                        option.classList.add('selected');
                    }
                } else {
                    // Context tags: multi-select (checkbox behavior)
                    SelectionManager.toggleContextTag(tag, wasSelected);
                }

                this.render();
            });
        });

        // Vault switcher
        const vaultSwitcherBtn = document.getElementById('vaultSwitcherBtn');
        if (vaultSwitcherBtn) {
            vaultSwitcherBtn.addEventListener('click', () => this.showVaultDropdown(vaultSwitcherBtn));
        }

        // Settings button (replaces old tag-radio-option)
        const settingsBtn = document.getElementById('settingsBtn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => this.setView('settings'));
        }

        // FAB listener
        const fab = document.getElementById('fabNewNote');
        if (fab) {
            fab.addEventListener('click', () => this.handleNewNote());
            // Store.shortcuts might not be loaded yet if this runs too early,
            // but Store.init should have finished.
            if (Store.shortcuts) {
                fab.title = `New Note (${Store.shortcuts.newNote})`;
            }
        }

        // Undo/Redo button listeners
        const undoBtn = document.getElementById('undoBtn');
        if (undoBtn) {
            undoBtn.addEventListener('click', () => {
                console.log('Undo button clicked');
                if (typeof UndoRedoManager !== 'undefined') {
                    UndoRedoManager.undo();
                } else {
                    console.error('UndoRedoManager not defined');
                }
            });
        } else {
            console.warn('UndoBtn not found in DOM');
        }
        const redoBtn = document.getElementById('redoBtn');
        if (redoBtn) {
            redoBtn.addEventListener('click', () => {
                console.log('Redo button clicked');
                if (typeof UndoRedoManager !== 'undefined') {
                    UndoRedoManager.redo();
                } else {
                    console.error('UndoRedoManager not defined');
                }
            });
        } else {
            console.warn('RedoBtn not found in DOM');
        }

        // Global shortcuts
        window.addEventListener('keydown', (e) => {
            // Check if recording shortcut in settings
            if (document.querySelector('.shortcut-key.recording')) return;

            const combo = [];
            if (e.ctrlKey) combo.push('Ctrl');
            if (e.altKey) combo.push('Alt');
            if (e.shiftKey) combo.push('Shift');
            if (e.metaKey) combo.push('Meta');

            const key = e.key === ' ' ? 'Space' : (e.key.length === 1 ? e.key.toUpperCase() : e.key);
            if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
                combo.push(key);
            }

            const currentCombo = combo.join('+');

            // Undo: Ctrl+Z (or Cmd+Z on Mac) - but NOT Ctrl+Shift+Z (that's redo)
            if ((currentCombo === 'Ctrl+Z' || currentCombo === 'Meta+Z') && !e.shiftKey) {
                // Check if focused in CodeMirror editor - let editor handle its own undo
                const editorFocused = document.activeElement?.closest('.cm-editor');
                if (!editorFocused && UndoRedoManager.canUndo()) {
                    e.preventDefault();
                    UndoRedoManager.undo();
                }
            }

            // Redo: Ctrl+Y or Ctrl+Shift+Z (or Cmd+Shift+Z, Cmd+Y on Mac)
            if (currentCombo === 'Ctrl+Y' || currentCombo === 'Meta+Y' ||
                ((currentCombo === 'Ctrl+Shift+Z' || currentCombo === 'Meta+Shift+Z') &&
                 (e.key === 'z' || e.key === 'Z'))) {
                const editorFocused = document.activeElement?.closest('.cm-editor');
                if (!editorFocused && UndoRedoManager.canRedo()) {
                    e.preventDefault();
                    UndoRedoManager.redo();
                }
            }

            if (Store.shortcuts && currentCombo === Store.shortcuts.newNote) {
                e.preventDefault();
                this.handleNewNote();
            }
        });
    },

    setView(view) {
        console.log('[App] setView', {
            requestedView: view,
            previousView: Store.currentView
        });
        Store.setCurrentView(view);

        // Note: Don't invalidate timeline cache when switching away
        // The timeline cache should persist as long as git history hasn't changed

        // Time filter selection is independent of view - user's choice persists
        // across view changes.

        SelectionManager.updateSelectionUI();
        SortManager.updateSidebar();
        this.render();
        console.log('[App] setView:done', {
            currentView: Store.currentView
        });
    },

    render() {
        const blocks = Store.getFilteredBlocks();
        const view = Store.currentView;

        SortManager.updateSidebar();

        switch (view) {
            case 'document':
                DocumentView.render(blocks);
                break;
            case 'timeline':
                TimelineView.render(blocks);
                break;
            case 'kanban':
                KanbanView.render(blocks);
                break;
            case 'settings':
                SettingsView.render(blocks);
                break;
        }

        // Update undo/redo button states
        this.updateUndoRedoUI();
    },

    updateUndoRedoUI() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');

        if (typeof UndoRedoManager === 'undefined') {
            console.warn('UndoRedoManager not defined in updateUndoRedoUI');
            if (undoBtn) undoBtn.disabled = true;
            if (redoBtn) redoBtn.disabled = true;
            return;
        }

        if (undoBtn) {
            const canUndo = UndoRedoManager.canUndo();
            undoBtn.disabled = !canUndo;
            undoBtn.title = canUndo
                ? `Undo (${UndoRedoManager.getUndoDescription()}) [Ctrl+Z]`
                : 'Undo [Ctrl+Z]';
        }

        if (redoBtn) {
            const canRedo = UndoRedoManager.canRedo();
            redoBtn.disabled = !canRedo;
            redoBtn.title = canRedo
                ? `Redo (${UndoRedoManager.getRedoDescription()}) [Ctrl+Y]`
                : 'Redo [Ctrl+Y]';
        }
    },

    async saveBlockContent(id, content, options = {}) {
        const block = Store.blocks.find(b => b.id === id);
        if (!block) return;

        // Pass new content in options to allow Store.saveBlock to correctly capture before/after state
        await Store.saveBlock(block, { ...options, content });
        
        // Invalidate timeline cache after saving
        TimelineView.invalidateCache();
        // Update tag counts to refresh contacts sidebar
        SelectionManager.updateTagCounts();
    },

    async deleteBlock(id) {
        await Store.deleteBlock(id);
        // Invalidate timeline cache after deleting
        TimelineView.invalidateCache();
        SelectionManager.updateTagCounts();
        this.render();
    },

    async editBlock(id) {
        // Focus the CodeMirror editor for this block
        DocumentView.focusEditor(id);
    },

    async updateBlockProperty(id, property, value, commitMessage) {
        const block = Store.blocks.find(b => b.id === id);
        if (!block) return;

        // Use options to pass the update, ensuring Store.saveBlock can diff properly
        const options = (typeof commitMessage === 'string') 
            ? { commit: true, commitMessage, [property]: value }
            : { ...commitMessage, [property]: value };

        await Store.saveBlock(block, options);
        
        // Invalidate timeline cache after saving
        TimelineView.invalidateCache();
        // Update tag counts to refresh contacts sidebar
        SelectionManager.updateTagCounts();
        this.render();
    },

    async updateBlockProperties(id, properties, commitMessage) {
        const block = Store.blocks.find(b => b.id === id);
        if (!block) return;

        // Use options to pass updates
        const options = (typeof commitMessage === 'string')
            ? { commit: true, commitMessage, ...properties }
            : { ...commitMessage, ...properties };

        await Store.saveBlock(block, options);
        
        // Invalidate timeline cache after saving
        TimelineView.invalidateCache();
        // Update tag counts to refresh contacts sidebar
        SelectionManager.updateTagCounts();
        this.render();
    },

    async showBlockContentModal(blockId) {
        const block = Store.blocks.find(b => b.id === blockId);
        if (!block) return;

        const content = `
            ${DocumentView.renderBlockMetadata(block)}
            <div class="block-editor">
                <div class="codemirror-container" data-id="${blockId}">${escapeHtml(block.content || '')}</div>
                <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
                    <span class="save-indicator" data-id="${blockId}">saved</span>
                </div>
            </div>
        `;

        const modal = Modal.create({
            headerContent: '',
            content,
            modalClass: 'tag-modal content-modal',
            onClose: () => {
                // If we were in Kanban, we might want to refresh the view to reflect changes
                if (Store.currentView === 'kanban') {
                    this.render();
                }
            }
        });

        // Initialize CodeMirror
        const cmContainer = modal.querySelector('.codemirror-container');
        const initialContent = cmContainer.textContent;
        cmContainer.textContent = '';

        // We need to wait for CodeMirror to be ready
        await DocumentView.waitForCodeMirror();
        DocumentView.createEditor(cmContainer, blockId, initialContent);

        // Attach metadata event listeners (tags, history button)
        this.attachModalMetadataListeners(modal, block);
    },

    attachModalMetadataListeners(modal, block) {
        // Tag management
        modal.querySelectorAll('.add-tag-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.showTagModal(block.id);
            });
        });

        modal.querySelectorAll('.remove-tag').forEach(btn => {
            btn.addEventListener('click', async () => {
                const tag = btn.dataset.tag;
                if (block && block.tags) {
                    block.tags = block.tags.filter(t => t !== tag);
                    await this.updateBlockProperty(block.id, 'tags', block.tags);
                    modal.close();
                    this.showBlockContentModal(block.id);
                }
            });
        });

        // History
        modal.querySelectorAll('.history-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                HistoryView.openHistory(block.id);
            });
        });
    },

    showTagModal(blockId) {
        const allTags = SelectionManager.getAllContextTags();
        const block = Store.blocks.find(b => b.id === blockId);
        const initialTags = block ? (block.tags || []) : [];
        let selectedTags = new Set(initialTags);

        const content = `
            <div class="tag-modal-input-row">
                <input type="text" id="tagModalInput" placeholder="Search or create tag..." autofocus>
            </div>
            <div class="tag-modal-list">
                ${allTags.map(tag => `
                    <div class="tag-modal-item ${selectedTags.has(tag) ? 'selected' : ''}" data-tag="${tag}">
                        <span class="tag-checkbox">${selectedTags.has(tag) ? '✓' : ''}</span>
                        ${SelectionManager.getTagDisplayName(tag)}
                    </div>
                `).join('')}
            </div>
            <div id="tagModalCreatePrompt" style="display: none;" class="tag-modal-create">
                <span class="create-text"></span>
            </div>
            <div class="tag-modal-footer">
                <button id="tagModalSaveBtn" class="tag-modal-save-btn">Save</button>
            </div>
        `;

        const modal = Modal.create({
            title: 'Manage Tags',
            content
        });

        const input = document.getElementById('tagModalInput');
        const promptBtn = document.getElementById('tagModalCreatePrompt');

        setTimeout(() => input.focus(), 10);

        const updateItemVisuals = () => {
            modal.querySelectorAll('.tag-modal-item').forEach(item => {
                const tag = item.dataset.tag;
                const isSelected = selectedTags.has(tag);
                const checkbox = item.querySelector('.tag-checkbox');
                if (isSelected) {
                    item.classList.add('selected');
                    if (checkbox) checkbox.textContent = '✓';
                } else {
                    item.classList.remove('selected');
                    if (checkbox) checkbox.textContent = '';
                }
            });
        };

        const saveChanges = async () => {
            const newTags = Array.from(selectedTags).sort();

            if (blockId === 'new') {
                // Store pending tags for the new note placeholder
                DocumentView.pendingNewTags = newTags;

                // Add any new tags to the context UI
                for (const tag of newTags) {
                    if (!allTags.includes(tag)) {
                        SelectionManager.addContextTagToUI(tag);
                    }
                }

                // Update the badge display on the new note placeholder
                const newBlock = document.querySelector('.block[data-id="new"]');
                if (newBlock) {
                    const tagsDiv = newBlock.querySelector('.block-tags');
                    if (tagsDiv) {
                        const addBtn = tagsDiv.querySelector('.add-tag-btn');
                        const badgesHtml = newTags.map(tag => `<span class="badge">${Common.capitalizeFirst(tag)}</span>`).join('');
                        // Remove existing badges, keep the + Tag button
                        tagsDiv.querySelectorAll('.badge').forEach(b => b.remove());
                        if (addBtn) {
                            addBtn.insertAdjacentHTML('beforebegin', badgesHtml);
                        } else {
                            tagsDiv.insertAdjacentHTML('afterbegin', badgesHtml);
                        }
                    }
                }
            } else if (blockId) {
                // Only save if tags actually changed
                if (JSON.stringify(newTags) !== JSON.stringify([...initialTags].sort())) {
                    await this.updateBlockProperty(blockId, 'tags', newTags);
                }
            }
            modal.close();
        };

        modal.querySelectorAll('.tag-modal-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const tag = item.dataset.tag;

                if (selectedTags.has(tag)) {
                    selectedTags.delete(tag);
                } else {
                    selectedTags.add(tag);
                }

                updateItemVisuals();
                input.focus();
            });
        });

        const createTag = (tagStr) => {
            const tagsToAdd = tagStr.split(/[\s,]+/).map(t => t.trim().toLowerCase()).filter(t => t);
            const computedTags = SelectionManager.getComputedContextTags().map(tag => tag.toLowerCase());

            for (const tag of tagsToAdd) {
                if (computedTags.includes(tag)) {
                    console.warn("Cannot assign computed tags directly to a note.");
                    continue;
                }

                selectedTags.add(tag);

                // Add to list if not already there
                if (!allTags.includes(tag)) {
                    const list = modal.querySelector('.tag-modal-list');
                    const newItem = document.createElement('div');
                    newItem.className = 'tag-modal-item selected';
                    newItem.dataset.tag = tag;
                    newItem.innerHTML = `<span class="tag-checkbox">✓</span> ${SelectionManager.getTagDisplayName(tag)}`;
                    newItem.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (selectedTags.has(tag)) {
                            selectedTags.delete(tag);
                        } else {
                            selectedTags.add(tag);
                        }
                        updateItemVisuals();
                        input.focus();
                    });
                    list.appendChild(newItem);
                    allTags.push(tag);
                }
            }

            updateItemVisuals();
            input.value = '';
            promptBtn.style.display = 'none';
        };

        modal.querySelector('#tagModalSaveBtn').addEventListener('click', saveChanges);
        promptBtn.addEventListener('click', () => {
            createTag(input.value.trim().toLowerCase());
        });

        input.addEventListener('input', () => {
            const valArr = input.value.split(/[\s,]+/);
            const val = valArr[valArr.length - 1].trim().toLowerCase();
            let exactMatch = false;

            modal.querySelectorAll('.tag-modal-item').forEach(item => {
                const tag = item.dataset.tag;

                // Filter by search
                if (tag.includes(val) || val === '') {
                    item.style.display = 'block';
                } else {
                    item.style.display = 'none';
                }
                if (tag === val) exactMatch = true;
            });

            const isComputedTag = SelectionManager.getComputedContextTags().some(tag => tag.toLowerCase() === val);

            if (val && !exactMatch && !selectedTags.has(val) && !isComputedTag) {
                promptBtn.style.display = 'flex';
                promptBtn.querySelector('.create-text').textContent = `Create tag '${val}'`;
            } else {
                promptBtn.style.display = 'none';
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const val = input.value.trim().toLowerCase();
                if (val && !allTags.includes(val)) {
                    createTag(val);
                } else {
                    saveChanges();
                }
            } else if (e.key === 'Escape') {
                modal.close();
            }
        });
    },

    showAssigneeModal(onSelect, currentTags = null) {
        // Prioritize contacts that share the current context
        const allContacts = Array.from(Store.contacts.keys()).sort();
        let suggestedContacts = [...allContacts];

        // Define the reference context for matching
        let referenceContext = new Set();
        if (currentTags && currentTags.length > 0) {
            currentTags.forEach(t => referenceContext.add(t));
        } else if (SelectionManager.selections.context.size > 0) {
            referenceContext = new Set(SelectionManager.getActiveTags());
        }

        if (referenceContext.size > 0) {
            // Sort by matching context tags (higher match first), then alphabetically
            suggestedContacts.sort((a, b) => {
                const aTags = Store.contacts.get(a);
                const bTags = Store.contacts.get(b);
                const aMatchCount = Array.from(referenceContext).filter(t => aTags.has(t)).length;
                const bMatchCount = Array.from(referenceContext).filter(t => bTags.has(t)).length;

                if (aMatchCount !== bMatchCount) return bMatchCount - aMatchCount;
                return a.localeCompare(b);
            });
        }

        const content = `
            <input type="text" id="assigneeModalInput" placeholder="Search or enter name..." autofocus>
            <div class="tag-modal-list">
                ${suggestedContacts.map(contact => {
                    const contactTags = Store.contacts.get(contact);
                    const hasMatch = referenceContext.size === 0 || Array.from(referenceContext).some(t => contactTags.has(t));
                    const matchClass = hasMatch ? '' : 'non-matching-context';
                    return `<div class="tag-modal-item ${matchClass}" data-contact="${contact}">@${contact}</div>`;
                }).join('')}
            </div>
            <div id="assigneeModalCreatePrompt" style="display: none;" class="tag-modal-create">
                <span class="create-text"></span>
            </div>
        `;

        const modal = Modal.create({
            title: 'Select Assignee',
            content
        });

        const input = document.getElementById('assigneeModalInput');
        const promptBtn = document.getElementById('assigneeModalCreatePrompt');

        setTimeout(() => input.focus(), 10);

        const selectContact = (contact) => {
            if (contact) {
                // Strip @ if user typed it
                if (contact.startsWith('@')) contact = contact.substring(1);
                onSelect(contact);
            }
            modal.close();
        };

        modal.querySelectorAll('.tag-modal-item').forEach(item => {
            item.addEventListener('click', () => selectContact(item.dataset.contact));
        });

        promptBtn.addEventListener('click', () => {
            selectContact(input.value.trim());
        });

        input.addEventListener('input', () => {
            const val = input.value.trim().toLowerCase().replace(/^@/, '');
            let exactMatch = false;

            modal.querySelectorAll('.tag-modal-item').forEach(item => {
                const contact = item.dataset.contact.toLowerCase();
                if (contact.includes(val)) {
                    item.style.display = 'block';
                } else {
                    item.style.display = 'none';
                }
                if (contact === val) exactMatch = true;
            });

            if (val && !exactMatch) {
                promptBtn.style.display = 'flex';
                promptBtn.querySelector('.create-text').textContent = `Assign to '@${val}'`;
            } else {
                promptBtn.style.display = 'none';
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const val = input.value.trim().replace(/^@/, '');
                const visibleItems = Array.from(modal.querySelectorAll('.tag-modal-item'))
                    .filter(i => i.style.display !== 'none');

                if (visibleItems.length === 1 && val && visibleItems[0].dataset.contact !== val.toLowerCase()) {
                    selectContact(visibleItems[0].dataset.contact);
                } else if (val) {
                    selectContact(val);
                }
            } else if (e.key === 'Escape') {
                modal.close();
            }
        });
    },

    async changeVaultDirectory() {
        const success = await Store.changeDirectory();
        if (success) {
            // Re-initialize app state
            SelectionManager.updateTagCounts();
            // Switch to document view after changing vault
            this.setView('document');
            this.updateVaultSwitcherName();
        }
    },

    updateVaultSwitcherName() {
        const nameEl = document.getElementById('vaultSwitcherName');
        if (nameEl) {
            nameEl.textContent = Store.directoryHandle ? Store.directoryHandle.name : 'No vault';
        }
    },

    async showVaultDropdown(btn) {
        // Remove any existing dropdown
        const existing = document.getElementById('vaultDropdown');
        if (existing) { existing.remove(); return; }

        const vaultList = await Store.getVaultList();
        const currentName = Store.directoryHandle?.name || '';

        const menu = document.createElement('div');
        menu.id = 'vaultDropdown';
        menu.className = 'task-context-menu';

        // Vault items
        if (vaultList.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'vault-dropdown-item';
            empty.style.opacity = '0.5';
            empty.style.cursor = 'default';
            empty.textContent = 'No vaults yet';
            menu.appendChild(empty);
        } else {
            vaultList.forEach(v => {
                const item = document.createElement('div');
                item.className = 'vault-dropdown-item' + (v.name === currentName ? ' active' : '');
                item.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v.name}</span>`;
                if (v.name !== currentName) {
                    item.addEventListener('click', () => {
                        menu.remove();
                        this.switchVault(v.name);
                    });
                }
                menu.appendChild(item);
            });
        }

        // Divider
        const divider = document.createElement('div');
        divider.className = 'menu-divider';
        divider.style.margin = '0.3rem 0';
        menu.appendChild(divider);

        // Manage Vaults option
        const manageItem = document.createElement('div');
        manageItem.className = 'vault-dropdown-item';
        manageItem.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82V9a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg><span>Manage Vaults...</span>`;
        manageItem.addEventListener('click', () => {
            menu.remove();
            this.showManageVaultsModal();
        });
        menu.appendChild(manageItem);

        // Position above the button
        document.body.appendChild(menu);
        const rect = btn.getBoundingClientRect();
        const availHeight = rect.top - 8; // space above the button
        menu.style.position = 'fixed';
        menu.style.top = 'auto'; // override .task-context-menu top:0
        menu.style.left = `${rect.left}px`;
        menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
        menu.style.minWidth = `${rect.width}px`;
        menu.style.maxHeight = `min(${availHeight}px, 300px)`;
        menu.style.overflowY = 'auto';

        // Close on outside click
        setTimeout(() => {
            const closeDropdown = (e) => {
                if (!menu.contains(e.target) && e.target !== btn) {
                    menu.remove();
                    document.removeEventListener('click', closeDropdown);
                }
            };
            document.addEventListener('click', closeDropdown);
        }, 50);
    },

    async switchVault(name) {
        const container = document.getElementById('viewContainer');
        if (container) container.innerHTML = '<div class="loading">Loading notes...</div>';

        try {
            const handle = await Store.getVaultHandle(name);
            if (!handle) {
                // Vault handle was removed — clean up
                await Store.deleteVault(name);
                this.updateVaultSwitcherName();
                return;
            }

            await Store.switchToVault(handle);
            await this.completeInitialization();
            this.updateVaultSwitcherName();
        } catch (err) {
            if (err.message?.includes('Permission denied')) {
                // Try showing the permission button
                const handle = await Store.getVaultHandle(name);
                if (handle) {
                    this.showPermissionButton(handle);
                }
            } else if (err.name === 'AbortError') {
                // User cancelled
            } else {
                this.showError(err.message || 'Failed to switch vault');
            }
        }
    },

    async showManageVaultsModal() {
        const vaultList = await Store.getVaultList();
        const currentName = Store.directoryHandle?.name || '';

        const folderIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;

        const dotsIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="12" cy="19" r="2"></circle></svg>`;

        const renderList = (vaults) => vaults.map(v => `
            <div class="vault-manager-row${v.name === currentName ? ' active' : ''}" data-vault="${v.name}">
                ${folderIcon}
                <span class="vault-manager-name">${v.name}</span>
                <button class="vault-manager-menu-btn" data-vault="${v.name}" title="Vault options">${dotsIcon}</button>
            </div>
        `).join('');

        const modal = Modal.create({
            title: 'Manage Vaults',
            content: `
                <div class="vault-manager">
                    <div class="vault-manager-sidebar">
                        <div class="vault-manager-list" id="vaultManagerList">
                            ${vaultList.length > 0 ? renderList(vaultList) : '<div style="text-align:center;color:var(--text-muted);padding:2rem 0">No vaults added yet</div>'}
                        </div>
                    </div>
                    <div class="vault-manager-actions">
                        <div class="vault-manager-action">
                            <div class="vault-manager-action-text">
                                <h4>Create new vault</h4>
                                <p>Create a new folder for your notes</p>
                            </div>
                            <button class="vault-manager-action-btn primary" id="createVaultBtn">Create</button>
                        </div>
                        <div class="vault-manager-action">
                            <div class="vault-manager-action-text">
                                <h4>Open folder as vault</h4>
                                <p>Open an existing folder on your device</p>
                            </div>
                            <button class="vault-manager-action-btn secondary" id="openFolderAsVaultBtn">Open</button>
                        </div>
                    </div>
                </div>
            `,
            width: '600px'
        });

        const refreshList = async () => {
            const list = await Store.getVaultList();
            const listEl = modal.querySelector('#vaultManagerList');
            if (listEl) {
                if (list.length > 0) {
                    listEl.innerHTML = renderList(list);
                    wireRowEvents();
                } else {
                    listEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:2rem 0">No vaults added yet</div>';
                }
            }
        };

        function closeVaultMenu() {
            const existing = document.getElementById('vaultContextMenu');
            if (existing) existing.remove();
        }

        function showVaultContextMenu(btn, vaultName) {
            closeVaultMenu();
            const menu = document.createElement('div');
            menu.id = 'vaultContextMenu';
            menu.className = 'task-context-menu';
            menu.style.width = '220px';
            menu.innerHTML = `
                <div class="menu-item menu-item-danger" data-action="remove">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;flex-shrink:0"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    Remove from list
                </div>
            `;

            document.body.appendChild(menu);
            const rect = btn.getBoundingClientRect();
            menu.style.position = 'fixed';
            menu.style.top = 'auto';
            menu.style.left = 'auto';
            menu.style.right = `${window.innerWidth - rect.right}px`;
            menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
            menu.style.overflow = 'visible';

            // Ensure menu stays on screen
            requestAnimationFrame(() => {
                const menuRect = menu.getBoundingClientRect();
                if (menuRect.left < 8) {
                    menu.style.right = 'auto';
                    menu.style.left = `${rect.left}px`;
                }
                if (menuRect.top < 8) {
                    menu.style.bottom = 'auto';
                    menu.style.top = `${rect.bottom + 4}px`;
                }
            });

            menu.querySelector('[data-action="remove"]').addEventListener('click', () => {
                closeVaultMenu();
                const confirmed = window.confirm(`Remove "${vaultName}" from your vault list?\n\nYour files are not deleted.`);
                if (confirmed) {
                    Store.deleteVault(vaultName).then(() => refreshList());
                }
            });

            setTimeout(() => {
                const closeMenu = (e) => {
                    if (!menu.contains(e.target) && e.target !== btn) {
                        closeVaultMenu();
                        document.removeEventListener('click', closeMenu);
                    }
                };
                document.addEventListener('click', closeMenu);
            }, 50);
        }

        function wireRowEvents() {
            modal.querySelectorAll('.vault-manager-row').forEach(row => {
                row.addEventListener('click', (e) => {
                    if (e.target.closest('.vault-manager-menu-btn')) return;
                    const name = row.dataset.vault;
                    if (name === currentName) return;
                    modal.close();
                    App.switchVault(name);
                });
            });
            modal.querySelectorAll('.vault-manager-menu-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showVaultContextMenu(btn, btn.dataset.vault);
                });
            });
        }

        wireRowEvents();

        const openVaultFromPicker = async () => {
            try {
                const handle = await window.showDirectoryPicker();
                modal.close();
                const container = document.getElementById('viewContainer');
                if (container) container.innerHTML = '<div class="loading">Loading notes...</div>';

                await Store.switchToVault(handle);
                await App.completeInitialization();
                App.updateVaultSwitcherName();
            } catch (err) {
                if (err.name === 'AbortError') return;
                App.showError(err.message || 'Failed to open vault');
            }
        };

        const createBtn = modal.querySelector('#createVaultBtn');
        if (createBtn) createBtn.addEventListener('click', openVaultFromPicker);

        const openBtn = modal.querySelector('#openFolderAsVaultBtn');
        if (openBtn) openBtn.addEventListener('click', openVaultFromPicker);
    },

    handleNewNote() {
        if (Store.currentView === 'document') {
            DocumentView.focusNewBlock();
        } else {
            this.showNewNoteModal();
        }
    },

    showNewNoteModal() {
        const content = `
            <div class="block-editor">
                <div class="codemirror-container" data-id="new-modal"></div>
                <div style="display: flex; justify-content: flex-end; margin-top: 15px; gap: 10px;">
                    <button id="cancelNewNoteBtn" class="settings-btn secondary">Cancel</button>
                    <button id="saveNewNoteBtn" class="settings-btn primary">Save Note</button>
                </div>
            </div>
        `;

        const modal = Modal.create({
            title: 'New Note',
            content,
            modalClass: 'tag-modal content-modal active-recording-preventer'
        });

        // Initialize CodeMirror for the modal
        const cmContainer = modal.querySelector('.codemirror-container');
        
        DocumentView.waitForCodeMirror().then(() => {
            DocumentView.createEditor(cmContainer, 'new-modal', '');
            setTimeout(() => {
                const editor = DocumentView.editors.get('new-modal');
                if (editor) editor.focus();
            }, 100);
        });

        const saveNote = async () => {
            const editor = DocumentView.editors.get('new-modal');
            if (editor) {
                const content = editor.state.doc.toString();
                if (content.trim()) {
                    await Store.createBlock(content);
                    modal.close();
                    if (Store.currentView === 'document') {
                        this.render(); // Refresh list if in document view (though we usually use the inline one)
                    } else if (Store.currentView === 'kanban' || Store.currentView === 'timeline') {
                        this.render(); // Refresh other views to show new note
                    }
                }
            }
        };

        modal.querySelector('#saveNewNoteBtn').addEventListener('click', saveNote);
        modal.querySelector('#cancelNewNoteBtn').addEventListener('click', () => modal.close());
        
        // Handle Ctrl+Enter to save
        cmContainer.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                saveNote();
            }
        });
    }
};

// Theme Manager
const ThemeManager = {
    init() {
        this.btn = document.getElementById('themeToggleBtn');
        if (!this.btn) return;
        this.sunIcon = this.btn.querySelector('.sun-icon');
        this.moonIcon = this.btn.querySelector('.moon-icon');
        
        // Load preference
        const savedTheme = localStorage.getItem('noteview-theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
            this.setTheme('dark');
        } else {
            this.setTheme('light');
        }
        
        this.btn.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
            this.setTheme(currentTheme === 'light' ? 'dark' : 'light');
        });
    },
    
    setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('noteview-theme', theme);
        
        if (theme === 'dark') {
            this.sunIcon.style.display = 'none';
            this.moonIcon.style.display = 'inline-block';
        } else {
            this.sunIcon.style.display = 'inline-block';
            this.moonIcon.style.display = 'none';
        }
    }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());

// Close IndexedDB connection when page is hidden/unloaded to prevent blocking
window.addEventListener('beforeunload', () => {
    if (Store.db) {
        try {
            Store.db.close();
            Store.db = null;
        } catch (e) {
            // Ignore errors during cleanup
        }
    }
});

// Also close when page becomes hidden (user switches tabs)
document.addEventListener('visibilitychange', () => {
    if (document.hidden && Store.db) {
        try {
            Store.db.close();
            Store.db = null;
        } catch (e) {
            // Ignore errors during cleanup
        }
    }
});
