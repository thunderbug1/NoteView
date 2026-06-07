/**
 * DocumentDiffHelper - Inline AI diff overlay support
 */
const DocumentDiffHelper = {
    // --- Inline AI Diff Overlay ---

    renderInlineDiffOverlay(blockId, pendingDiffs) {
        const latest = pendingDiffs[pendingDiffs.length - 1];
        const msg = latest.msg;
        return `
            <div class="inline-diff-overlay" data-block-id="${escapeHtml(blockId)}" data-diff-id="${escapeHtml(msg.id)}" data-chat-id="${escapeHtml(latest.chatId)}">
                <div class="inline-diff-header">
                    <span class="inline-diff-badge">AI Change</span>
                    <span class="inline-diff-title">${escapeHtml(msg.noteTitle || blockId)}</span>
                    <button class="inline-diff-toggle expanded" data-toggle-inline-diff="${escapeHtml(msg.id)}" title="Toggle diff view">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                </div>
                <div class="inline-diff-body visible" id="inlineDiffBody-${escapeHtml(msg.id)}"></div>
                <div class="inline-diff-actions">
                    <button class="ai-reject-btn" data-reject-inline-diff="${escapeHtml(msg.id)}">Reject</button>
                    <button class="ai-accept-btn" data-accept-inline-diff="${escapeHtml(msg.id)}">Accept</button>
                </div>
            </div>
        `;
    },

    _createInlineDiffEditor(container, original, modified) {
        const create = () => {
            const { EditorView, EditorState, basicSetup, unifiedMergeView } = window.CodeMirror;
            const existingView = container._cmView;
            if (existingView) { try { existingView.destroy(); } catch { /* */ } }

            container._cmView = new EditorView({
                doc: modified,
                extensions: [
                    basicSetup,
                    unifiedMergeView({ original, mergeControls: false }),
                    EditorView.theme({
                        '&': { height: '100%', width: '100%' },
                        '.cm-merge-deleted': { backgroundColor: 'rgba(244, 63, 94, 0.2)', textDecoration: 'line-through' },
                        '.cm-merge-inserted': { backgroundColor: 'rgba(16, 185, 129, 0.2)', outline: 'none' }
                    }),
                    EditorView.editable.of(false),
                    EditorState.readOnly.of(true)
                ],
                parent: container
            });
        };
        if (window.CodeMirror?.basicSetup) create();
        else window.addEventListener('CodeMirrorReady', create, { once: true });
    },

    showPendingInlineDiffs() {
        if (!window.AIAssistant) return;
        const pendingIds = new Set(AIAssistant.getPendingDiffBlockIds());

        // Clean up overlays for blocks that no longer have pending diffs
        for (const article of document.querySelectorAll('article.block-has-pending-diff')) {
            const blockId = article.dataset.id;
            if (!pendingIds.has(blockId)) {
                const overlay = article.querySelector('.inline-diff-overlay');
                if (overlay) overlay.remove();
                article.classList.remove('block-has-pending-diff');
                const editorDiv = article.querySelector('.block-editor');
                if (editorDiv) editorDiv.classList.remove('block-editor-diff-hidden');
            }
        }

        // Add overlays for blocks that have pending diffs
        for (const blockId of pendingIds) {
            const article = document.querySelector(`article.block[data-id="${CSS.escape(blockId)}"]`);
            if (!article || article.querySelector('.inline-diff-overlay')) continue;

            const pendingDiffs = AIAssistant.getPendingDiffsForBlock(blockId);
            if (pendingDiffs.length === 0) continue;

            const editorDiv = article.querySelector('.block-editor');
            if (editorDiv) editorDiv.classList.add('block-editor-diff-hidden');
            article.classList.add('block-has-pending-diff');

            const diffOverlay = this.renderInlineDiffOverlay(blockId, pendingDiffs);
            if (editorDiv) {
                editorDiv.insertAdjacentHTML('afterend', diffOverlay);
            } else {
                article.insertAdjacentHTML('beforeend', diffOverlay);
            }
            this.wireInlineDiffEvents(article);

            // Auto-create the diff editor for the expanded-by-default body
            const body = article.querySelector('.inline-diff-body.visible');
            if (body && !body.dataset.initialized) {
                body.dataset.initialized = 'true';
                const overlay = article.querySelector('.inline-diff-overlay');
                const chat = AIAssistant._chats?.find(c => c.id === overlay?.dataset.chatId);
                const msg = chat?.messages.find(m => m.id === overlay?.dataset.diffId);
                if (msg) this._createInlineDiffEditor(body, msg.original, msg.modified);
            }
        }
    },

    wireInlineDiffEvents(article) {
        const overlay = article.querySelector('.inline-diff-overlay');
        if (!overlay) return;

        const toggle = overlay.querySelector('.inline-diff-toggle');
        if (toggle) {
            toggle.addEventListener('click', () => {
                const body = overlay.querySelector('.inline-diff-body');
                if (!body) return;
                toggle.classList.toggle('expanded');
                body.classList.toggle('visible');
                if (!body.dataset.initialized) {
                    body.dataset.initialized = 'true';
                    const chat = AIAssistant._chats.find(c => c.id === overlay.dataset.chatId);
                    const msg = chat?.messages.find(m => m.id === overlay.dataset.diffId);
                    if (msg) this._createInlineDiffEditor(body, msg.original, msg.modified);
                }
            });
        }

        const acceptBtn = overlay.querySelector('[data-accept-inline-diff]');
        if (acceptBtn) {
            acceptBtn.addEventListener('click', () => {
                const chat = AIAssistant._chats.find(c => c.id === overlay.dataset.chatId);
                if (chat) AIAssistant._acceptDiff(chat, acceptBtn.dataset.acceptInlineDiff);
            });
        }

        const rejectBtn = overlay.querySelector('[data-reject-inline-diff]');
        if (rejectBtn) {
            rejectBtn.addEventListener('click', () => {
                const chat = AIAssistant._chats.find(c => c.id === overlay.dataset.chatId);
                if (chat) AIAssistant._rejectDiff(chat, rejectBtn.dataset.rejectInlineDiff);
            });
        }
    },

    _saveScrollAnchor() {
        let anchorEl = this._focusedBlockId
            ? document.querySelector(`article.block[data-id="${CSS.escape(this._focusedBlockId)}"]`)
            : null;

        if (!anchorEl) {
            const blockEls = document.querySelectorAll('article.block:not([data-id="new"])');
            const viewCenter = window.innerHeight / 2;
            let minDist = Infinity;
            for (const el of blockEls) {
                const rect = el.getBoundingClientRect();
                const center = rect.top + rect.height / 2;
                const dist = Math.abs(center - viewCenter);
                if (dist < minDist) {
                    minDist = dist;
                    anchorEl = el;
                }
            }
        }

        if (!anchorEl) return null;
        return { id: anchorEl.dataset.id, offset: anchorEl.getBoundingClientRect().top };
    },

    _restoreScrollFromAnchor(anchor) {
        if (!anchor) return;
        const el = document.querySelector(`article.block[data-id="${CSS.escape(anchor.id)}"]`);
        if (!el) return;
        const newOffset = el.getBoundingClientRect().top;
        const scroller = document.getElementById('viewContainer');
        if (scroller) {
            scroller.scrollBy(0, newOffset - anchor.offset);
        } else {
            window.scrollBy(0, newOffset - anchor.offset);
        }
    },
};
