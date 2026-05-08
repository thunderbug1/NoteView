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
    shortcuts: { newNote: 'Ctrl+Alt+N', aiAssistant: 'Ctrl+Shift+A', contextBack: 'Alt+ArrowLeft', contextForward: 'Alt+ArrowRight', toggleTask: 'Alt+T' },

    // Cache for filtered blocks
    _filteredBlocksCache: CacheManager.createCache(() => {
        const contextSelection = window.SelectionManager?.selections?.context
            ? Array.from(window.SelectionManager.selections.context).sort().join(',')
            : '';
        const excludedSelection = window.SelectionManager?.selections?.excluded
            ? Array.from(window.SelectionManager.selections.excluded).sort().join(',')
            : '';
        const contactSelection = window.SelectionManager?.selections?.contact || '';
        const searchQuery = Store.searchQuery || '';
        const timeProperty = Store.timeProperty || 'lastUpdated';
        const blocksHash = Store.blocks?.map(b => b.id).join(',') || '';
        return `${contextSelection}|${excludedSelection}|${contactSelection}|${searchQuery}|${timeProperty}|${blocksHash}`;
    }),

    // IndexedDB for persistence
    db: null,
    DB_NAME: 'NoteViewDB',
    DB_VERSION: 3,
    STORE_NAME: 'handles',
    VIEW_PREFERENCES_STORAGE_KEY: 'noteview-view-preferences',
    CURRENT_VIEW_STORAGE_KEY: 'noteview-current-view',

    // Check browser support
    isSupported() {
        return 'showDirectoryPicker' in window || ('storage' in navigator && 'getDirectory' in navigator.storage);
    },

    isOPFSVault(vaultEntry) {
        return vaultEntry && vaultEntry.type === 'opfs';
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

            request.onblocked = () => {
                console.warn('IndexedDB upgrade blocked — close other tabs');
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
                if (!db.objectStoreNames.contains('chatHistory')) {
                    console.log('Creating chatHistory object store');
                    db.createObjectStore('chatHistory');
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
                const key = this.directoryHandle ? `remoteConfig:${this.directoryHandle.name}` : 'remoteConfig';
                const request = store.put(config, key);

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
                const key = this.directoryHandle ? `remoteConfig:${this.directoryHandle.name}` : 'remoteConfig';
                const request = store.get(key);

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

    async saveChatHistory(vaultName, chats) {
        if (!this.db) {
            await this.initDB();
            if (!this.db) return;
        }
        return new Promise((resolve, reject) => {
            try {
                if (!this.db.objectStoreNames.contains('chatHistory')) {
                    return resolve();
                }
                const transaction = this.db.transaction(['chatHistory'], 'readwrite');
                const store = transaction.objectStore('chatHistory');
                const request = store.put(chats, `chatHistory::${vaultName}`);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
                transaction.onerror = () => reject(transaction.error);
            } catch (e) {
                console.warn('Exception in saveChatHistory:', e.name, e.message);
                reject(e);
            }
        });
    },

    async loadChatHistory(vaultName) {
        if (!this.db) await this.initDB();
        if (!this.db) return null;
        return new Promise((resolve) => {
            try {
                if (!this.db.objectStoreNames.contains('chatHistory')) {
                    return resolve(null);
                }
                const transaction = this.db.transaction(['chatHistory'], 'readonly');
                const store = transaction.objectStore('chatHistory');
                const request = store.get(`chatHistory::${vaultName}`);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => resolve(null);
                transaction.onerror = () => resolve(null);
            } catch (e) {
                console.warn('Exception in loadChatHistory:', e.name, e.message);
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
                // Look up vault entry to check if OPFS (no permission needed)
                const vaultList = await this.getVaultList();
                const vaultEntry = vaultList.find(v => v.name === savedHandle.name);

                // Check permission — skip for OPFS vaults
                let permission = 'granted';
                if (!this.isOPFSVault(vaultEntry)) {
                    permission = await savedHandle.queryPermission({ mode: 'readwrite' });
                    if (permission !== 'granted') {
                        // Chrome auto-grants for installed PWAs even without user gesture
                        permission = await savedHandle.requestPermission({ mode: 'readwrite' });
                    }
                }
                if (permission === 'granted') {
                    this.directoryHandle = savedHandle;
                    await this.saveVault(savedHandle);
                    await GitStore.init(this.directoryHandle); // INIT GIT HERE
                    await this.loadBlocks();
                    RecentAccessTracker.init(this.directoryHandle.name);
                    RecentAccessTracker.prune(this.blocks.map(b => b.id));
                    return true;
                } else {
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
        const isMobile = window.matchMedia('(max-width: 768px)').matches
            || ('ontouchstart' in window && window.innerWidth <= 900);
        try {
            const savedView = localStorage.getItem(this.CURRENT_VIEW_STORAGE_KEY);
            const allowedViews = new Set(['document', 'timeline', 'kanban', 'capture', 'settings']);

            if (isMobile) {
                // Mobile always starts on capture view
                this.currentView = 'capture';
            } else {
                this.currentView = allowedViews.has(savedView) ? savedView : 'document';
            }
            console.log('[Store] loadCurrentView', {
                savedView,
                resolvedView: this.currentView
            });
        } catch (error) {
            console.warn('Could not load current view:', error);
            this.currentView = isMobile ? 'capture' : 'document';
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
        const allowedViews = new Set(['document', 'timeline', 'kanban', 'settings', 'capture']);
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
        if (window.AppSettings) AppSettings.invalidate();
        await this.saveDirectoryHandle(handle);
        await this.saveVault(handle);
        await GitStore.init(handle);
        await this.loadBlocks();
        RecentAccessTracker.init(handle.name);
        RecentAccessTracker.prune(this.blocks.map(b => b.id));
    },

    getDefaultViewPreferences() {
        return {
            document: {
                sort: {
                    clauses: [
                        { field: 'lastUpdated', direction: 'desc' },
                        { field: 'id', direction: 'asc' }
                    ]
                },
                groupBy: null
            },
            kanban: {
                sort: {
                    clauses: [
                        { field: 'priority', direction: 'asc' },
                        { field: 'deadline', direction: 'asc' },
                        { field: 'sourceOrder', direction: 'asc' }
                    ]
                },
                groupBy: null
            },
            timeline: {
                groupBy: null
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
        if (!window.showDirectoryPicker) return false;
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

    async saveVault(handle, type = 'local') {
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
        const existing = list.find(v => v.name === name);
        if (!existing) {
            list.push({ name, type, addedAt: new Date().toISOString() });
        } else {
            existing.type = type;
        }
        await new Promise((resolve, reject) => {
            try {
                const tx = this.db.transaction([this.STORE_NAME], 'readwrite');
                const store = tx.objectStore(this.STORE_NAME);
                const req = store.put(list, 'vaultList');
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            } catch (e) { reject(e); }
        });

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

        // Check if this is an OPFS vault before removing metadata
        const list = await this.getVaultList();
        const entry = list.find(v => v.name === name);

        // For OPFS vaults, actually delete the directory contents
        if (this.isOPFSVault(entry)) {
            try {
                const opfsRoot = await navigator.storage.getDirectory();
                await opfsRoot.removeEntry(name, { recursive: true });
            } catch (e) {
                console.warn('Could not delete OPFS vault directory:', e);
            }
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
        // Check / request permission — skip for OPFS vaults
        const vaultList = await this.getVaultList();
        const vaultEntry = vaultList.find(v => v.name === handle.name);

        if (!this.isOPFSVault(vaultEntry)) {
            const perm = await handle.queryPermission({ mode: 'readwrite' });
            if (perm !== 'granted') {
                const requested = await handle.requestPermission({ mode: 'readwrite' });
                if (requested !== 'granted') {
                    throw new Error('Permission denied for vault');
                }
            }
        }

        this.directoryHandle = handle;
        await this.saveDirectoryHandle(handle);
        await this.saveVault(handle);
        await this.setLastActiveVault(handle.name);
        await GitStore.init(handle);
        await this.loadBlocks();
        RecentAccessTracker.init(handle.name);
        RecentAccessTracker.prune(this.blocks.map(b => b.id));
        await UndoRedoManager.clear();
        TimelineView.invalidateRawDataCache();
        TimelineView.invalidateCache();
    },

    async createOPFSVault(name) {
        const opfsRoot = await navigator.storage.getDirectory();
        const vaultHandle = await opfsRoot.getDirectoryHandle(name, { create: true });
        this.directoryHandle = vaultHandle;
        await this.saveDirectoryHandle(vaultHandle);
        await this.saveVault(vaultHandle, 'opfs');
        await GitStore.init(vaultHandle);
        await this.loadBlocks();
        RecentAccessTracker.init(vaultHandle.name);
        RecentAccessTracker.prune(this.blocks.map(b => b.id));
        await UndoRedoManager.clear();
        TimelineView.invalidateRawDataCache();
        TimelineView.invalidateCache();
        return vaultHandle;
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

        const blockData = { ...block };

        RecentAccessTracker.recordDeletion(block);

        const fileName = block.filename || `${block.id}.md`;

        try {
            await this.directoryHandle.removeEntry(fileName);
        } catch (e) {
            console.error('Failed to delete file', e);
            throw e;
        }

        // Record command AFTER successful file deletion
        if (!UndoRedoManager.isExecuting) {
            await UndoRedoManager.executeCommand({
                type: 'delete',
                blockId: block.id,
                blockData
            });
        }

        // Remove from memory only after file deletion attempt
        this.blocks.splice(index, 1);
        this.extractContacts();
        this._filteredBlocksCache.invalidate();

        // Commit deletion to git
        try {
            await GitStore.commitDeletion(fileName, `Delete ${fileName}`);
            if (window.SyncManager) SyncManager.onCommit();
        } catch (e) {
            console.error('Failed to commit deletion to git:', e);
        }
    },

    // Copy a block's .md file to a different vault
    async sendBlockToVault(blockId, targetVaultName) {
        const block = this.blocks.find(b => b.id === blockId);
        if (!block) throw new Error('Block not found');

        const handle = await this.getVaultHandle(targetVaultName);
        if (!handle) throw new Error('Vault not found. It may have been removed.');

        // Permission check for non-OPFS vaults
        const vaultList = await this.getVaultList();
        const entry = vaultList.find(v => v.name === targetVaultName);
        if (!this.isOPFSVault(entry)) {
            const perm = await handle.queryPermission({ mode: 'readwrite' });
            if (perm !== 'granted') {
                const requested = await handle.requestPermission({ mode: 'readwrite' });
                if (requested !== 'granted') {
                    throw new Error('Permission denied for ' + targetVaultName + '. Try opening it first via Manage Vaults.');
                }
            }
        }

        const content = serializeBlock(block);
        const fileName = `${block.id}.md`;

        const fileHandle = await handle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();

        return { fileName, vaultName: targetVaultName };
    },

    // Check if a block already exists with identical content in a target vault
    async checkVaultDuplicate(blockId, targetVaultName) {
        const block = this.blocks.find(b => b.id === blockId);
        if (!block) return false;

        const handle = await this.getVaultHandle(targetVaultName);
        if (!handle) return false;

        const fileName = `${block.id}.md`;
        let existingFile;
        try {
            const fh = await handle.getFileHandle(fileName);
            existingFile = await fh.getFile();
        } catch {
            return false;
        }

        const existingContent = await existingFile.text();
        const newContent = serializeBlock(block);
        return existingContent === newContent;
    },

    // Get display title for a block (first heading, or empty string if none)
    getBlockTitle(block) {
        if (!block || !block.content) return '';
        const match = block.content.match(/^#\s+(.+)$/m);
        return match ? match[1].trim() : '';
    },

    // Resolve a wikilink target: filename first (Obsidian-compatible), then first heading
    findBlockByWikilink(target) {
        const lower = target.toLowerCase();
        let block = this.blocks.find(b => b.id.toLowerCase() === lower);
        if (block) return block;
        return this.blocks.find(b => {
            const title = this.getBlockTitle(b);
            return title && title.toLowerCase() === lower;
        });
    },

    // Create new block
    async createBlock(content = '', extraMetadata = {}) {
        const id = extraMetadata.id || `${new Date().toISOString().split('T')[0]}-${Date.now()}`;
        const block = {
            id,
            content,
            tags: extraMetadata.tags || SelectionManager.getTagsForNewNote(),
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
        RecentAccessTracker.touch(block.id);

        // Record command AFTER creation — failure should not prevent the block from being returned
        if (!UndoRedoManager.isExecuting && !extraMetadata.skipUndo) {
            try {
                await UndoRedoManager.executeCommand({
                    type: 'create',
                    blockId: block.id,
                    blockData: { ...block }
                });
            } catch (undoErr) {
                console.error('Failed to record undo for new block:', undoErr);
            }
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
            const contextSelection = SelectionManager.selections.context;
            const contactSelection = SelectionManager.selections.contact;

            // Derive time selection from context
            let timeSelection = '';
            if (contextSelection.has('Time.today')) timeSelection = 'today';
            else if (contextSelection.has('Time.thisWeek')) timeSelection = 'thisWeek';
            else if (contextSelection.has('Time.thisMonth')) timeSelection = 'thisMonth';

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

                // Block-level computed: untagged
                if (contextSelection.has('Status.untagged')) {
                    if (block.tags && block.tags.length > 0) return false;
                }

                // Task-level computed: find at least one task satisfying ALL selected conditions
                const TASK_COMPUTED_TAGS = ['Todo.all', 'Todo.open', 'Todo.inProgress', 'Todo.done', 'Todo.blocked', 'Todo.canceled', 'Todo.unblocked', 'Status.unassigned'];
                const activeTaskComputed = [...contextSelection].filter(t => TASK_COMPUTED_TAGS.includes(t));

                if (activeTaskComputed.length > 0) {
                    const tasks = TaskParser.parseTasksFromBlock(block);
                    const hasMatchingTask = tasks.some(task =>
                        activeTaskComputed.every(tag => {
                            switch (tag) {
                                case 'Todo.all':          return true;
                                case 'Todo.open':         return TaskParser.isOpenTask(task);
                                case 'Todo.inProgress':   return TaskParser.isInProgressTask(task);
                                case 'Todo.done':         return TaskParser.isDoneTask(task);
                                case 'Todo.blocked':      return TaskParser.isBlockedTask(task);
                                case 'Todo.canceled':     return TaskParser.isCanceledTask(task);
                                case 'Todo.unblocked':    return TaskParser.isUnblockedTask(task);
                                case 'Status.unassigned': return TaskParser.isUnassignedTask(task);
                            }
                        })
                    );
                    if (!hasMatchingTask) return false;
                }
            }

            // Excluded tags: block must NOT have any excluded tag
            const excludedSelection = SelectionManager.selections.excluded;
            if (excludedSelection.size > 0) {
                const blockTags = block.tags || [];

                for (const item of excludedSelection) {
                    if (SelectionManager.isComputedContextTag(item)) {
                        if (item === 'Todo.all') {
                            if (block.content?.match(/\[[ xX\/bB\-]\]/)) return false;
                        } else if (item === 'Todo.open') {
                            if (block.content?.match(/\[[ \/]\]/)) return false;
                        } else if (item === 'Todo.inProgress') {
                            if (block.content?.match(/\[[\/]\]/)) return false;
                        } else if (item === 'Todo.done') {
                            if (block.content?.match(/\[[xX]\]/)) return false;
                        } else if (item === 'Todo.blocked') {
                            if (TaskParser.parseTasksFromBlock(block).some(t => TaskParser.isBlockedTask(t))) return false;
                        } else if (item === 'Todo.canceled') {
                            if (TaskParser.parseTasksFromBlock(block).some(t => TaskParser.isCanceledTask(t))) return false;
                        } else if (item === 'Todo.unblocked') {
                            if (TaskParser.parseTasksFromBlock(block).some(t => TaskParser.isUnblockedTask(t))) return false;
                        } else if (item === 'Status.untagged') {
                            if (!block.tags || block.tags.length === 0) return false;
                        } else if (item === 'Status.unassigned') {
                            if (TaskParser.hasUnassignedTasks(TaskParser.parseTasksFromBlock(block))) return false;
                        }
                    } else if (item.startsWith('path:')) {
                        const group = item.slice(5);
                        if (blockTags.some(tag => {
                            const { segments } = Common.parseHierarchicalTag(tag);
                            return segments.length > 0 && segments[0] === group;
                        })) return false;
                    } else {
                        if (blockTags.includes(item)) return false;
                    }
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

    /**
     * Determine which active filters would exclude a given block.
     * Returns an array of { type, label } objects. Empty if the block passes all filters.
     */
    getBlockingFilters(block) {
        const reasons = [];
        if (block.pinned) return reasons;

        const contextSelection = SelectionManager.selections.context;
        const excludedSelection = SelectionManager.selections.excluded;
        const contactSelection = SelectionManager.selections.contact;
        const searchQuery = this.searchQuery;

        // Derive time selection from context
        let timeSelection = '';
        if (contextSelection.has('Time.today')) timeSelection = 'today';
        else if (contextSelection.has('Time.thisWeek')) timeSelection = 'thisWeek';
        else if (contextSelection.has('Time.thisMonth')) timeSelection = 'thisMonth';

        // Time filter
        if (timeSelection) {
            const property = this.timeProperty || 'lastUpdated';
            const dateVal = block[property];
            if (!dateVal || !TimeFilter.checkTimeFilter(dateVal, timeSelection)) {
                const labels = { today: 'Today', thisWeek: 'This Week', thisMonth: 'This Month' };
                reasons.push({ type: 'time', label: labels[timeSelection] || timeSelection });
            }
        }

        // Context tags (AND logic)
        if (contextSelection.size > 0) {
            const blockTags = block.tags || [];

            for (const item of contextSelection) {
                if (SelectionManager.isComputedContextTag(item)) continue;

                if (item.startsWith('path:')) {
                    const group = item.slice(5);
                    const hasMatch = blockTags.some(tag => {
                        const { segments } = Common.parseHierarchicalTag(tag);
                        return segments.length > 0 && segments[0] === group;
                    });
                    if (!hasMatch) {
                        reasons.push({ type: 'context', label: group });
                    }
                } else {
                    if (!blockTags.includes(item)) {
                        reasons.push({ type: 'context', label: item });
                    }
                }
            }

            // Computed context tags
            if (contextSelection.has('Todo.all')) {
                if (!block.content?.match(/\[[ xX\/bB\-]\]/)) {
                    reasons.push({ type: 'context', label: 'Todo.all' });
                }
            }
            if (contextSelection.has('Todo.open')) {
                if (!block.content?.match(/\[[ \/]\]/)) {
                    reasons.push({ type: 'context', label: 'Todo.open' });
                }
            }
            if (contextSelection.has('Todo.inProgress')) {
                if (!block.content?.match(/\[[\/]\]/)) {
                    reasons.push({ type: 'context', label: 'Todo.inProgress' });
                }
            }
            if (contextSelection.has('Todo.done')) {
                if (!block.content?.match(/\[[xX]\]/)) {
                    reasons.push({ type: 'context', label: 'Todo.done' });
                }
            }
            if (contextSelection.has('Todo.blocked')) {
                const tasks = TaskParser.parseTasksFromBlock(block);
                if (!tasks.some(t => TaskParser.isBlockedTask(t))) {
                    reasons.push({ type: 'context', label: 'Todo.blocked' });
                }
            }
            if (contextSelection.has('Todo.canceled')) {
                const tasks = TaskParser.parseTasksFromBlock(block);
                if (!tasks.some(t => TaskParser.isCanceledTask(t))) {
                    reasons.push({ type: 'context', label: 'Todo.canceled' });
                }
            }
            if (contextSelection.has('Todo.unblocked')) {
                const tasks = TaskParser.parseTasksFromBlock(block);
                if (!tasks.some(t => TaskParser.isUnblockedTask(t))) {
                    reasons.push({ type: 'context', label: 'Todo.unblocked' });
                }
            }
            if (contextSelection.has('Status.untagged')) {
                if (block.tags && block.tags.length > 0) {
                    reasons.push({ type: 'context', label: 'Status.untagged' });
                }
            }
            if (contextSelection.has('Status.unassigned')) {
                const tasks = TaskParser.parseTasksFromBlock(block);
                if (!TaskParser.hasUnassignedTasks(tasks)) {
                    reasons.push({ type: 'context', label: 'Status.unassigned' });
                }
            }
        }

        // Excluded tags
        if (excludedSelection.size > 0) {
            const blockTags = block.tags || [];

            for (const item of excludedSelection) {
                if (SelectionManager.isComputedContextTag(item)) {
                    if (item === 'Todo.all') {
                        if (block.content?.match(/\[[ xX\/bB\-]\]/)) {
                            reasons.push({ type: 'excluded', label: 'Todo.all' });
                        }
                    } else if (item === 'Todo.open') {
                        if (block.content?.match(/\[[ \/]\]/)) {
                            reasons.push({ type: 'excluded', label: 'Todo.open' });
                        }
                    } else if (item === 'Todo.inProgress') {
                        if (block.content?.match(/\[[\/]\]/)) {
                            reasons.push({ type: 'excluded', label: 'Todo.inProgress' });
                        }
                    } else if (item === 'Todo.done') {
                        if (block.content?.match(/\[[xX]\]/)) {
                            reasons.push({ type: 'excluded', label: 'Todo.done' });
                        }
                    } else if (item === 'Todo.blocked') {
                        if (TaskParser.parseTasksFromBlock(block).some(t => TaskParser.isBlockedTask(t))) {
                            reasons.push({ type: 'excluded', label: 'Todo.blocked' });
                        }
                    } else if (item === 'Todo.canceled') {
                        if (TaskParser.parseTasksFromBlock(block).some(t => TaskParser.isCanceledTask(t))) {
                            reasons.push({ type: 'excluded', label: 'Todo.canceled' });
                        }
                    } else if (item === 'Todo.unblocked') {
                        if (TaskParser.parseTasksFromBlock(block).some(t => TaskParser.isUnblockedTask(t))) {
                            reasons.push({ type: 'excluded', label: 'Todo.unblocked' });
                        }
                    } else if (item === 'Status.untagged') {
                        if (!block.tags || block.tags.length === 0) {
                            reasons.push({ type: 'excluded', label: 'Status.untagged' });
                        }
                    } else if (item === 'Status.unassigned') {
                        if (TaskParser.hasUnassignedTasks(TaskParser.parseTasksFromBlock(block))) {
                            reasons.push({ type: 'excluded', label: 'Status.unassigned' });
                        }
                    }
                } else if (item.startsWith('path:')) {
                    const group = item.slice(5);
                    if (blockTags.some(tag => {
                        const { segments } = Common.parseHierarchicalTag(tag);
                        return segments.length > 0 && segments[0] === group;
                    })) {
                        reasons.push({ type: 'excluded', label: item });
                    }
                } else {
                    if (blockTags.includes(item)) {
                        reasons.push({ type: 'excluded', label: item });
                    }
                }
            }
        }

        // Contact filter
        if (contactSelection) {
            if (!ContactHelper.hasContact(block.content || '', contactSelection)) {
                reasons.push({ type: 'contact', label: '@' + contactSelection });
            }
        }

        // Search filter
        if (searchQuery) {
            const searchLower = searchQuery.toLowerCase();
            const contentMatch = block.content?.toLowerCase().includes(searchLower);
            const tagMatch = block.tags?.some(tag => tag.toLowerCase().includes(searchLower));
            if (!contentMatch && !tagMatch) {
                reasons.push({ type: 'search', label: '"' + searchQuery + '"' });
            }
        }

        return reasons;
    },

    // Override saveBlock to invalidate cache
    // Save block to disk and optionally commit to git
    async saveBlock(block, options = {}) {
        const { commit = false, commitMessage = null, skipUndo = false, ...updates } = options;

        // Serialize concurrent saves for the same block
        const saveKey = block.id;
        if (!this._saveQueue) this._saveQueue = new Map();
        while (this._saveQueue.has(saveKey)) {
            await this._saveQueue.get(saveKey);
        }
        let resolveSave;
        this._saveQueue.set(saveKey, new Promise(r => { resolveSave = r; }));

        try {
            // Capture state before save for undo/redo
            const existingBlock = this.blocks.find(b => b.id === block.id);
            const isUpdate = !!existingBlock && !UndoRedoManager.isExecuting && !skipUndo;

            // Take a deep copy of the block BEFORE applying updates
            const beforeState = isUpdate ? JSON.parse(JSON.stringify(existingBlock)) : null;
            const keysBefore = isUpdate ? Object.keys(existingBlock) : null;

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
            } catch { /* Retry once on intermittent FS error */
                fileHandle = await this.directoryHandle.getFileHandle(fileName, { create: true });
            }

            let writable;
            try {
                writable = await fileHandle.createWritable();
                await writable.write(content);
                await writable.close();
            } catch (writeError) {
                // Roll back in-memory changes on write failure
                if (beforeState) {
                    Object.keys(block).forEach(key => {
                        if (keysBefore && !keysBefore.includes(key)) delete block[key];
                    });
                    Object.assign(block, beforeState);
                }
                this.extractContacts();
                throw writeError;
            }

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
                if (window.SyncManager) SyncManager.onCommit();
            }
        } finally {
            this._saveQueue.delete(saveKey);
            resolveSave();
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
        if (this._isLoading) return;
        this._isLoading = true;
        try {
        this.blocks = [];
        this._filteredBlocksCache.invalidate();

        let entries;
        try {
            entries = this.directoryHandle.values();
        } catch (err) {
            console.error('loadBlocks: failed to iterate directory:', err);
            this.extractContacts();
            return;
        }

        for await (const entry of entries) {
            try {
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
            } catch (err) {
                if (err.name === 'NotFoundError') {
                    console.warn('loadBlocks: skipping stale entry:', err.message);
                    continue;
                }
                throw err;
            }
        }
        this.extractContacts();
        console.log(`Loaded ${this.blocks.length} blocks`);
        } finally {
            this._isLoading = false;
        }
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
            const lineMatch = line.match(/^([^:]+):\s*(.*)$/);
            if (!lineMatch) return;
            const key = lineMatch[1].trim();
            const valueStr = lineMatch[2].trim();
            
            // Because they stack chronologically, the first block is newest
            if (!(key in data)) {
                try {
                    data[key] = JSON.parse(valueStr);
                } catch { /* Not valid JSON, treat as plain string */
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
