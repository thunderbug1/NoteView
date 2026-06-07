/**
 * DocumentInteractions - Paste handling, extract/cut, autocomplete
 */
const DocumentInteractions = {
    getCMWidgets() {
        if (this._cmWidgets) return this._cmWidgets;
        this._cmWidgets = CodeMirrorWidgets.create(this);
        return this._cmWidgets;
    },

    shouldPromptForLargePaste(text) {
        if (!text || typeof text !== 'string') {
            return false;
        }

        const normalized = text.replace(/\r\n/g, '\n');
        const lineCount = normalized.split('\n').length;
        const trimmed = normalized.trim();

        if (!trimmed || this.isFencedContent(trimmed)) {
            return false;
        }

        return lineCount >= this.fencedBlockThresholds.lines || normalized.length >= this.fencedBlockThresholds.chars;
    },

    showLargePasteModal(text) {
        const summary = this.summarizePastedText(text);
        const preview = summary.preview || '(empty)';

        return new Promise((resolve) => {
            let resolved = false;
            const finish = (value) => {
                if (resolved) return;
                resolved = true;
                resolve(value);
            };

            const modal = Modal.create({
                title: 'Large Paste Detected',
                modalClass: 'tag-modal large-paste-modal',
                content: `
                    <div class="large-paste-summary">
                        <p>You pasted ${summary.lines} lines and ${summary.chars} characters. Insert it as a collapsible block?</p>
                        <pre class="large-paste-preview">${escapeHtml(preview)}</pre>
                    </div>
                    <div class="large-paste-actions">
                        <button class="settings-btn secondary" data-action="normal">Paste Normally</button>
                        <button class="settings-btn secondary" data-action="log">Paste As Log Block</button>
                        <button class="settings-btn primary" data-action="code">Paste As Code Block</button>
                    </div>
                `,
                onClose: () => finish(null)
            });

            modal.querySelectorAll('[data-action]').forEach((button) => {
                button.addEventListener('click', () => {
                    const action = button.dataset.action;
                    finish(action);
                    modal.close();
                });
            });
        });
    },

    showMediaUrlModal(mediaInfo) {
        const { type, url, label } = mediaInfo;

        return new Promise((resolve) => {
            let resolved = false;
            const finish = (value) => {
                if (resolved) return;
                resolved = true;
                resolve(value);
            };

            let insertPreview;
            if (type === 'image') {
                insertPreview = `![image](${url})`;
            } else if (type === 'video') {
                insertPreview = `<video src="${url}" controls></video>`;
            } else if (type === 'youtube' || type === 'vimeo' || type === 'steam') {
                insertPreview = `${label} embed: ${url}`;
            } else {
                insertPreview = url;
            }

            const modal = Modal.create({
                title: `${label} URL Detected`,
                modalClass: 'tag-modal media-url-modal',
                content: `
                    <div class="media-url-summary">
                        <p>A ${escapeHtml(label.toLowerCase())} URL was detected. How would you like to insert it?</p>
                        <pre class="media-url-preview">${escapeHtml(url)}</pre>
                        <div class="media-url-insert-preview">
                            <span class="media-url-insert-label">Will insert:</span>
                            <code>${escapeHtml(insertPreview)}</code>
                        </div>
                    </div>
                    <div class="media-url-actions">
                        <button class="settings-btn secondary" data-action="text">Paste as Text</button>
                        <button class="settings-btn primary" data-action="embed">Embed</button>
                    </div>
                `,
                onClose: () => finish(null)
            });

            modal.querySelectorAll('[data-action]').forEach((button) => {
                button.addEventListener('click', () => {
                    finish(button.dataset.action);
                    modal.close();
                });
            });
        });
    },

    buildFencedPaste(view, text, kind) {
        const normalized = this.normalizePastedText(text);
        const selection = view.state.selection.main;
        const beforeChar = selection.from > 0 ? view.state.sliceDoc(selection.from - 1, selection.from) : '';
        const afterChar = selection.to < view.state.doc.length ? view.state.sliceDoc(selection.to, selection.to + 1) : '';
        const prefix = beforeChar && beforeChar !== '\n' ? '\n' : '';
        const suffix = afterChar && afterChar !== '\n' ? '\n' : '';
        const infoString = kind === 'log' ? 'log' : 'code';
        const body = normalized.endsWith('\n') ? normalized : `${normalized}\n`;

        return `${prefix}\`\`\`${infoString}\n${body}\`\`\`${suffix}`;
    },

    insertTextAtSelection(view, text, annotations) {
        const selection = view.state.selection.main;
        const anchor = selection.from + text.length;
        const dispatch = {
            changes: { from: selection.from, to: selection.to, insert: text },
            selection: { anchor, head: anchor },
            scrollIntoView: true
        };
        if (annotations) dispatch.annotations = annotations;
        view.dispatch(dispatch);
        view.focus();
    },

    async handleMediaUrlPaste(view, mediaInfo) {
        const action = await this.showMediaUrlModal(mediaInfo);
        if (!action) {
            view.focus();
            return;
        }

        if (action === 'text') {
            this.insertTextAtSelection(view, mediaInfo.url);
            return;
        }

        let insertText;
        switch (mediaInfo.type) {
            case 'image':
                insertText = `![image](${mediaInfo.url})`;
                break;
            case 'video':
                insertText = `<video src="${mediaInfo.url}" controls></video>`;
                break;
            case 'youtube':
            case 'vimeo':
            case 'steam':
                insertText = mediaInfo.url;
                break;
            default:
                insertText = mediaInfo.url;
        }

        this.insertTextAtSelection(view, insertText);
    },

    async handleLargePaste(view, text) {
        const action = await this.showLargePasteModal(text);
        if (!action) {
            view.focus();
            return;
        }

        if (action === 'normal') {
            this.insertTextAtSelection(view, this.normalizePastedText(text));
            return;
        }

        this.insertTextAtSelection(view, this.buildFencedPaste(view, text, action));
    },

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

    showExtractCutModal(text, view) {
        const lines = text.split('\n').length;
        const chars = text.length;
        const allTags = SelectionManager.getAllContextTags();

        // Determine initial tags from the source block
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

            // Tag autocomplete
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
    },

    getMentionSuggestions(blockId) {
        const allContacts = Array.from(Store.contacts.keys());
        if (allContacts.length === 0) return [];

        const block = Store.blocks.find(b => b.id === blockId);
        const referenceContext = new Set();

        if (block?.tags?.length) {
            block.tags.forEach(tag => referenceContext.add(tag));
        } else {
            SelectionManager.getExpandedActiveTags().forEach(tag => referenceContext.add(tag));
        }

        return allContacts.sort((a, b) => {
            const aTags = Store.contacts.get(a) || new Set();
            const bTags = Store.contacts.get(b) || new Set();
            const aMatchCount = Array.from(referenceContext).filter(tag => aTags.has(tag)).length;
            const bMatchCount = Array.from(referenceContext).filter(tag => bTags.has(tag)).length;

            if (aMatchCount !== bMatchCount) return bMatchCount - aMatchCount;
            return a.localeCompare(b);
        });
    },

    createMentionCompletionSource(container, resolveBlockId) {
        return (context) => {
            const word = context.matchBefore(/@[\p{L}\p{N}_]*/u);
            if (!word) return null;

            const beforeChar = word.from > 0
                ? context.state.sliceDoc(word.from - 1, word.from)
                : '';
            const atBoundary = word.from === 0 || /\s|\(|\[|\{|"|'/.test(beforeChar);
            if (!atBoundary) return null;

            if (word.from === word.to && !context.explicit) return null;

            const typedQuery = word.text.slice(1).toLowerCase();
            const blockId = resolveBlockId ? resolveBlockId() : container.dataset.id;
            const suggestions = this.getMentionSuggestions(blockId)
                .filter(contact => contact.toLowerCase().includes(typedQuery))
                .map(contact => ({
                    label: `@${contact}`,
                    type: 'variable',
                    apply: `@${contact}`
                }));

            if (suggestions.length === 0) {
                return null;
            }

            return {
                from: word.from,
                options: suggestions,
                validFor: /^@[\p{L}\p{N}_]*$/u
            };
        };
    },

    createWikilinkCompletionSource(container) {
        return (context) => {
            const word = context.matchBefore(/\[\[[^\[\]|]*$/);
            if (!word) return null;

            if (word.from === word.to && !context.explicit) return null;

            const typedQuery = word.text.slice(2).toLowerCase();
            const suggestions = Store.blocks
                .map(b => ({ block: b, title: Store.getBlockTitle(b) }))
                .filter(({ title, block }) => title && title !== block.id || block.id.toLowerCase().includes(typedQuery))
                .map(({ block, title }) => {
                    const display = title || block.id;
                    return {
                        label: display,
                        type: 'text',
                        apply: `[[${display}]]`,
                        detail: block.tags?.length ? block.tags.join(', ') : ''
                    };
                })
                .filter(s => s.label.toLowerCase().includes(typedQuery));

            if (suggestions.length === 0) return null;

            return {
                from: word.from,
                options: suggestions,
                validFor: /^\[\[[^\[\]|]*$/
            };
        };
    },
};
