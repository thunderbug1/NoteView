/**
 * DocumentInteractions - CodeMirror widget provider (lazy-init).
 * Assigned to DocumentView via Object.assign after shell initialization.
 */
const DocumentInteractions = {
    /**
     * Get or create CodeMirrorWidgets instance. Used by decorations.js.
     * @returns {Object} CodeMirrorWidgets instance
     */
    getCMWidgets() {
        if (this._cmWidgets) return this._cmWidgets;
        this._cmWidgets = CodeMirrorWidgets.create(this);
        return this._cmWidgets;
    }
};
