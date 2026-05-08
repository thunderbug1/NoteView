/**
 * AI Task Panel - Shows background AI dictation status in the right sidebar.
 * Displays processing indicator and unread notifications for AI-formatted notes.
 */

const AITaskPanel = {
    _pendingBlockId: null,
    _unreadBlockIds: [],
    _isProcessing: false,
    _noteTitle: '',
    _clickHandler: null,

    startProcessing(blockId, title) {
        this._pendingBlockId = blockId;
        this._isProcessing = true;
        this._noteTitle = title || 'Untitled';
        this.render();
    },

    finishProcessing(blockId, title) {
        this._isProcessing = false;
        this._pendingBlockId = null;
        if (!this._unreadBlockIds.includes(blockId)) {
            this._unreadBlockIds.push(blockId);
        }
        this.render();
        this._updateTogglePulse();
    },

    failProcessing(blockId) {
        this._isProcessing = false;
        this._pendingBlockId = null;
        this.render();
    },

    dismissNotification(blockId) {
        this._unreadBlockIds = this._unreadBlockIds.filter(id => id !== blockId);
        this.render();
        this._updateTogglePulse();
    },

    checkAutoDismiss(blockId) {
        if (this._unreadBlockIds.includes(blockId)) {
            this.dismissNotification(blockId);
        }
    },

    render() {
        const container = document.querySelector('#sidebarRight .sidebar-scroll');
        if (!container) return;

        if (!this._isProcessing && this._unreadBlockIds.length === 0) {
            this._clear(container);
            return;
        }

        if (!this._clickHandler) {
            this._clickHandler = (e) => {
                const item = e.target.closest('.ai-task-item');
                if (!item) return;

                const blockId = item.dataset.blockId;
                if (!blockId) return;

                this.dismissNotification(blockId);

                if (Store.currentView === 'document') {
                    const editor = DocumentView.editors.get(blockId);
                    if (editor) {
                        DocumentView.highlightAndScrollTo(blockId, editor);
                        editor.focus();
                        return;
                    }
                }

                App.showBlockContentModal(blockId);
            };
            container.addEventListener('click', this._clickHandler);
        }

        let html = '<div class="ai-task-panel"><div class="sidebar-section">';
        html += '<div class="section-header"><h3>AI Tasks</h3></div>';

        if (this._isProcessing && this._pendingBlockId) {
            html += this._renderItem(this._pendingBlockId, this._noteTitle, 'processing');
        }

        for (const blockId of this._unreadBlockIds) {
            const block = Store.blocks.find(b => b.id === blockId);
            const title = block
                ? (block.content || '').split('\n')[0].replace(/^#+\s*/, '').slice(0, 40) || 'Untitled'
                : blockId;
            html += this._renderItem(blockId, title, 'unread');
        }

        html += '</div></div>';

        const existing = container.querySelector('.ai-task-panel');
        if (existing) {
            existing.outerHTML = html;
        } else {
            container.insertAdjacentHTML('afterbegin', html);
        }
    },

    _renderItem(blockId, title, status) {
        const escapedTitle = escapeHtml(title);
        const label = status === 'processing' ? 'AI is formatting...' : 'AI note ready';
        const cls = status === 'processing' ? 'ai-task-item--processing' : 'ai-task-item--unread';
        return `<div class="ai-task-item ${cls}" data-block-id="${escapeHtml(blockId)}">
            <span class="ai-task-dot"></span>
            <div class="ai-task-content">
                <span class="ai-task-label">${label}</span>
                <span class="ai-task-title">${escapedTitle}</span>
            </div>
        </div>`;
    },

    _updateTogglePulse() {
        const toggle = document.getElementById('sidebarRightToggle');
        if (!toggle) return;
        const sidebar = document.getElementById('sidebarRight');
        const collapsed = sidebar && sidebar.classList.contains('collapsed');
        const hasUnread = this._unreadBlockIds.length > 0;
        toggle.classList.toggle('ai-notification-pulse', hasUnread && collapsed);
    },

    _clear(container) {
        if (!container) container = document.querySelector('#sidebarRight .sidebar-scroll');
        const existing = container && container.querySelector('.ai-task-panel');
        if (existing) existing.remove();
    }
};
