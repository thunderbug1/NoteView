/**
 * DocumentPasteHandler - Paste handling, media URL insertion, text insertion helpers.
 * Assigned to DocumentView via Object.assign after shell initialization.
 */
const DocumentPasteHandler = {
    /**
     * Determine whether pasted text should trigger the large-paste prompt.
     * @param {string} text - Pasted text
     * @returns {boolean}
     */
    shouldPromptForLargePaste(text) {
        if (!text || typeof text !== 'string') return false;

        const normalized = text.replace(/\r\n/g, '\n');
        const lineCount = normalized.split('\n').length;
        const trimmed = normalized.trim();

        if (!trimmed || DocumentView.isFencedContent(trimmed)) return false;

        return lineCount >= DocumentView.fencedBlockThresholds.lines || normalized.length >= DocumentView.fencedBlockThresholds.chars;
    },

    /**
     * Show modal to choose how to insert large pasted text.
     * @param {string} text - Pasted text
     * @returns {Promise<string|null>} - Action: 'normal', 'log', 'code', or null (cancel)
     */
    showLargePasteModal(text) {
        const summary = DocumentView.summarizePastedText(text);
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

    /**
     * Show modal for detected media URLs (images, videos, embeds).
     * @param {Object} mediaInfo - { type, url, label }
     * @returns {Promise<string|null>} - Action: 'text', 'embed', or null (cancel)
     */
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

    /**
     * Build fenced code/log block text for pasting.
     * @param {EditorView} view - CodeMirror view
     * @param {string} text - Text to wrap
     * @param {string} kind - 'code' or 'log'
     * @returns {string} Formatted fenced block text
     */
    buildFencedPaste(view, text, kind) {
        const normalized = DocumentView.normalizePastedText(text);
        const selection = view.state.selection.main;
        const beforeChar = selection.from > 0 ? view.state.sliceDoc(selection.from - 1, selection.from) : '';
        const afterChar = selection.to < view.state.doc.length ? view.state.sliceDoc(selection.to, selection.to + 1) : '';
        const prefix = beforeChar && beforeChar !== '\n' ? '\n' : '';
        const suffix = afterChar && afterChar !== '\n' ? '\n' : '';
        const infoString = kind === 'log' ? 'log' : 'code';
        const body = normalized.endsWith('\n') ? normalized : `${normalized}\n`;

        return `${prefix}\`\`\`${infoString}\n${body}\`\`\`${suffix}`;
    },

    /**
     * Insert text at the current cursor position in a CodeMirror editor.
     * @param {EditorView} view - CodeMirror view
     * @param {string} text - Text to insert
     * @param {Annotation[]} [annotations] - Optional CM6 annotations (e.g. for undo grouping)
     */
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

    /**
     * Handle a media URL paste — show modal and insert accordingly.
     * @param {EditorView} view - CodeMirror view
     * @param {Object} mediaInfo - { type, url, label }
     */
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

    /**
     * Handle large paste — show modal and insert as chosen type.
     * @param {EditorView} view - CodeMirror view
     * @param {string} text - Pasted text
     */
    async handleLargePaste(view, text) {
        const action = await this.showLargePasteModal(text);
        if (!action) {
            view.focus();
            return;
        }

        if (action === 'normal') {
            this.insertTextAtSelection(view, DocumentView.normalizePastedText(text));
            return;
        }

        this.insertTextAtSelection(view, this.buildFencedPaste(view, text, action));
    }
};
