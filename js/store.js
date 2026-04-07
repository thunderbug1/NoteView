/**
 * Store module - Handles file system operations and state management
 */

const Store = {
    // State
    blocks: [],
    timeProperty: 'lastUpdated',
    searchQuery: '',
    currentView: 'document',
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

        // Load shortcuts
        const savedShortcuts = await this.getShortcuts();
        if (savedShortcuts) {
            this.shortcuts = { ...this.shortcuts, ...savedShortcuts };
        }

        // Load undo/redo state
        await UndoRedoManager.loadState();

        // Try to get previously saved handle
        let savedHandle = await this.getDirectoryHandle();

        if (savedHandle) {
            try {
                // Check if we still have permission
                const permission = await savedHandle.queryPermission({ mode: 'readwrite' });
                if (permission === 'granted') {
                    this.directoryHandle = savedHandle;
                    await GitStore.init(this.directoryHandle); // INIT GIT HERE
                    await this.loadBlocks();
                    return true;
                } else if (permission === 'prompt') {
                    // Permission needed - throw special error so UI can show button
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

    async openDirectory(handle) {
        this.directoryHandle = handle;
        await this.saveDirectoryHandle(handle);
        await GitStore.init(handle);
        await this.loadBlocks();
    },

    async changeDirectory() {
        try {
            const newHandle = await window.showDirectoryPicker();
            this.directoryHandle = newHandle;
            await this.saveDirectoryHandle(this.directoryHandle);
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

        // Filter blocks
        const filtered = this.blocks.filter(block => {
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

            // Context filter (multi-select - must have ALL selected tags)
            if (contextSelection.size > 0) {
                const requiredTags = Array.from(contextSelection).filter(t => !['allTodos', 'openTodos', 'blockedTodos', 'unblockedTodos', 'untagged'].includes(t));
                const hasAllTags = requiredTags.every(tag => block.tags?.includes(tag));
                if (!hasAllTags) {
                    return false;
                }
                
                if (contextSelection.has('allTodos')) {
                    if (!block.content?.match(/\[[ xX\/bB\-]\]/)) return false;
                }
                if (contextSelection.has('openTodos')) {
                    if (!block.content?.match(/\[[ \/]\]/)) return false;
                }
                if (contextSelection.has('blockedTodos')) {
                    const tasks = TaskParser.parseTasksFromBlock(block);
                    const hasBlocked = tasks.some(t => t.state === 'b' || t.badges.some(b => b.type === 'dependsOn'));
                    if (!hasBlocked) return false;
                }
                if (contextSelection.has('unblockedTodos')) {
                    const tasks = TaskParser.parseTasksFromBlock(block);
                    const hasUnblocked = tasks.some(t => (t.state === ' ' || t.state === '/') && !t.badges.some(b => b.type === 'dependsOn'));
                    if (!hasUnblocked) return false;
                }
                if (contextSelection.has('untagged')) {
                    if (block.tags && block.tags.length > 0) return false;
                }
            }

            // Contact filter
            if (contactSelection) {
                const searchContactLower = contactSelection.toLowerCase();
                
                // Check if mentioned
                const mentionRegex = new RegExp(`(?:^|\\s)@${searchContactLower}(?!\\S)`, 'i');
                const hasMention = mentionRegex.test(block.content || '');
                
                // Check if assigned
                const assigneeRegex = new RegExp(`\\[assignee::\\s*@?${searchContactLower}\\]`, 'i');
                const hasAssignment = assigneeRegex.test(block.content || '');
                
                if (!hasMention && !hasAssignment) {
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

        // Cache the result
        this._filteredBlocksCache.set(filtered);
        return filtered;
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
