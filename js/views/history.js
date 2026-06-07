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
            Common.showToast('Failed to load version history', 'error');
        }
    },
    
    renderModal() {
        let existing = document.getElementById('historyModal');
        if (existing) existing.remove();
        
        const modal = document.createElement('div');
        modal.id = 'historyModal';
        modal.className = 'history-modal-overlay';
        
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
                        <button class="close-history-btn" title="Close History">&times;</button>
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

        const { EditorView, EditorState, basicSetup, unifiedMergeView } = window.CodeMirror;

        this.editorView = new EditorView({
            doc: block.content || '',
            extensions: [
                basicSetup,
                unifiedMergeView({
                    original: parsedOld.content,
                    mergeControls: false
                }),
                EditorView.theme({
                    "&": { height: "100%", width: "100%", fontFamily: 'Inter, sans-serif' },
                    ".cm-merge-deleted": { backgroundColor: "rgba(244, 63, 94, 0.2)", textDecoration: "line-through" },
                    ".cm-merge-inserted": { backgroundColor: "rgba(16, 185, 129, 0.2)", outline: "none" }
                }),
                EditorView.editable.of(false),
                EditorState.readOnly.of(true)
            ],
            parent: container
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
