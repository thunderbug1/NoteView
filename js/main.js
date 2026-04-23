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
                <h3>${escapeHtml(name)}</h3>
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
        await SyncManager.init();
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

    _syncIcons: {
        idle: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/><polyline points="13 10 18 10 18 15"/></svg>',
        syncing: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/><polyline points="13 10 18 10 18 15"/></svg>',
        error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
        conflict: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
    },

    _setupSyncStatusIndicator() {
        const btn = document.getElementById('toolbarSyncBtn');
        if (!btn) return;

        // Click handler
        btn.addEventListener('click', () => {
            const status = SyncManager.getStatus();
            if (!status.hasRemote) {
                this.setView('settings');
                return;
            }
            SyncManager.sync();
        });

        // Listen for status changes
        window.addEventListener('sync-status-change', (e) => {
            const { status, detail, pendingCommits, lastSyncTime } = e.detail;
            const hasRemote = e.detail.hasRemote;

            if (!hasRemote) {
                btn.title = 'Sync: no remote configured';
                btn.style.color = 'var(--text-muted)';
                btn.style.animation = '';
                return;
            }

            const iconMap = {
                idle: { color: 'var(--text-secondary)', anim: '' },
                syncing: { color: 'var(--accent)', anim: 'sync-pulse 1.2s ease-in-out infinite' },
                error: { color: 'var(--color-danger, #f44)', anim: '' },
                conflict: { color: 'var(--color-warning, #f90)', anim: '' }
            };

            const style = iconMap[status] || iconMap.idle;
            btn.innerHTML = this._syncIcons[status] || this._syncIcons.idle;
            btn.style.color = style.color;
            btn.style.animation = style.anim;

            let title = 'Sync: ';
            if (status === 'idle' && pendingCommits > 0) {
                title += `${pendingCommits} unpushed`;
                btn.style.color = 'var(--accent)';
            } else if (status === 'idle') {
                title += lastSyncTime ? `synced (${formatRelativeDate(lastSyncTime)})` : 'ready';
            } else {
                title += detail || status;
            }
            btn.title = title;
        });
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
                    showToast('Enable AI Features in Settings first');
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
                    showToast('Enable AI Features in Settings first');
                } else {
                    AIAssistant.openBatchOverlay();
                }
            }

            // Select mode toggle
            if (currentCombo === 'Ctrl+Shift+S') {
                e.preventDefault();
                if (typeof BlockSelector !== 'undefined') BlockSelector.toggle();
            }

            // Recent sort toggle
            if (currentCombo === 'Alt+R') {
                e.preventDefault();
                this.toggleRecentSort();
            }

            // Escape exits select mode
            if (e.key === 'Escape' && typeof BlockSelector !== 'undefined' && BlockSelector.active) {
                e.preventDefault();
                e.stopPropagation();
                BlockSelector.deactivate();
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

        if (typeof BlockSelector !== 'undefined') BlockSelector.init();

        SortManager.initToolbar(() => this.render());
        SortManager.updateToolbar();
        GroupManager.initToolbar(() => this.render());
        GroupManager.updateToolbar();

        // Recent toggle button
        const toolbarRecentBtn = document.getElementById('toolbarRecentBtn');
        if (toolbarRecentBtn) {
            toolbarRecentBtn.addEventListener('click', () => this.toggleRecentSort());
            toolbarRecentBtn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showTrashPanel(toolbarRecentBtn);
            });
        }

        // Toolbar AI button
        const toolbarAiBtn = document.getElementById('toolbarAiBtn');
        if (toolbarAiBtn) {
            toolbarAiBtn.addEventListener('click', () => {
                if (!AIAssistant.isConfigured()) {
                    showToast('Enable AI Features in Settings first');
                    return;
                }
                AIAssistant.openBatchOverlay();
            });
        }

        // Toolbar sync button
        this._setupSyncStatusIndicator();

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

        // Update recent button visibility for new view
        const recentBtn = document.getElementById('toolbarRecentBtn');
        if (recentBtn) recentBtn.hidden = view !== 'document';

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
        GroupManager.updateToolbar();

        // Update recent sort button state
        const toolbarRecentBtn = document.getElementById('toolbarRecentBtn');
        if (toolbarRecentBtn) {
            const sortConfig = Store.getSortConfig('document');
            const isRecentMode = sortConfig?.clauses?.[0]?.field === 'lastAccessed';
            toolbarRecentBtn.classList.toggle('active', isRecentMode);
            toolbarRecentBtn.title = isRecentMode
                ? 'Exit recent sort (Alt+R)'
                : 'Sort by recently viewed (Alt+R)';
            toolbarRecentBtn.hidden = view !== 'document';
        }

        // Update toolbar AI button state
        const toolbarAiBtn = document.getElementById('toolbarAiBtn');
        if (toolbarAiBtn) {
            const aiReady = AIAssistant.isConfigured();
            toolbarAiBtn.disabled = !aiReady || blocks.length === 0;
            toolbarAiBtn.hidden = view === 'settings' || !aiReady;
        }

        const groupBy = GroupManager.getGroupBy(view);

        switch (view) {
            case 'document':
                DocumentView.render(blocks, { groupBy });
                break;
            case 'timeline':
                TimelineView.render(blocks, { groupBy });
                break;
            case 'kanban':
                KanbanView.render(blocks, { groupBy });
                break;
            case 'settings':
                SettingsView.render(blocks);
                break;
        }

        // Refresh selection UI if select mode is active
        if (typeof BlockSelector !== 'undefined' && BlockSelector.active) {
            BlockSelector.refreshSelectionUI();
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

    toggleRecentSort() {
        const view = Store.currentView;
        if (view !== 'document') return;

        const currentSort = Store.getSortConfig('document');
        const isRecentMode = currentSort?.clauses?.[0]?.field === 'lastAccessed';

        if (isRecentMode) {
            if (this._preRecentSort) {
                Store.updateSortConfig('document', { clauses: this._preRecentSort });
                this._preRecentSort = null;
            }
        } else {
            this._preRecentSort = currentSort?.clauses ? JSON.parse(JSON.stringify(currentSort.clauses)) : null;
            Store.updateSortConfig('document', {
                clauses: [{ field: 'lastAccessed', direction: 'desc' }]
            });
        }

        this.render();
    },

    showTrashPanel(anchorEl) {
        const trash = RecentAccessTracker.getTrashLog();
        if (trash.length === 0) {
            showToast('No recently deleted notes', { duration: 2500 });
            return;
        }

        let listHtml = trash.map(entry => {
            const title = Store.getBlockTitle(entry.blockData) || entry.id;
            const time = this._formatRelativeTime(entry.timestamp);
            return `
                <div class="trash-entry" data-trash-id="${escapeHtml(entry.id)}">
                    <div class="trash-entry-info">
                        <div class="trash-entry-title">${escapeHtml(title)}</div>
                        <div class="trash-entry-time">${escapeHtml(time)}</div>
                    </div>
                    <button class="trash-entry-restore" data-trash-restore="${escapeHtml(entry.id)}">Restore</button>
                </div>
            `;
        }).join('');

        const modal = Modal.create({
            title: 'Recently Deleted',
            modalClass: 'trash-modal',
            content: `<div class="trash-list">${listHtml}</div>`
        });

        modal.element.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-trash-restore]');
            if (!btn) return;
            const blockId = btn.dataset.trashRestore;
            await this.restoreFromTrash(blockId);
            modal.close();
        });
    },

    async restoreFromTrash(blockId) {
        const trash = RecentAccessTracker.getTrashLog();
        const entry = trash.find(e => e.id === blockId);
        if (!entry?.blockData) return;

        const block = JSON.parse(JSON.stringify(entry.blockData));
        await Store.saveBlock(block, { commit: true, commitMessage: `Restore deleted note ${block.id}` });

        if (!Store.blocks.some(b => b.id === block.id)) {
            Store.blocks.push(block);
        }

        RecentAccessTracker.removeFromTrash(blockId);
        RecentAccessTracker.touch(block.id);
        Store._filteredBlocksCache.invalidate();
        Store.extractContacts();
        TimelineView.invalidateCache();
        SelectionManager.updateTagCounts();
        this.render();
    },

    _formatRelativeTime(timestamp) {
        const diff = Date.now() - timestamp;
        const minutes = Math.floor(diff / 60000);
        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
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

        const sel = SelectionManager.selections;
        const hasContext = sel?.context?.size > 0;
        const hasExcluded = sel?.excluded?.size > 0;
        const hasSearch = !!Store.searchQuery;
        const hasTime = !!sel?.time;

        // Tag additions cannot hide a visible block under AND-logic context filters.
        // Exception: Status.untagged filter — adding a tag to an untagged block would hide it.
        if (property === 'tags' && hasContext && !hasExcluded && !hasSearch && !hasTime) {
            if (sel.context.has('Status.untagged')) {
                const block = Store.blocks.find(b => b.id === blockId);
                if (block && (!block.tags || block.tags.length === 0)) return false;
            }
            // Still check sort dependency
            const sortConfig = Store.getSortConfig('document');
            const sortFields = (sortConfig?.clauses || []).map(c => c.field);
            if (sortFields.includes('tags')) return false;
            return true;
        }

        // Active filters may change block visibility for other properties
        if (hasContext || hasExcluded || hasSearch || hasTime) return false;

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

        // 3-dot overflow menu (pin, copy, history, delete)
        modal.querySelectorAll('.block-menu-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const blockId = block.id;
                const isPinned = block.pinned;

                const menu = document.createElement('div');
                menu.className = 'task-context-menu block-action-menu';
                menu.innerHTML = `
                    <div class="menu-item" data-action="pin">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="${isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:0.5rem"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76z"/></svg>
                        ${isPinned ? 'Unpin note' : 'Pin note'}
                    </div>
                    <div class="menu-item" data-action="copy">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:0.5rem"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        Copy note text
                    </div>
                    <div class="menu-item" data-action="history">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:0.5rem"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        Revision history
                    </div>
                    <div class="menu-divider"></div>
                    <div class="menu-item menu-item-danger" data-action="delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:0.5rem"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        Delete note
                    </div>
                `;

                const rect = btn.getBoundingClientRect();
                menu.style.left = `${rect.right - 180}px`;
                menu.style.top = `${rect.bottom + 4}px`;
                document.body.appendChild(menu);

                requestAnimationFrame(() => {
                    const menuRect = menu.getBoundingClientRect();
                    if (menuRect.bottom > window.innerHeight) {
                        menu.style.top = `${rect.top - menuRect.height - 4}px`;
                    }
                });

                const closeMenu = () => {
                    menu.remove();
                    document.removeEventListener('click', closeHandler);
                };
                const closeHandler = (evt) => {
                    if (!menu.contains(evt.target) && evt.target !== btn) closeMenu();
                };
                document.addEventListener('click', closeHandler);

                menu.addEventListener('click', (evt) => {
                    const item = evt.target.closest('.menu-item');
                    if (!item) return;
                    const action = item.dataset.action;

                    if (action === 'pin') {
                        App.updateBlockProperty(blockId, 'pinned', !block.pinned);
                    } else if (action === 'copy') {
                        const editor = DocumentView.editors.get(blockId);
                        const content = editor ? editor.state.doc.toString() : (block.content || '');
                        navigator.clipboard.writeText(content);
                    } else if (action === 'history') {
                        HistoryView.openHistory(blockId);
                    } else if (action === 'delete') {
                        closeMenu();
                        modal.close();
                        App.deleteBlock(blockId);
                        return;
                    }
                    closeMenu();
                });
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

    _micSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>',

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

        const micSvg = this._micSvg;

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
        if (view && view.dom) {
            try {
                const { EditorView, EditorState } = window.CodeMirror;
                view.dispatch({ effects: [EditorView.editable.of(!locked), EditorState.readOnly.of(locked)] });
            } catch (e) {
                // Editor was destroyed during async AI processing
            }
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

        // Create transcript preview element above the editor
        const modal = btn.closest('.tag-modal');
        let preview = modal && modal.querySelector('.ai-transcript-preview');
        if (!preview && modal) {
            preview = document.createElement('div');
            preview.className = 'ai-transcript-preview';
            const editorContainer = modal.querySelector('.block-editor');
            if (editorContainer) {
                editorContainer.parentNode.insertBefore(preview, editorContainer);
            }
        }

        this._aiRecognition.onresult = (event) => {
            let finalTranscript = '';
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            if (finalTranscript) {
                this._aiTranscript += finalTranscript + ' ';
            }

            // Show live transcript in the preview element
            if (preview) {
                const displayText = this._aiTranscript + (interimTranscript ? interimTranscript + '...' : '');
                preview.textContent = displayText;
                preview.classList.toggle('has-content', !!displayText);
            }
        };

        this._aiRecognition.onerror = (event) => {
            console.error('AI Speech Recognition Error:', event.error);
            this.stopAIDictation(modalBlockId);
        };

        this._aiRecognition.onend = () => {
            if (this._aiDictationActive && !this._isStoppingAIDictation) {
                try { this._aiRecognition.start(); } catch(e) { console.warn('Speech recognition restart failed:', e); }
            }
            // Don't cleanup here when stopAIDictation initiated the stop —
            // processDictationWithAI handles its own cleanup
        };

        this._aiRecognition.start();
        Common.showToast('AI Listening... Speak your command.');
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
    },

    _cleanupAIDictation(modalBlockId) {
        this._aiRecognition = null;
        const preview = document.querySelector('.ai-transcript-preview');
        if (preview) preview.remove();
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
            this._insertAIContent(transcript + '\n', targetBlockId);
            return;
        }

        // Show thinking indicator in the preview area
        const modal = this._aiDictationBtn && this._aiDictationBtn.closest('.tag-modal');
        let thinkingPreview = modal && modal.querySelector('.ai-transcript-preview');
        if (!thinkingPreview && modal) {
            thinkingPreview = document.createElement('div');
            thinkingPreview.className = 'ai-transcript-preview has-content ai-thinking';
            const editorContainer = modal.querySelector('.block-editor');
            if (editorContainer) {
                editorContainer.parentNode.insertBefore(thinkingPreview, editorContainer);
            }
        }
        if (thinkingPreview) {
            thinkingPreview.className = 'ai-transcript-preview has-content ai-thinking';
            thinkingPreview.innerHTML = '<span class="ai-thinking-dots"></span> Writing note...';
        }

        try {
            const profile = AIAssistant.profiles[0];
            const apiKey = AIAssistant._apiKeys[profile.id];

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
                        { role: 'system', content: 'You are a note-taking assistant. The user will speak a command — perform the command and write the resulting note in well-structured markdown. Use headings, lists, indentation where appropriate. If the user tells you to note a task, use task checkboxes (- [ ]). Output only the note content, no commentary or code fences.' },
                        { role: 'user', content: transcript }
                    ],
                    stream: true
                })
            });

            if (!response.ok) throw new Error('API failed');

            // Accumulate full response before touching the editor
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let fullContent = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') break;
                    try {
                        const parsed = JSON.parse(data);
                        const chunk = parsed.choices?.[0]?.delta?.content || '';
                        if (chunk) fullContent += chunk;
                    } catch { /* skip malformed chunks */ }
                }
            }

            // Strip code fences if the model wrapped them
            let noteContent = fullContent.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
            if (!noteContent) noteContent = transcript;

            // Remove thinking indicator and transcript preview
            if (thinkingPreview) thinkingPreview.remove();
            const transcriptPreview = modal && modal.querySelector('.ai-transcript-preview');
            if (transcriptPreview) transcriptPreview.remove();

            // Insert content into editor — this triggers promoteModalBlock via the update listener
            this._insertAIContent(noteContent + '\n', targetBlockId);
            Common.showToast('Note created by AI.');
        } catch (err) {
            console.error('AI dictation failed:', err);
            Common.showToast('AI processing failed. Falling back to raw text.');
            if (this._aiDictationBtn) {
                this._setAIButtonState(this._aiDictationBtn, 'error');
            }
            if (thinkingPreview) thinkingPreview.remove();
            this._insertAIContent(transcript + '\n', targetBlockId);
        } finally {
            this._aiIsStreaming = false;
            if (this._aiDictationBtn && !this._aiDictationBtn.classList.contains('ai-error')) {
                this._cleanupAIDictation();
            } else {
                this._aiRecognition = null;
                this._aiDictationBtn = null;
            }
        }
    },

    _insertAIContent(content, modalBlockId) {
        if (!modalBlockId) return;

        const modal = this._aiDictationBtn && this._aiDictationBtn.closest('.tag-modal');
        const preview = modal && modal.querySelector('.ai-transcript-preview');
        if (preview) preview.remove();

        const view = DocumentView.editors.get(modalBlockId);
        if (view && view.dom) {
            const head = view.state.selection.main.head;
            const charBefore = head > 0 ? view.state.doc.sliceString(head - 1, head) : '';
            const prefix = (head > 0 && charBefore !== '\n') ? '\n' : '';
            view.dispatch({
                changes: { from: head, insert: prefix + content },
                selection: { anchor: head + prefix.length + content.length }
            });
            view.focus();
        }
    },

    handleNewNote() {
        if (document.querySelector('.content-modal')) return;
        this.showCreationPicker();
    },

    showCreationPicker() {
        if (document.querySelector('.content-modal')) return;

        const speechSupported = DocumentView.isSpeechRecognitionSupported();
        const aiConfigured = AIAssistant.isConfigured();

        const typeIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
        const micIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>';
        const taskIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>';
        const templateIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>';

        let methods = `
            <button class="creation-picker-card" data-method="type">
                ${typeIcon}
                <span class="creation-picker-label">Type</span>
                <span class="creation-picker-desc">Write a note manually</span>
            </button>`;

        if (speechSupported) {
            methods += `
            <button class="creation-picker-card" data-method="dictate">
                ${micIcon}
                <span class="creation-picker-label">Dictate</span>
                <span class="creation-picker-desc">Speech to text</span>
            </button>`;
            if (aiConfigured) {
                methods += `
            <button class="creation-picker-card" data-method="ai-dictate">
                ${micIcon}
                <span class="creation-picker-label">AI Dictate</span>
                <span class="creation-picker-desc">AI-formatted speech</span>
            </button>`;
            }
        }

        methods += `
            <button class="creation-picker-card" data-method="task">
                ${taskIcon}
                <span class="creation-picker-label">Task</span>
                <span class="creation-picker-desc">Add a new task</span>
            </button>
            <button class="creation-picker-card" data-method="template">
                ${templateIcon}
                <span class="creation-picker-label">Template</span>
                <span class="creation-picker-desc">Start from a template</span>
            </button>`;

        const modal = Modal.create({
            title: 'Create Note',
            content: `<div class="creation-picker-grid">${methods}</div>`,
            modalClass: 'tag-modal creation-picker'
        });

        modal.querySelectorAll('.creation-picker-card').forEach(card => {
            card.addEventListener('click', (e) => {
                e.preventDefault();
                const method = card.dataset.method;
                modal.close();
                this.showNewNoteModal(method);
            });
        });
    },

    showNewNoteModal(method = 'type') {
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
                SelectionManager.updateTagCounts();

                // Don't call App.render() here — it would move the modal's editor
                // to the main view. The full render happens when the modal closes.

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
            } catch (err) {
                console.error('Failed to create note:', err);
                Common.showToast('Failed to create note: ' + (err.message || 'Unknown error'));
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
                TagModal.show(tempId, {
                    onClose: () => syncTagsFromPending()
                });
            }
        };

        const micSvg = this._micSvg;
        let actionBtnHtml = '';
        if (method === 'dictate') {
            actionBtnHtml = `<button class="creation-btn mic-btn active-method" data-action="dictate" data-id="${modalBlockId}" title="Stop dictation">${micSvg} Stop</button>`;
        } else if (method === 'ai-dictate') {
            actionBtnHtml = `<button class="creation-btn ai-mic-btn active-method" data-action="ai-dictate" data-id="${modalBlockId}" title="Stop AI Dictation">${micSvg} AI <span class="ai-sparkle">\u2728</span></button>`;
        }

        const content = `
            ${actionBtnHtml ? `<div class="block block-creation-actions" style="margin-bottom: 0.75rem;">${actionBtnHtml}</div>` : ''}
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
                    this.stopAIDictation(createdBlockId || modalBlockId);
                }
                const preview = modal.querySelector('.ai-transcript-preview');
                if (preview) preview.remove();
            }
        });

        // Tag add button
        modal.querySelectorAll('.add-tag-btn').forEach(btn => {
            btn.addEventListener('click', () => openTagModal());
        });

        // Tag sync: called when tag modal closes instead of polling
        const syncTagsFromPending = () => {
            if (!createdBlockId && DocumentView.pendingNewTags) {
                const pending = DocumentView.pendingNewTags;
                if (JSON.stringify(pending) !== JSON.stringify(modalTags)) {
                    modalTags = [...pending];
                    renderModalTags();
                }
            }
        };

        // Content auto-create: triggered by CM6 update listener (set up after editor creation)
        const onEditorContentChanged = (content) => {
            if (!createdBlockId && content.trim()) {
                promoteModalBlock(content);
            }
        };

        // Clean up on close
        const origClose = modal.close.bind(modal);
        modal.close = () => {
            Store.blocks = Store.blocks.filter(b => b.id !== 'new');
            const promotedId = createdBlockId;
            const promotedContent = promotedId ? Store.blocks.find(b => b.id === promotedId)?.content : null;

            // Destroy the modal editor before origClose removes the DOM
            if (promotedId) {
                const ed = DocumentView.editors.get(promotedId);
                if (ed) { ed.destroy(); DocumentView.editors.delete(promotedId); }
            } else {
                DocumentView.editors.delete(modalBlockId);
            }

            origClose();
            Store._filteredBlocksCache.invalidate();
            SelectionManager.updateTagCounts();
            TimelineView.invalidateCache();

            if (promotedId && promotedContent && Store.currentView === 'document') {
                // Efficient insert: add the block to the DOM without a full render
                const viewContainer = document.getElementById('viewContainer');
                const newBlockArticle = viewContainer.querySelector('[data-id="new"]');
                if (newBlockArticle) {
                    const block = Store.blocks.find(b => b.id === promotedId);
                    if (block) {
                        const article = document.createElement('article');
                        article.className = 'block';
                        article.dataset.id = promotedId;
                        article.innerHTML = `
                            ${DocumentView.renderCollapseButton(block)}
                            <div class="block-split-marker" data-id="${promotedId}" title="Split note here">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" x2="8.12" y1="4" y2="15.88"/><line x1="14.47" x2="20" y1="14.48" y2="20"/><line x1="8.12" x2="12" y1="8.12" y2="12"/></svg>
                            </div>
                            ${DocumentView.renderBlockMetadata(block)}
                            <div class="block-editor">
                                <div class="codemirror-container" data-id="${promotedId}">${Common.escapeHtml(block.content || '')}</div>
                                <span class="save-indicator" data-id="${promotedId}">saved</span>
                            </div>
                        `;
                        newBlockArticle.parentNode.insertBefore(article, newBlockArticle);
                        // Create editor for the inserted block
                        const cmContainer = article.querySelector('.codemirror-container');
                        if (cmContainer) {
                            DocumentView.createEditor(cmContainer, promotedId, block.content || '');
                        }
                    }
                }
            } else {
                App.render();
            }
        };

        // Stop button for dictate/AI-dictate modes
        const actionsDiv = modal.querySelector('.block-creation-actions');
        if (actionsDiv) {
            actionsDiv.addEventListener('click', (e) => {
                const btn = e.target.closest('.creation-btn');
                if (!btn) return;
                e.preventDefault();
                const action = btn.dataset.action;
                if (action === 'dictate') {
                    DocumentView.stopSpeechRecognition();
                    actionsDiv.remove();
                } else if (action === 'ai-dictate') {
                    this.handleAIMicClick(modalBlockId, btn);
                    if (!this._aiDictationActive) actionsDiv.remove();
                }
            });
        }

        // Initialize CodeMirror for the modal
        const cmContainer = modal.querySelector('.codemirror-container');

        const initEditor = (initialContent = '') => {
            DocumentView.waitForCodeMirror().then(() => {
                const { EditorView } = window.CodeMirror;

                DocumentView.createEditor(cmContainer, modalBlockId, initialContent, [
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged && !this._aiIsStreaming) {
                            onEditorContentChanged(update.state.doc.toString());
                        }
                    })
                ]);

                const editor = DocumentView.editors.get(modalBlockId);
                if (!editor) return;

                if (method === 'task') {
                    const taskPrefix = '- [ ] ';
                    const docLen = editor.state.doc.length;
                    if (docLen === 0) {
                        editor.dispatch({
                            changes: { from: 0, insert: taskPrefix },
                            selection: { anchor: taskPrefix.length }
                        });
                    }
                    editor.focus();
                } else if (method === 'dictate') {
                    editor.focus();
                    const btn = modal.querySelector('[data-action="dictate"]');
                    if (btn) {
                        DocumentView.startSpeechRecognition(modalBlockId, btn);
                        Common.showToast('Listening... Tap mic to stop.');
                    }
                } else if (method === 'ai-dictate') {
                    editor.focus();
                    const btn = modal.querySelector('[data-action="ai-dictate"]');
                    if (btn) {
                        this.startAIDictation(modalBlockId, btn);
                    }
                } else {
                    editor.focus();
                }
            });
        };

        if (method === 'template') {
            DocumentView.waitForCodeMirror().then(async () => {
                const templates = await AppSettings.getTemplates();
                if (templates.length === 0) {
                    initEditor('');
                    return;
                }
                const pickerHtml = templates.map(t =>
                    `<button class="creation-btn template-select-btn" data-template-id="${t.id}">${escapeHtml(t.name)}</button>`
                ).join('');
                const pickerWrap = document.createElement('div');
                pickerWrap.className = 'template-picker-inline';
                pickerWrap.innerHTML = pickerHtml;
                const metadata = modal.querySelector('.block-metadata');
                metadata.before(pickerWrap);

                pickerWrap.addEventListener('click', async (e) => {
                    const btn = e.target.closest('.template-select-btn');
                    if (!btn) return;
                    const template = templates.find(t => t.id === btn.dataset.templateId);
                    pickerWrap.remove();
                    const content = template && template.content ? template.content : '';
                    initEditor(content);
                });
            });
        } else {
            initEditor('');
        }

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

// Close IndexedDB connection when page is unloaded to prevent blocking upgrades
window.addEventListener('beforeunload', () => {
    if (Store.db && !Store._saveQueue?.size) {
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
    if (document.hidden) {
        if (window.SyncManager && typeof SyncManager.onTabHidden === 'function') SyncManager.onTabHidden();
    } else if (window.SyncManager && typeof SyncManager.onTabVisible === 'function') {
        SyncManager.onTabVisible();
    }
});
