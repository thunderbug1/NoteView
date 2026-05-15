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

            request.onsuccess = () => {
                if (!completed) {
                    completed = true;
                    clearTimeout(timeout);
                    this.db = request.result;
                    Logger.log('IndexedDB opened successfully, version:', this.db.version);
                    resolve();
                }
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                Logger.log('IndexedDB upgrade needed, old version:', event.oldVersion, 'new version:', event.newVersion);
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    db.createObjectStore(this.STORE_NAME);
                }
                // Add store for undo/redo state (new in version 2)
                if (!db.objectStoreNames.contains('undoRedoState')) {
                    db.createObjectStore('undoRedoState');
                    Logger.log('Creating undoRedoState object store');
                }
                if (!db.objectStoreNames.contains('chatHistory')) {
                    db.createObjectStore('chatHistory');
                    Logger.log('Creating chatHistory object store');
                }
            };

            request.onblocked = () => {
                console.warn('IndexedDB upgrade blocked. Please close other tabs.');
                // Mark as completed to prevent the timeout from firing later
                if (!completed) {
                    completed = true;
                    clearTimeout(timeout);
                    this.db = null;
                    reject(new Error('IndexedDB upgrade blocked by another tab'));
                }
            };
        });
    },

    // --- IndexedDB helpers ---
    _dbInitFailedAt: 0,

    async _ensureDB() {
        if (this.db) return true;
        // Back off for 30 seconds after a failed init to avoid repeated 5s timeouts
        const now = Date.now();
        if (this._dbInitFailedAt && now - this._dbInitFailedAt < 30000) return false;
        try {
            await this.initDB();
        } catch {
            this._dbInitFailedAt = now;
        }
        return !!this.db;
    },

    async _dbPut(storeName, key, value, { warnOnMissing = true } = {}) {
        if (!await this._ensureDB()) {
            if (warnOnMissing) console.warn(`Cannot save to ${storeName} - DB not available`);
            return;
        }
        return new Promise((resolve, reject) => {
            try {
                if (!this.db.objectStoreNames.contains(storeName)) {
                    if (warnOnMissing) console.warn(`${storeName} object store not found. Skipping.`);
                    return resolve();
                }
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.put(value, key);
                request.onsuccess = () => resolve();
                request.onerror = () => {
                    console.warn(`Error putting ${key} in ${storeName}:`, request.error);
                    reject(request.error);
                };
                transaction.onerror = () => {
                    console.warn(`Transaction error putting ${key} in ${storeName}`);
                    reject(transaction.error);
                };
            } catch (e) {
                console.warn(`Exception in _dbPut(${storeName}, ${key}):`, e.name, e.message);
                reject(e);
            }
        });
    },

    async _dbGet(storeName, key, { silent = false } = {}) {
        if (!await this._ensureDB()) return null;
        return new Promise((resolve) => {
            try {
                if (!this.db.objectStoreNames.contains(storeName)) {
                    return resolve(null);
                }
                const transaction = this.db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.get(key);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => {
                    if (!silent) console.warn(`Error getting ${key} from ${storeName}:`, request.error);
                    resolve(null);
                };
                transaction.onerror = () => {
                    if (!silent) console.warn(`Transaction error getting ${key} from ${storeName}`);
                    resolve(null);
                };
            } catch (e) {
                if (!silent) console.warn(`Exception in _dbGet(${storeName}, ${key}):`, e.name, e.message);
                resolve(null);
            }
        });
    },

    // --- IndexedDB-backed key/value methods ---

    async saveDirectoryHandle(handle) {
        return this._dbPut(this.STORE_NAME, 'lastDirectory', handle);
    },

    async getDirectoryHandle() {
        return this._dbGet(this.STORE_NAME, 'lastDirectory');
    },

    async saveRemoteConfig(config) {
        const key = this.directoryHandle ? `remoteConfig:${this.directoryHandle.name}` : 'remoteConfig';
        return this._dbPut(this.STORE_NAME, key, config);
    },

    async getRemoteConfig() {
        const key = this.directoryHandle ? `remoteConfig:${this.directoryHandle.name}` : 'remoteConfig';
        return this._dbGet(this.STORE_NAME, key);
    },

    async saveShortcuts(shortcuts) {
        this.shortcuts = shortcuts;
        return this._dbPut(this.STORE_NAME, 'shortcuts', shortcuts);
    },

    async getShortcuts() {
        return this._dbGet(this.STORE_NAME, 'shortcuts');
    },

    async saveUndoRedoState(state) {
        return this._dbPut('undoRedoState', state.sessionId, state);
    },

    async getUndoRedoState(sessionId) {
        return this._dbGet('undoRedoState', sessionId, { silent: true });
    },

    async saveChatHistory(vaultName, chats) {
        return this._dbPut('chatHistory', `chatHistory::${vaultName}`, chats);
    },

    async loadChatHistory(vaultName) {
        return this._dbGet('chatHistory', `chatHistory::${vaultName}`);
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

        // Fallback: try all known vaults until one works
        if (!savedHandle) {
            const vaultList = await this.getVaultList();
            for (const entry of vaultList) {
                const handle = await this.getVaultHandle(entry.name);
                if (handle) {
                    savedHandle = handle;
                    break;
                }
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
                    await this._activateVault(savedHandle);
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
                Logger.log('Could not restore directory handle:', err);
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
            Logger.log('[Store] loadCurrentView', { savedView, resolvedView: this.currentView });
        } catch (error) {
            console.warn('Could not load current view:', error);
            this.currentView = isMobile ? 'capture' : 'document';
        }

        return this.currentView;
    },

    saveCurrentView() {
        try {
            localStorage.setItem(this.CURRENT_VIEW_STORAGE_KEY, this.currentView);
            Logger.log('[Store] saveCurrentView', { currentView: this.currentView });
        } catch (error) {
            console.warn('Could not save current view:', error);
        }

        return this.currentView;
    },

    setCurrentView(view) {
        const allowedViews = new Set(['document', 'timeline', 'kanban', 'settings', 'capture']);
        Logger.log('[Store] setCurrentView:before', { requestedView: view, currentView: this.currentView });
        this.currentView = allowedViews.has(view) ? view : 'document';
        this.saveCurrentView();
        Logger.log('[Store] setCurrentView:after', { currentView: this.currentView });
        return this.currentView;
    },

    async openDirectory(handle) {
        this.directoryHandle = handle;
        if (window.AppSettings) AppSettings.invalidate();
        await this._activateVault(handle);
    },

    async _activateVault(handle, options = {}) {
        await this.saveDirectoryHandle(handle);
        await this.saveVault(handle, options.vaultType);
        if (options.setLastActive !== false) {
            await this.setLastActiveVault(handle.name);
        }
        await GitStore.init(handle);
        await this.loadBlocks();
        if (RecentAccessTracker) {
            RecentAccessTracker.init(handle.name);
            RecentAccessTracker.prune(this.blocks.map(b => b.id));
        }
        if (options.clearUndo) {
            await UndoRedoManager.clear();
        }
        TimelineView.invalidateRawDataCache();
        TimelineView.invalidateCache();
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
            await this._activateVault(newHandle, { clearUndo: true });
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

        const prevHandle = this.directoryHandle;
        const prevBlocks = [...this.blocks];
        this.directoryHandle = handle;
        try {
            await this._activateVault(handle, { clearUndo: true });
        } catch (err) {
            this.directoryHandle = prevHandle;
            this.blocks = prevBlocks;
            throw err;
        }
    },

    async createOPFSVault(name) {
        const opfsRoot = await navigator.storage.getDirectory();
        const vaultHandle = await opfsRoot.getDirectoryHandle(name, { create: true });
        this.directoryHandle = vaultHandle;
        await this._activateVault(vaultHandle, { vaultType: 'opfs', clearUndo: true });
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

        // Drain any in-flight save for this block to prevent it from
        // re-creating the file after deletion.
        if (this._saveQueue?.has(id)) {
            try { await this._saveQueue.get(id); } catch { /* save may have failed, proceed */ }
            this._deleteSentinels = this._deleteSentinels || new Set();
            this._deleteSentinels.add(id);
            this._saveQueue.delete(id);
        }

        const blockData = JSON.parse(JSON.stringify(block));

        const fileName = block.filename || `${block.id}.md`;

        try {
            await this.directoryHandle.removeEntry(fileName);
        } catch (e) {
            console.error('Failed to delete file', e);
            this._deleteSentinels?.delete(id);
            throw e;
        }

        // Record deletion in tracker only after file deletion succeeds
        RecentAccessTracker.recordDeletion(block);

        // Record command AFTER successful file deletion
        if (!UndoRedoManager.isExecuting) {
            await UndoRedoManager.executeCommand({
                type: 'delete',
                blockId: block.id,
                blockData
            });
        }

        // Commit deletion to git before mutating in-memory state
        try {
            await GitStore.commitDeletion(fileName, `Delete ${fileName}`);
            if (window.SyncManager) SyncManager.onCommit();
        } catch (e) {
            console.error('Failed to commit deletion to git:', e);
        }

        // Remove from memory only after file and git operations succeed
        this.blocks.splice(index, 1);
        this._deleteSentinels?.delete(id);
        this.extractContacts();
        this._filteredBlocksCache.invalidate();
        TimelineView.invalidateCache();
        SelectionManager.updateTagCounts();
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
        let writable;
        try {
            writable = await fileHandle.createWritable();
            await writable.write(content);
            await writable.close();
        } catch (writeError) {
            if (writable) await writable.abort();
            throw writeError;
        }

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
        const id = extraMetadata.id || `${new Date().toISOString().split('T')[0]}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
        // Capture snapshot before save/push to avoid race with concurrent mutations
        const blockSnapshot = JSON.parse(JSON.stringify(block));
        await this.saveBlock(block, { commit: true, commitMessage: `Create note ${id}`, skipUndo: extraMetadata.skipUndo });
        this.blocks.push(block);
        this._filteredBlocksCache.invalidate();
        TimelineView.invalidateCache();
        SelectionManager.updateTagCounts();
        RecentAccessTracker.touch(block.id);

        // Record command AFTER creation — failure should not prevent the block from being returned
        if (!UndoRedoManager.isExecuting && !extraMetadata.skipUndo) {
            try {
                await UndoRedoManager.executeCommand({
                    type: 'create',
                    blockId: block.id,
                    blockData: blockSnapshot
                });
            } catch (undoErr) {
                console.error('Failed to record undo for new block:', undoErr);
            }
        }

        return block;
    },

    // Get filtered blocks based on current selections
    getFilteredBlocks() {
        const cached = this._filteredBlocksCache.get();
        if (cached !== null) {
            return cached;
        }

        const opts = BlockFilter._currentOpts();
        const pinnedBlocks = this.blocks.filter(block => block.pinned && !block._isTemp);
        const unpinnedBlocks = this.blocks.filter(block => !block.pinned && !block._isTemp);
        const filteredUnpinned = unpinnedBlocks.filter(block => BlockFilter._blockPassesFast(block, opts));

        const result = [...pinnedBlocks, ...filteredUnpinned];
        this._filteredBlocksCache.set(result);
        return result;
    },

    /**
     * Determine which active filters would exclude a given block.
     * Returns an array of { type, label } objects. Empty if the block passes all filters.
     */
    getBlockingFilters(block) {
        if (block.pinned) return [];
        return BlockFilter.getBlockingReasons(block, BlockFilter._currentOpts());
    },

    // Override saveBlock to invalidate cache
    // Save block to disk and optionally commit to git
    async saveBlock(block, options = {}) {
        const { commit = false, commitMessage = null, skipUndo = false, ...updates } = options;

        // Serialize concurrent saves for the same block via promise chain
        const saveKey = block.id;
        if (!this._saveQueue) this._saveQueue = new Map();
        const prev = this._saveQueue.get(saveKey) || Promise.resolve();
        let resolveSave = () => {};
        const next = Promise.resolve(prev).then(() => new Promise(r => { resolveSave = r; }));
        this._saveQueue.set(saveKey, next);

        try {
            // Check sentinel inside the chain for atomicity
            if (this._deleteSentinels?.has(saveKey)) {
                throw new Error(`Block ${saveKey} has been deleted, save aborted`);
            }

            // Capture state before save for undo/redo
            const existingBlock = this.blocks.find(b => b.id === block.id);
            const isUpdate = !!existingBlock && !UndoRedoManager.isExecuting && !skipUndo;

            // Take a deep copy of the block BEFORE applying updates
            const beforeState = isUpdate ? JSON.parse(JSON.stringify(existingBlock)) : null;
            const keysBefore = isUpdate ? Object.keys(existingBlock) : null;

            // Apply allowed updates from options (prevent arbitrary key leakage into frontmatter)
            const allowedKeys = new Set(['content', 'tags', 'priority', 'assignee', 'due', 'start', 'status', 'creationDate', 'lastUpdated']);
            if (Object.keys(updates).length > 0) {
                for (const key of Object.keys(updates)) {
                    if (allowedKeys.has(key) || key.endsWith('Date') || key.endsWith('At')) {
                        block[key] = updates[key];
                    }
                }
            }

            block.lastUpdated = new Date().toISOString();
            const content = serializeBlock(block);
            const fileName = block.filename || `${block.id}.md`;

            // Create or update file
            let fileHandle;
            try {
                fileHandle = await this.directoryHandle.getFileHandle(fileName, { create: true });
            } catch (fsError) {
                if (fsError.name === 'NetworkError') {
                    fileHandle = await this.directoryHandle.getFileHandle(fileName, { create: true });
                } else {
                    throw fsError;
                }
            }

            let writable;
            try {
                writable = await fileHandle.createWritable();
                await writable.write(content);
                await writable.close();
            } catch (writeError) {
                if (writable) { try { await writable.abort(); } catch { /* ignore */ } }
                // Roll back in-memory changes on write failure
                if (beforeState) {
                    Object.keys(block).forEach(key => delete block[key]);
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
            resolveSave();
            if (this._saveQueue.get(saveKey) === next) {
                this._saveQueue.delete(saveKey);
            }
        }
    },

    // Rename a tag across all blocks
    async renameTag(oldTag, newTag) {
        if (oldTag === newTag) return;
        const affected = this.blocks.filter(b => b.tags?.includes(oldTag));
        for (const block of affected) {
            const newTags = block.tags.map(t => t === oldTag ? newTag : t);
            await this.saveBlock(block, { commit: true, commitMessage: `Rename tag "${oldTag}" to "${newTag}"`, skipUndo: true, tags: newTags });
        }
        this._filteredBlocksCache.invalidate();
        SelectionManager.updateTagCounts();
        return affected.length;
    },

    // Delete a tag from all blocks
    async deleteTag(tag) {
        const affected = this.blocks.filter(b => b.tags?.includes(tag));
        for (const block of affected) {
            const newTags = block.tags.filter(t => t !== tag);
            await this.saveBlock(block, { commit: true, commitMessage: `Remove tag "${tag}"`, skipUndo: true, tags: newTags });
        }
        this._filteredBlocksCache.invalidate();
        SelectionManager.updateTagCounts();
        return affected.length;
    },

    // Override loadBlocks to invalidate cache
    async loadBlocks() {
        if (this._loadPromise) return this._loadPromise;
        this._loadPromise = this._loadBlocksInternal();
        try {
            await this._loadPromise;
        } finally {
            this._loadPromise = null;
        }
    },

    async _loadBlocksInternal() {
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
                        id: entry.name.endsWith('.md') ? entry.name.slice(0, -3) : entry.name,
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
                // Skip corrupted/unreadable files instead of halting the entire load
                console.error('loadBlocks: skipping unreadable file:', entry?.name, err);
                continue;
            }
        }
        this.extractContacts();
        Logger.log('Loaded ' + this.blocks.length + ' blocks');
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
        data.tags = [String(data.tags)];
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
    delete metadata._isTemp;

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
