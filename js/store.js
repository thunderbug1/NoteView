/**
 * Store module - Handles file system operations and state management
 */

const Store = {
    // State
    blocks: [],
    timeProperty: 'lastUpdated',
    searchQuery: '',
    currentView: 'document',
    viewPreferences: {
        document: {
            sort: {
                clauses: [
                    { field: 'lastUpdated', direction: 'desc' },
                    { field: 'id', direction: 'asc' }
                ]
            }
        },
        kanban: {
            sort: {
                clauses: [
                    { field: 'priority', direction: 'asc' },
                    { field: 'deadline', direction: 'asc' },
                    { field: 'sourceOrder', direction: 'asc' }
                ]
            }
        }
    },
    directoryHandle: null,
    contacts: new Map(), // Map of username -> Set of tags
    shortcuts: { newNote: 'Ctrl+Alt+N' },

    // Cache for filtered blocks
    _filteredBlocksCache: CacheManager.createCache(() => {
        const timeSelection = window.SelectionManager?.selections?.time || '';
        const contextSelection = window.SelectionManager?.selections?.context
            ? Array.from(window.SelectionManager.selections.context).sort().join(',')
            : '';
        const contactSelection = window.SelectionManager?.selections?.contact || '';
        const searchQuery = Store.searchQuery || '';
        const timeProperty = Store.timeProperty || 'lastUpdated';
        const blocksHash = Store.blocks?.map(b => b.id).join(',') || '';
        return `${timeSelection}|${contextSelection}|${contactSelection}|${searchQuery}|${timeProperty}|${blocksHash}`;
    }),

    // IndexedDB for persistence
    db: null,
    DB_NAME: 'NoteViewDB',
    DB_VERSION: 2,
    STORE_NAME: 'handles',
    VIEW_PREFERENCES_STORAGE_KEY: 'noteview-view-preferences',
    CURRENT_VIEW_STORAGE_KEY: 'noteview-current-view',

    // Check browser support
    isSupported() {
        return 'showDirectoryPicker' in window;
    },

    // Initialize IndexedDB
    async initDB() {
        // Close any existing connection first
        if (this.db) {
            try {
                this.db.close();
                this.db = null;
            } catch (e) {
                console.warn('Error closing existing DB connection:', e);
            }
        }

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            let completed = false;

            const timeout = setTimeout(() => {
                if (!completed) {
                    completed = true;
                    console.error('IndexedDB open timed out after 5 seconds');
                    // Ensure db is null so other code knows it failed
                    this.db = null;
                    reject(new Error('IndexedDB open timed out'));
                }
            }, 5000);

            request.onerror = () => {
                if (!completed) {
                    completed = true;
                    clearTimeout(timeout);
                    console.error('IndexedDB open error:', request.error);
                    this.db = null;
                    reject(request.error);
                }
            };

            request.onsuccess = () => {
                if (!completed) {
                    completed = true;
                    clearTimeout(timeout);
                    this.db = request.result;
                    console.log('IndexedDB opened successfully, version:', this.db.version);
                    resolve();
                }
            };

            request.onupgradeneeded = (event) => {
                console.log('IndexedDB upgrade needed, old version:', event.oldVersion, 'new version:', event.newVersion);
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    db.createObjectStore(this.STORE_NAME);
                }
                // Add store for undo/redo state (new in version 2)
                if (!db.objectStoreNames.contains('undoRedoState')) {
                    console.log('Creating undoRedoState object store');
                    db.createObjectStore('undoRedoState');
                }
            };

            request.onblocked = () => {
                console.warn('IndexedDB upgrade blocked. Please close other tabs.');
                // Don't alert here to avoid blocking initialization completely if possible,
                // but logs will help debug.
            };
        });
    },

    // Save directory handle to IndexedDB
    async saveDirectoryHandle(handle) {
        if (!this.db) {
            await this.initDB();
            if (!this.db) {
                console.warn('Cannot save directory handle - DB not available');
                return;
            }
        }

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
                const store = transaction.objectStore(this.STORE_NAME);
                const request = store.put(handle, 'lastDirectory');

                request.onsuccess = () => resolve();
                request.onerror = () => {
                    console.warn('Error saving directory handle:', request.error);
                    reject(request.error);
                };
            } catch (e) {
                console.warn('Exception in saveDirectoryHandle:', e);
                reject(e);
            }
        });
    },

    // Get directory handle from IndexedDB
    async getDirectoryHandle() {
        if (!this.db) {
            await this.initDB();
            if (!this.db) {
                return null;
            }
        }

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
                const store = transaction.objectStore(this.STORE_NAME);
                const request = store.get('lastDirectory');

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => {
                    console.warn('Error getting directory handle:', request.error);
                    reject(request.error);
                };
            } catch (e) {
                console.warn('Exception in getDirectoryHandle:', e);
                reject(e);
            }
        });
    },
    // Save remote config to IndexedDB
    async saveRemoteConfig(config) {
        if (!this.db) {
            await this.initDB();
            if (!this.db) {
                console.warn('Cannot save remote config - DB not available');
                return;
            }
        }

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
                const store = transaction.objectStore(this.STORE_NAME);
                const request = store.put(config, 'remoteConfig');

                request.onsuccess = () => resolve();
                request.onerror = () => {
                    console.warn('Error saving remote config:', request.error);
                    reject(request.error);
                };
            } catch (e) {
                console.warn('Exception in saveRemoteConfig:', e);
                reject(e);
            }
        });
    },

    // Get remote config from IndexedDB
    async getRemoteConfig() {
        if (!this.db) {
            await this.initDB();
            if (!this.db) {
                return null;
            }
        }

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
                const store = transaction.objectStore(this.STORE_NAME);
                const request = store.get('remoteConfig');

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => {
                    console.warn('Error getting remote config:', request.error);
                    reject(request.error);
                };
            } catch (e) {
                console.warn('Exception in getRemoteConfig:', e);
                reject(e);
            }
        });
    },

    // Save shortcuts to IndexedDB
    async saveShortcuts(shortcuts) {
        this.shortcuts = shortcuts;
        if (!this.db) {
            await this.initDB();
            if (!this.db) {
                console.warn('Cannot save shortcuts - DB not available');
                return;
            }
        }

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
                const store = transaction.objectStore(this.STORE_NAME);
                const request = store.put(shortcuts, 'shortcuts');

                request.onsuccess = () => resolve();
                request.onerror = () => {
                    console.warn('Error saving shortcuts:', request.error);
                    reject(request.error);
                };
            } catch (e) {
                console.warn('Exception in saveShortcuts:', e);
                reject(e);
            }
        });
    },

    // Get shortcuts from IndexedDB
    async getShortcuts() {
        if (!this.db) {
            await this.initDB();
            if (!this.db) {
                return null;
            }
        }

        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
                const store = transaction.objectStore(this.STORE_NAME);
                const request = store.get('shortcuts');

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => {
                    console.warn('Error getting shortcuts:', request.error);
                    reject(request.error);
                };
            } catch (e) {
                console.warn('Exception in getShortcuts:', e);
                reject(e);
            }
        });
    },

    // Save undo/redo state to IndexedDB
    async saveUndoRedoState(state) {
        if (!this.db) {
            await this.initDB();
            if (!this.db) {
                console.warn('Cannot save undo/redo state - DB not available');
                return;
            }
        }

        return new Promise((resolve, reject) => {
            try {
                // Check if the object store exists before trying to transact
                if (!this.db.objectStoreNames.contains('undoRedoState')) {
                    console.warn('undoRedoState object store not found. Skipping save.');
                    return resolve();
                }
                const transaction = this.db.transaction(['undoRedoState'], 'readwrite');
                const store = transaction.objectStore('undoRedoState');
                const request = store.put(state, state.sessionId);

                request.onsuccess = () => resolve();
                request.onerror = () => {
                    console.warn('Error saving undo/redo state:', request.error);
                    reject(request.error);
                };
                transaction.onerror = () => {
                    console.warn('Transaction error saving undo/redo state');
                    reject(transaction.error);
                };
            } catch (e) {
                // If object store doesn't exist yet, fail silently
                console.warn('Exception in saveUndoRedoState:', e.name, e.message);
                reject(e);
            }
        });
    },

    // Get undo/redo state from IndexedDB
    async getUndoRedoState(sessionId) {
        if (!this.db) await this.initDB();
        if (!this.db) return null; // If initDB failed, return null

        return new Promise((resolve, reject) => {
            try {
                if (!this.db.objectStoreNames.contains('undoRedoState')) {
                    return resolve(null);
                }
                const transaction = this.db.transaction(['undoRedoState'], 'readonly');
                const store = transaction.objectStore('undoRedoState');
                const request = store.get(sessionId);

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
                transaction.onerror = () => {
                    console.warn('Transaction error reading undo/redo state');
                    resolve(null);
                };
            } catch (e) {
                // If object store doesn't exist yet (e.g., during DB upgrade), return null
                console.warn('Exception in getUndoRedoState:', e.name, e.message);
                resolve(null);
            }
        });
    },

    // Initialize file system access
    async init() {
        if (!this.isSupported()) {
            throw new Error('File System Access API is not supported in this browser. Please use Chrome, Edge, or Opera.');
        }

        await this.initDB();
        this.loadViewPreferences();
        this.loadCurrentView();

        // Load shortcuts
        const savedShortcuts = await this.getShortcuts();
        if (savedShortcuts) {
            this.shortcuts = { ...this.shortcuts, ...savedShortcuts };
        }

        // Load undo/redo state
        await UndoRedoManager.loadState();

        // Try to get previously saved handle
        let savedHandle = await this.getDirectoryHandle();

        // Fallback: try last active vault by name (handles can be lost on mobile)
        if (!savedHandle) {
            const lastVaultName = await this.getLastActiveVault();
            if (lastVaultName) {
                savedHandle = await this.getVaultHandle(lastVaultName);
            }
        }

        if (savedHandle) {
            try {
                // Check if we still have permission
                const permission = await savedHandle.queryPermission({ mode: 'readwrite' });
                if (permission === 'granted') {
                    this.directoryHandle = savedHandle;
                    await this.saveVault(savedHandle);
                    await GitStore.init(this.directoryHandle); // INIT GIT HERE
                    await this.loadBlocks();
                    return true;
                } else if (permission === 'prompt') {
                    // Try to auto-request permission (works if previously granted in this origin)
                    try {
                        const granted = await savedHandle.requestPermission({ mode: 'readwrite' });
                        if (granted === 'granted') {
                            this.directoryHandle = savedHandle;
                            await this.saveVault(savedHandle);
                            await GitStore.init(this.directoryHandle);
                            await this.loadBlocks();
                            return true;
                        }
                    } catch (_) { /* requestPermission may fail without user gesture */ }
                    // Fallback: show permission button
                    const error = new Error('Permission required to access saved folder');
                    error.name = 'NotAllowedError';
                    error.needsPermission = true;
                    error.handle = savedHandle;
                    throw error;
                }
            } catch (err) {
                if (err.needsPermission) {
                    throw err;
                }
                console.log('Could not restore directory handle:', err);
            }
        }

        // No saved handle or permission denied — caller must show picker via user gesture
        return false;
    },

    loadCurrentView() {
        try {
            const savedView = localStorage.getItem(this.CURRENT_VIEW_STORAGE_KEY);
            const allowedViews = new Set(['document', 'timeline', 'kanban', 'settings']);

            this.currentView = allowedViews.has(savedView) ? savedView : 'document';
            console.log('[Store] loadCurrentView', {
                savedView,
                resolvedView: this.currentView
            });
        } catch (error) {
            console.warn('Could not load current view:', error);
            this.currentView = 'document';
        }

        return this.currentView;
    },

    saveCurrentView() {
        try {
            localStorage.setItem(this.CURRENT_VIEW_STORAGE_KEY, this.currentView);
            console.log('[Store] saveCurrentView', {
                currentView: this.currentView
            });
        } catch (error) {
            console.warn('Could not save current view:', error);
        }

        return this.currentView;
    },

    setCurrentView(view) {
        const allowedViews = new Set(['document', 'timeline', 'kanban', 'settings']);
        console.log('[Store] setCurrentView:before', {
            requestedView: view,
            currentView: this.currentView
        });
        this.currentView = allowedViews.has(view) ? view : 'document';
        this.saveCurrentView();
        console.log('[Store] setCurrentView:after', {
            currentView: this.currentView
        });
        return this.currentView;
    },

    async openDirectory(handle) {
        this.directoryHandle = handle;
        await this.saveDirectoryHandle(handle);
        await this.saveVault(handle);
        await GitStore.init(handle);
        await this.loadBlocks();
    },

    getDefaultViewPreferences() {
        return {
            document: {
                sort: {
                    clauses: [
                        { field: 'lastUpdated', direction: 'desc' },
                        { field: 'id', direction: 'asc' }
                    ]
                }
            },
            kanban: {
                sort: {
                    clauses: [
                        { field: 'priority', direction: 'asc' },
                        { field: 'deadline', direction: 'asc' },
                        { field: 'sourceOrder', direction: 'asc' }
                    ]
                }
            }
        };
    },

    loadViewPreferences() {
        const defaults = this.getDefaultViewPreferences();
        try {
            const raw = localStorage.getItem(this.VIEW_PREFERENCES_STORAGE_KEY);
            if (!raw) {
                this.viewPreferences = defaults;
                return this.viewPreferences;
            }

            const parsed = JSON.parse(raw);
            this.viewPreferences = {
                document: {
                    ...defaults.document,
                    ...parsed?.document,
                    sort: {
                        ...defaults.document.sort,
                        ...parsed?.document?.sort
                    }
                },
                kanban: {
                    ...defaults.kanban,
                    ...parsed?.kanban,
                    sort: {
                        ...defaults.kanban.sort,
                        ...parsed?.kanban?.sort
                    }
                }
            };
        } catch (error) {
            console.warn('Could not load view preferences:', error);
            this.viewPreferences = defaults;
        }

        return this.viewPreferences;
    },

    saveViewPreferences() {
        try {
            localStorage.setItem(this.VIEW_PREFERENCES_STORAGE_KEY, JSON.stringify(this.viewPreferences));
        } catch (error) {
            console.warn('Could not save view preferences:', error);
        }

        return this.viewPreferences;
    },

    getViewPreferences(view) {
        if (!this.viewPreferences?.[view]) {
            this.viewPreferences = {
                ...this.getDefaultViewPreferences(),
                ...this.viewPreferences
            };
        }

        return this.viewPreferences[view];
    },

    getSortConfig(view) {
        return this.getViewPreferences(view)?.sort || { clauses: [] };
    },

    updateSortConfig(view, sortConfig) {
        const current = this.getViewPreferences(view) || {};
        this.viewPreferences = {
            ...this.viewPreferences,
            [view]: {
                ...current,
                sort: {
                    ...(current.sort || {}),
                    ...sortConfig
                }
            }
        };

        try {
            localStorage.setItem(this.VIEW_PREFERENCES_STORAGE_KEY, JSON.stringify(this.viewPreferences));
        } catch (error) {
            console.warn('Could not save sort configuration:', error);
        }

        return this.getSortConfig(view);
    },

    async changeDirectory() {
        try {
            const newHandle = await window.showDirectoryPicker();
            this.directoryHandle = newHandle;
            await this.saveDirectoryHandle(this.directoryHandle);
            await this.saveVault(this.directoryHandle);
            await GitStore.init(this.directoryHandle);
            await this.loadBlocks();
            // Clear undo/redo stacks when changing directory
            await UndoRedoManager.clear();
            return true;
        } catch (err) {
            if (err.name === 'AbortError') {
                return false;
            }
            throw err;
        }
    },

    // --- Vault management ---

    async saveVault(handle) {
        if (!this.db) {
            await this.initDB();
            if (!this.db) return;
        }

        const name = handle.name;

        // Store the handle under vault::<name>
        await new Promise((resolve, reject) => {
            try {
                const tx = this.db.transaction([this.STORE_NAME], 'readwrite');
                const store = tx.objectStore(this.STORE_NAME);
                const req = store.put(handle, `vault::${name}`);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            } catch (e) { reject(e); }
        });

        // Update vault list
        const list = await this.getVaultList();
        if (!list.some(v => v.name === name)) {
            list.push({ name, addedAt: new Date().toISOString() });
            await new Promise((resolve, reject) => {
                try {
                    const tx = this.db.transaction([this.STORE_NAME], 'readwrite');
                    const store = tx.objectStore(this.STORE_NAME);
                    const req = store.put(list, 'vaultList');
                    req.onsuccess = () => resolve();
                    req.onerror = () => reject(req.error);
                } catch (e) { reject(e); }
            });
        }

        // Keep lastDirectory in sync for backward compat
        await this.saveDirectoryHandle(handle);
    },

    async getVaultList() {
        if (!this.db) {
            await this.initDB();
            if (!this.db) return [];
        }
        return new Promise((resolve) => {
            try {
                const tx = this.db.transaction([this.STORE_NAME], 'readonly');
                const store = tx.objectStore(this.STORE_NAME);
                const req = store.get('vaultList');
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => resolve([]);
            } catch (e) { resolve([]); }
        });
    },

    async getVaultHandle(name) {
        if (!this.db) {
            await this.initDB();
            if (!this.db) return null;
        }
        return new Promise((resolve) => {
            try {
                const tx = this.db.transaction([this.STORE_NAME], 'readonly');
                const store = tx.objectStore(this.STORE_NAME);
                const req = store.get(`vault::${name}`);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        });
    },

    async deleteVault(name) {
        if (!this.db) {
            await this.initDB();
            if (!this.db) return;
        }

        // Remove the handle
        await new Promise((resolve, reject) => {
            try {
                const tx = this.db.transaction([this.STORE_NAME], 'readwrite');
                const store = tx.objectStore(this.STORE_NAME);
                const req = store.delete(`vault::${name}`);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            } catch (e) { reject(e); }
        });

        // Update vault list
        const list = await this.getVaultList();
        const filtered = list.filter(v => v.name !== name);
        await new Promise((resolve, reject) => {
            try {
                const tx = this.db.transaction([this.STORE_NAME], 'readwrite');
                const store = tx.objectStore(this.STORE_NAME);
                const req = store.put(filtered, 'vaultList');
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            } catch (e) { reject(e); }
        });
    },

    async setLastActiveVault(name) {
        if (!this.db) {
            await this.initDB();
            if (!this.db) return;
        }
        return new Promise((resolve, reject) => {
            try {
                const tx = this.db.transaction([this.STORE_NAME], 'readwrite');
                const store = tx.objectStore(this.STORE_NAME);
                const req = store.put(name, 'lastActiveVault');
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            } catch (e) { reject(e); }
        });
    },

    async getLastActiveVault() {
        if (!this.db) {
            await this.initDB();
            if (!this.db) return null;
        }
        return new Promise((resolve) => {
            try {
                const tx = this.db.transaction([this.STORE_NAME], 'readonly');
                const store = tx.objectStore(this.STORE_NAME);
                const req = store.get('lastActiveVault');
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        });
    },

    async switchToVault(handle) {
        // Check / request permission
        const perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
            const requested = await handle.requestPermission({ mode: 'readwrite' });
            if (requested !== 'granted') {
                throw new Error('Permission denied for vault');
            }
        }

        this.directoryHandle = handle;
        await this.saveDirectoryHandle(handle);
        await this.saveVault(handle);
        await this.setLastActiveVault(handle.name);
        await GitStore.init(handle);
        await this.loadBlocks();
        await UndoRedoManager.clear();
        TimelineView.invalidateRawDataCache();
    },

    extractContacts() {
        this.contacts.clear();
        this.blocks.forEach(block => {
            if (!block.content) return;

            // Extract all contacts (mentions and assignees) using ContactHelper
            const contacts = ContactHelper.extractContacts(block.content);

            // Associate each contact with this block's tags
            contacts.forEach(username => {
                if (!this.contacts.has(username)) {
                    this.contacts.set(username, new Set());
                }
                const contactTags = this.contacts.get(username);
                const tags = Array.isArray(block.tags) ? block.tags : [];
                tags.forEach(tag => contactTags.add(tag));
            });
        });
    },

    // Delete a block and its file
    async deleteBlock(id) {
        const index = this.blocks.findIndex(b => b.id === id);
        if (index === -1) return;

        const block = this.blocks[index];

        // Record command BEFORE deletion
        if (!UndoRedoManager.isExecuting) {
            await UndoRedoManager.executeCommand({
                type: 'delete',
                blockId: block.id,
                blockData: { ...block }
            });
        }

        const fileName = block.filename || `${block.id}.md`;

        try {
            await this.directoryHandle.removeEntry(fileName);
        } catch (e) {
            console.error('Failed to delete file', e);
        }

        this.blocks.splice(index, 1);
        this.extractContacts();
        this._filteredBlocksCache.invalidate();
    },

    // Create new block
    async createBlock(content = '', extraMetadata = {}) {
        const id = `${new Date().toISOString().split('T')[0]}-${Date.now()}`;
        const block = {
            id,
            content,
            tags: extraMetadata.tags || SelectionManager.getActiveTags(),
            creationDate: extraMetadata.creationDate || new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            ...extraMetadata
        };
        // Ensure id, content, tags, creationDate, lastUpdated are not overridden badly
        block.id = id;
        block.content = content;
        // Initial create always commits? Or only on blur?
        // Let's stick to commit: true for creation to ensure it exists in git history.
        await this.saveBlock(block, { commit: true, commitMessage: `Create note ${id}`, skipUndo: extraMetadata.skipUndo });
        this.blocks.push(block);

        // Record command AFTER creation
        if (!UndoRedoManager.isExecuting && !extraMetadata.skipUndo) {
            await UndoRedoManager.executeCommand({
                type: 'create',
                blockId: block.id,
                blockData: { ...block }
            });
        }

        return block;
    },

    // Get filtered blocks based on current selections
    getFilteredBlocks() {
        // Check cache
        const cached = this._filteredBlocksCache.get();
        if (cached !== null) {
            return cached;
        }

        // Separate pinned blocks (always shown regardless of filters)
        const pinnedBlocks = this.blocks.filter(block => block.pinned);
        const unpinnedBlocks = this.blocks.filter(block => !block.pinned);

        // Filter only unpinned blocks
        const filteredUnpinned = unpinnedBlocks.filter(block => {
            // Get active selections from App
            const timeSelection = SelectionManager.selections.time || '';
            const contextSelection = SelectionManager.selections.context;
            const contactSelection = SelectionManager.selections.contact;

            // Time filter (if selected)
            if (timeSelection) {
                const property = this.timeProperty || 'lastUpdated';
                const dateVal = block[property];

                if (!dateVal) return false;

                if (!TimeFilter.checkTimeFilter(dateVal, timeSelection)) {
                    return false;
                }
            }

            // Context filter (multi-select)
            // - Individual tags: AND (block must have each)
            // - Group paths (path:X): OR within group (block must have ANY tag with that group)
            // - Between items: AND
            if (contextSelection.size > 0) {
                const blockTags = block.tags || [];

                for (const item of contextSelection) {
                    if (SelectionManager.isComputedContextTag(item)) continue;

                    if (item.startsWith('path:')) {
                        // Group selection: block must have ANY tag in this group
                        const group = item.slice(5);
                        const hasMatch = blockTags.some(tag => {
                            const { segments } = Common.parseHierarchicalTag(tag);
                            return segments.length > 0 && segments[0] === group;
                        });
                        if (!hasMatch) return false;
                    } else {
                        // Individual tag: block must have this specific tag
                        if (!blockTags.includes(item)) return false;
                    }
                }

                let tasks = null;
                const getTasks = () => {
                    if (!tasks) {
                        tasks = TaskParser.parseTasksFromBlock(block);
                    }
                    return tasks;
                };

                if (contextSelection.has('Todo.all')) {
                    if (!block.content?.match(/\[[ xX\/bB\-]\]/)) return false;
                }
                if (contextSelection.has('Todo.open')) {
                    if (!block.content?.match(/\[[ \/]\]/)) return false;
                }
                if (contextSelection.has('Todo.blocked')) {
                    const hasBlocked = getTasks().some(t => TaskParser.isBlockedTask(t));
                    if (!hasBlocked) return false;
                }
                if (contextSelection.has('Todo.unblocked')) {
                    const hasUnblocked = getTasks().some(t => TaskParser.isUnblockedTask(t));
                    if (!hasUnblocked) return false;
                }
                if (contextSelection.has('Status.untagged')) {
                    if (block.tags && block.tags.length > 0) return false;
                }
                if (contextSelection.has('Status.unassigned')) {
                    const hasUnassigned = TaskParser.hasUnassignedTasks(getTasks());
                    if (!hasUnassigned) return false;
                }
            }

            // Contact filter
            if (contactSelection) {
                if (!ContactHelper.hasContact(block.content || '', contactSelection)) {
                    return false;
                }
            }

            // Search filter
            if (this.searchQuery) {
                const searchLower = this.searchQuery.toLowerCase();
                const contentMatch = block.content?.toLowerCase().includes(searchLower);
                const tagMatch = block.tags?.some(tag => tag.toLowerCase().includes(searchLower));
                if (!contentMatch && !tagMatch) return false;
            }

            return true;
        });

        // Combine: pinned blocks first (unfiltered), then filtered unpinned blocks
        const result = [...pinnedBlocks, ...filteredUnpinned];
        this._filteredBlocksCache.set(result);
        return result;
    },

    // Override saveBlock to invalidate cache
    // Save block to disk and optionally commit to git
    async saveBlock(block, options = {}) {
        const { commit = false, commitMessage = null, skipUndo = false, ...updates } = options;

        // Capture state before save for undo/redo
        const existingBlock = this.blocks.find(b => b.id === block.id);
        const isUpdate = !!existingBlock && !UndoRedoManager.isExecuting && !skipUndo;
        
        // Take a deep copy of the block BEFORE applying updates
        const beforeState = isUpdate ? JSON.parse(JSON.stringify(existingBlock)) : null;

        // Apply any updates provided in options
        if (Object.keys(updates).length > 0) {
            Object.assign(block, updates);
        }

        block.lastUpdated = new Date().toISOString();
        const content = serializeBlock(block);
        const fileName = block.filename || `${block.id}.md`;

        // Create or update file
        let fileHandle;
        try {
            fileHandle = await this.directoryHandle.getFileHandle(fileName, { create: true });
        } catch {
            fileHandle = await this.directoryHandle.getFileHandle(fileName, { create: true });
        }

        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();

        block.filename = fileName;

        // Update contacts
        this.extractContacts();

        // Invalidate cache
        this._filteredBlocksCache.invalidate();

        // Record update command AFTER save (using the captured beforeState)
        if (isUpdate && beforeState) {
            const diff = UndoRedoManager.createDiff(beforeState, block);
            // Only record if something actually changed (beyond just lastUpdated)
            const changedFields = Object.keys(diff.before);
            if (changedFields.length > 0 && !(changedFields.length === 1 && changedFields[0] === 'lastUpdated')) {
                await UndoRedoManager.executeCommand({
                    type: 'update',
                    blockId: block.id,
                    before: diff.before,
                    after: diff.after
                });
            }
        }

        // Commit block to git ONLY if requested
        if (commit) {
            const message = commitMessage || `Update ${fileName}`;
            await GitStore.commitBlock(fileName, message);
        }
    },

    // Rename a tag across all blocks
    async renameTag(oldTag, newTag) {
        if (oldTag === newTag) return;
        const affected = this.blocks.filter(b => b.tags?.includes(oldTag));
        for (const block of affected) {
            block.tags = block.tags.map(t => t === oldTag ? newTag : t);
            await this.saveBlock(block, { commit: true, commitMessage: `Rename tag "${oldTag}" to "${newTag}"`, skipUndo: true });
        }
        this._filteredBlocksCache.invalidate();
        SelectionManager.updateTagCounts();
        return affected.length;
    },

    // Delete a tag from all blocks
    async deleteTag(tag) {
        const affected = this.blocks.filter(b => b.tags?.includes(tag));
        for (const block of affected) {
            block.tags = block.tags.filter(t => t !== tag);
            await this.saveBlock(block, { commit: true, commitMessage: `Remove tag "${tag}"`, skipUndo: true });
        }
        this._filteredBlocksCache.invalidate();
        SelectionManager.updateTagCounts();
        return affected.length;
    },

    // Override loadBlocks to invalidate cache
    async loadBlocks() {
        this.blocks = [];
        this._filteredBlocksCache.invalidate();

        for await (const entry of this.directoryHandle.values()) {
            if (entry.name === '.git') continue;

            if (entry.kind === 'file' && entry.name.endsWith('.md')) {
                const file = await entry.getFile();
                const content = await file.text();
                const parsed = parseFrontMatter(content);
                this.blocks.push({
                    id: entry.name.replace('.md', ''),
                    filename: entry.name,
                    fileHandle: entry,
                    ...parsed
                });
            }
        }
        this.extractContacts();
        console.log(`Loaded ${this.blocks.length} blocks`);
    }
};

