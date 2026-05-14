/**
 * BlockSelector - Multi-select mode for bulk operations
 *
 * Document view: selects entire blocks (notes).
 * Kanban view: selects individual tasks (todos).
 */

const BlockSelector = {
    active: false,
    selectedIds: new Set(),       // block IDs in doc view, task IDs in kanban
    _lastClickedId: null,
    _actionBar: null,
    _clickHandler: null,
    _mouseDownHandler: null,

    init() {
        const btn = document.getElementById('toolbarSelectBtn');
        if (btn) {
            btn.addEventListener('click', () => this.toggle());
        }
    },

    toggle() {
        this.active ? this.deactivate() : this.activate();
    },

    activate() {
        if (this.active) return;
        this.active = true;
        this.selectedIds.clear();
        this._lastClickedId = null;

        const vc = document.getElementById('viewContainer');
        if (vc) vc.classList.add('select-mode-active');

        const btn = document.getElementById('toolbarSelectBtn');
        if (btn) btn.classList.add('active');

        document.querySelectorAll('.kanban-card').forEach(c => c.setAttribute('draggable', 'false'));

        this._clickHandler = (e) => this._handleClick(e);
        vc.addEventListener('click', this._clickHandler, true);

        // Block mousedown on blocks to prevent editor focus in select mode
        this._mouseDownHandler = (e) => {
            const article = e.target.closest('article.block[data-id]');
            if (article && article.dataset.id !== 'new') {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        vc.addEventListener('mousedown', this._mouseDownHandler, true);

        this._showActionBar();
    },

    deactivate() {
        if (!this.active) return;
        this.active = false;
        this.selectedIds.clear();
        this._lastClickedId = null;

        const vc = document.getElementById('viewContainer');
        if (vc) vc.classList.remove('select-mode-active');

        const btn = document.getElementById('toolbarSelectBtn');
        if (btn) btn.classList.remove('active');

        document.querySelectorAll('.block-selected').forEach(el => el.classList.remove('block-selected'));

        if (Store.currentView === 'kanban') {
            document.querySelectorAll('.kanban-card').forEach(c => {
                if (window.innerWidth > 768) c.setAttribute('draggable', 'true');
            });
        }

        if (this._clickHandler) {
            vc.removeEventListener('click', this._clickHandler, true);
            this._clickHandler = null;
        }

        if (this._mouseDownHandler) {
            vc.removeEventListener('mousedown', this._mouseDownHandler, true);
            this._mouseDownHandler = null;
        }

        this._hideActionBar();
    },

    _isKanban() {
        return Store.currentView === 'kanban';
    },

    _handleClick(e) {
        // In document view select mode: capture ALL clicks on blocks — no editing, no todo toggling
        // In kanban view: capture clicks on cards

        const article = e.target.closest('article.block[data-id]');
        const kanbanCard = e.target.closest('.kanban-card');

        let id = null;
        let selector = null;

        if (article && article.dataset.id !== 'new') {
            id = article.dataset.id;
            selector = `article.block[data-id="${id}"]`;
        } else if (kanbanCard && kanbanCard.dataset.id) {
            // Kanban: select per-task using data-id (task ID)
            id = kanbanCard.dataset.id;
            selector = `.kanban-card[data-id="${id}"]`;
        }

        if (!id) return;

        e.stopPropagation();
        e.preventDefault();

        const isDocView = !this._isKanban();

        if (e.shiftKey && isDocView && this._lastClickedId) {
            this._handleRangeSelect(id);
        } else {
            this._toggleSelection(id, selector);
        }

        this._lastClickedId = id;
        this._showActionBar();
    },

    _toggleSelection(id, selector) {
        if (this.selectedIds.has(id)) {
            this.selectedIds.delete(id);
        } else {
            this.selectedIds.add(id);
        }
        this._applySelectionClass(id, selector);
    },

    _applySelectionClass(id, selector) {
        if (!selector) {
            // Auto-detect: try both
            document.querySelectorAll(`article.block[data-id="${id}"]`).forEach(el => {
                el.classList.toggle('block-selected', this.selectedIds.has(id));
            });
            document.querySelectorAll(`.kanban-card[data-id="${id}"]`).forEach(el => {
                el.classList.toggle('block-selected', this.selectedIds.has(id));
            });
            return;
        }
        document.querySelectorAll(selector).forEach(el => {
            el.classList.toggle('block-selected', this.selectedIds.has(id));
        });
    },

    _handleRangeSelect(clickedId) {
        const container = document.getElementById('viewContainer');
        const allBlocks = container.querySelectorAll('article.block[data-id]:not([data-id="new"])');
        const ids = Array.from(allBlocks).map(el => el.dataset.id);

        const startIdx = ids.indexOf(this._lastClickedId);
        const endIdx = ids.indexOf(clickedId);

        if (startIdx === -1 || endIdx === -1) {
            this._toggleSelection(clickedId);
            return;
        }

        const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        for (let i = lo; i <= hi; i++) {
            this.selectedIds.add(ids[i]);
            this._applySelectionClass(ids[i]);
        }
    },

    refreshSelectionUI() {
        if (!this.active) return;

        document.querySelectorAll('.kanban-card').forEach(c => c.setAttribute('draggable', 'false'));

        const vc = document.getElementById('viewContainer');
        if (vc && this._clickHandler) {
            vc.removeEventListener('click', this._clickHandler, true);
            vc.addEventListener('click', this._clickHandler, true);
            vc.classList.add('select-mode-active');
        }
        if (vc && this._mouseDownHandler) {
            vc.removeEventListener('mousedown', this._mouseDownHandler, true);
            vc.addEventListener('mousedown', this._mouseDownHandler, true);
        }

        if (this._isKanban()) {
            // Prune task IDs that no longer exist in DOM
            const currentIds = new Set();
            vc.querySelectorAll('.kanban-card[data-id]').forEach(c => currentIds.add(c.dataset.id));
            for (const id of this.selectedIds) {
                if (!currentIds.has(id)) this.selectedIds.delete(id);
            }
        } else {
            const validIds = new Set(Store.blocks.map(b => b.id));
            for (const id of this.selectedIds) {
                if (!validIds.has(id)) this.selectedIds.delete(id);
            }
        }

        this.selectedIds.forEach(id => this._applySelectionClass(id));
        this._showActionBar();
    },

    isSelected(id) {
        return this.selectedIds.has(id);
    },

    getSelectedIds() {
        return Array.from(this.selectedIds);
    },

    // --- Select All / Deselect All ---

    selectAll() {
        const vc = document.getElementById('viewContainer');
        if (this._isKanban()) {
            vc.querySelectorAll('.kanban-card[data-id]').forEach(el => {
                this.selectedIds.add(el.dataset.id);
                this._applySelectionClass(el.dataset.id);
            });
        } else {
            vc.querySelectorAll('article.block[data-id]:not([data-id="new"])').forEach(el => {
                this.selectedIds.add(el.dataset.id);
                this._applySelectionClass(el.dataset.id);
            });
        }
        this._showActionBar();
    },

    deselectAll() {
        for (const id of this.selectedIds) {
            this._applySelectionClass(id);
        }
        this.selectedIds.clear();
        this._lastClickedId = null;
        this._showActionBar();
    },

    // --- Collapse All / Expand All (document view) ---

    collapseAll() {
        if (typeof DocumentView === 'undefined') return;
        const vc = document.getElementById('viewContainer');
        vc.querySelectorAll('article.block[data-id]:not([data-id="new"])').forEach(el => {
            DocumentView.collapseBlock(el.dataset.id);
        });
    },

    expandAll() {
        if (typeof DocumentView === 'undefined') return;
        const vc = document.getElementById('viewContainer');
        vc.querySelectorAll('article.block[data-id]:not([data-id="new"])').forEach(el => {
            DocumentView.expandBlock(el.dataset.id);
        });
    },

    // --- Action Bar ---

    _showActionBar() {
        let bar = this._actionBar;
        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'select-action-bar';
            document.body.appendChild(bar);
            this._actionBar = bar;
        }

        const count = this.selectedIds.size;
        const hasSelection = count > 0;
        const aiDisabled = !window.AIAssistant || !AIAssistant.isConfigured();
        const isDocView = !this._isKanban();

        bar.innerHTML = `
            <span class="select-count">${hasSelection ? count + ' selected' : 'Select items'}</span>
            <button class="select-action-btn select-action-secondary" data-action="selectall" title="Select all"><span>All</span></button>
            <button class="select-action-btn select-action-secondary" data-action="deselectall" title="Deselect all"><span>None</span></button>
            ${isDocView ? `
            <span class="select-action-divider"></span>
            <button class="select-action-btn select-action-secondary" data-action="collapseall" title="Collapse all notes">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/></svg>
            </button>
            <button class="select-action-btn select-action-secondary" data-action="expandall" title="Expand all notes">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="14 10 20 10 20 4"/></svg>
            </button>
            ` : ''}
            <span class="select-action-divider"></span>
            <button class="select-action-btn select-action-delete${hasSelection ? '' : ' select-action-disabled'}" data-action="delete" ${hasSelection ? '' : 'disabled'}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                <span>Delete</span>
            </button>
            ${isDocView ? `
            <button class="select-action-btn select-action-tags${hasSelection ? '' : ' select-action-disabled'}" data-action="tags" ${hasSelection ? '' : 'disabled'}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>
                <span>Tags</span>
            </button>
            ` : ''}
            <button class="select-action-btn select-action-ai${aiDisabled || !hasSelection ? ' select-action-disabled' : ''}" data-action="ai" ${aiDisabled || !hasSelection ? 'disabled' : ''}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>
                <span>AI</span>
            </button>
            <button class="select-action-btn select-action-secondary${hasSelection ? '' : ' select-action-disabled'}" data-action="sendtovault" ${hasSelection ? '' : 'disabled'}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="19" x2="12" y2="11"></line><polyline points="8 15 12 11 16 15"></polyline></svg>
                <span>Send</span>
            </button>
            <button class="select-action-btn select-action-done" data-action="done"><span>Done</span></button>
        `;

        bar.querySelectorAll('.select-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                switch (btn.dataset.action) {
                    case 'selectall': this.selectAll(); break;
                    case 'deselectall': this.deselectAll(); break;
                    case 'collapseall': this.collapseAll(); break;
                    case 'expandall': this.expandAll(); break;
                    case 'delete': this.bulkDelete(); break;
                    case 'tags': this.bulkAddTags(); break;
                    case 'ai': this.bulkSendToAI(); break;
                    case 'sendtovault': this.bulkSendToVault(); break;
                    case 'done': this.deactivate(); break;
                }
            });
        });
    },

    _hideActionBar() {
        if (this._actionBar) {
            this._actionBar.remove();
            this._actionBar = null;
        }
    },

    // --- Helpers for kanban task resolution ---

    _getTaskById(taskId) {
        const card = document.querySelector(`.kanban-card[data-id="${taskId}"]`);
        if (!card) return null;
        const block = Store.blocks.find(b => b.id === card.dataset.blockId);
        if (!block) return null;
        const tasks = KanbanView.extractTasks([block]);
        return tasks.find(t => t.id === taskId) || null;
    },

    _getTaskCard(taskId) {
        return document.querySelector(`.kanban-card[data-id="${taskId}"]`);
    },

    // --- Bulk Operations ---

    async bulkDelete() {
        const ids = this.getSelectedIds();
        if (ids.length === 0) return;

        if (this._isKanban()) {
            // Kanban: delete selected task lines from their parent blocks
            const confirmed = await Modal.confirm(
                `Delete ${ids.length} task${ids.length > 1 ? 's' : ''}?`,
                'The task lines will be removed from their notes.'
            );
            if (!confirmed) return;

            this._hideActionBar();

            try {
                // Group tasks by block to batch content changes
                const byBlock = new Map();
                for (const taskId of ids) {
                    const task = this._getTaskById(taskId);
                    if (!task) continue;
                    if (!byBlock.has(task.blockId)) byBlock.set(task.blockId, []);
                    byBlock.get(task.blockId).push(task);
                }

                for (const [blockId, tasks] of byBlock) {
                    const block = Store.blocks.find(b => b.id === blockId);
                    if (!block) continue;
                    let content = block.content;
                    // Re-parse tasks from fresh content to get accurate matchIndex values
                    const freshTasks = KanbanView.extractTasks([block]);
                    const taskIds = new Set(tasks.map(t => t.id));
                    const freshMatch = freshTasks.filter(t => taskIds.has(t.id));
                    // Remove tasks in reverse matchIndex order to preserve positions
                    const sorted = freshMatch.sort((a, b) => b.matchIndex - a.matchIndex);
                    for (const task of sorted) {
                        let nextNewline = content.indexOf('\n', task.matchIndex);
                        if (nextNewline === -1) nextNewline = content.length;
                        content = content.substring(0, task.matchIndex) + content.substring(nextNewline + 1);
                    }
                    await App.saveBlockContent(blockId, content, { commit: true, commitMessage: `Delete ${tasks.length} task${tasks.length > 1 ? 's' : ''}` });
                }
            } catch (err) {
                console.error('Bulk delete tasks failed:', err);
                showToast('Failed to delete some tasks');
            }

            this.selectedIds.clear();
            this._lastClickedId = null;
            App.render();
        } else {
            // Document: delete entire blocks
            const confirmed = await Modal.confirm(
                `Delete ${ids.length} note${ids.length > 1 ? 's' : ''}?`,
                'This cannot be undone from select mode.'
            );
            if (!confirmed) return;

            this._hideActionBar();

            try {
                for (const id of ids) {
                    await Store.deleteBlock(id);
                }
            } catch (err) {
                console.error('Bulk delete blocks failed:', err);
                showToast('Failed to delete some notes');
            }

            TimelineView.invalidateCache();
            SelectionManager.updateTagCounts();

            this.selectedIds.clear();
            this._lastClickedId = null;
            App.render();
        }
    },

    bulkAddTags() {
        const ids = this.getSelectedIds();
        if (ids.length === 0 || this._isKanban()) return;

        if (typeof TagModal !== 'undefined' && TagModal.showBulk) {
            TagModal.showBulk(async (addedTags) => {
                for (const id of ids) {
                    const block = Store.blocks.find(b => b.id === id);
                    if (!block) continue;
                    const existing = new Set(block.tags || []);
                    for (const tag of addedTags) existing.add(tag);
                    await App.updateBlockProperty(id, 'tags', Array.from(existing).sort());
                }
                App.render();
            });
        }
    },

    bulkSendToAI() {
        if (!window.AIAssistant || !AIAssistant.isConfigured()) return;

        let contextIds;
        if (this._isKanban()) {
            const blockIds = new Set();
            for (const taskId of this.getSelectedIds()) {
                const card = this._getTaskCard(taskId);
                if (card) blockIds.add(card.dataset.blockId);
            }
            contextIds = [...blockIds];
        } else {
            contextIds = [...this.selectedIds];
        }

        if (contextIds.length === 0) return;

        // Create a fresh chat with the selected notes as context, then open panel
        const chat = AIAssistant.createChat({
            contextBlockIds: contextIds,
            mode: 'transform'
        });

        const firstBlock = Store.blocks.find(b => b.id === contextIds[0]);
        chat.title = contextIds.length === 1 && firstBlock
            ? AIAssistant._extractTitle(firstBlock)
            : `${contextIds.length} notes`;

        AIAssistant.openPanel();
    },

    bulkSendToVault() {
        const ids = [...this.selectedIds];
        if (ids.length === 0) return;
        SendToVault.show(ids, this._actionBar);
    }
};
