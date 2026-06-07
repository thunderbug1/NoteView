/**
 * DiffEditor - Shared CodeMirror MergeView diff editor factory.
 * Deduplicates the near-identical EditorView + unifiedMergeView construction
 * that was replicated across diffHelper.js, ai.js (2 sites), history.js,
 * and timeline.js (~125 lines duplicated).
 *
 * Usage:
 *   await DiffEditor.waitForCodeMirror();
 *   DiffEditor.createMergeView(container, original, modified, { markdown, fontSize, fontFamily });
 */
const DiffEditor = {
    /**
     * Wait for CodeMirror to be loaded. Delegates to DocumentView.window.waitForCodeMirror
     * but also works when DocumentView is not available (polls CodeMirrorReady directly).
     * @returns {Promise<void>}
     */
    async waitForCodeMirror() {
        if (window.CodeMirror?.basicSetup) return Promise.resolve();
        if (window.DocumentView && typeof DocumentView.waitForCodeMirror === 'function') {
            return DocumentView.waitForCodeMirror();
        }
        return new Promise((resolve) => {
            if (window.CodeMirrorReady) { resolve(); return; }
            window.addEventListener('CodeMirrorReady', resolve, { once: true });
        });
    },

    /**
     * Create a read-only CodeMirror MergeView diff editor in the given container.
     * Destroys any previous editor stored on container._diffEditorView before creating.
     *
     * @param {HTMLElement} container - Parent element to host the diff editor
     * @param {string} original - Original document content
     * @param {string} modified - Modified document content
     * @param {Object} [options]
     * @param {boolean} [options.markdown=false] - Enable markdown syntax highlighting
     * @param {string} [options.fontSize] - CSS font-size value (e.g. "14px")
     * @param {string} [options.fontFamily] - CSS font-family value (e.g. "Inter, sans-serif")
     * @param {Object} [options.colors] - Custom diff colors
     * @param {string} [options.colors.deleted='rgba(244, 63, 94, 0.2)'] - Deleted text background
     * @param {string} [options.colors.inserted='rgba(16, 185, 129, 0.2)'] - Inserted text background
     * @returns {EditorView} The CM6 EditorView instance
     */
    createMergeView(container, original, modified, options = {}) {
        const { EditorView, EditorState, basicSetup, unifiedMergeView, markdown, languages } = window.CodeMirror;

        const prevView = container._diffEditorView;
        if (prevView) {
            try { prevView.destroy(); } catch (_) { /* cleanup */ }
        }

        const style = {};
        if (options.fontSize) style.fontSize = options.fontSize;
        if (options.fontFamily) style.fontFamily = options.fontFamily;
        style.height = '100%';
        style.width = '100%';

        const deletedBg = options.colors?.deleted || 'rgba(244, 63, 94, 0.2)';
        const insertedBg = options.colors?.inserted || 'rgba(16, 185, 129, 0.2)';

        const extensions = [
            basicSetup,
            unifiedMergeView({ original, mergeControls: false }),
            EditorView.theme({
                '&': style,
                '.cm-merge-deleted': { backgroundColor: deletedBg, textDecoration: 'line-through' },
                '.cm-merge-inserted': { backgroundColor: insertedBg, outline: 'none' }
            }),
            EditorView.editable.of(false),
            EditorState.readOnly.of(true)
        ];

        if (options.markdown && markdown && languages) {
            extensions.splice(1, 0, markdown({ codeLanguages: languages }));
        }

        const view = new EditorView({
            doc: modified,
            extensions,
            parent: container
        });

        container._diffEditorView = view;
        return view;
    },

    /**
     * Create a merge view that handles CodeMirror-not-ready-yet gracefully.
     * If CodeMirror is available, creates immediately. Otherwise waits for CodeMirrorReady event.
     *
     * @param {HTMLElement} container
     * @param {string} original
     * @param {string} modified
     * @param {Object} [options] - Same as createMergeView options
     */
    createMergeViewWhenReady(container, original, modified, options = {}) {
        const create = () => {
            this.createMergeView(container, original, modified, options);
        };
        if (window.CodeMirror?.basicSetup) {
            create();
        } else {
            window.addEventListener('CodeMirrorReady', create, { once: true });
        }
    }
};
