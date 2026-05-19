/**
 * NoteView - Main App Controller
 */

const App = {
    VERSION: '0.1',
    isInitialized: false,



    showDirectoryPicker() {
        const hasLocalPicker = 'showDirectoryPicker' in window;
        const container = document.getElementById('viewContainer');
        const folderBtn = hasLocalPicker ? `
                    <button id="selectFolderBtn" class="select-folder-btn">
                        <span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:bottom; margin-right:4px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg></span>
                        <span>Select Folder</span>
                    </button>` : '';
        const browserVaultBtn = `
                    <button id="createBrowserVaultBtn" class="select-folder-btn" style="margin-top: 0.5rem; background: var(--bg-secondary); color: var(--text); border: 1px solid var(--border);">
                        <span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:bottom; margin-right:4px;"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg></span>
                        <span>Create Browser Vault</span>
                    </button>`;
        container.innerHTML = `
            <div class="directory-picker">
                <div class="picker-content">
                    <h1>Welcome to NoteView</h1>
                    <p>${hasLocalPicker ? 'Select a folder to store your notes' : 'Create a browser vault to store your notes'}</p>
                    ${folderBtn}
                    ${browserVaultBtn}
                    <button id="openVaultManagerBtn" class="select-folder-btn" style="margin-top: 0.5rem; background: var(--bg-secondary); color: var(--text); border: 1px solid var(--border);">
                        <span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:bottom; margin-right:4px;"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 7 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>
                        <span>Manage Vaults</span>
                    </button>
                    <p class="picker-hint">${hasLocalPicker ? 'Your notes will be stored as markdown files in the selected folder.' : 'Browser vaults stay in browser storage — no permission prompts on reload.'}</p>
                </div>
            </div>
        `;

        const selectBtn = document.getElementById('selectFolderBtn');
        if (selectBtn) {
            selectBtn.addEventListener('click', () => this.selectDirectory());
        }
        const bvBtn = document.getElementById('createBrowserVaultBtn');
        if (bvBtn) {
            bvBtn.addEventListener('click', () => this.createBrowserVault());
        }
        const vaultMgrBtn = document.getElementById('openVaultManagerBtn');
        if (vaultMgrBtn) {
            vaultMgrBtn.addEventListener('click', () => this.showManageVaultsModal());
        }
    },

    async createBrowserVault() {
        const name = window.prompt('Browser vault name:', 'Browser Vault');
        if (!name) return;
        try {
            const container = document.getElementById('viewContainer');
            container.innerHTML = '<div class="loading">Loading notes...</div>';
            await Store.createOPFSVault(name);
            await this.completeInitialization();
            this.setView('settings');
        } catch (err) {
            this.showError(err.message || 'Failed to create browser vault');
        }
    },

    async selectDirectory() {
        try {
            const container = document.getElementById('viewContainer');
            container.innerHTML = '<div class="loading">Loading notes...</div>';

            const initialized = await Store.init();
            if (initialized) {
                await this.completeInitialization();
            } else if (window.showDirectoryPicker) {
                const handle = await window.showDirectoryPicker();
                await Store.openDirectory(handle);
                await this.completeInitialization();
            } else {
                this.showManageVaultsModal();
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

        // Check for import hash/query parameter on startup
        const hash = window.location.hash || '';
        const hasImport = hash.includes('import=') || window.location.search.includes('import=');
        
        if (hasImport) {
            // Initialize basic database/state first so that the import flow works perfectly
            try {
                await Store.initDB();
                Store.loadViewPreferences();
                Store.loadCurrentView();
                const savedShortcuts = await Store.getShortcuts();
                if (savedShortcuts) {
                    Store.shortcuts = { ...Store.shortcuts, ...savedShortcuts };
                }
                await UndoRedoManager.loadState();
            } catch (err) {
                console.error('Failed to pre-initialize database for import:', err);
            }

            // Call QRTransfer's result handler with the current URL hash/search
            const importPayload = hash.includes('import=') ? hash : window.location.search;
            QRTransfer._handleScanResult(importPayload);

            // Clean up the URL parameters so that reloading the page doesn't prompt for import again
            // Using replaceState to keep history clean and avoid annoying loops.
            history.replaceState(null, document.title, window.location.pathname + window.location.search.replace(/[\?&]import=[^&]+/g, ''));
            if (window.location.hash.includes('import=')) {
                history.replaceState(null, document.title, window.location.pathname + window.location.search);
            }
            return;
        }

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
        if (this._initInProgress) return;
        this._initInProgress = true;
        // Show sidebars and FAB now that a vault is open
        document.getElementById('app')?.classList.remove('no-vault');
        const fab = document.getElementById('fabNewNote');
        if (fab) fab.style.display = '';
        Logger.log('[App] completeInitialization:start', {
            isInitialized: this.isInitialized,
            currentView: Store.currentView,
            blockCount: Store.blocks.length
        });
        if (this.isInitialized) {
            try {
                AppSettings.invalidate();
                await GitRemote.init();
                await SyncManager.init();
                await AIAssistant.init();
                SelectionManager.init({ isSwitch: true });
                SelectionManager.updateTagCounts();
                this.updateVaultSwitcherName();
                this.render();
                Logger.log('[App] completeInitialization:reenter', {
                    currentView: Store.currentView,
                    context: Array.from(SelectionManager.selections.context)
                });
            } finally {
                this._initInProgress = false;
            }
            return;
        }
        try {
            await GitRemote.init();
            await SyncManager.init();
            this.setupEventListeners();
            this.setupMobilePullToRefresh();
            SelectionManager.init();
            SelectionManager.updateTagCounts();
            await AIAssistant.init();
            this.updateVaultSwitcherName();
            this.render();
            // Collapse right sidebar on initial load when there are no deadlines
            this._collapseRightIfNoDeadlines();
            Logger.log('[App] completeInitialization:done', {
                currentView: Store.currentView,
                context: Array.from(SelectionManager.selections.context)
            });
            this.isInitialized = true;
        } finally {
            this._initInProgress = false;
        }
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
                btn.innerHTML += '<span class="sync-dot" style="position:absolute;top:2px;right:2px;width:6px;height:6px;border-radius:50%;background:var(--accent)"></span>';
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
            touchEdgeStartX = e.touches[0].clientX;
            touchEdgeStartY = e.touches[0].clientY;
        }, { passive: true });
        sidebarEdgeLeft?.addEventListener('touchend', (e) => {
            const dx = e.changedTouches[0].clientX - touchEdgeStartX;
            const dy = e.changedTouches[0].clientY - touchEdgeStartY;
            if (Math.abs(dy) > Math.abs(dx)) return;
            e.stopPropagation();
            edgeHandled = true;
            openSidebar();
        }, { passive: true });
        sidebarEdgeRight?.addEventListener('touchstart', (e) => {
            touchEdgeStartX = e.touches[0].clientX;
            touchEdgeStartY = e.touches[0].clientY;
        }, { passive: true });
        sidebarEdgeRight?.addEventListener('touchend', (e) => {
            const dx = e.changedTouches[0].clientX - touchEdgeStartX;
            const dy = e.changedTouches[0].clientY - touchEdgeStartY;
            if (Math.abs(dy) > Math.abs(dx)) return;
            e.stopPropagation();
            edgeHandled = true;
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
            if (typeof AITaskPanel !== 'undefined') AITaskPanel._updateTogglePulse();
        });

        // Touch swipe for sidebars
        let touchStartX = 0, touchStartY = 0, touchStartTarget = null;
        let touchValid = false;
        let edgeHandled = false;
        let touchEdgeStartX = 0, touchEdgeStartY = 0;

        document.addEventListener('touchstart', e => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchStartTarget = e.target;
            touchValid = true;
            edgeHandled = false;
        }, { passive: true });
        document.addEventListener('touchend', e => {
            if (!touchValid || edgeHandled) return;
            if (touchStartTarget?.closest(interactiveSelector) || e.target.closest(interactiveSelector)) return;
            const dx = e.changedTouches[0].clientX - touchStartX;
            const dy = e.changedTouches[0].clientY - touchStartY;
            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);
            const w = screenWidth();

            // 1. Standard swipe logic for horizontal movements
            if (absDx < 80 || absDx < absDy * 1.5) return;

            // If touch started inside a kanban board that can still scroll in the swipe direction, skip sidebar gesture
            const kanbanBoard = touchStartTarget?.closest('.kanban-board');
            if (kanbanBoard) {
                const atLeftEdge = kanbanBoard.scrollLeft <= 0;
                const atRightEdge = kanbanBoard.scrollLeft + kanbanBoard.clientWidth >= kanbanBoard.scrollWidth - 1;
                if ((dx > 0 && !atLeftEdge) || (dx < 0 && !atRightEdge)) return;
            }

            if (dx > 0 && !sidebar.classList.contains('sidebar-open') &&
                !sidebarRight.classList.contains('sidebar-open')) {
                const fromLeft = touchStartX;
                if ((fromLeft > 10 && fromLeft < 50) ||
                    (fromLeft >= 50 && fromLeft < 120 && dx > 100)) {
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
                    (fromRight >= 50 && fromRight < 120 && Math.abs(dx) > 100)) {
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
            this.render({ loading: true });
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

                this.render({ loading: true });
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
                        AIAssistant.togglePanel(blockId);
                    } else {
                        AIAssistant.togglePanel();
                    }
                }
            }

            // Batch AI shortcut — opens panel with all visible notes as context
            if (currentCombo === 'Ctrl+Shift+B') {
                e.preventDefault();
                if (!AIAssistant.isConfigured()) {
                    showToast('Enable AI Features in Settings first');
                } else {
                    const blocks = Store.getFilteredBlocks();
                    const contextIds = blocks.map(b => b.id);
                    if (AIAssistant._panelOpen) {
                        AIAssistant.closePanel();
                    } else if (contextIds.length > 0) {
                        const chat = AIAssistant.createChat({
                            contextBlockIds: contextIds,
                            mode: 'transform',
                            title: `${contextIds.length} notes`
                        });
                        AIAssistant.openPanel();
                    } else {
                        AIAssistant.openPanel();
                    }
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

    setupMobilePullToRefresh() {
        if (!('ontouchstart' in window)) return;
        const main = document.getElementById('main');
        if (!main || main._pullRefreshSetup) return;
        main._pullRefreshSetup = true;

        let startY = 0, pulling = false;
        const threshold = 80;

        // Create indicator
        const indicator = document.createElement('div');
        indicator.className = 'pull-refresh-indicator';
        indicator.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';
        indicator.setAttribute('aria-hidden', 'true');
        main.prepend(indicator);

        main.addEventListener('touchstart', (e) => {
            if (main.scrollTop > 0) return;
            startY = e.touches[0].clientY;
            pulling = true;
            indicator.classList.remove('spinning');
        }, { passive: true });

        main.addEventListener('touchmove', (e) => {
            if (!pulling) return;
            const dy = e.touches[0].clientY - startY;
            if (main.scrollTop > 0 || dy < 0) {
                indicator.style.transform = '';
                return;
            }
            const pull = Math.min(dy, threshold * 1.5);
            indicator.style.transform = `translateY(${pull}px)`;
            indicator.classList.toggle('ready', dy >= threshold);
        }, { passive: true });

        main.addEventListener('touchend', async () => {
            if (!pulling) return;
            pulling = false;
            const ready = indicator.classList.contains('ready');
            indicator.classList.remove('ready');

            if (ready) {
                indicator.classList.add('spinning');
                try {
                    await Store.loadBlocks();
                    App.render();
                    Common.showToast('Notes reloaded');
                } catch { /* ignore */ }
                indicator.classList.remove('spinning');
            }
            indicator.style.transform = '';
        }, { passive: true });
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

        // Filter bar clear button
        const filterBarClear = document.querySelector('.filter-bar-clear');
        if (filterBarClear) {
            filterBarClear.addEventListener('click', () => {
                SelectionManager.clearAllFilters();
                App.render();
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
                AIAssistant.togglePanel();
            });
        }

        // Toolbar sync button
        this._setupSyncStatusIndicator();

        // AI panel overlay (mobile close)
        const aiOverlay = document.getElementById('aiPanelOverlay');
        if (aiOverlay) {
            aiOverlay.addEventListener('click', () => {
                AIAssistant.closePanel();
            });
        }

        this.setupSidebarTagListeners();

        // Vault switcher
        const vaultSwitcherBtn = document.getElementById('vaultSwitcherBtn');
        if (vaultSwitcherBtn) {
            vaultSwitcherBtn.addEventListener('click', (e) => { e.stopPropagation(); this.showVaultDropdown(vaultSwitcherBtn); });
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
        Logger.log('[App] setView', {
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
            AIAssistant.closePanel();
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

        this.render({ loading: true });
        Logger.log('[App] setView:done', {
            currentView: Store.currentView
        });
    },

    _saveSidebarState() {
        const sidebar = document.getElementById('sidebar');
        const sidebarRight = document.getElementById('sidebarRight');
        this._savedSidebarState = {
            leftOpen: sidebar?.classList.contains('sidebar-open') || false,
            rightOpen: sidebarRight?.classList.contains('sidebar-open') || false,
            rightCollapsed: sidebarRight?.classList.contains('collapsed') || false,
            aiPanelOpen: AIAssistant._panelOpen || false
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

        const hasDeadlines = state.rightOpen
            && typeof TaskParser !== 'undefined'
            && TaskParser.getTasksWithUrgency(Store.blocks).length > 0;
        const rightActuallyOpen = hasDeadlines && !state.aiPanelOpen;

        if (rightActuallyOpen) {
            if (sidebarRight) sidebarRight.classList.add('sidebar-open');
            if (sidebarEdgeRight) sidebarEdgeRight.classList.add('hidden');
        }

        if (state.rightCollapsed || (!rightActuallyOpen && !state.leftOpen)) {
            if (sidebarRight) sidebarRight.classList.add('collapsed');
            if (sidebarRightToggle) sidebarRightToggle.classList.add('shifted', 'rotated');
        } else {
            if (sidebarRight) sidebarRight.classList.remove('collapsed');
            if (sidebarRightToggle) sidebarRightToggle.classList.remove('shifted', 'rotated');
        }

        if (state.leftOpen || rightActuallyOpen) {
            if (overlay) overlay.classList.add('active');
            document.body.classList.add('sidebar-open');
        }

        if (state.aiPanelOpen) {
            AIAssistant.openPanel();
        }

        this._savedSidebarState = null;
    },

    _collapseRightIfNoDeadlines() {
        const hasDeadlines = typeof TaskParser !== 'undefined'
            && TaskParser.getTasksWithUrgency(Store.blocks).length > 0;
        const hasAITasks = typeof AITaskPanel !== 'undefined'
            && (AITaskPanel._isProcessing || AITaskPanel._unreadBlockIds.length > 0);
        if (hasDeadlines || hasAITasks) return;
        const sidebarRight = document.getElementById('sidebarRight');
        const sidebarRightToggle = document.getElementById('sidebarRightToggle');
        if (sidebarRight) sidebarRight.classList.add('collapsed');
        if (sidebarRightToggle) sidebarRightToggle.classList.add('shifted', 'rotated');
    },

    _loadingOverlay: null,

    showViewLoading() {
        const container = document.getElementById('viewContainer');
        if (!container) return;
        let overlay = container.querySelector('.view-loading-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'view-loading-overlay';
            overlay.innerHTML = '<div class="view-spinner"></div>';
            container.appendChild(overlay);
        }
        overlay.classList.add('visible');
        this._loadingOverlay = overlay;
    },

    hideViewLoading() {
        const overlay = this._loadingOverlay;
        if (!overlay) return;
        overlay.classList.remove('visible');
        const el = overlay;
        setTimeout(() => el.remove(), 160);
        this._loadingOverlay = null;
    },

    render(options = {}) {
        if (options.loading) {
            this.showViewLoading();
            const self = this;
            requestAnimationFrame(() => requestAnimationFrame(() => {
                self._executeViewRender();
                self._postRender();
                self.hideViewLoading();
            }));
            return;
        }
        this._executeViewRender();
        this._postRender();
    },

    _executeViewRender() {
        const blocks = Store.getFilteredBlocks();
        const view = Store.currentView;
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
            case 'capture':
                CaptureView.render(blocks);
                break;
            case 'settings':
                SettingsView.render(blocks);
                break;
        }

        if (typeof BlockSelector !== 'undefined' && BlockSelector.active) {
            BlockSelector.refreshSelectionUI();
        }

        const fab = document.getElementById('fabNewNote');
        if (fab) {
            const hideForView = (view === 'kanban' || view === 'capture');
            const hideForAI = AIAssistant._panelOpen && window.innerWidth <= 768;
            fab.style.display = (hideForView || hideForAI) ? 'none' : '';
        }
    },

    _postRender() {
        SortManager.updateToolbar();
        GroupManager.updateToolbar();
        this.updateFilterBar();

        const view = Store.currentView;
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

        const toolbarAiBtn = document.getElementById('toolbarAiBtn');
        if (toolbarAiBtn) {
            const aiReady = AIAssistant.isConfigured();
            toolbarAiBtn.disabled = !aiReady || Store.getFilteredBlocks().length === 0;
            toolbarAiBtn.hidden = view === 'settings' || !aiReady;
        }

        this.updateUndoRedoUI();
        DeadlinePanel.render(Store.blocks);
        const focusedBlockId = DocumentView.getFocusedBlockId();
        BacklinksPanel.render(Store.blocks, focusedBlockId);
        if (typeof AITaskPanel !== 'undefined') {
            AITaskPanel.checkAutoDismiss(focusedBlockId);
            AITaskPanel.render();
        }
    },

    updateFilterBar() {
        const bar = document.getElementById('filterBar');
        if (!bar) return;

        const sel = SelectionManager.selections;
        const hasFilters = (sel?.context?.size > 0) || (sel?.excluded?.size > 0)
            || !!Store.searchQuery || !!sel?.contact;

        if (!hasFilters || Store.currentView === 'capture' || Store.currentView === 'settings') {
            bar.hidden = true;
            return;
        }

        const filtered = Store.getFilteredBlocks().length;
        const total = Store.blocks.length;
        if (filtered === total) { bar.hidden = true; return; }

        bar.hidden = false;
        bar.querySelector('.filter-bar-count').textContent =
            `${filtered} of ${total} notes`;

        const tagsEl = bar.querySelector('.filter-bar-tags');
        const pills = [];
        if (sel.context?.size > 0) {
            sel.context.forEach(tag => {
                const name = SelectionManager.getTagDisplayName(tag);
                pills.push(`<span class="filter-bar-pill">${escapeHtml(name)}</span>`);
            });
        }
        if (sel.excluded?.size > 0) {
            sel.excluded.forEach(tag => {
                const name = SelectionManager.getTagDisplayName(tag);
                pills.push(`<span class="filter-bar-pill" style="text-decoration:line-through;opacity:0.7">${escapeHtml(name)}</span>`);
            });
        }
        if (Store.searchQuery) {
            pills.push(`<span class="filter-bar-pill">"${escapeHtml(Store.searchQuery)}"</span>`);
        }
        if (sel.contact) {
            pills.push(`<span class="filter-bar-pill">@${escapeHtml(sel.contact)}</span>`);
        }
        tagsEl.innerHTML = pills.join('');
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

        try {
            // Pass new content in options to allow Store.saveBlock to correctly capture before/after state
            await Store.saveBlock(block, { ...options, content });

            TimelineView.invalidateCache();
            SelectionManager.updateTagCounts();

            // Update deadline panel after content changes
            DeadlinePanel.render(Store.blocks);
            // Update backlinks panel after content changes
            BacklinksPanel.render(Store.blocks, DocumentView.getFocusedBlockId());
        } catch (err) {
            Common.showToast('Save failed: ' + (err.message || 'Unknown error'));
            console.error('Save failed:', err);
        }
    },

    async deleteBlock(id, options = {}) {
        try {
            await Store.deleteBlock(id);
        } catch (err) {
            Common.showToast('Failed to delete note: ' + (err.message || 'Unknown error'));
            return;
        }
        TimelineView.invalidateCache();
        SelectionManager.updateTagCounts();

        if (options.showToast) {
            Common.showToast('Note deleted', {
                actionLabel: 'Undo',
                action: () => UndoRedoManager.undo(),
                duration: 8000
            });
        }

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
            const restore = this._preRecentSort || Store.getDefaultViewPreferences()?.document?.sort?.clauses || [];
            Store.updateSortConfig('document', { clauses: restore });
            this._preRecentSort = null;
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
        // saveBlock handles adding to Store.blocks if it's a new block
        await Store.saveBlock(block, { commit: true, commitMessage: `Restore deleted note ${block.id}` });

        // Ensure the restored block is in the in-memory array
        if (!Store.blocks.some(b => b.id === block.id)) {
            // saveBlock serialized a copy; push the reference we'll work with
            const savedBlock = Store.blocks.find(b => b.id === block.id);
            if (!savedBlock) Store.blocks.push(block);
        }

        RecentAccessTracker.removeFromTrash(blockId);
        RecentAccessTracker.touch(block.id);
        Store._filteredBlocksCache.invalidate();
        Store.extractContacts();
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

        try {
            await Store.saveBlock(block, options);

            TimelineView.invalidateCache();
            SelectionManager.updateTagCounts();

            // Fast path: surgical metadata update without full re-render
            if (this._canSurgicalPropertyUpdate(property, id)) {
                if (property === 'tags' && DocumentView.updateBlockTags(id)) return;
                if (DocumentView.updateBlockMetadata(id)) return;
            }
        } catch (err) {
            Common.showToast('Update failed: ' + (err.message || 'Unknown error'));
            console.error('Update failed:', err);
        }

        // Skip full render if block's editor is outside the view container (e.g. in a modal)
        const editor = DocumentView.editors.get(id);
        if (editor && !editor.dom.closest('#viewContainer')) return;

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
        const hasTime = sel?.context && Array.from(sel.context).some(t => t.startsWith('Time.'));

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

        try {
            await Store.saveBlock(block, options);

            TimelineView.invalidateCache();
            SelectionManager.updateTagCounts();

            // Fast path: surgical metadata update without full re-render
            const allSurgical = Object.keys(properties).every(p => this._canSurgicalPropertyUpdate(p, id));
            if (allSurgical && DocumentView.updateBlockMetadata(id)) return;

            this.render();
        } catch (err) {
            console.error('Failed to update block properties:', err);
            showToast('Failed to save changes');
        }
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

        RecentAccessTracker.touch(blockId);

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
                // Destroy CodeMirror editor to prevent memory leak
                const view = DocumentView.editors.get(blockId);
                if (view) {
                    view.destroy();
                    DocumentView.editors.delete(blockId);
                }
                if (Store.currentView === 'kanban') {
                    requestAnimationFrame(() => this.render());
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
        if (options.matchIndex != null) {
            const view = DocumentView.editors.get(blockId);
            if (view) {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        DocumentView.highlightAndScrollTo(blockId, view, options.matchIndex);
                    });
                });
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
                    <div class="menu-item" data-action="sendtovault">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:0.5rem"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="19" x2="12" y2="11"></line><polyline points="8 15 12 11 16 15"></polyline></svg>
                        Send to vault
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
                        navigator.clipboard.writeText(content).catch(() => {});
                    } else if (action === 'history') {
                        HistoryView.openHistory(blockId);
                    } else if (action === 'sendtovault') {
                        closeMenu();
                        SendToVault.show(blockId, btn);
                        return;
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
            SelectionManager.init({ isSwitch: true });
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
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    // AI dictation & new note modal delegated to NewNoteModal module
    _micSvg: undefined, // set after NewNoteModal loads

    get _aiIsStreaming() { return NewNoteModal._aiIsStreaming; },
    get _aiDictationActive() { return NewNoteModal._aiDictationActive; },

    handleAIMicClick(modalBlockId, btn) { NewNoteModal.handleAIMicClick(modalBlockId, btn); },
    startAIDictation(modalBlockId, btn) { NewNoteModal.startAIDictation(modalBlockId, btn); },
    stopAIDictation(modalBlockId) { return NewNoteModal.stopAIDictation(modalBlockId); },
    processDictationWithAI(transcript, blockId) { return NewNoteModal.processDictationWithAI(transcript, blockId); },

    handleNewNote() {
        if (document.querySelector('.content-modal')) return;
        const isMobile = window.matchMedia('(max-width: 768px)').matches
            || ('ontouchstart' in window && window.innerWidth <= 900);
        if (isMobile && Store.currentView !== 'capture') {
            this.setView('capture');
            return;
        }
        this.showNewNoteModal('type');
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
        NewNoteModal.showNewNoteModal(method);
    },

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

        const logoIcon = document.getElementById('appLogoIcon');
        if (logoIcon) {
            logoIcon.src = theme === 'dark' ? 'assets/icon-dark.svg' : 'assets/icon-light.svg';
        }

        if (!this.sunIcon || !this.moonIcon) return;

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
    const hasPendingSaves = Store._saveQueue && Store._saveQueue.size > 0;
    if (Store.db && !hasPendingSaves) {
        try {
            Store.db.close();
            Store.db = null;
        } catch (e) {
            // Ignore errors during cleanup
        }
    }
});

// Also close when page becomes hidden (user switches tabs)
document.addEventListener('visibilitychange', async () => {
    if (document.hidden) {
        if (window.DocumentView && typeof DocumentView.flushAllPendingSaves === 'function') {
            await DocumentView.flushAllPendingSaves();
        }
        if (window.SyncManager && typeof SyncManager.onTabHidden === 'function') SyncManager.onTabHidden();
    } else if (window.SyncManager && typeof SyncManager.onTabVisible === 'function') {
        SyncManager.onTabVisible();
    }
});

