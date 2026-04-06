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
                <div class="commit-msg">${c.message}</div>
                <div class="commit-oid">${c.oid.substring(0, 7)}</div>
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
        
        modal.querySelector('.close-history-btn').addEventListener('click', () => this.closeHistory());
        
        modal.querySelectorAll('.history-commit-item').forEach(item => {
            item.addEventListener('click', (e) => {
                modal.querySelectorAll('.history-commit-item').forEach(i => i.classList.remove('selected'));
                e.currentTarget.classList.add('selected');
                this.loadDiff(e.currentTarget.dataset.oid);
            });
        });
        
        document.getElementById('restoreVersionBtn').addEventListener('click', () => {
            this.restoreVersion();
        });
        
        if (this.commits.length > 0) {
            this.loadDiff(this.commits[0].oid);
        } else {
            document.getElementById('diffEditorContainer').innerHTML = '<div style="padding:2rem;color:var(--text-secondary)">Save this note to create the first version in history.</div>';
        }
    },
    
    async loadDiff(oid) {
        if (!oid) return;
        
        const oldContentRaw = await GitStore.getFileAtCommit(this.currentFilename, oid);
        let oldContent = oldContentRaw || '';
        
        const parsedOld = this.parseFrontMatter(oldContent);
        const block = Store.blocks.find(b => b.id === this.currentBlockId);
        
        const container = document.getElementById('diffEditorContainer');
        container.innerHTML = '';
        
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
        
        document.getElementById('restoreVersionBtn').disabled = false;
        this.selectedOid = oid;
        this.selectedOldContent = parsedOld.content;
    },
    
    async restoreVersion() {
        if (!this.selectedOldContent) return;
        
        if (confirm("Are you sure you want to restore this version? Your current changes will be overwritten (but saved in history).")) {
            await App.updateBlockProperty(this.currentBlockId, 'content', this.selectedOldContent);
            await App.saveBlockContent(this.currentBlockId, this.selectedOldContent);
            this.closeHistory();
            App.render();
        }
    },
    
    closeHistory() {
        const modal = document.getElementById('historyModal');
        if (modal) modal.remove();
        if (this.editorView) {
            this.editorView.destroy();
            this.editorView = null;
        }
    },
    
    parseFrontMatter(content) {
        let currentContent = content.trimStart();
        const data = {};
        const regex = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
        
        while (true) {
            const match = currentContent.match(regex);
            if (!match) break;
            currentContent = currentContent.substring(match[0].length).trimStart();
        }
        return { content: currentContent };
    }
};

window.HistoryView = HistoryView;
