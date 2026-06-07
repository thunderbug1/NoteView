/**
 * DocumentExtractCutModal - Extract/cut selected text to a new note.
 * Assigned to DocumentView via Object.assign after shell initialization.
 */
const DocumentExtractCutModal = {
    /**
     * Handle extract/cut action from editor — show modal, create new block from selected text.
     * @param {EditorView} view - CodeMirror view
     * @param {string} selectedText - The selected text to extract
     * @param {SelectionRange} selection - CM6 selection range
     */
    async handleExtractCut(view, selectedText, selection) {
        const result = await this.showExtractCutModal(selectedText, view);
        if (!result) {
            view.dispatch({ changes: { from: selection.from, to: selection.to, insert: '' } });
            view.focus();
            return;
        }

        const title = result.title || '';
        const content = title ? `# ${title}\n\n${selectedText}` : selectedText;

        await Store.createBlock(content, { tags: result.tags });
        SelectionManager.updateTagCounts();
        TimelineView.invalidateCache();

        const replacement = title ? `[[${title}]]` : '';
        view.dispatch({
            changes: { from: selection.from, to: selection.to, insert: replacement },
            scrollIntoView: true
        });
        view.focus();
    },

    /**
     * Show the extract/cut modal with title input and tag selector.
     * @param {string} text - Selected text to extract
     * @param {EditorView} view - CodeMirror view for context
     * @returns {Promise<{title: string, tags: string[]}|null>}
     */
    showExtractCutModal(text, view) {
        const lines = text.split('\n').length;
        const chars = text.length;
        const allTags = SelectionManager.getAllContextTags();

        let initialTags = [];
        if (view) {
            const container = view.dom.closest('.codemirror-container');
            if (container) {
                const block = Store.blocks.find(b => b.id === container.dataset.id);
                if (block && block.tags) initialTags = [...block.tags];
            }
        }
        let selectedTags = new Set(initialTags);

        return new Promise((resolve) => {
            let resolved = false;
            const finish = (value) => {
                if (resolved) return;
                resolved = true;
                resolve(value);
            };

            const renderBadges = () => {
                const container = modal.querySelector('#extract-tag-badges');
                if (!container) return;
                container.innerHTML = Array.from(selectedTags).map(tag =>
                    `<span class="badge tag-badge" data-tag="${escapeHtml(tag)}">${escapeHtml(Common.formatTagDisplay(tag))}<span class="badge-remove">&times;</span></span>`
                ).join('');
                container.querySelectorAll('.badge-remove').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const badge = e.target.closest('.badge');
                        selectedTags.delete(badge.dataset.tag);
                        renderBadges();
                    });
                });
            };

            const modal = Modal.create({
                title: 'Extract to New Note',
                modalClass: 'tag-modal large-paste-modal extract-cut-modal',
                content: `
                    <div class="large-paste-summary">
                        <p>You cut ${lines} lines (${chars} characters). Extract into a new note?</p>
                    </div>
                    <div class="extract-cut-title-row">
                        <label for="extract-title-input">Title <span style="font-weight:normal;color:var(--text-muted)">(optional — needed to link back)</span></label>
                        <input type="text" id="extract-title-input" class="modal-prompt-input" placeholder="Enter note title..." value="" />
                    </div>
                    <div class="extract-cut-tags-row">
                        <label>Tags</label>
                        <div id="extract-tag-badges" class="block-tags" style="margin-bottom:4px;"></div>
                        <div style="position:relative;">
                            <input type="text" id="extract-tag-input" class="modal-prompt-input" placeholder="Add tag..." autocomplete="off" />
                            <div id="extract-tag-ac" class="tag-autocomplete" style="display:none;"></div>
                        </div>
                    </div>
                    <div class="large-paste-actions">
                        <button class="settings-btn secondary" data-action="extract">Extract</button>
                        <button class="settings-btn primary" data-action="extract-link">Extract & Link</button>
                    </div>
                `,
                onClose: () => finish(null)
            });

            const titleInput = modal.querySelector('#extract-title-input');
            const tagInput = modal.querySelector('#extract-tag-input');
            const tagAc = modal.querySelector('#extract-tag-ac');
            requestAnimationFrame(() => { titleInput.focus(); titleInput.select(); });

            renderBadges();

            let acItems = [];
            let acIndex = -1;

            const showAc = (items) => {
                acItems = items;
                acIndex = -1;
                if (items.length === 0) { tagAc.style.display = 'none'; return; }
                tagAc.innerHTML = items.map((t, i) =>
                    `<div class="ac-item" data-index="${i}" data-tag="${escapeHtml(t)}">${escapeHtml(Common.formatTagDisplay(t))}</div>`
                ).join('');
                tagAc.style.display = 'block';
                tagAc.querySelectorAll('.ac-item').forEach(el => {
                    el.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        selectedTags.add(el.dataset.tag);
                        tagInput.value = '';
                        tagAc.style.display = 'none';
                        renderBadges();
                        tagInput.focus();
                    });
                });
            };

            tagInput.addEventListener('input', () => {
                const val = tagInput.value.trim().toLowerCase();
                if (!val) { showAc([]); return; }
                const matches = allTags.filter(t => t.toLowerCase().includes(val) && !selectedTags.has(t)).slice(0, 8);
                showAc(matches);
            });

            tagInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = tagInput.value.trim().toLowerCase();
                    if (val && !selectedTags.has(val)) {
                        selectedTags.add(val);
                        tagInput.value = '';
                        tagAc.style.display = 'none';
                        renderBadges();
                    }
                }
                if (e.key === 'Escape') {
                    tagAc.style.display = 'none';
                }
                if (e.key === 'ArrowDown' && acItems.length) {
                    e.preventDefault();
                    acIndex = Math.min(acIndex + 1, acItems.length - 1);
                    tagAc.querySelectorAll('.ac-item').forEach((el, i) => el.classList.toggle('ac-active', i === acIndex));
                }
                if (e.key === 'ArrowUp' && acItems.length) {
                    e.preventDefault();
                    acIndex = Math.max(acIndex - 1, 0);
                    tagAc.querySelectorAll('.ac-item').forEach((el, i) => el.classList.toggle('ac-active', i === acIndex));
                }
                if (e.key === 'Tab' && acIndex >= 0 && acItems[acIndex]) {
                    e.preventDefault();
                    selectedTags.add(acItems[acIndex]);
                    tagInput.value = '';
                    tagAc.style.display = 'none';
                    renderBadges();
                }
            });

            tagInput.addEventListener('blur', () => {
                tagAc.style.display = 'none';
            });

            const submit = (withLink) => {
                const title = titleInput.value.trim();
                if (withLink && !title) {
                    Common.showToast('Enter a title to extract');
                    titleInput.focus();
                    return;
                }
                finish(withLink ? { title, tags: Array.from(selectedTags) } : { title: '', tags: Array.from(selectedTags) });
                modal.close();
            };

            titleInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const title = titleInput.value.trim();
                    finish(title ? { title, tags: Array.from(selectedTags) } : { title: '', tags: Array.from(selectedTags) });
                    modal.close();
                }
                if (e.key === 'Escape') {
                    finish(null);
                    modal.close();
                }
            });

            modal.querySelector('[data-action="extract-link"]').addEventListener('click', () => submit(true));
            modal.querySelector('[data-action="extract"]').addEventListener('click', () => submit(false));
        });
    }
};
