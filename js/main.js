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
                    <button id="openVaultManagerBtn" class="select-folder-btn" style="margin-top: 0.5rem; background: var(--bg-secondary); color: var(--text); border: 1px solid var(--border);">
                        <span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:bottom; margin-right:4px;"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 7 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>
                        <span>Manage Vaults</span>
                    </button>
                    <p class="picker-hint">Your notes will be stored as markdown files in the selected folder.</p>
                </div>
            </div>
        `;

        const selectBtn = document.getElementById('selectFolderBtn');
        if (selectBtn) {
            selectBtn.addEventListener('click', () => this.selectDirectory());
        }
        const vaultMgrBtn = document.getElementById('openVaultManagerBtn');
        if (vaultMgrBtn) {
            vaultMgrBtn.addEventListener('click', () => this.showManageVaultsModal());
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
        // Hide sidebars and FAB until a vault is opened
        document.getElementById('app')?.classList.add('no-vault');
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
                this.showManageVaultsModal();
            }
        } catch (err) {
            // If permission needed, show reopen button for the last vault
            if (err.needsPermission && err.handle) {
                this.showReopenPrompt(err.handle);
            } else if (err.name === 'NotAllowedError' || err.message?.includes('permission')) {
                this.showManageVaultsModal();
            } else if (err.name === 'AbortError') {
                this.showManageVaultsModal();
            } else {
                this.showError(err.message || 'Failed to load directory');
            }
        }
    },

    async showReopenPrompt(handle) {
        const container = document.getElementById('viewContainer');
        if (!container) return;
        const name = handle.name;
        container.innerHTML = `
            <div class="reopen-prompt">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                <h3>${name}</h3>
                <p>Tap to reopen your vault</p>
                <button class="reopen-btn">Open</button>
                <button class="reopen-other-btn">Choose another vault</button>
            </div>
        `;
        container.querySelector('.reopen-btn').addEventListener('click', async () => {
            container.innerHTML = '<div class="loading">Loading notes...</div>';
            try {
                await Store.switchToVault(handle);
                await this.completeInitialization();
            } catch (e) {
                this.showManageVaultsModal();
            }
        });
        container.querySelector('.reopen-other-btn').addEventListener('click', () => {
            this.showManageVaultsModal();
        });
    },

    showPermissionButton(handle = null) {
        if (handle) {
            this.showReopenPrompt(handle);
        } else {
            this.showManageVaultsModal();
        }
    },

    async completeInitialization() {
        // Show sidebars and FAB now that a vault is open
        document.getElementById('app')?.classList.remove('no-vault');
        const fab = document.getElementById('fabNewNote');
        if (fab) fab.style.display = '';
        console.log('[App] completeInitialization:start', {
            isInitialized: this.isInitialized,
            currentView: Store.currentView,
            blockCount: Store.blocks.length
        });
        if (this.isInitialized) {
            AppSettings.invalidate();
            await AIAssistant.init();
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
        await AIAssistant.init();
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

    setupSidebarListeners() {
        const sidebar = document.getElementById('sidebar');
        const sidebarRight = document.getElementById('sidebarRight');
        const overlay = document.getElementById('sidebarOverlay');
        const sidebarEdgeLeft = document.getElementById('sidebarEdgeLeft');
        const sidebarEdgeRight = document.getElementById('sidebarEdgeRight');
        const screenWidth = () => window.innerWidth;
        const interactiveSelector = 'button, .toolbar-btn, .content-toolbar, .block-metadata, .block-actions, a, input, [contenteditable], .block-menu-btn, .task-toggle-btn, .mic-btn, .creation-btn';

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

        // Direct interaction with sidebar edges
        sidebarEdgeLeft?.addEventListener('click', (e) => {
            e.stopPropagation();
            openSidebar();
        });
        sidebarEdgeRight?.addEventListener('click', (e) => {
            e.stopPropagation();
            openSidebarRight();
        });
        sidebarEdgeLeft?.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            openSidebar();
        }, { passive: true });
        sidebarEdgeRight?.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            openSidebarRight();
        }, { passive: true });

        // Document click listener still useful for clicks just outside interactive elements 
        // that happened to be in the edge zones
        document.addEventListener('click', (e) => {
            if (e.target.closest(interactiveSelector)) return;
            const w = screenWidth();
            if (e.clientX < 15 && !sidebar.classList.contains('sidebar-open')) {
                openSidebar();
            } else if (e.clientX > w - 15 && !sidebarRight.classList.contains('sidebar-open')) {
                openSidebarRight();
            }
        });

        // Desktop right sidebar toggle
        const sidebarRightToggle = document.getElementById('sidebarRightToggle');
        sidebarRightToggle?.addEventListener('click', () => {
            const collapsed = sidebarRight.classList.toggle('collapsed');
            sidebarRightToggle.classList.toggle('shifted', collapsed);
            sidebarRightToggle.classList.toggle('rotated', collapsed);
        });

        // Touch swipe for sidebars
        let touchStartX = 0, touchStartY = 0, touchStartTarget = null;

        document.addEventListener('touchstart', e => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchStartTarget = e.target;
        }, { passive: true });
        document.addEventListener('touchend', e => {
            if (touchStartTarget?.closest(interactiveSelector) || e.target.closest(interactiveSelector)) return;
            const dx = e.changedTouches[0].clientX - touchStartX;
            const dy = e.changedTouches[0].clientY - touchStartY;
            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);
            const w = screenWidth();

            // 1. Standard swipe logic for horizontal movements
            if (absDx < 50 || absDy > 30) return;

            if (dx > 0 && !sidebar.classList.contains('sidebar-open') &&
                !sidebarRight.classList.contains('sidebar-open')) {
                const fromLeft = touchStartX;
                if ((fromLeft > 10 && fromLeft < 50) ||
                    (fromLeft >= 50 && fromLeft < 120 && dx > 80)) {
                    openSidebar();
                    return;
                }
            }
            if (dx < 0 && sidebar.classList.contains('sidebar-open')) {
                closeSidebar();
                return;
            }
            if (dx < 0 && !sidebarRight.classList.contains('sidebar-open') &&
                !sidebar.classList.contains('sidebar-open')) {
                const fromRight = w - touchStartX;
                if ((fromRight > 10 && fromRight < 50) ||
                    (fromRight >= 50 && fromRight < 120 && Math.abs(dx) > 80)) {
                    openSidebarRight();
                    return;
                }
            }
            if (dx > 0 && sidebarRight.classList.contains('sidebar-open')) {
                closeSidebarRight();
                return;
            }
        });
    },

    setupPWAListeners() {
        let deferredPrompt = null;
        const installBanner = document.getElementById('installBanner');
        const installBtn = document.getElementById('installBtn');
        const installDismissBtn = document.getElementById('installDismissBtn');

        window.addEventListener('beforeinstallprompt', e => {
            e.preventDefault();
            deferredPrompt = e;
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
    },

    setupSearch() {
        const searchInput = document.getElementById('searchInput');
        if (!searchInput) return;

        const debouncedSearch = debounce((value) => {
            Store.searchQuery = value;
            this.render();
        }, 300);

        searchInput.addEventListener('input', (e) => {
            const value = e.target.value;
            if (value === '') {
                Store.searchQuery = '';
                this.render();
            } else {
                debouncedSearch(value);
            }
        });
    },

    setupSidebarTagListeners() {
        document.querySelectorAll('.tag-radio-option').forEach(option => {
            option.addEventListener('click', (e) => {
                if (e.target.closest('.delete-tag-btn') || option.classList.contains('add-new-context-tag')) return;

                const group = option.dataset.group;
                const tag = option.dataset.tag;
                const wasSelected = option.classList.contains('selected');

                if (group === 'view') {
                    if (!wasSelected) {
                        this.setView(tag);
                        document.querySelectorAll(`.tag-radio-option[data-group="view"]`).forEach(opt => {
                            opt.classList.remove('selected');
                        });
                        option.classList.add('selected');
                    }
                } else if (group === 'time') {
                    if (wasSelected && tag !== '') {
                        SelectionManager.setTimeSelection('');
                        option.classList.remove('selected');
                    } else {
                        SelectionManager.setTimeSelection(tag);
                        document.querySelectorAll(`.tag-radio-option[data-group="time"]`).forEach(opt => {
                            opt.classList.remove('selected');
                        });
                        option.classList.add('selected');
                    }
                } else if (group === 'contact') {
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
                    SelectionManager.toggleContextTag(tag, wasSelected);
                }

                this.render();
            });
        });
    },

    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            // Check if recording shortcut in settings
            if (document.querySelector('.shortcut-key.recording')) return;

            const combo = [];
            if (e.ctrlKey) combo.push('Ctrl');
            if (e.altKey) combo.push('Alt');
            if (e.shiftKey) combo.push('Shift');
            if (e.metaKey) combo.push('Meta');

            const key = !e.key ? '' : e.key === ' ' ? 'Space' : (e.key.length === 1 ? e.key.toUpperCase() : e.key);
            if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
                combo.push(key);
            }

            const currentCombo = combo.join('+');

            // Undo: Ctrl+Z (or Cmd+Z on Mac) - but NOT Ctrl+Shift+Z (that's redo)
            if ((currentCombo === 'Ctrl+Z' || currentCombo === 'Meta+Z') && !e.shiftKey) {
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

            // Context history navigation
            if (Store.shortcuts && currentCombo === Store.shortcuts.contextBack) {
                e.preventDefault();
                SelectionManager.historyBack();
                return;
            }
            if (Store.shortcuts && currentCombo === Store.shortcuts.contextForward) {
                e.preventDefault();
                SelectionManager.historyForward();
                return;
            }

            if (Store.shortcuts && currentCombo === Store.shortcuts.newNote) {
                e.preventDefault();
                this.handleNewNote();
            }

            // AI Assistant shortcut
            if (Store.shortcuts && currentCombo === Store.shortcuts.aiAssistant) {
                e.preventDefault();
                if (!AIAssistant.enabled) {
                    AIAssistant._showToast('Enable AI Features in Settings first');
                } else {
                    const activeEditor = document.activeElement?.closest('.cm-editor');
                    const cmContainer = activeEditor?.closest('.codemirror-container');
                    const blockId = cmContainer?.dataset.id;
                    if (blockId && blockId !== 'new') {
                        AIAssistant.openOverlay(blockId);
                    }
                }
            }

            // Batch AI shortcut
            if (currentCombo === 'Ctrl+Shift+B') {
                e.preventDefault();
                if (!AIAssistant.isConfigured()) {
                    AIAssistant._showToast('Enable AI Features in Settings first');
                } else {
                    AIAssistant.openBatchOverlay();
                }
            }
        });
    },

    setupEventListeners() {
        this.setupSidebarListeners();
        this.setupPWAListeners();

        // Deselect / defocus editor when clicking outside
        document.getElementById('main').addEventListener('mousedown', (e) => {
            const insideEditor = e.target.closest('.cm-editor');
            const onInteractive = e.target.closest('button, input, a, select');
            const onDraggable = e.target.closest('[draggable="true"]');
            if (!insideEditor && !onInteractive && !onDraggable) {
                e.preventDefault();
                document.activeElement?.blur();
            }
        });

        this.setupSearch();

        SortManager.initToolbar(() => this.render());
        SortManager.updateToolbar();

        // Toolbar AI button
        const toolbarAiBtn = document.getElementById('toolbarAiBtn');
        if (toolbarAiBtn) {
            toolbarAiBtn.addEventListener('click', () => {
                if (!AIAssistant.isConfigured()) {
                    AIAssistant._showToast('Enable AI Features in Settings first');
                    return;
                }
                AIAssistant.openBatchOverlay();
            });
        }

        this.setupSidebarTagListeners();

        // Vault switcher
        const vaultSwitcherBtn = document.getElementById('vaultSwitcherBtn');
        if (vaultSwitcherBtn) {
            vaultSwitcherBtn.addEventListener('click', () => this.showVaultDropdown(vaultSwitcherBtn));
        }

        // Settings button
        const settingsBtn = document.getElementById('settingsBtn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => this.setView('settings'));
        }

        // FAB listener
        const fab = document.getElementById('fabNewNote');
        if (fab) {
            fab.addEventListener('click', () => this.handleNewNote());
            if (Store.shortcuts) {
                fab.title = `New Note (${Store.shortcuts.newNote})`;
            }
        }

        // Undo/Redo buttons
        const undoBtn = document.getElementById('undoBtn');
        if (undoBtn) {
            undoBtn.addEventListener('click', () => {
                if (typeof UndoRedoManager !== 'undefined') {
                    UndoRedoManager.undo();
                }
            });
        }
        const redoBtn = document.getElementById('redoBtn');
        if (redoBtn) {
            redoBtn.addEventListener('click', () => {
                if (typeof UndoRedoManager !== 'undefined') {
                    UndoRedoManager.redo();
                }
            });
        }

        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportFilteredBlocks());
        }

        this.setupKeyboardShortcuts();
    },

    setView(view) {
        const previousView = Store.currentView;
        console.log('[App] setView', {
            requestedView: view,
            previousView
        });

        // Leaving settings: restore sidebars
        if (previousView === 'settings' && view !== 'settings') {
            this._restoreSidebarState();
        }

        Store.setCurrentView(view);

        // Entering settings: save and close sidebars
        if (view === 'settings') {
            this._saveSidebarState();
            this._closeSidebars();
        }

        // Note: Don't invalidate timeline cache when switching away
        // The timeline cache should persist as long as git history hasn't changed

        // Time filter selection is independent of view - user's choice persists
        // across view changes.

        SelectionManager.updateSelectionUI();
        SortManager.updateToolbar();
        this.render();
        console.log('[App] setView:done', {
            currentView: Store.currentView
        });
    },

    _saveSidebarState() {
        const sidebar = document.getElementById('sidebar');
        const sidebarRight = document.getElementById('sidebarRight');
        this._savedSidebarState = {
            leftOpen: sidebar?.classList.contains('sidebar-open') || false,
            rightOpen: sidebarRight?.classList.contains('sidebar-open') || false,
            rightCollapsed: sidebarRight?.classList.contains('collapsed') || false
        };
    },

    _closeSidebars() {
        const sidebar = document.getElementById('sidebar');
        const sidebarRight = document.getElementById('sidebarRight');
        const overlay = document.getElementById('sidebarOverlay');
        const sidebarEdgeLeft = document.getElementById('sidebarEdgeLeft');
        const sidebarEdgeRight = document.getElementById('sidebarEdgeRight');
        const sidebarRightToggle = document.getElementById('sidebarRightToggle');

        if (sidebar) sidebar.classList.remove('sidebar-open');
        if (sidebarEdgeLeft) sidebarEdgeLeft.classList.remove('hidden');

        if (sidebarRight) sidebarRight.classList.remove('sidebar-open');
        if (sidebarEdgeRight) sidebarEdgeRight.classList.remove('hidden');

        if (overlay) overlay.classList.remove('active');
        document.body.classList.remove('sidebar-open');

        if (sidebarRight) sidebarRight.classList.add('collapsed');
        if (sidebarRightToggle) sidebarRightToggle.classList.add('shifted', 'rotated');
    },

    _restoreSidebarState() {
        if (!this._savedSidebarState) return;
        const state = this._savedSidebarState;
        const sidebar = document.getElementById('sidebar');
        const sidebarRight = document.getElementById('sidebarRight');
        const overlay = document.getElementById('sidebarOverlay');
        const sidebarEdgeLeft = document.getElementById('sidebarEdgeLeft');
        const sidebarEdgeRight = document.getElementById('sidebarEdgeRight');
        const sidebarRightToggle = document.getElementById('sidebarRightToggle');

        if (state.leftOpen) {
            if (sidebar) sidebar.classList.add('sidebar-open');
            if (sidebarEdgeLeft) sidebarEdgeLeft.classList.add('hidden');
        }

        if (state.rightOpen) {
            if (sidebarRight) sidebarRight.classList.add('sidebar-open');
            if (sidebarEdgeRight) sidebarEdgeRight.classList.add('hidden');
        }

        if (state.rightCollapsed) {
            if (sidebarRight) sidebarRight.classList.add('collapsed');
            if (sidebarRightToggle) sidebarRightToggle.classList.add('shifted', 'rotated');
        } else {
            if (sidebarRight) sidebarRight.classList.remove('collapsed');
            if (sidebarRightToggle) sidebarRightToggle.classList.remove('shifted', 'rotated');
        }

        if (state.leftOpen || state.rightOpen) {
            if (overlay) overlay.classList.add('active');
            document.body.classList.add('sidebar-open');
        }

        this._savedSidebarState = null;
    },

    render() {
        const blocks = Store.getFilteredBlocks();
        const view = Store.currentView;

        SortManager.updateToolbar();

        // Update toolbar AI button state
        const toolbarAiBtn = document.getElementById('toolbarAiBtn');
        if (toolbarAiBtn) {
            const aiReady = AIAssistant.isConfigured();
            toolbarAiBtn.disabled = !aiReady || blocks.length === 0;
            toolbarAiBtn.hidden = view === 'settings' || !aiReady;
        }

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

        // Hide FAB in kanban — columns have their own add-task buttons
        const fab = document.getElementById('fabNewNote');
        if (fab) fab.style.display = (view === 'kanban') ? 'none' : '';

        // Update undo/redo button states
        this.updateUndoRedoUI();

        // Update deadline panel in right sidebar (uses all blocks, not filtered)
        DeadlinePanel.render(Store.blocks);
        // Update backlinks panel
        const focusedBlockId = DocumentView.getFocusedBlockId();
        BacklinksPanel.render(Store.blocks, focusedBlockId);
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
        // Update deadline panel after content changes
        DeadlinePanel.render(Store.blocks);
        // Update backlinks panel after content changes
        BacklinksPanel.render(Store.blocks, DocumentView.getFocusedBlockId());
    },

    async deleteBlock(id) {
        await Store.deleteBlock(id);
        // Invalidate timeline cache after deleting
        TimelineView.invalidateCache();
        SelectionManager.updateTagCounts();

        // Surgical DOM removal for document view (no filters active)
        if (Store.currentView === 'document') {
            const sel = SelectionManager.selections;
            const hasFilters = (sel?.context?.size > 0) || (sel?.excluded?.size > 0) || !!Store.searchQuery || !!sel?.time;
            if (!hasFilters && DocumentView.removeBlockElement(id)) {
                this.updateUndoRedoUI();
                return;
            }
        }

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

        // Fast path: surgical metadata update without full re-render
        if (this._canSurgicalPropertyUpdate(property, id)) {
            if (property === 'tags' && DocumentView.updateBlockTags(id)) return;
            if (DocumentView.updateBlockMetadata(id)) return;
        }

        this.render();
    },

    _canSurgicalPropertyUpdate(property, blockId) {
        if (Store.currentView !== 'document') return false;
        // Pinned affects block ordering
        if (property === 'pinned') return false;

        // Active filters may change block visibility
        const sel = SelectionManager.selections;
        if ((sel?.context?.size > 0) || (sel?.excluded?.size > 0) || !!Store.searchQuery || !!sel?.time) return false;

        // Check if sort order depends on this property
        const sortConfig = Store.getSortConfig('document');
        const sortFields = (sortConfig?.clauses || []).map(c => c.field);
        if (sortFields.includes(property)) return false;

        return true;
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

        // Fast path: surgical metadata update without full re-render
        const allSurgical = Object.keys(properties).every(p => this._canSurgicalPropertyUpdate(p, id));
        if (allSurgical && DocumentView.updateBlockMetadata(id)) return;

        this.render();
    },

    async createNewBlockWithId(targetId) {
        await Store.createBlock(`# ${targetId}\n`, { id: targetId });
        SelectionManager.updateTagCounts();
        await this.render();
        DocumentView.navigateToBlock(targetId);
    },

    async showBlockContentModal(blockId, options = {}) {
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

        // Scroll to and highlight the task line if matchIndex was provided.
        // Delay to let the modal layout settle and CodeMirror render lines.
        if (options.matchIndex != null) {
            const view = DocumentView.editors.get(blockId);
            if (view) {
                setTimeout(() => DocumentView.highlightAndScrollTo(blockId, view, options.matchIndex), 100);
            }
        }

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
        TagModal.show(blockId);
    },

    showAssigneeModal(onSelect, currentTags = null) {
        AssigneeModal.show(onSelect, currentTags);
    },

    async changeVaultDirectory() {
        const success = await Store.changeDirectory();
        if (success) {
            TimelineView.invalidateRawDataCache();
            SelectionManager.updateTagCounts();
            this.setView('document');
            VaultModal.updateVaultSwitcherName();
        }
    },

    updateVaultSwitcherName() {
        VaultModal.updateVaultSwitcherName();
    },

    async showVaultDropdown(btn) {
        VaultModal.showDropdown(btn);
    },

    async switchVault(name) {
        VaultModal.switchVault(name);
    },

    async showManageVaultsModal() {
        VaultModal.showManager();
    },

    exportFilteredBlocks() {
        const blocks = Store.getFilteredBlocks();
        if (blocks.length === 0) return;

        const activeTaskFilters = DocumentView.getActiveTaskFilter();

        const markdown = blocks.map(block => {
            const filtered = DocumentView.filterContentLines(block.content || '', activeTaskFilters);
            const parts = [];
            const headingLine = filtered.split('\n').find(l => /^#+\s+/.test(l.trim()));
            const title = headingLine ? headingLine.replace(/^#+\s*/, '').trim() : block.id;
            parts.push(`# ${title}`);
            if (block.tags && block.tags.length > 0) {
                parts.push(block.tags.map(t => `#${t}`).join(' '));
            }
            parts.push('');
            parts.push(filtered);
            return parts.join('\n');
        }).join('\n\n---\n\n');

        const date = new Date().toISOString().split('T')[0];
        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `noteview-export-${date}.md`;
        a.click();
        URL.revokeObjectURL(url);
    },

    handleAIMicClick(modalBlockId, btn) {
        if (!DocumentView.isSpeechRecognitionSupported()) return;

        if (this._aiDictationActive) {
            this.stopAIDictation(modalBlockId);
        } else {
            this.startAIDictation(modalBlockId, btn);
        }
    },

    _setAIButtonState(btn, state) {
        if (!btn) return;
        btn.classList.remove('ai-recording', 'ai-processing', 'ai-error');

        const micSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>';

        switch (state) {
            case 'idle':
                btn.innerHTML = micSvg + ' AI <span class="ai-sparkle">\u2728</span>';
                btn.title = 'Dictate to AI';
                this._setAILockout(false);
                break;
            case 'recording':
                btn.classList.add('ai-recording');
                btn.innerHTML = micSvg + ' Listening...';
                btn.title = 'Stop AI Dictation';
                break;
            case 'processing':
                btn.classList.add('ai-processing');
                btn.innerHTML = '<span class="ai-thinking-dots"></span> Thinking...';
                btn.title = 'AI is processing your dictation';
                this._setAILockout(true);
                break;
            case 'error':
                btn.classList.add('ai-error');
                btn.innerHTML = micSvg + ' Error';
                btn.title = 'AI processing failed';
                this._setAILockout(false);
                setTimeout(() => this._setAIButtonState(btn, 'idle'), 2000);
                break;
        }
    },

    _setAILockout(locked) {
        const modal = this._aiDictationBtn && this._aiDictationBtn.closest('.tag-modal');
        if (!modal) return;
        const blockId = this._aiDictationBlockId;
        const buttons = modal.querySelectorAll('.creation-btn');
        buttons.forEach(b => { b.disabled = locked; });
        const view = DocumentView.editors.get(blockId);
        if (view) {
            const { EditorView, EditorState } = window.CodeMirror;
            view.dispatch({ effects: [EditorView.editable.of(!locked), EditorState.readOnly.of(locked)] });
        }
    },

    startAIDictation(modalBlockId, btn) {
        if (this._aiRecognition) {
            this.stopAIDictation();
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this._aiRecognition = new SpeechRecognition();
        this._aiRecognition.continuous = true;
        this._aiRecognition.interimResults = true;

        this._aiDictationBtn = btn;
        this._setAIButtonState(btn, 'recording');

        this._aiDictationActive = true;
        this._aiTranscript = '';
        this._aiDictationBlockId = modalBlockId;

        this._aiRecognition.onresult = (event) => {
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                }
            }
            if (finalTranscript) {
                this._aiTranscript += finalTranscript + ' ';
            }
        };

        this._aiRecognition.onerror = (event) => {
            console.error('AI Speech Recognition Error:', event.error);
            this.stopAIDictation(modalBlockId);
        };

        this._aiRecognition.onend = () => {
            if (this._aiDictationActive && !this._isStoppingAIDictation) {
                try { this._aiRecognition.start(); } catch(e) {}
            } else {
                this._cleanupAIDictation(modalBlockId);
            }
        };

        this._aiRecognition.start();
        Common.showToast('AI Listening... Speak your note.');
    },

    async stopAIDictation(modalBlockId) {
        this._aiDictationActive = false;
        this._isStoppingAIDictation = true;

        if (this._aiRecognition) {
            this._aiRecognition.stop();
        }

        const transcript = (this._aiTranscript || '').trim();
        this._aiRecognition = null;

        if (transcript) {
            Common.showToast('Processing dictation with AI...', 3000);
            await this.processDictationWithAI(transcript, modalBlockId || this._aiDictationBlockId);
        } else {
            this._cleanupAIDictation(modalBlockId);
            Common.showToast('No speech detected.');
        }

        setTimeout(() => { this._isStoppingAIDictation = false; }, 500);
    },

    _cleanupAIDictation(modalBlockId) {
        this._aiRecognition = null;
        if (this._aiDictationBtn) {
            this._setAIButtonState(this._aiDictationBtn, 'idle');
        }
    },

    async processDictationWithAI(transcript, targetBlockId) {
        if (this._aiDictationBtn) {
            this._setAIButtonState(this._aiDictationBtn, 'processing');
        }
        if (!AIAssistant.isConfigured()) {
            Common.showToast('AI is not configured. Please set up an API key in Settings.');
            this._fallbackDictation(transcript, targetBlockId);
            return;
        }

        try {
            const profile = AIAssistant.profiles[0];
            const apiKey = AIAssistant._apiKeys[profile.id];
            
            const instruction = "The user dictated the following text. Format it into a proper markdown note. If they list tasks, format them as a markdown task list with checkboxes (- [ ]). Be concise and accurate to the dictated content. Do not output anything except the formatted note. Text: " + transcript;

            const url = profile.endpointUrl.replace(/[\\/]+$/, '') + '/chat/completions';
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: profile.model,
                    messages: [
                        { role: 'system', content: 'You are a helpful note-taking assistant. Output only the requested formatted note. No surrounding text, no conversational filler, and no code block formatting unless appropriate.' },
                        { role: 'user', content: instruction }
                    ]
                })
            });

            if (!response.ok) throw new Error('API failed');

            const data = await response.json();
            let noteContent = data.choices && data.choices[0] && data.choices[0].message.content;
            if (!noteContent) noteContent = transcript;

            noteContent = noteContent.replace(/^```([a-z]+)?\n?/igm, '').replace(/```$/gm, '').trim();

            this._fallbackDictation(noteContent + '\n', targetBlockId);
            Common.showToast('Note formatted by AI successfully!');
        } catch (err) {
            console.error('AI dictation failed:', err);
            Common.showToast('AI processing failed. Falling back to raw text.');
            if (this._aiDictationBtn) {
                this._setAIButtonState(this._aiDictationBtn, 'error');
            }
            this._fallbackDictation(transcript + '\n', targetBlockId);
        } finally {
            // Only reset to idle on success; error path already sets its own state
            if (this._aiDictationBtn && !this._aiDictationBtn.classList.contains('ai-error')) {
                this._cleanupAIDictation();
            } else {
                this._aiRecognition = null;
                this._aiDictationBtn = null;
            }
        }
    },

    _fallbackDictation(content, modalBlockId) {
        if (!modalBlockId) return;
        const view = DocumentView.editors.get(modalBlockId);
        if (view) {
            const docLength = view.state.doc.length;
            view.dispatch({
                changes: { from: docLength, insert: (docLength > 0 ? '\n' : '') + content },
                selection: { anchor: docLength + (docLength > 0 ? 1 : 0) + content.length }
            });
            view.focus();
        }
    },

    handleNewNote() {
        this.showNewNoteModal();
    },

    showNewNoteModal() {
        const modalBlockId = 'new-modal';
        let modalTags = SelectionManager.getActiveTags();
        let createdBlockId = null;
        let isCreating = false;

        const renderModalTags = () => {
            const tagsDiv = modal.querySelector('.block-tags');
            if (!tagsDiv) return;
            const id = createdBlockId || modalBlockId;
            const badgesHtml = modalTags.map(tag => TagModal._renderBadge(tag)).join('');
            tagsDiv.innerHTML = `${badgesHtml}<button class="add-tag-btn" data-id="${id}">+ Tag</button>`;
            // Re-attach tag listeners
            modal.querySelectorAll('.add-tag-btn').forEach(btn => {
                btn.addEventListener('click', () => openTagModal());
            });
        };

        const promoteModalBlock = async (initialContent) => {
            if (isCreating || createdBlockId) return;
            isCreating = true;

            try {
                const extraMeta = {};
                if (modalTags.length > 0) {
                    extraMeta.tags = modalTags;
                }
                const newBlock = await Store.createBlock(initialContent, extraMeta);
                createdBlockId = newBlock.id;

                // Remap the editor from 'new-modal' to the real block ID
                const editor = DocumentView.editors.get(modalBlockId);
                if (editor) {
                    DocumentView.editors.delete(modalBlockId);
                    DocumentView.editors.set(createdBlockId, editor);
                }

                // Update the container's data-id so handleContentChange routes correctly
                const cmContainer = modal.querySelector('.codemirror-container');
                if (cmContainer) {
                    cmContainer.dataset.id = createdBlockId;
                }

                // Update all buttons with the new ID
                modal.querySelectorAll('[data-id="' + modalBlockId + '"]').forEach(el => {
                    el.dataset.id = createdBlockId;
                });
                
                // CRITICAL: Update AI dictation target if it's currently recording
                if (this._aiDictationBlockId === modalBlockId) {
                    this._aiDictationBlockId = createdBlockId;
                }

                // Check if more content was typed while we were awaiting createBlock
                if (editor) {
                    const currentContent = editor.state.doc.toString();
                    if (currentContent !== initialContent) {
                        DocumentView.scheduleSave(createdBlockId, currentContent);
                    }
                }

                DocumentView.pendingNewTags = null;
                App.render();

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
                isCreating = false;
            }
        };

        const openTagModal = () => {
            if (createdBlockId) {
                // Block exists — open tag modal for real block
                TagModal.show(createdBlockId);
            } else {
                // Block not yet created — use temp block approach
                const tempId = 'new';
                const existingIdx = Store.blocks.findIndex(b => b.id === tempId);
                const tempBlock = { id: tempId, tags: [...modalTags], content: '' };
                if (existingIdx === -1) {
                    Store.blocks.push(tempBlock);
                } else {
                    Store.blocks[existingIdx] = tempBlock;
                }
                DocumentView.pendingNewTags = [...modalTags];
                TagModal.show(tempId);
            }
        };

        const content = `
            <div class="block block-creation-actions" style="margin-bottom: 0.75rem;">
                <button class="creation-btn" data-action="type" data-id="${modalBlockId}" title="Start typing">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg> Type
                </button>
                ${DocumentView.isSpeechRecognitionSupported() ? `
                <button class="creation-btn mic-btn" data-action="dictate" data-id="${modalBlockId}" title="Dictate text">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg> Dictate
                </button>
                ${AIAssistant.isConfigured() ? `
                <button class="creation-btn ai-mic-btn" data-action="ai-dictate" data-id="${modalBlockId}" title="Dictate to AI">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg> AI ✨
                </button>` : ''}
                ` : ''}
                <button class="creation-btn" data-action="task" data-id="${modalBlockId}" title="Add a task">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg> Task
                </button>
                <button class="creation-btn" data-action="template" data-id="${modalBlockId}" title="Create from template">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg> Template
                </button>
            </div>
            <div class="block-metadata">
                <div class="block-tags">
                    ${modalTags.map(tag => TagModal._renderBadge(tag)).join('')}
                    <button class="add-tag-btn" data-id="${modalBlockId}">+ Tag</button>
                </div>
            </div>
            <div class="block block-editor">
                <div class="codemirror-container" data-id="${modalBlockId}"></div>
            </div>
        `;

        const modal = Modal.create({
            headerContent: '',
            content,
            modalClass: 'tag-modal content-modal active-recording-preventer',
            onClose: () => {
                DocumentView.stopSpeechRecognition();
                if (this._aiDictationActive) {
                    this.stopAIDictation(modalBlockId);
                }
                // Clean up editor reference if still mapped to modalBlockId
                if (!createdBlockId) {
                    DocumentView.editors.delete(modalBlockId);
                }
            }
        });

        // Tag add button
        modal.querySelectorAll('.add-tag-btn').forEach(btn => {
            btn.addEventListener('click', () => openTagModal());
        });

        // Auto-save: combined tag sync + content auto-create
        let lastContent = '';
        const autoSaveInterval = setInterval(() => {
            // --- Tag sync ---
            if (!createdBlockId && DocumentView.pendingNewTags && DocumentView.pendingNewTags.length >= 0) {
                const pending = DocumentView.pendingNewTags;
                if (JSON.stringify(pending) !== JSON.stringify(modalTags)) {
                    modalTags = [...pending];
                    renderModalTags();
                }
            }
            // Clean up temp block once tag modal is gone
            Store.blocks = Store.blocks.filter(b => b.id === 'new');

            // --- Content auto-create ---
            if (!createdBlockId) {
                const editor = DocumentView.editors.get(modalBlockId);
                if (editor) {
                    const content = editor.state.doc.toString();
                    if (content.trim() && content !== lastContent) {
                        lastContent = content;
                        promoteModalBlock(content);
                    }
                }
            }
        }, 300);

        // Clean up interval when modal overlay is removed
        const origClose = modal.close.bind(modal);
        modal.close = () => {
            clearInterval(autoSaveInterval);
            // Clean up any temp block
            Store.blocks = Store.blocks.filter(b => b.id !== 'new');
            origClose();
            App.render();
        };

        // Creation options — single event delegation
        const actionsDiv = modal.querySelector('.block-creation-actions');
        actionsDiv.addEventListener('click', (e) => {
            const btn = e.target.closest('.creation-btn');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();

            const action = btn.dataset.action;
            const currentId = btn.dataset.id;
            const view = DocumentView.editors.get(currentId);

            if (action === 'type') {
                if (view) view.focus();
            } else if (action === 'task') {
                if (view) {
                    const taskPrefix = '- [ ] ';
                    const selection = view.state.selection.main;
                    view.dispatch({
                        changes: { from: selection.from, insert: taskPrefix },
                        selection: { anchor: selection.from + taskPrefix.length }
                    });
                    view.focus();
                }
            } else if (action === 'template') {
                DocumentView.showTemplatePicker(btn, currentId);
            } else if (action === 'dictate') {
                if (DocumentView._recordingBlockId === currentId) {
                    DocumentView.stopSpeechRecognition();
                } else {
                    DocumentView.startSpeechRecognition(currentId, btn);
                }
            } else if (action === 'ai-dictate') {
                this.handleAIMicClick(currentId, btn);
            }
        });

        // Initialize CodeMirror for the modal
        const cmContainer = modal.querySelector('.codemirror-container');

        DocumentView.waitForCodeMirror().then(() => {
            DocumentView.createEditor(cmContainer, modalBlockId, '');
            setTimeout(() => {
                const editor = DocumentView.editors.get(modalBlockId);
                if (editor) editor.focus();
            }, 100);
        });

        // Ctrl+Enter closes the modal (block is already auto-saved)
        cmContainer.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                modal.close();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                modal.close();
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
