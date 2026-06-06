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
    _vaultReady: false, // Flag indicating vault is ready for saves
    _pendingNotesStore: 'queuedNotes', // IndexedDB store for queued notes

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
    DB_VERSION: 6,
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
                if (!db.objectStoreNames.contains('timelineCache')) {
                    db.createObjectStore('timelineCache');
                    Logger.log('Creating timelineCache object store');
                }
                if (!db.objectStoreNames.contains('metadataCache')) {
                    db.createObjectStore('metadataCache');
                    Logger.log('Creating metadataCache object store');
                }
                // Add store for queued notes (survives crashes/reloads)
                if (!db.objectStoreNames.contains(this._pendingNotesStore)) {
                    const store = db.createObjectStore(this._pendingNotesStore, { 
                        keyPath: 'id',
                        autoIncrement: true 
                    });
                    store.createIndex('timestamp', 'timestamp');
                    Logger.log('Creating queuedNotes object store');
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

    async saveDirectoryHandle(handle, type = null) {
        let vaultType = type;
        if (!vaultType && handle && handle.name) {
            const list = await this.getVaultList();
            const entry = list.find(v => v.name === handle.name);
            if (entry) {
                vaultType = entry.type;
            }
        }

        const valueToStore = (vaultType === 'opfs' && handle && typeof handle.getFileHandle === 'function')
            ? { name: handle.name, type: 'opfs', isPlaceholder: true }
            : handle;

        return this._dbPut(this.STORE_NAME, 'lastDirectory', valueToStore);
    },

    async getDirectoryHandle() {
        const stored = await this._dbGet(this.STORE_NAME, 'lastDirectory');
        if (stored && stored.isPlaceholder && stored.type === 'opfs') {
            try {
                const opfsRoot = await navigator.storage.getDirectory();
                return await opfsRoot.getDirectoryHandle(stored.name, { create: false });
            } catch (e) {
                console.warn('Could not reconstruct OPFS directory handle for lastDirectory:', e);
                return null;
            }
        }
        return stored;
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

    async saveTimelineCache(vaultName, data) {
        return this._dbPut('timelineCache', vaultName, data);
    },

    async loadTimelineCache(vaultName) {
        return this._dbGet('timelineCache', vaultName);
    },

    async deleteTimelineCache(vaultName) {
        if (!await this._ensureDB()) return;
        return new Promise((resolve) => {
            try {
                if (!this.db.objectStoreNames.contains('timelineCache')) return resolve();
                const transaction = this.db.transaction(['timelineCache'], 'readwrite');
                const store = transaction.objectStore('timelineCache');
                const request = store.delete(vaultName);
                request.onsuccess = () => resolve();
                request.onerror = () => { console.warn('Error deleting timeline cache:', request.error); resolve(); };
            } catch (e) { console.warn('Exception deleting timeline cache:', e); resolve(); }
        });
    },

    // --- Queued Notes (persist before vault loads) ---

    async _queueNoteInDB(content, options) {
        if (!await this._ensureDB()) {
            this._queueNoteInLocalStorage(content, options);
            return;
        }

        // Check if store exists
        if (!this.db.objectStoreNames.contains(this._pendingNotesStore)) {
            this._queueNoteInLocalStorage(content, options);
            return;
        }

        return new Promise((resolve, reject) => {
            try {
                const tx = this.db.transaction([this._pendingNotesStore], 'readwrite');
                const store = tx.objectStore(this._pendingNotesStore);

                const note = {
                    content,
                    options,
                    timestamp: Date.now(),
                    attempted: 0
                };

                const request = store.add(note);
                request.onsuccess = () => resolve();
                request.onerror = () => {
                    console.error('Failed to queue note in DB:', request.error);
                    this._queueNoteInLocalStorage(content, options);
                    resolve();
                };

                tx.onerror = () => {
                    console.error('Transaction error queuing note:', tx.error);
                    this._queueNoteInLocalStorage(content, options);
                    resolve();
                };
            } catch (e) {
                console.error('Exception queuing note:', e);
                this._queueNoteInLocalStorage(content, options);
                resolve();
            }
        });
    },

    _queueNoteInLocalStorage(content, options) {
        try {
            const queued = JSON.parse(localStorage.getItem('noteview_queued_notes') || '[]');
            queued.push({
                content,
                options,
                timestamp: Date.now(),
                attempted: 0
            });
            localStorage.setItem('noteview_queued_notes', JSON.stringify(queued));
            console.warn('Queued note in localStorage (DB unavailable)');
        } catch (e) {
            console.error('CRITICAL: Could not queue note anywhere!', e);
            alert('Warning: Could not save note. Vault not loaded and storage unavailable. Please retry.');
        }
    },

    async _flushPendingNotes() {
        await this._flushNotesFromDB();
        await this._flushNotesFromLocalStorage();
    },

    async _flushNotesFromDB() {
        if (!await this._ensureDB()) return;

        return new Promise((resolve, reject) => {
            try {
                // Check if store exists before accessing
                if (!this.db.objectStoreNames.contains(this._pendingNotesStore)) {
                    Logger.log('[Store] queuedNotes store does not exist yet, skipping DB flush');
                    resolve();
                    return;
                }

                const tx = this.db.transaction([this._pendingNotesStore], 'readwrite');
                const store = tx.objectStore(this._pendingNotesStore);
                const getAllRequest = store.getAll();

                getAllRequest.onsuccess = async () => {
                    const notes = getAllRequest.result || [];
                    if (notes.length === 0) {
                        resolve();
                        return;
                    }

                    let savedCount = 0;
                    let failedNotes = [];

                    for (const note of notes) {
                        try {
                            const id = `${new Date().toISOString().split('T')[0]}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                            const block = {
                                id,
                                content: note.content,
                                tags: note.options.tags || [],
                                creationDate: new Date(note.timestamp).toISOString(),
                                lastUpdated: new Date().toISOString(),
                                ...note.options
                            };
                            block.id = id;
                            block.content = note.content;
                            if (!Array.isArray(block.tags)) block.tags = note.options.tags || [];

                            await this.saveBlock(block, { commit: true, commitMessage: `Create note ${id}`, skipUndo: true });
                            this.blocks.push(block);
                            await store.delete(note.id);
                            savedCount++;
                        } catch (err) {
                            console.error('Failed to save queued note:', err);
                            note.attempted++;

                            if (note.attempted < 3) {
                                await store.put(note);
                                failedNotes.push(note);
                            } else {
                                await store.put(note);
                                failedNotes.push(note);
                            }
                        }
                    }

                    tx.oncomplete = () => {
                        if (savedCount > 0) {
                            this._filteredBlocksCache.invalidate();
                            TimelineView.invalidateCache();
                            SelectionManager.updateTagCounts();
                            if (window.Common) {
                                window.Common.showToast(`${savedCount} note(s) saved`);
                            }
                        }

                        if (failedNotes.length > 0) {
                            if (window.Common) {
                                window.Common.showToast(`${failedNotes.length} note(s) failed to save (will retry)`, {
                                    duration: 5000
                                });
                            }
                        }

                        this._updatePendingNotesCount();
                        resolve();
                    };

                    tx.onerror = () => {
                        console.error('Transaction error flushing notes:', tx.error);
                        this._updatePendingNotesCount();
                        resolve();
                    };
                };

                getAllRequest.onerror = () => {
                    console.error('Failed to get queued notes:', getAllRequest.error);
                    resolve();
                };
            } catch (e) {
                console.error('Exception flushing notes:', e);
                resolve();
            }
        });
    },

    async _flushNotesFromLocalStorage() {
        try {
            const queued = JSON.parse(localStorage.getItem('noteview_queued_notes') || '[]');
            if (queued.length === 0) return;

            const notesToFlush = [...queued];
            localStorage.removeItem('noteview_queued_notes');

            let savedCount = 0;

            for (const note of notesToFlush) {
                try {
                    if (this.directoryHandle) {
                        const id = `${new Date().toISOString().split('T')[0]}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                        const block = {
                            id,
                            content: note.content,
                            tags: note.options.tags || [],
                            creationDate: new Date(note.timestamp).toISOString(),
                            lastUpdated: new Date().toISOString(),
                            ...note.options
                        };
                        block.id = id;
                        block.content = note.content;
                        if (!Array.isArray(block.tags)) block.tags = note.options.tags || [];

                        await this.saveBlock(block, { commit: true, commitMessage: `Create note ${id}`, skipUndo: true });
                        this.blocks.push(block);
                        savedCount++;
                    } else {
                        const remaining = JSON.parse(localStorage.getItem('noteview_queued_notes') || '[]');
                        remaining.push(note);
                        localStorage.setItem('noteview_queued_notes', JSON.stringify(remaining));
                    }
                } catch (err) {
                    console.error('Failed to save queued note from localStorage:', err);
                    const remaining = JSON.parse(localStorage.getItem('noteview_queued_notes') || '[]');
                    remaining.push(note);
                    localStorage.setItem('noteview_queued_notes', JSON.stringify(remaining));
                }
            }

            if (savedCount > 0) {
                this._filteredBlocksCache.invalidate();
                TimelineView.invalidateCache();
                SelectionManager.updateTagCounts();
                if (window.Common) {
                    window.Common.showToast(`${savedCount} note(s) saved`);
                }
            }
        } catch (e) {
            console.error('Error flushing from localStorage:', e);
        }
    },

    async _getQueuedNotesCount() {
        if (await this._ensureDB()) {
            // Check if store exists
            if (!this.db.objectStoreNames.contains(this._pendingNotesStore)) {
                try {
                    return JSON.parse(localStorage.getItem('noteview_queued_notes') || '[]').length;
                } catch (e) {
                    return 0;
                }
            }

            try {
                return new Promise((resolve) => {
                    const tx = this.db.transaction([this._pendingNotesStore], 'readonly');
                    const store = tx.objectStore(this._pendingNotesStore);
                    const countRequest = store.count();

                    countRequest.onsuccess = () => {
                        let dbCount = countRequest.result || 0;

                        try {
                            const localCount = JSON.parse(localStorage.getItem('noteview_queued_notes') || '[]').length;
                            resolve(dbCount + localCount);
                        } catch (e) {
                            resolve(dbCount);
                        }
                    };

                    countRequest.onerror = () => resolve(0);
                });
            } catch (e) {
                try {
                    return JSON.parse(localStorage.getItem('noteview_queued_notes') || '[]').length;
                } catch (e2) {
                    return 0;
                }
            }
        }

        try {
            return JSON.parse(localStorage.getItem('noteview_queued_notes') || '[]').length;
        } catch (e) {
            return 0;
        }
    },

    _updatePendingNotesCount(count) {
        if (count === undefined) {
            this._getQueuedNotesCount().then(c => {
                window.dispatchEvent(new CustomEvent('pending-notes-update', {
                    detail: { count: c }
                }));
            });
        } else {
            window.dispatchEvent(new CustomEvent('pending-notes-update', {
                detail: { count }
            }));
        }
    },

    async getQueuedNotes() {
        const notes = [];

        if (await this._ensureDB()) {
            // Check if store exists
            if (!this.db.objectStoreNames.contains(this._pendingNotesStore)) {
                try {
                    const localNotes = JSON.parse(localStorage.getItem('noteview_queued_notes') || '[]');
                    notes.push(...localNotes);
                } catch (e) {
                    console.error('Error reading queued notes from localStorage:', e);
                }
                return notes;
            }

            try {
                const dbNotes = await new Promise((resolve) => {
                    const tx = this.db.transaction([this._pendingNotesStore], 'readonly');
                    const store = tx.objectStore(this._pendingNotesStore);
                    const request = store.getAll();
                    request.onsuccess = () => resolve(request.result || []);
                    request.onerror = () => resolve([]);
                });
                notes.push(...dbNotes);
            } catch (e) {
                console.error('Error reading queued notes from DB:', e);
            }
        }

        try {
            const localNotes = JSON.parse(localStorage.getItem('noteview_queued_notes') || '[]');
            notes.push(...localNotes);
        } catch (e) {
            console.error('Error reading queued notes from localStorage:', e);
        }

        return notes;
    },

    async retryQueuedNote(noteId) {
        if (await this._ensureDB()) {
            // Check if store exists
            if (!this.db.objectStoreNames.contains(this._pendingNotesStore)) {
                console.warn('queuedNotes store does not exist');
                return false;
            }

            try {
                const note = await new Promise((resolve) => {
                    const tx = this.db.transaction([this._pendingNotesStore], 'readonly');
                    const store = tx.objectStore(this._pendingNotesStore);
                    const request = store.get(noteId);
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => resolve(null);
                });

                if (note) {
                    try {
                        const id = `${new Date().toISOString().split('T')[0]}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                        const block = {
                            id,
                            content: note.content,
                            tags: note.options.tags || [],
                            creationDate: new Date(note.timestamp).toISOString(),
                            lastUpdated: new Date().toISOString(),
                            ...note.options
                        };
                        block.id = id;
                        block.content = note.content;
                        if (!Array.isArray(block.tags)) block.tags = note.options.tags || [];

                        await this.saveBlock(block, { commit: true, commitMessage: `Create note ${id}`, skipUndo: true });
                        this.blocks.push(block);

                        await new Promise((resolve) => {
                            const tx = this.db.transaction([this._pendingNotesStore], 'readwrite');
                            const store = tx.objectStore(this._pendingNotesStore);
                            const request = store.delete(noteId);
                            request.onsuccess = () => resolve();
                            request.onerror = () => resolve();
                        });

                        this._filteredBlocksCache.invalidate();
                        TimelineView.invalidateCache();
                        SelectionManager.updateTagCounts();
                        if (window.Common) {
                            window.Common.showToast('Note saved');
                        }
                        this._updatePendingNotesCount();
                        return true;
                    } catch (err) {
                        console.error('Failed to retry note:', err);
                        if (window.Common) {
                            window.Common.showToast('Failed to save note');
                        }
                        return false;
                    }
                }
            } catch (e) {
                console.error('Error retrying note:', e);
            }
        }

        return false;
    },

    async deleteQueuedNote(noteId) {
        if (await this._ensureDB()) {
            // Check if store exists
            if (!this.db.objectStoreNames.contains(this._pendingNotesStore)) {
                console.warn('queuedNotes store does not exist');
                return false;
            }

            try {
                await new Promise((resolve) => {
                    const tx = this.db.transaction([this._pendingNotesStore], 'readwrite');
                    const store = tx.objectStore(this._pendingNotesStore);
                    const request = store.delete(noteId);
                    request.onsuccess = () => resolve();
                    request.onerror = () => resolve();
                });
                this._updatePendingNotesCount();
                return true;
            } catch (e) {
                console.error('Error deleting queued note:', e);
            }
        }
        return false;
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
        await this.saveDirectoryHandle(handle, options.vaultType);
        await this.saveVault(handle, options.vaultType);
        if (options.setLastActive !== false) {
            await this.setLastActiveVault(handle.name);
        }
        await GitStore.init(handle);
        await this.loadBlocks();
        // Mark vault as ready and flush any queued notes
        this._vaultReady = true;
        await this._flushPendingNotes();
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

    async saveVault(handle, type = null) {
        if (!this.db) {
            await this.initDB();
            if (!this.db) return;
        }

        const name = handle.name;

        // Update vault list and resolve type
        const list = await this.getVaultList();
        const existing = list.find(v => v.name === name);
        const resolvedType = type || (existing ? existing.type : 'local');

        // Store the handle under vault::<name>
        await new Promise((resolve, reject) => {
            try {
                const tx = this.db.transaction([this.STORE_NAME], 'readwrite');
                const store = tx.objectStore(this.STORE_NAME);
                const valueToStore = (resolvedType === 'opfs' && handle && typeof handle.getFileHandle === 'function')
                    ? { name, type: 'opfs', isPlaceholder: true }
                    : handle;
                const req = store.put(valueToStore, `vault::${name}`);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            } catch (e) { reject(e); }
        });

        if (!existing) {
            list.push({ name, type: resolvedType, addedAt: new Date().toISOString() });
        } else {
            existing.type = resolvedType;
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
        await this.saveDirectoryHandle(handle, resolvedType);
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
        const stored = await new Promise((resolve) => {
            try {
                const tx = this.db.transaction([this.STORE_NAME], 'readonly');
                const store = tx.objectStore(this.STORE_NAME);
                const req = store.get(`vault::${name}`);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        });

        if (stored && stored.isPlaceholder && stored.type === 'opfs') {
            try {
                const opfsRoot = await navigator.storage.getDirectory();
                return await opfsRoot.getDirectoryHandle(stored.name, { create: false });
            } catch (e) {
                console.warn(`Could not reconstruct OPFS directory handle for vault::${name}:`, e);
                return null;
            }
        }

        // Fallback: if stored is not a valid handle object (e.g. empty or placeholder parsed incorrectly),
        // check vaultList to see if it is OPFS, and if so, reconstruct it.
        if (!stored || typeof stored.getDirectoryHandle !== 'function') {
            const list = await this.getVaultList();
            const entry = list.find(v => v.name === name);
            if (entry && entry.type === 'opfs') {
                try {
                    const opfsRoot = await navigator.storage.getDirectory();
                    return await opfsRoot.getDirectoryHandle(name, { create: false });
                } catch (e) {
                    console.warn(`Fallback OPFS reconstruction failed for vault::${name}:`, e);
                }
            }
        }

        return stored;
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
        // Flush any pending saves before we switch vaults!
        if (window.DocumentView && typeof DocumentView.flushAllPendingSaves === 'function') {
            await DocumentView.flushAllPendingSaves();
        }
        
        // Clear all view state to prevent stale data from persisting
        if (window.DocumentView && typeof DocumentView.clearVaultState === 'function') {
            DocumentView.clearVaultState();
        }
        if (window.KanbanView && typeof KanbanView.clearVaultState === 'function') {
            KanbanView.clearVaultState();
        }
        if (window.TimelineView && typeof TimelineView.clearVaultState === 'function') {
            TimelineView.clearVaultState();
        }
        
        // Clear cache to ensure new vault data is used
        this._filteredBlocksCache.invalidate();
        
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
        
        // Clear all view state to prevent stale data from persisting
        if (window.DocumentView && typeof DocumentView.clearVaultState === 'function') {
            DocumentView.clearVaultState();
        }
        if (window.KanbanView && typeof KanbanView.clearVaultState === 'function') {
            KanbanView.clearVaultState();
        }
        if (window.TimelineView && typeof TimelineView.clearVaultState === 'function') {
            TimelineView.clearVaultState();
        }
        
        // Clear cache to ensure new vault data is used
        this._filteredBlocksCache.invalidate();
        
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

        // Set sentinel BEFORE draining save queue to block any racing saves.
        this._deleteSentinels = this._deleteSentinels || new Set();
        this._deleteSentinels.add(id);

        // Drain any in-flight save for this block to prevent it from
        // re-creating the file after deletion.
        if (this._saveQueue?.has(id)) {
            try { await this._saveQueue.get(id); } catch { /* save may have failed, proceed */ }
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
        TagIndex.removeBlock(id);
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
        // If vault not ready, queue note in IndexedDB for guaranteed persistence
        if (!this._vaultReady || !this.directoryHandle) {
            await this._queueNoteInDB(content, extraMetadata);
            if (window.Common) {
                window.Common.showToast('Note queued (vault loading...)');
            }
            const count = await this._getQueuedNotesCount();
            this._updatePendingNotesCount(count);
            return null;
        }

        const id = extraMetadata.id || `${new Date().toISOString().split('T')[0]}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const block = {
            id,
            content,
            tags: extraMetadata.tags || SelectionManager.getTagsForNewNote(),
            creationDate: extraMetadata.creationDate || new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            ...extraMetadata
        };
        // Ensure critical fields are not overridden by extraMetadata spread
        block.id = id;
        block.content = content;
        if (!Array.isArray(block.tags)) block.tags = extraMetadata.tags || SelectionManager.getTagsForNewNote();
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

        // Use tag index to pre-filter by context tags when possible
        let candidateBlocks = unpinnedBlocks;

        if (opts.contextSelection && opts.contextSelection.size > 0 && window.TagIndex?.tagToBlocks?.size > 0) {
            const regularTags = [];
            const pathGroups = [];
            const todoTags = [];
            let hasTodoGroup = false;
            let hasUntagged = false;

            for (const item of opts.contextSelection) {
                if (window.SelectionManager.isComputedContextTag(item)) {
                    if (item === 'Status.untagged') hasUntagged = true;
                    else if (item.startsWith('Todo.')) todoTags.push(item);
                    continue;
                }
                if (item.startsWith('path:')) {
                    const group = item.slice(5);
                    if (group === 'Todo') {
                        hasTodoGroup = true;
                    } else {
                        pathGroups.push(group);
                    }
                } else {
                    regularTags.push(item);
                }
            }

            // If we have regular tags, path groups, or todo status, use index to pre-filter
            if (regularTags.length > 0 || pathGroups.length > 0 || todoTags.length > 0 || hasTodoGroup || hasUntagged) {
                let candidateBlockIds = null;

                // Regular tags (AND logic)
                if (regularTags.length > 0) {
                    candidateBlockIds = window.TagIndex.getBlocksWithTags(regularTags);
                }

                // Intersect with todo status blocks
                if (hasTodoGroup) {
                    // path:Todo means OR logic for all Todo.* states
                    const allTodoBlocks = window.TagIndex.getBlocksWithTodo('Todo.all');
                    if (candidateBlockIds === null) {
                        candidateBlockIds = allTodoBlocks;
                    } else {
                        candidateBlockIds = new Set([...candidateBlockIds].filter(x => allTodoBlocks.has(x)));
                    }
                } else if (todoTags.length > 0) {
                    // Individual Todo.* tags: use AND logic
                    for (const todoTag of todoTags) {
                        const todoBlocks = window.TagIndex.getBlocksWithTodo(todoTag);
                        if (candidateBlockIds === null) {
                            candidateBlockIds = todoBlocks;
                        } else {
                            candidateBlockIds = new Set([...candidateBlockIds].filter(x => todoBlocks.has(x)));
                        }
                        if (candidateBlockIds.size === 0) break;
                    }
                }

                // Intersect with path group blocks
                if (candidateBlockIds !== new Set() && pathGroups.length > 0) {
                    for (const group of pathGroups) {
                        const groupBlocks = window.TagIndex.getBlocksWithTagGroup(group);
                        if (candidateBlockIds === null) {
                            candidateBlockIds = groupBlocks;
                        } else {
                            candidateBlockIds = new Set([...candidateBlockIds].filter(x => groupBlocks.has(x)));
                        }
                        if (candidateBlockIds.size === 0) break;
                    }
                }

                // Intersect with untagged blocks if needed
                if (candidateBlockIds !== new Set() && hasUntagged) {
                    const untagged = window.TagIndex.untaggedBlocks;
                    if (candidateBlockIds === null) {
                        candidateBlockIds = untagged;
                    } else {
                        candidateBlockIds = new Set([...candidateBlockIds].filter(x => untagged.has(x)));
                    }
                }

                // Pre-filter blocks to only those in the candidate set
                if (candidateBlockIds) {
                    candidateBlocks = candidateBlocks.filter(block => candidateBlockIds.has(block.id));
                }
            }
        }

        // Use tag index to pre-filter by excluded tags when possible
        if (opts.excludedSelection && opts.excludedSelection.size > 0 && window.TagIndex?.tagToBlocks?.size > 0) {
            const regularTags = [];
            const pathGroups = [];
            const todoTags = [];
            let hasUntagged = false;

            for (const item of opts.excludedSelection) {
                if (window.SelectionManager.isComputedContextTag(item)) {
                    if (item === 'Status.untagged') hasUntagged = true;
                    else if (item.startsWith('Todo.')) todoTags.push(item);
                    continue;
                }
                if (item.startsWith('path:')) {
                    pathGroups.push(item.slice(5));
                } else {
                    regularTags.push(item);
                }
            }

            // If we have regular tags, path groups, or todo status to exclude, use index to pre-filter
            if (regularTags.length > 0 || pathGroups.length > 0 || todoTags.length > 0 || hasUntagged) {
                let excludedBlockIds = null;

                // Collect blocks with any excluded regular tag
                if (regularTags.length > 0) {
                    excludedBlockIds = window.TagIndex.getBlocksWithoutTags(regularTags);
                }

                // Collect blocks with any excluded todo status
                if (todoTags.length > 0) {
                    for (const todoTag of todoTags) {
                        const todoBlocks = window.TagIndex.getBlocksWithTodo(todoTag);
                        if (excludedBlockIds === null) {
                            excludedBlockIds = new Set(todoBlocks);
                        } else {
                            todoBlocks.forEach(id => excludedBlockIds.add(id));
                        }
                    }
                }

                // Collect blocks with any tag in excluded path groups
                if (pathGroups.length > 0) {
                    for (const group of pathGroups) {
                        const groupSet = window.TagIndex.getBlocksWithTagGroup(group);
                        if (excludedBlockIds === null) {
                            excludedBlockIds = new Set(groupSet);
                        } else {
                            groupSet.forEach(id => excludedBlockIds.add(id));
                        }
                    }
                }

                // Add untagged blocks to excluded set if needed
                if (hasUntagged) {
                    const untagged = window.TagIndex.untaggedBlocks;
                    if (excludedBlockIds === null) {
                        excludedBlockIds = new Set(untagged);
                    } else {
                        untagged.forEach(id => excludedBlockIds.add(id));
                    }
                }

                // Pre-filter blocks to exclude those in the excluded set
                if (excludedBlockIds) {
                    candidateBlocks = candidateBlocks.filter(block => !excludedBlockIds.has(block.id));
                }
            }
        }

        // Filter the candidates with the full filter logic
        const filteredUnpinned = candidateBlocks.filter(block => BlockFilter._blockPassesFast(block, opts));

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

            // Skip saving if there are no actual changes in content or metadata
            if (existingBlock && !UndoRedoManager.isExecuting) {
                let hasChanges = false;
                const allowedKeys = new Set(['content', 'tags', 'priority', 'assignee', 'due', 'start', 'status', 'creationDate', 'lastUpdated', 'pinned']);
                for (const key of Object.keys(updates)) {
                    if (allowedKeys.has(key) || key.endsWith('Date') || key.endsWith('At')) {
                        const newValue = updates[key];
                        const currentValue = existingBlock[key];
                        if (Array.isArray(newValue)) {
                            if (!Array.isArray(currentValue) || newValue.length !== currentValue.length || !newValue.every((v, i) => v === currentValue[i])) {
                                hasChanges = true;
                                break;
                            }
                        } else if (newValue !== currentValue) {
                            hasChanges = true;
                            break;
                        }
                    }
                }
                if (!hasChanges) {
                    return;
                }
            }

            const isUpdate = !!existingBlock && !UndoRedoManager.isExecuting && !skipUndo;

            // Take a deep copy of the block BEFORE applying updates
            const beforeState = isUpdate ? JSON.parse(JSON.stringify(existingBlock)) : null;
            const keysBefore = isUpdate ? Object.keys(existingBlock) : null;

            // Apply allowed updates from options (prevent arbitrary key leakage into frontmatter)
            const allowedKeys = new Set(['content', 'tags', 'priority', 'assignee', 'due', 'start', 'status', 'creationDate', 'lastUpdated', 'pinned']);
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

            // Update tag index if tags changed
            const oldTags = existingBlock?.tags || [];
            const newTags = block.tags || [];
            if (JSON.stringify(oldTags) !== JSON.stringify(newTags)) {
                TagIndex.updateBlockTags(block.id, oldTags, newTags);
            }

            // Always update content index (for Todo.* status)
            TagIndex.updateBlockContent(block.id, block.content || '');

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
        let entries;
        try {
            entries = this.directoryHandle.values();
        } catch (err) {
            console.error('loadBlocks: failed to iterate directory:', err);
            this._filteredBlocksCache.invalidate();
            TagIndex.clear();
            this.extractContacts();
            return;
        }

        const entriesArray = [];
        try {
            for await (const entry of entries) {
                if (entry.name === '.git') continue;
                if (entry.kind === 'file' && entry.name.endsWith('.md')) {
                    entriesArray.push(entry);
                }
            }
        } catch (err) {
            console.error('loadBlocks: failed to gather directory entries:', err);
            this._filteredBlocksCache.invalidate();
            TagIndex.clear();
            this.extractContacts();
            return;
        }

        // Get existing metadata cache
        const cacheStore = 'metadataCache';
        const vaultPrefix = `vault::${this.directoryHandle.name}::`;
        const metadataCache = new Map();
        
        if (await this._ensureDB()) {
            try {
                // Check if store exists before accessing
                if (!this.db.objectStoreNames.contains(cacheStore)) {
                    console.warn('[Store] metadataCache store does not exist yet');
                } else {
                    const tx = this.db.transaction([cacheStore], 'readonly');
                    const store = tx.objectStore(cacheStore);
                    const req = store.openCursor(IDBKeyRange.bound(vaultPrefix, vaultPrefix + '\uffff'));
                    await new Promise(resolve => {
                        req.onsuccess = (e) => {
                            const cursor = e.target.result;
                            if (cursor) {
                                metadataCache.set(cursor.key.replace(vaultPrefix, ''), cursor.value);
                                cursor.continue();
                            } else resolve();
                        };
                        req.onerror = () => resolve();
                    });
                }
            } catch (e) { console.warn('Failed to load metadata cache:', e); }
        }

        const updatedCache = new Map();
        const readPromises = entriesArray.map(async (entry) => {
            try {
                const file = await entry.getFile();
                const cached = metadataCache.get(entry.name);
                
                if (cached && cached.mtime === file.lastModified) {
                    return {
                        id: entry.name.slice(0, -3),
                        filename: entry.name,
                        fileHandle: entry,
                        ...cached.data
                    };
                }

                // Cache miss or stale: read and parse
                const content = await file.text();
                const parsed = parseFrontMatter(content);
                const data = { ...parsed };
                
                updatedCache.set(entry.name, { mtime: file.lastModified, data });

                return {
                    id: entry.name.slice(0, -3),
                    filename: entry.name,
                    fileHandle: entry,
                    ...data
                };
            } catch (err) {
                if (err.name === 'NotFoundError') return null;
                console.error('loadBlocks: skipping unreadable file:', entry?.name, err);
                return null;
            }
        });

        const results = await Promise.all(readPromises);
        
        // Update IndexedDB cache with new/changed files and prune deleted ones
        if (updatedCache.size > 0 || entriesArray.length < metadataCache.size) {
            if (await this._ensureDB()) {
                try {
                    const tx = this.db.transaction([cacheStore], 'readwrite');
                    const store = tx.objectStore(cacheStore);
                    
                    // Update cache for new/changed files
                    for (const [filename, value] of updatedCache) {
                        store.put(value, vaultPrefix + filename);
                    }
                    
                    // Prune cache for deleted files
                    const currentFiles = new Set(entriesArray.map(e => e.name));
                    for (const filename of metadataCache.keys()) {
                        if (!currentFiles.has(filename)) {
                            store.delete(vaultPrefix + filename);
                        }
                    }
                } catch (e) { console.warn('Failed to update metadata cache:', e); }
            }
        }

        // Atomically update the memory store, cache, index, and contacts only after all async reads resolve
        this.blocks = results.filter(block => block !== null);
        this._filteredBlocksCache.invalidate();
        TagIndex.init(this.blocks);
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
