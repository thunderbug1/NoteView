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

    /**
     * Initialize the manager
     */
    init() {
        this.sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    },

    /**
     * Execute a command and record it on the undo stack
     * @param {Object} command - Command object with type, blockId, and relevant data
     */
    async executeCommand(command) {
        // Don't record if we're currently executing an undo/redo
        if (this.isExecuting) {
            console.log('UndoRedoManager: Skipping command recording during undo/redo execution');
            return;
        }

        console.log('UndoRedoManager: Recording command:', command.type, command.blockId);

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

        console.log('UndoRedoManager: Stack size - undo:', this.undoStack.length, 'redo:', this.redoStack.length);

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
        console.log('UndoRedoManager: Undo called, stack size:', this.undoStack.length);
        if (this.undoStack.length === 0) {
            console.log('UndoRedoManager: Nothing to undo');
            return;
        }

        const command = this.undoStack.pop();
        console.log('UndoRedoManager: Undoing command:', command.type, command.blockId);
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
            }

            // Push to redo stack
            this.redoStack.push(command);

            // Persist and update UI
            await this.saveState();
            this.updateUI();
            App.render();
        } finally {
            this.isExecuting = false;
        }
    },

    /**
     * Redo the last undone command
     */
    async redo() {
        console.log('UndoRedoManager: Redo called, stack size:', this.redoStack.length);
        if (this.redoStack.length === 0) {
            console.log('UndoRedoManager: Nothing to redo');
            return;
        }

        const command = this.redoStack.pop();
        console.log('UndoRedoManager: Redoing command:', command.type, command.blockId);
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
            }

            // Push back to undo stack
            this.undoStack.push(command);

            // Persist and update UI
            await this.saveState();
            this.updateUI();
            App.render();
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
            // Remove from Store.blocks
            const index = Store.blocks.findIndex(b => b.id === command.blockId);
            Store.blocks.splice(index, 1);

            // Delete file
            const fileName = block.filename || `${block.id}.md`;
            try {
                await Store.directoryHandle.removeEntry(fileName);
            } catch (e) {
                console.error('Failed to delete file during undo:', e);
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
        const block = command.blockData;
        if (block) {
            // Create file
            await Store.saveBlock(block, { commit: false });

            // Add to Store.blocks if not already there
            if (!Store.blocks.find(b => b.id === block.id)) {
                Store.blocks.push(block);
            }

            // Update contacts and cache
            Store.extractContacts();
            Store._filteredBlocksCache.invalidate();
            SelectionManager.updateTagCounts();
        }
    },

    /**
     * Undo an update command - reverts to before state
     */
    async undoUpdate(command) {
        const block = Store.blocks.find(b => b.id === command.blockId);
        if (block && command.before) {
            // Revert to before state
            Object.assign(block, command.before);
            block.lastUpdated = new Date().toISOString();

            // Save to disk
            await Store.saveBlock(block, { commit: false });

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
            block.lastUpdated = new Date().toISOString();

            // Save to disk
            await Store.saveBlock(block, { commit: false });

            // Update cache
            Store.extractContacts();
            Store._filteredBlocksCache.invalidate();
        }
    },

    /**
     * Undo a delete command - restores the block
     */
    async undoDelete(command) {
        const block = command.blockData;
        if (block) {
            // Create file
            await Store.saveBlock(block, { commit: false });

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
            // Remove from Store.blocks
            const index = Store.blocks.findIndex(b => b.id === command.blockId);
            Store.blocks.splice(index, 1);

            // Delete file
            const fileName = block.filename || `${block.id}.md`;
            try {
                await Store.directoryHandle.removeEntry(fileName);
            } catch (e) {
                console.error('Failed to delete file during redo delete:', e);
            }

            // Update contacts and cache
            Store.extractContacts();
            Store._filteredBlocksCache.invalidate();
            SelectionManager.updateTagCounts();
        }
    },

    /**
     * Create a diff between two block states (for update commands)
     * Only stores fields that actually changed
     */
    createDiff(before, after) {
        const diff = { before: {}, after: {} };
        const fields = ['content', 'tags', 'creationDate', 'lastUpdated'];

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
        console.log('UndoRedoManager: Loading state...');
        try {
            const state = await Store.getUndoRedoState();
            console.log('UndoRedoManager: State loaded:', state);
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
        console.log('UndoRedoManager: Load complete');
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
