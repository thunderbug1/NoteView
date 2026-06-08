const DocumentHtmlRenderer = {
    renderFlatBlocks(blocks) {
        return blocks.map(block => this.renderBlockHtml(block)).join('');
    },

    renderGroupedBlocks(grouped, namespace) {
        let html = '';
        const collapsed = this.collapsedGroups;

        for (const [key, groupBlocks] of grouped.groups) {
            if (groupBlocks.length === 0) continue;
            const isCollapsed = collapsed.get(`${namespace}.${key}`) || false;
            const label = `${Common.capitalizeFirst(namespace)} / ${Common.capitalizeFirst(key)}`;
            html += `<div class="doc-group${isCollapsed ? ' doc-group-collapsed' : ''}" data-group="${escapeHtml(namespace)}" data-group-key="${escapeHtml(key)}">`;
            html += `<div class="doc-group-header">`;
            html += `<button class="doc-group-collapse">${isCollapsed ? '&#9654;' : '&#9660;'}</button>`;
            html += `<h3 class="doc-group-title">${escapeHtml(label)}</h3>`;
            html += `<span class="doc-group-count">${groupBlocks.length} note${groupBlocks.length !== 1 ? 's' : ''}</span>`;
            html += `</div>`;
            html += `<div class="doc-group-blocks">`;
            html += groupBlocks.map(block => this.renderBlockHtml(block)).join('');
            html += `</div></div>`;
        }

        if (grouped.ungrouped.length > 0) {
            const isCollapsed = collapsed.get(`${namespace}.__ungrouped`) || false;
            html += `<div class="doc-group doc-group-ungrouped${isCollapsed ? ' doc-group-collapsed' : ''}">`;
            html += `<div class="doc-group-header">`;
            html += `<button class="doc-group-collapse">${isCollapsed ? '&#9654;' : '&#9660;'}</button>`;
            html += `<h3 class="doc-group-title">Other</h3>`;
            html += `<span class="doc-group-count">${grouped.ungrouped.length} note${grouped.ungrouped.length !== 1 ? 's' : ''}</span>`;
            html += `</div>`;
            html += `<div class="doc-group-blocks">`;
            html += grouped.ungrouped.map(block => this.renderBlockHtml(block)).join('');
            html += `</div></div>`;
        }

        return html;
    },

    renderBlockHtml(block) {
        const pendingDiffs = window.AIAssistant?.getPendingDiffsForBlock(block.id) || [];
        const hasPendingDiff = pendingDiffs.length > 0;
        return `
            <article class="block ${block.pinned ? 'block-pinned' : ''} ${(!block.tags || block.tags.length === 0) ? 'block-untagged' : ''} ${hasPendingDiff ? 'block-has-pending-diff' : ''}" data-id="${escapeHtml(block.id)}">
                ${this.renderCollapseButton(block)}
                <div class="block-split-marker" data-id="${escapeHtml(block.id)}" title="Split note here" role="button" tabindex="0" aria-label="Split note here">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" x2="8.12" y1="4" y2="15.88"/><line x1="14.47" x2="20" y1="14.48" y2="20"/><line x1="8.12" x2="12" y1="8.12" y2="12"/></svg>
                </div>
                ${this.renderBlockMetadata(block)}
                <div class="block-editor ${hasPendingDiff ? 'block-editor-diff-hidden' : ''}">
                    <div class="codemirror-container" data-id="${escapeHtml(block.id)}">${escapeHtml(block.content || '')}</div>
                    <span class="save-indicator" data-id="${escapeHtml(block.id)}">saved</span>
                </div>
                ${hasPendingDiff ? this.renderInlineDiffOverlay(block.id, pendingDiffs) : ''}
            </article>
        `;
    },

    getSelectedContextBadge() {
        const selectedTags = SelectionManager.getTagsForNewNote();
        if (selectedTags.length === 0) return '';

        return selectedTags
            .map(tag => TagModal._renderBadge(tag))
            .join('');
    },

    renderCollapseButton(block) {
        const isCollapsed = this.collapsedBlocks.has(block.id);
        return `<button class="collapse-btn ${isCollapsed ? 'collapsed' : ''}" data-id="${escapeHtml(block.id)}" title="${isCollapsed ? 'Expand note' : 'Collapse note'}" aria-label="${isCollapsed ? 'Expand note' : 'Collapse note'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="${isCollapsed ? '15 18 9 12 15 6' : '6 9 12 15 18 9'}"/></svg>
        </button>`;
    },

    // Render metadata header above block (like Obsidian/Tana)
    renderBlockMetadata(block) {
        const parts = [];

        // Title (from first heading)
        const titleMatch = block.content?.match(/^#\s+(.+)$/m);
        if (titleMatch) {
            parts.push(`<span class="block-title">${Common.escapeHtml(titleMatch[1].trim())}</span>`);
        }

        // Tags
        parts.push(this.renderTagsHtml(block));

        // Dates
        const dateParts = [];
        if (block.creationDate) {
            const created = new Date(block.creationDate);
            dateParts.push(`<span class="meta-date">Created ${Common.formatRelativeDate(created)}</span>`);
        }
        if (block.lastUpdated && block.lastUpdated !== block.creationDate) {
            const updated = new Date(block.lastUpdated);
            dateParts.push(`<span class="meta-date">Updated ${Common.formatRelativeDate(updated)}</span>`);
        }

        if (dateParts.length > 0) {
            parts.push(`
                <div class="block-dates">
                    ${dateParts.join(' · ')}
                </div>
            `);
        }

        // Task toggle button
        const actions = [];

        // Drag handle for wikilink insertion
        actions.push(`
            <button class="drag-handle-btn" data-block-id="${escapeHtml(block.id)}" title="Drag to link to another note" aria-label="Drag to insert wikilink">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>
            </button>
        `);

        actions.push(`
            <button class="task-toggle-btn" data-id="${escapeHtml(block.id)}" title="Toggle task on current line (Alt+T)" aria-label="Toggle task on current line">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
            </button>
        `);

        // Microphone / Speech-to-Text button
        if (this.isSpeechRecognitionSupported()) {
            actions.push(`
                <button class="mic-btn" data-id="${escapeHtml(block.id)}" title="Dictate text" aria-label="Dictate text">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                </button>
            `);
        }

        // AI Assistant button (always shown, disabled when AI is off)
        if (window.AIAssistant) {
            const disabled = !AIAssistant.enabled;
            actions.push(`
                <button class="ai-btn${disabled ? ' ai-btn-disabled' : ''}" data-id="${escapeHtml(block.id)}" title="${disabled ? 'Enable AI in Settings to use' : 'AI Assistant (Ctrl+Shift+A)'}" aria-label="AI Assistant">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>
                </button>
            `);
        }

        // Clone Context button (create new note with same context/tags)
        actions.push(`
            <button class="clone-context-btn" data-id="${escapeHtml(block.id)}" title="Create new note with same context (tags)" aria-label="Clone Context">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path><path d="M12 15h6M15 12v6"></path></svg>
            </button>
        `);

        // 3-dot overflow menu (pin, copy, delete)
        actions.push(`
            <button class="block-menu-btn" data-id="${escapeHtml(block.id)}" title="More actions" aria-label="More actions">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
            </button>
        `);

        parts.push(`<div class="block-actions">${actions.join('')}</div>`);

        if (parts.length > 0) {
            return `<div class="block-metadata">${parts.join('')}</div>`;
        }
        return '';
    },

    renderTagsHtml(block) {
        const tags = block.tags || [];
        const selectedContexts = SelectionManager.selections?.context || new Set();
        const sortedTags = [...tags].sort((a, b) => {
            const aSelected = selectedContexts.has(a);
            const bSelected = selectedContexts.has(b);
            if (aSelected && !bSelected) return -1;
            if (!aSelected && bSelected) return 1;
            return a.localeCompare(b);
        });

        const untaggedBadge = tags.length === 0
            ? '<span class="badge badge-untagged">untagged</span>'
            : '';

        return `
            <div class="block-tags">
                ${sortedTags.map(tag => TagModal._renderBadge(tag)).join('')}
                ${untaggedBadge}
                <button class="add-tag-btn" data-id="${escapeHtml(block.id)}" title="Edit tags" aria-label="Edit tags"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>
            </div>
        `;
    },

    updateBlockTags(blockId) {
        const article = document.querySelector(`article.block[data-id="${CSS.escape(blockId)}"]`);
        if (!article) return false;

        const block = Store.blocks.find(b => b.id === blockId);
        if (!block) return false;

        article.classList.toggle('block-untagged', !block.tags || block.tags.length === 0);

        const tagsDiv = article.querySelector('.block-tags');
        if (!tagsDiv) return false;

        const temp = document.createElement('div');
        temp.innerHTML = this.renderTagsHtml(block);
        tagsDiv.replaceWith(temp.firstElementChild);
        return true;
    },

    updateBlockMetadata(blockId) {
        const article = document.querySelector(`article.block[data-id="${CSS.escape(blockId)}"]`);
        if (!article) return false;

        const block = Store.blocks.find(b => b.id === blockId);
        if (!block) return false;

        const metadataDiv = article.querySelector('.block-metadata');
        if (!metadataDiv) return false;

        const temp = document.createElement('div');
        temp.innerHTML = this.renderBlockMetadata(block);
        const newMetadata = temp.firstElementChild;
        if (!newMetadata) return false;

        metadataDiv.replaceWith(newMetadata);

        // Re-attach per-button listeners on the new metadata
        newMetadata.querySelectorAll('.history-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                if (id && id !== 'new') HistoryView.openHistory(id);
            });
        });
        // Task-toggle-btn clicks handled by container-level delegation in render()
        newMetadata.querySelectorAll('.block-menu-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showBlockMenu(btn);
            });
        });

        return true;
    },

    collapseBlock(blockId) {
        this.collapsedBlocks.set(blockId, true);
        this._autoCollapseOnBlur.delete(blockId);
        const blockEl = document.querySelector(`.block[data-id="${CSS.escape(blockId)}"]`);
        if (!blockEl) return;

        const editorDiv = blockEl.querySelector('.block-editor');
        if (editorDiv) editorDiv.style.display = 'none';

        // Update button visual
        const collapseBtn = blockEl.querySelector('.collapse-btn');
        if (collapseBtn) {
            collapseBtn.classList.add('collapsed');
            collapseBtn.title = 'Expand note';
            const svg = collapseBtn.querySelector('polyline');
            if (svg) svg.setAttribute('points', '15 18 9 12 15 6');
        }

        blockEl.classList.add('block-collapsed');
    },

    expandBlock(blockId) {
        this.collapsedBlocks.delete(blockId);
        const blockEl = document.querySelector(`.block[data-id="${CSS.escape(blockId)}"]`);
        if (!blockEl) return;

        const editorDiv = blockEl.querySelector('.block-editor');
        if (editorDiv) editorDiv.style.display = '';

        // Update button visual
        const collapseBtn = blockEl.querySelector('.collapse-btn');
        if (collapseBtn) {
            collapseBtn.classList.remove('collapsed');
            collapseBtn.title = 'Collapse note';
            const svg = collapseBtn.querySelector('polyline');
            if (svg) svg.setAttribute('points', '6 9 12 15 18 9');
        }

        blockEl.classList.remove('block-collapsed');
    },

    restoreCollapsedState(blocks) {
        for (const block of blocks) {
            if (this.collapsedBlocks.has(block.id)) {
                const blockEl = document.querySelector(`.block[data-id="${CSS.escape(block.id)}"]`);
                if (!blockEl) continue;
                const editorDiv = blockEl.querySelector('.block-editor');
                if (editorDiv) editorDiv.style.display = 'none';
                blockEl.classList.add('block-collapsed');
            }
        }
    },

    handleCollapseClick(e) {
        // Check for collapse button click
        const collapseBtn = e.target.closest('.collapse-btn');
        if (collapseBtn) {
            if (collapseBtn.closest('.content-modal, .tag-modal')) return;
            e.preventDefault();
            e.stopPropagation();
            const blockId = collapseBtn.dataset.id;
            if (blockId && blockId !== 'new') {
                if (this.collapsedBlocks.has(blockId)) {
                    this.expandBlock(blockId);
                } else {
                    this.collapseBlock(blockId);
                }
            }
            return;
        }

        // Click on collapsed block body — expand and focus
        const collapsedBlock = e.target.closest('.block.block-collapsed');
        if (collapsedBlock) {
            if (collapsedBlock.closest('.content-modal, .tag-modal')) return;
            const blockId = collapsedBlock.dataset.id;
            if (blockId && blockId !== 'new') {
                this.expandBlock(blockId);
                this._autoCollapseOnBlur.add(blockId);
                const editor = this.editors.get(blockId);
                if (editor) editor.focus();
            }
        }
    },

    handleGroupCollapseClick(e) {
        const header = e.target.closest('.doc-group-header');
        if (!header) return;

        if (header.closest('.content-modal, .tag-modal')) return;

        const group = header.closest('.doc-group');
        if (!group) return;

        e.preventDefault();
        e.stopPropagation();

        const namespace = group.dataset.group;
        const key = group.dataset.groupKey;
        const groupKey = key ? `${namespace}.${key}` : `${namespace}.__ungrouped`;

        const isCollapsed = this.collapsedGroups.get(groupKey) || false;
        this.collapsedGroups.set(groupKey, !isCollapsed);

        const blocks = group.querySelector('.doc-group-blocks');
        const btn = group.querySelector('.doc-group-collapse');
        if (isCollapsed) {
            group.classList.remove('doc-group-collapsed');
            if (blocks) blocks.style.display = '';
            if (btn) btn.innerHTML = '&#9660;';
        } else {
            group.classList.add('doc-group-collapsed');
            if (blocks) blocks.style.display = 'none';
            if (btn) btn.innerHTML = '&#9654;';
        }
    },

    removeBlockElement(blockId) {
        const article = document.querySelector(`article.block[data-id="${CSS.escape(blockId)}"]`);
        if (!article) return false;

        // Clean up editor
        const editor = this.editors.get(blockId);
        if (editor) {
            editor.destroy();
            this.editors.delete(blockId);
        }

        // Clear tracked state
        this.originalContents.delete(blockId);
        this.collapsedBlocks.delete(blockId);
        const timeout = this.saveTimeouts.get(blockId);
        if (timeout) {
            clearTimeout(timeout);
            this.saveTimeouts.delete(blockId);
        }

        // Clear focus if this block was focused
        if (this._focusedBlockId === blockId) {
            this._focusedBlockId = null;
        }

        article.remove();
        return true;
    }
};
