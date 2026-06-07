const DocumentContentManager = {
    async handleSplitNote(view, from, to) {
        // Find the block ID of the current editor
        let editorContainer = view.dom.closest('.codemirror-container');
        if (!editorContainer) return;
        const blockId = editorContainer.dataset.id;
        let originalBlock = Store.blocks.find(b => b.id === blockId);
        if (!originalBlock && blockId !== 'new') return;

        const doc = view.state.doc;
        const selection = view.state.selection.main;
        
        let extractedContent = '';
        let newOriginalContent = '';

        if (!selection.empty && selection.from !== selection.to) {
            // Cut specific selected selection lines
            const startLine = view.state.doc.lineAt(selection.from);
            const endLine = view.state.doc.lineAt(selection.to);
            
            extractedContent = view.state.sliceDoc(startLine.from, endLine.to);
            
            // Reattach surrounding doc, being careful around newlines so we don't leave blank lines
            const before = view.state.sliceDoc(0, startLine.from);
            const after = view.state.sliceDoc(endLine.to);
            
            // Eat the newline if possible
            if (before.endsWith('\n') && after.startsWith('\n')) {
                newOriginalContent = before + after.substring(1);
            } else {
                newOriginalContent = before + after;
            }
            
        } else {
            // Split from the specified clicked line downwards
            newOriginalContent = view.state.sliceDoc(0, from);
            extractedContent = view.state.sliceDoc(from);
        }

        // Clean up text
        newOriginalContent = newOriginalContent.trimEnd() + '\n';
        extractedContent = extractedContent.trim();
        if (!extractedContent) return; // Nothing to split

        // Update the original block first
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: newOriginalContent }
        });
        
        let beforeState = null;
        if (originalBlock && !UndoRedoManager.isExecuting) {
            beforeState = JSON.parse(JSON.stringify(originalBlock));
        }

        if (blockId !== 'new') {
            this.handleContentChange(blockId, newOriginalContent);
            clearTimeout(this.saveTimeouts.get(blockId));
            App.saveBlockContent(blockId, newOriginalContent, { commit: true, skipUndo: true });
            this.originalContents.set(blockId, newOriginalContent);
        } else {
            this.handleContentChange('new', newOriginalContent);
        }

        // Create new block
        const newBlockParams = {
            content: extractedContent,
            skipUndo: true
        };
        // Inherit creationDate if present
        if (originalBlock) {
            newBlockParams.creationDate = originalBlock.creationDate;
        }

        // Let user pick tags before creating the block
        const inheritedTags = originalBlock?.tags ? [...originalBlock.tags] : [];
        const chosenTags = await this._pickTagsBeforeCreate(inheritedTags);
        newBlockParams.tags = chosenTags;

        const newBlock = await Store.createBlock(newBlockParams.content, newBlockParams);
        
        // Add manual undo/redo tracking chunk
        if (beforeState && !UndoRedoManager.isExecuting) {
            const diff = UndoRedoManager.createDiff(beforeState, Store.blocks.find(b => b.id === blockId));
            await UndoRedoManager.executeCommand({
                type: 'batch',
                description: 'Split Note',
                commands: [
                    { type: 'update', blockId: blockId, before: diff.before, after: diff.after },
                    { type: 'create', blockId: newBlock.id, blockData: { ...newBlock } }
                ]
            });
        }
        
        // Save scroll position relative to the block
        let scrollOffset = 0;
        const blockElement = document.querySelector(`.block[data-id="${CSS.escape(blockId)}"]`);
        if (blockElement) {
            scrollOffset = blockElement.getBoundingClientRect().top;
        }
        
        // Save the cursor position where the split happened
        const cursorRestorePos = from;

        // Re-render blocks so the newly generated note spawns in the DOM
        App.render();

        // Restore scroll position and cursor after the browser paints the new DOM
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (blockId !== 'new') {
                    const newBlockElement = document.querySelector(`.block[data-id="${CSS.escape(blockId)}"]`);
                    if (newBlockElement) {
                        const newOffset = newBlockElement.getBoundingClientRect().top;
                        window.scrollBy(0, newOffset - scrollOffset);
                    }

                    // Re-focus original editor and restore the cursor near where it was split
                    const newView = this.editors.get(blockId);
                    if (newView) {
                        newView.focus();
                        const safePos = Math.min(cursorRestorePos, newView.state.doc.length);
                        newView.dispatch({ selection: { anchor: safePos, head: safePos } });
                    }
                }
            });
        });
    },

    _pickTagsBeforeCreate(initialTags) {
        return new Promise((resolve) => {
            const tempId = 'new';
            const existingIdx = Store.blocks.findIndex(b => b.id === tempId);
            const tempBlock = { id: tempId, tags: [...initialTags], content: '' };
            if (existingIdx === -1) {
                Store.blocks.push(tempBlock);
            } else {
                Store.blocks[existingIdx] = tempBlock;
            }
            DocumentView.pendingNewTags = [...initialTags];

            TagModal.show(tempId, {
                onClose: () => {
                    const tags = DocumentView.pendingNewTags || [...initialTags];
                    Store.blocks = Store.blocks.filter(b => b.id !== 'new');
                    DocumentView.pendingNewTags = null;
                    resolve(tags);
                }
            });
        });
    },

    handleContentChange(blockId, content, skipUndo = false) {
        // Skip recording during undo/redo execution
        if (UndoRedoManager.isExecuting) return;

        // Handle new block
        if (blockId === 'new') {
            // Guard: verify the 'new' placeholder exists in the live DOM.
            // After a re-render, stale closures may resolve a detached container's
            // old 'new' data-id, which would spuriously create notes.
            const placeholder = document.querySelector('.block[data-id="new"]');
            if (!placeholder || !placeholder.isConnected) return;

            this.newBlockContent = content;
            if (content.trim()) {
                placeholder.classList.remove('empty');
                // Promote immediately when content is added
                this.promotePlaceholder(content);
            }
        } else {
            // Debounced save for existing blocks
            this.scheduleSave(blockId, content, { skipUndo });
        }
    },

    async promotePlaceholder(initialContent) {
        if (this.isPromoting) return;
        this.isPromoting = true;

        try {
            // Take snapshot of content to save
            const contentToSave = this.newBlockContent || initialContent;

            // 1. Create the block in the store, applying any pending tags
            const extraMeta = {};
            if (this.pendingNewTags && this.pendingNewTags.length > 0) {
                extraMeta.tags = this.pendingNewTags;
            }
            const newBlock = await Store.createBlock(contentToSave, extraMeta);
            this.pendingNewTags = null;

            // 2. Update DOM of the currently active placeholder
            const currentBlock = document.querySelector('.block[data-id="new"]');
            if (currentBlock) {
                currentBlock.dataset.id = newBlock.id;
                currentBlock.classList.remove('empty');
                
                const editorContainer = currentBlock.querySelector('.codemirror-container');
                if (editorContainer) {
                    editorContainer.dataset.id = newBlock.id;
                }

                // Inject save indicator if missing
                let saveIndicator = currentBlock.querySelector('.save-indicator');
                if (!saveIndicator) {
                    saveIndicator = document.createElement('span');
                    saveIndicator.className = 'save-indicator saved';
                    saveIndicator.dataset.id = newBlock.id;
                    saveIndicator.textContent = 'saved';
                    const editorDiv = currentBlock.querySelector('.block-editor');
                    if (editorDiv) {
                        editorDiv.appendChild(saveIndicator);
                    }
                } else {
                    saveIndicator.dataset.id = newBlock.id;
                }

                // Render metadata
                const metadataHtml = this.renderBlockMetadata(newBlock);
                if (metadataHtml) {
                    currentBlock.insertAdjacentHTML('afterbegin', metadataHtml);
                }

                // Update editors map
                const editor = this.editors.get('new');
                if (editor) {
                    this.editors.delete('new');
                    this.editors.set(newBlock.id, editor);
                }
                // Update original contents map
                const originalContent = this.originalContents.get('new');
                if (originalContent !== undefined) {
                    this.originalContents.delete('new');
                    this.originalContents.set(newBlock.id, originalContent);
                }

                // Update dictation state if recording on the new block
                if (this._recordingBlockId === 'new') {
                    this._recordingBlockId = newBlock.id;
                    const micBtn = currentBlock.querySelector('.mic-btn');
                    if (micBtn) micBtn.dataset.id = newBlock.id;
                    const creationMicBtn = currentBlock.querySelector('.creation-btn.mic-action');
                    if (creationMicBtn) creationMicBtn.dataset.id = newBlock.id;
                }
            }

            // Check if more content was typed while we were awaiting createBlock
            if (this.newBlockContent !== contentToSave) {
                this.scheduleSave(newBlock.id, this.newBlockContent);
            }

            // 3. Reset new block content
            this.newBlockContent = '';

            // 4. Inject a new placeholder at the top
            const container = document.getElementById('viewContainer');
            const newPlaceholderHtml = `
                <article class="block empty" data-id="new">
                    <div class="block-tags">
                        ${this.getSelectedContextBadge()}
                    </div>
                    <div class="block-editor">
                        <div class="codemirror-container" data-id="new"></div>
                    </div>
                </article>
            `;
            container.insertAdjacentHTML('afterbegin', newPlaceholderHtml);

            // 5. Initialize editor for the new placeholder
            const newCmContainer = container.querySelector('.block[data-id="new"] .codemirror-container');
            if (newCmContainer) {
                this.createEditor(newCmContainer, 'new', '');
            }

            SelectionManager.updateTagCounts();

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
            console.error('Failed to promote placeholder:', err);
            this.newBlockContent = '';
            this.isPromoting = false;
            return;
        }
        this.isPromoting = false;
    },

    cancelAllPendingSaves() {
        for (const [, timeout] of this.saveTimeouts) {
            clearTimeout(timeout);
        }
        this.saveTimeouts.clear();
    },

    async flushAllPendingSaves() {
        if (!this.saveTimeouts || this.saveTimeouts.size === 0) return;

        const promises = [];
        for (const [blockId, timeout] of this.saveTimeouts) {
            clearTimeout(timeout);
            const editor = this.editors.get(blockId);
            if (editor) {
                const content = editor.state.doc.toString();
                promises.push(App.saveBlockContent(blockId, content, { commit: true }));
            }
        }
        this.saveTimeouts.clear();
        await Promise.allSettled(promises);
    },

    scheduleSave(blockId, content, options = {}) {
        // Skip auto-save if in modal or creation view
        if (this._isInModalOrCreation) return;
        
        const indicator = document.querySelector(`.save-indicator[data-id="${CSS.escape(blockId)}"]`);
        if (indicator) {
            indicator.textContent = 'saving...';
            indicator.classList.add('saving');
            indicator.classList.remove('saved');
        }

        // Clear existing timeout for THIS block
        const existingTimeout = this.saveTimeouts.get(blockId);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
        }

        // Schedule save for THIS block with 10 second debounce
        const timeout = setTimeout(async () => {
            this.saveTimeouts.delete(blockId);
            try {
                await App.saveBlockContent(blockId, content, options);
            } catch (err) {
                const failedIndicator = document.querySelector(`.save-indicator[data-id="${CSS.escape(blockId)}"]`);
                if (failedIndicator) {
                    failedIndicator.textContent = 'Save failed';
                    failedIndicator.classList.remove('saving');
                    failedIndicator.classList.remove('saved');
                }
                Common.showToast('Save failed: ' + (err.message || 'Unknown error'));
                return;
            }

            // Re-query indicator in case re-render replaced it
            const currentIndicator = document.querySelector(`.save-indicator[data-id="${CSS.escape(blockId)}"]`);
            if (currentIndicator) {
                currentIndicator.textContent = 'saved';
                currentIndicator.classList.remove('saving');
                currentIndicator.classList.add('saved');
                // Show undo hint
                if (UndoRedoManager.canUndo()) {
                    currentIndicator.title = 'Press Ctrl+Z to undo';
                }
                // Hide saved indicator after 2 seconds
                setTimeout(() => {
                    if (currentIndicator.textContent === 'saved') {
                        currentIndicator.textContent = '';
                    }
                }, 2000);
            }
        }, 10000);
        
        this.saveTimeouts.set(blockId, timeout);
    },

    async createNewBlock() {
        const content = this.newBlockContent.trim();
        if (!content) return;

        await Store.createBlock(content);
        this.newBlockContent = '';

        // Flush and commit pending saves before destroying editors to prevent stale writes and data loss
        await this.flushAllPendingSaves();
        for (const editor of this.editors.values()) {
            editor.destroy();
        }
        this.editors.clear();

        SelectionManager.updateTagCounts();
        await App.render();

        // Focus the new empty block
        this.focusNewBlock();

        // Scroll to top where the new placeholder is
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const container = document.getElementById('viewContainer');
                if (container) container.scrollTop = 0;
            });
        });
    },
};
