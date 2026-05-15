/**
 * Undo/Redo Manager - Command Pattern implementation for NoteView
 * Tracks and manages undo/redo operations for note mutations
 */

const UndoRedoManager = {
    // Stacks for undo/redo commands
    undoStack: [],
    redoStack: [],

    // Maximum number of commands to keep in memory
    MAX_STACK_SIZE: 100,

    // Flag to prevent recursive recording during undo/redo execution
    isExecuting: false,

    // Unique session ID for this browser session
    sessionId: null,

    // Promise-based lock to serialize undo/redo operations
    _operationLock: null,

    /**
     * Initialize the manager
     */
    init() {
        const stored = sessionStorage.getItem('undoRedoSessionId');
        if (stored) {
            this.sessionId = stored;
        } else {
            this.sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
            sessionStorage.setItem('undoRedoSessionId', this.sessionId);
        }
    },

    /**
     * Execute a command and record it on the undo stack
     * @param {Object} command - Command object with type, blockId, and relevant data
     */
    async executeCommand(command) {
        // Don't record if we're currently executing an undo/redo
        if (this.isExecuting) {
            return;
        }

        // Add timestamp if not present
        if (!command.timestamp) {
            command.timestamp = new Date().toISOString();
        }

        // Push to undo stack
        this.undoStack.push(command);

        // Clear redo stack (new action invalidates redo history)
        this.redoStack = [];

        // Trim stack if needed
        if (this.undoStack.length > this.MAX_STACK_SIZE) {
            this.undoStack.shift();
        }

        // Persist to IndexedDB
        try {
            await this.saveState();
        } catch (e) {
            console.warn('UndoRedoManager: Failed to save state:', e);
        }

        // Update UI button states
        this.updateUI();
    },

    /**
     * Undo the last command
     */
    async undo() {
        // Serialize concurrent undo/redo calls via promise chain
        const prev = this._operationLock || Promise.resolve();
        let resolveOp = () => {};
        this._operationLock = prev.then(() => new Promise(r => { resolveOp = r; }));
        try {
            await prev;
        } catch { /* previous op failed, proceed */ }

        try {
            await this._doUndo();
        } finally {
            resolveOp();
        }
    },

    async _doUndo() {
        if (this.undoStack.length === 0) {
            return;
        }

        const command = this.undoStack.pop();
        this.isExecuting = true;

        try {
            switch (command.type) {
                case 'create':
                    await this.undoCreate(command);
                    break;
                case 'update':
                    await this.undoUpdate(command);
                    break;
                case 'delete':
                    await this.undoDelete(command);
                    break;
                case 'batch':
                    await this.undoBatch(command);
                    break;
            }

            // Push to redo stack
            this.redoStack.push(command);

            // Persist and update UI
            await this.saveState();
            this.updateUI();
            App.render();
        } catch (e) {
            // Undo failed — push command back onto undo stack so it's not lost
            this.undoStack.push(command);
            await this.saveState();
            console.error('UndoRedoManager: Undo failed, command restored to undo stack:', e);
        } finally {
            this.isExecuting = false;
        }
    },

    /**
     * Redo the last undone command
     */
    async redo() {
        // Serialize concurrent undo/redo calls via promise chain
        const prev = this._operationLock || Promise.resolve();
        let resolveOp = () => {};
        this._operationLock = prev.then(() => new Promise(r => { resolveOp = r; }));
        try {
            await prev;
        } catch { /* previous op failed, proceed */ }

        try {
            await this._doRedo();
        } finally {
            resolveOp();
        }
    },

    async _doRedo() {
        if (this.redoStack.length === 0) {
            return;
        }

        const command = this.redoStack.pop();
        this.isExecuting = true;

        try {
            switch (command.type) {
                case 'create':
                    await this.redoCreate(command);
                    break;
                case 'update':
                    await this.redoUpdate(command);
                    break;
                case 'delete':
                    await this.redoDelete(command);
                    break;
                case 'batch':
                    await this.redoBatch(command);
                    break;
            }

            // Push back to undo stack
            this.undoStack.push(command);

            // Persist and update UI
            await this.saveState();
            this.updateUI();
            App.render();
        } catch (e) {
            // Redo failed — push command back onto redo stack so it's not lost
            this.redoStack.push(command);
            await this.saveState();
            console.error('UndoRedoManager: Redo failed, command restored to redo stack:', e);
        } finally {
            this.isExecuting = false;
        }
    },

    /**
     * Check if undo is available
     */
    canUndo() {
        return this.undoStack.length > 0;
    },

    /**
     * Check if redo is available
     */
    canRedo() {
        return this.redoStack.length > 0;
    },

    /**
     * Clear both stacks (call on directory change)
     */
    async clear() {
        this.undoStack = [];
        this.redoStack = [];
        try {
            await this.saveState();
        } catch (e) {
            // Ignore errors during DB upgrade
            console.warn('Could not save undo/redo state during clear:', e);
        }
        this.updateUI();
    },

    /**
     * Undo a create command - removes the block
     */
    async undoCreate(command) {
        const block = Store.blocks.find(b => b.id === command.blockId);
        if (block) {
            // Delete file first
            const fileName = block.filename || `${block.id}.md`;
            try {
                await Store.directoryHandle.removeEntry(fileName);
            } catch (e) {
                console.error('Failed to delete file during undo:', e);
                throw e;
            }

            // Remove from memory only after successful file deletion
            const index = Store.blocks.findIndex(b => b.id === command.blockId);
            Store.blocks.splice(index, 1);
            try {
                await GitStore.commitBlock(fileName, `Undo: remove ${fileName}`);
            } catch (e) {
                console.error('Failed to commit after delete during undo:', e);
            }

            // Update contacts and cache
            Store.extractContacts();
            Store._filteredBlocksCache.invalidate();
            SelectionManager.updateTagCounts();
        }
    },

    /**
     * Redo a create command - recreates the block
     */
    async redoCreate(command) {
        const block = JSON.parse(JSON.stringify(command.blockData));
        if (Store.blocks.find(b => b.id === block.id)) {
            console.warn('redoCreate: block already exists, skipping');
            return;
        }
        // Create file
        await Store.saveBlock(block, { commit: true, commitMessage: `Redo: recreate ${block.id}` });

        // Add to Store.blocks if not already there
        if (!Store.blocks.find(b => b.id === block.id)) {
            Store.blocks.push(block);
        }

        // Update contacts and cache
        Store.extractContacts();
        Store._filteredBlocksCache.invalidate();
        SelectionManager.updateTagCounts();
    },

    /**
     * Undo an update command - reverts to before state
     */
    async undoUpdate(command) {
        const block = Store.blocks.find(b => b.id === command.blockId);
        if (block && command.before) {
            // Revert only the fields that changed
            Object.assign(block, command.before);

            // Save to disk
            await Store.saveBlock(block, { commit: true, commitMessage: `Undo: revert ${block.id}` });

            // Update cache
            Store.extractContacts();
            Store._filteredBlocksCache.invalidate();
        }
    },

    /**
     * Redo an update command - applies the after state
     */
    async redoUpdate(command) {
        const block = Store.blocks.find(b => b.id === command.blockId);
        if (block && command.after) {
            // Apply after state
            Object.assign(block, command.after);

            // Save to disk
            await Store.saveBlock(block, { commit: true, commitMessage: `Redo: re-apply ${block.id}` });

            // Update cache
            Store.extractContacts();
            Store._filteredBlocksCache.invalidate();
        }
    },

    /**
     * Undo a delete command - restores the block
     */
    async undoDelete(command) {
        const block = JSON.parse(JSON.stringify(command.blockData));
        if (block) {
            // Create file
            await Store.saveBlock(block, { commit: true, commitMessage: `Undo: restore ${block.id}` });

            // Add back to Store.blocks at the correct position (sorted by id)
            const insertIndex = Store.blocks.findIndex(b => b.id > block.id);
            if (insertIndex === -1) {
                Store.blocks.push(block);
            } else {
                Store.blocks.splice(insertIndex, 0, block);
            }

            // Update contacts and cache
            Store.extractContacts();
            Store._filteredBlocksCache.invalidate();
            SelectionManager.updateTagCounts();
        }
    },

    /**
     * Redo a delete command - removes the block again
     */
    async redoDelete(command) {
        const block = Store.blocks.find(b => b.id === command.blockId);
        if (block) {
            const fileName = block.filename || `${block.id}.md`;

            // Delete file FIRST
            try {
                await Store.directoryHandle.removeEntry(fileName);
            } catch (e) {
                console.error('Failed to delete file during redo delete:', e);
                throw e;
            }

            // THEN remove from memory
            const index = Store.blocks.findIndex(b => b.id === command.blockId);
            Store.blocks.splice(index, 1);

            try {
                await GitStore.commitBlock(fileName, `Redo: remove ${fileName}`);
            } catch (e) {
                console.error('Failed to commit after delete during redo:', e);
            }

            // Update contacts and cache
            Store.extractContacts();
            Store._filteredBlocksCache.invalidate();
            SelectionManager.updateTagCounts();
        }
    },

    /**
     * Undo a batch of commands
     */
    async undoBatch(command) {
        for (let i = command.commands.length - 1; i >= 0; i--) {
            const sub = command.commands[i];
            // Normalize batch sub-commands to expected format
            const normalized = { ...sub };
            if (sub.type === 'create' && sub.after && !sub.blockData) {
                normalized.blockData = sub.after;
                normalized.blockId = sub.after.id;
            } else if (sub.type === 'delete' && sub.before && !sub.blockData) {
                normalized.blockData = sub.before;
                normalized.blockId = sub.before.id;
            } else if (sub.type === 'update') {
                normalized.blockId = sub.blockId || sub.before?.id || sub.after?.id;
            }
            switch (sub.type) {
                case 'create': await this.undoCreate(normalized); break;
                case 'update': await this.undoUpdate(normalized); break;
                case 'delete': await this.undoDelete(normalized); break;
            }
        }
    },

    /**
     * Redo a batch of commands
     */
    async redoBatch(command) {
        for (let i = 0; i < command.commands.length; i++) {
            const sub = command.commands[i];
            const normalized = { ...sub };
            if (sub.type === 'create' && sub.after && !sub.blockData) {
                normalized.blockData = sub.after;
                normalized.blockId = sub.after.id;
            } else if (sub.type === 'delete' && sub.before && !sub.blockData) {
                normalized.blockData = sub.before;
                normalized.blockId = sub.before.id;
            } else if (sub.type === 'update') {
                normalized.blockId = sub.blockId || sub.before?.id || sub.after?.id;
            }
            switch (sub.type) {
                case 'create': await this.redoCreate(normalized); break;
                case 'update': await this.redoUpdate(normalized); break;
                case 'delete': await this.redoDelete(normalized); break;
            }
        }
    },
    /**
     * Create a diff between two block states (for update commands)
     * Only stores fields that actually changed
     */
    createDiff(before, after) {
        const diff = { before: {}, after: {} };
        const fields = ['content', 'tags', 'creationDate', 'lastUpdated', 'pinned'];

        for (const field of fields) {
            const beforeValue = before[field];
            const afterValue = after[field];

            // Compare values (deep compare for arrays)
            if (Array.isArray(beforeValue) && Array.isArray(afterValue)) {
                if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
                    diff.before[field] = [...beforeValue];
                    diff.after[field] = [...afterValue];
                }
            } else if (beforeValue !== afterValue) {
                diff.before[field] = beforeValue;
                diff.after[field] = afterValue;
            }
        }

        return diff;
    },

    /**
     * Save state to IndexedDB
     */
    async saveState() {
        try {
            const state = {
                undoStack: this.undoStack,
                redoStack: this.redoStack,
                sessionId: this.sessionId,
                timestamp: new Date().toISOString()
            };
            await Store.saveUndoRedoState(state).catch(e => {
                console.warn('UndoRedoManager: Failed to save state (non-fatal):', e);
            });
        } catch (e) {
            console.warn('UndoRedoManager: Exception in saveState:', e);
        }
    },

    /**
     * Load state from IndexedDB
     */
    async loadState() {
        try {
            const state = await Store.getUndoRedoState(this.sessionId);
            // State might be null if object store doesn't exist yet (DB upgrade)
            if (state && state.sessionId === this.sessionId) {
                this.undoStack = state.undoStack || [];
                this.redoStack = state.redoStack || [];
            } else {
                // Different session, no state, or first time - start fresh
                this.undoStack = [];
                this.redoStack = [];
            }
        } catch (e) {
            console.error('Failed to load undo/redo state:', e);
            // Start fresh on error
            this.undoStack = [];
            this.redoStack = [];
        }
        this.updateUI();
    },

    /**
     * Update UI button states
     */
    updateUI() {
        if (typeof App !== 'undefined' && App.updateUndoRedoUI) {
            App.updateUndoRedoUI();
        }
    },

    /**
     * Get description of the next undo command for UI
     */
    getUndoDescription() {
        if (this.undoStack.length === 0) return '';
        const command = this.undoStack[this.undoStack.length - 1];
        return this.getCommandDescription(command);
    },

    /**
     * Get description of the next redo command for UI
     */
    getRedoDescription() {
        if (this.redoStack.length === 0) return '';
        const command = this.redoStack[this.redoStack.length - 1];
        return this.getCommandDescription(command);
    },

    /**
     * Get human-readable description of a command
     */
    getCommandDescription(command) {
        if (command.type === 'batch') {
            return command.description || 'Batch operation';
        }

        const block = Store.blocks.find(b => b.id === command.blockId);
        const blockTitle = block && block.content
            ? block.content.split('\n')[0].substring(0, 30)
            : command.blockId;

        switch (command.type) {
            case 'create':
                return `Create "${blockTitle}"`;
            case 'update':
                return `Edit "${blockTitle}"`;
            case 'delete':
                return `Delete "${blockTitle}"`;
            default:
                return 'Unknown action';
        }
    }
};

// Initialize on load
UndoRedoManager.init();