// Parse frontmatter from markdown
function parseFrontMatter(content) {
    let currentContent = content.trimStart();
    const data = {};
    let hasFrontMatter = false;

    // repeatedly match frontmatter blocks to handle corrupted stacked frontmatters
    const regex = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
    
    while (true) {
        const match = currentContent.match(regex);
        if (!match) break;
        
        hasFrontMatter = true;
        const metadataString = match[1];
        currentContent = currentContent.substring(match[0].length).trimStart();
        
        metadataString.split(/\r?\n/).forEach(line => {
            const separatorIndex = line.indexOf(':');
            if (separatorIndex === -1) return;
            const key = line.substring(0, separatorIndex).trim();
            const valueStr = line.substring(separatorIndex + 1).trim();
            
            // Because they stack chronologically, the first block is newest
            if (!(key in data)) {
                try {
                    data[key] = JSON.parse(valueStr);
                } catch {
                    data[key] = valueStr;
                }
            }
        });
    }

    if (!hasFrontMatter) {
        return { content };
    }

    // Ensure tags is always an array
    if (data.tags && !Array.isArray(data.tags)) {
        data.tags = [];
    }

    return {
        content: currentContent,
        ...data
    };
}

// Serialize block to markdown with frontmatter
function serializeBlock(block) {
    const { content, tags = [], ...metadata } = block;
    delete metadata.id;
    delete metadata.filename;
    delete metadata.fileHandle;

    if (Object.keys(metadata).length > 0 || tags.length > 0) {
        const frontmatter = {
            ...(tags.length > 0 && { tags }),
            ...metadata
        };
        return `---\n${Object.entries(frontmatter)
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
            .join('\n')}\n---\n\n${content || ''}`;
    }
    return content || '';
}
