/**
 * History View
 * Renders the timeline UI and manages the diff view interaction.
 */
const HistoryView = {
    currentBlockId: null,
    currentFilename: null,
    currentContent: '',
    commits: [],
    editorView: null,
    
    async openHistory(blockId) {
        const block = Store.blocks.find(b => b.id === blockId);
        if (!block) return;

        this.currentBlockId = blockId;
        this.currentFilename = block.filename;
        this.currentContent = block.content || '';

        // Immediate feedback while git history loads (can be slow on large repos)
        this._showLoadingModal();
        // Safety cutoff: if getHistory neither resolves nor rejects (e.g. hung
        // adapter), dismiss the modal instead of leaving it stuck open.
        this._loadingCutoff = setTimeout(() => {
            if (document.getElementById('historyModal')) {
                console.error('HistoryView: history load timed out');
                this.closeHistory();
                Common.showToast('Version history took too long to load. Try again.');
            }
        }, 30000);
        try {
        const rawCommits = await GitStore.getHistory(this.currentFilename);

        // Group commits together that occur within 10 minutes of each other
        // Since commits are returned newest first, we keep the newest of each edit session
        const GROUP_GAP_MS = 10 * 60 * 1000;
        this.commits = [];
        for (const c of rawCommits) {
            if (this.commits.length === 0) {
                this.commits.push(c);
            } else {
                const lastAdded = this.commits[this.commits.length - 1];
                if (lastAdded.timestamp - c.timestamp > GROUP_GAP_MS) {
                    this.commits.push(c);
                }
            }
        }

        this.renderModal();
        } catch (e) {
            console.error('Failed to load history:', e);
            this.closeHistory();
            Common.showToast('Failed to load version history', 'error');
        } finally {
            clearTimeout(this._loadingCutoff);
            this._loadingCutoff = null;
        }
    },

    _showLoadingModal() {
        let existing = document.getElementById('historyModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'historyModal';
        modal.className = 'history-modal-overlay';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'Version History');
        modal.innerHTML = `
            <div class="history-modal-container" style="align-items:center;justify-content:center;display:flex;min-height:200px">
                <div style="color:var(--text-secondary);font-size:0.9rem">Loading version history…</div>
            </div>
        `;
        document.body.appendChild(modal);
    },

    renderModal() {
        let existing = document.getElementById('historyModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'historyModal';
        modal.className = 'history-modal-overlay';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'Version History');

        const commitsHtml = this.commits.map((c, i) => `
            <div class="history-commit-item ${i === 0 ? 'selected' : ''}" data-oid="${c.oid}">
                <div class="commit-time">${Common.formatRelativeDate(new Date(c.timestamp))}</div>
                <div class="commit-msg">${escapeHtml(c.message)}</div>
                <div class="commit-oid">${escapeHtml(c.oid.substring(0, 7))}</div>
            </div>
        `).join('');
        
        modal.innerHTML = `
            <div class="history-modal-container">
                <div class="history-sidebar">
                    <div class="history-header">
                        <h2>Version History</h2>
                        <button class="close-history-btn" title="Close History" aria-label="Close History">&times;</button>
                    </div>
                    <div class="history-timeline">
                        ${commitsHtml || '<div class="no-history">No history found for this block yet. Make a save first!</div>'}
                    </div>
                </div>
                <div class="history-main">
                    <div class="history-actions">
                        <button id="restoreVersionBtn" class="restore-btn" disabled>Restore This Version</button>
                    </div>
                    <div id="diffEditorContainer" class="diff-editor-container"></div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);

        // Remove previous handler to prevent listener accumulation
        if (this._escapeHandler) {
            document.removeEventListener('keydown', this._escapeHandler);
        }
        const escapeHandler = (e) => {
            if (e.key === 'Escape') this.closeHistory();
        };
        document.addEventListener('keydown', escapeHandler);
        this._escapeHandler = escapeHandler;

        // Simple focus trap: keep Tab cycling inside the modal
        const trapHandler = (e) => {
            if (e.key !== 'Tab') return;
            const focusables = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', trapHandler);
        this._trapHandler = trapHandler;

        // Move focus into the dialog; restore it when it closes
        this._previouslyFocused = document.activeElement;
        modal.querySelector('.close-history-btn').focus();

        modal.querySelector('.close-history-btn').addEventListener('click', () => this.closeHistory());
        
        modal.querySelectorAll('.history-commit-item').forEach(item => {
            item.addEventListener('click', (e) => {
                modal.querySelectorAll('.history-commit-item').forEach(i => i.classList.remove('selected'));
                e.currentTarget.classList.add('selected');
                this.loadDiff(e.currentTarget.dataset.oid);
            });
        });
        
        const restoreBtn = document.getElementById('restoreVersionBtn');
        if (restoreBtn) restoreBtn.addEventListener('click', () => {
            this.restoreVersion();
        });

        if (this.commits.length > 0) {
            this.loadDiff(this.commits[0].oid);
        } else {
            const diffContainer = document.getElementById('diffEditorContainer');
            if (diffContainer) diffContainer.innerHTML = '<div style="padding:2rem;color:var(--text-secondary)">Save this note to create the first version in history.</div>';
        }
    },
    
    async loadDiff(oid) {
        if (!oid) return;

        try {
        const oldContentRaw = await GitStore.getFileAtCommit(this.currentFilename, oid);
        let oldContent = oldContentRaw || '';

        const parsedOld = this.parseFrontMatter(oldContent);
        const block = Store.blocks.find(b => b.id === this.currentBlockId);
        const container = document.getElementById('diffEditorContainer');
        if (!block) {
            if (container) container.innerHTML = '<div style="padding:2rem;color:var(--text-secondary)">Block no longer exists.</div>';
            return;
        }

        if (!container) return;

        if (this.editorView) {
            this.editorView.destroy();
            this.editorView = null;
        }
        container.innerHTML = '';

        await DocumentView.waitForCodeMirror();
        if (!window.CodeMirror?.EditorView) {
            container.innerHTML = '<div style="padding:2rem;color:var(--text-secondary)">Failed to load editor. Please try again.</div>';
            return;
        }

        this.editorView = DiffEditor.createMergeView(container, parsedOld.content, block.content || '', {
            fontFamily: 'Inter, sans-serif'
        });

        const restoreBtn = document.getElementById('restoreVersionBtn');
        if (restoreBtn) restoreBtn.disabled = false;
        this.selectedOid = oid;
        this.selectedOldContent = oldContent;
        } catch (e) {
            console.error('Failed to load diff:', e);
            const container = document.getElementById('diffEditorContainer');
            if (container) container.innerHTML = `<div style="padding:2rem;color:var(--text-secondary)">Failed to load version: ${escapeHtml(e.message)}</div>`;
        }
    },
    
    async restoreVersion() {
        if (!this.selectedOldContent) return;

        const confirmed = await Modal.confirm({
            title: 'Restore Version',
            message: 'Are you sure you want to restore this version? Your current changes will be overwritten (but saved in history).'
        });
        if (!confirmed) return;

        try {
            await App.updateBlockProperty(this.currentBlockId, 'content', this.selectedOldContent, 'Restore version');
        } catch (err) {
            console.error('Restore version failed:', err);
            Common.showToast('Failed to restore version: ' + (err.message || 'Unknown error'));
            return;
        }
        this.closeHistory();
        App.render();
    },
    
    closeHistory() {
        if (this._escapeHandler) {
            document.removeEventListener('keydown', this._escapeHandler);
            this._escapeHandler = null;
        }
        if (this._trapHandler) {
            document.removeEventListener('keydown', this._trapHandler);
            this._trapHandler = null;
        }
        if (this._previouslyFocused && typeof this._previouslyFocused.focus === 'function') {
            try { this._previouslyFocused.focus(); } catch { /* element may be gone */ }
            this._previouslyFocused = null;
        }
        const modal = document.getElementById('historyModal');
        if (modal) modal.remove();
        if (this.editorView) {
            this.editorView.destroy();
            this.editorView = null;
        }
    },
    
    parseFrontMatter(content) {
        let currentContent = content.trimStart();
        let frontmatter = '';
        const regex = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
        
        while (true) {
            const match = currentContent.match(regex);
            if (!match) break;
            frontmatter += match[0];
            currentContent = currentContent.substring(match[0].length).trimStart();
        }
        return { content: currentContent, frontmatter };
    }
};

window.HistoryView = HistoryView;
