/**
 * DocumentAutocomplete - Mention and wikilink autocomplete sources for CodeMirror.
 * Assigned to DocumentView via Object.assign after shell initialization.
 */
const DocumentAutocomplete = {
    /**
     * Get contact suggestions for mention autocomplete, sorted by tag match relevance.
     * @param {string} blockId - Block ID to determine tag context
     * @returns {string[]} Sorted contact names
     */
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

    /**
     * Create a CodeMirror autocompletion source for @mentions.
     * @param {HTMLElement} container - The codemirror-container element
     * @param {function(): string} resolveBlockId - Returns the current block ID
     * @returns {function} CM6 completion source function
     */
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

            if (suggestions.length === 0) return null;

            return {
                from: word.from,
                options: suggestions,
                validFor: /^@[\p{L}\p{N}_]*$/u
            };
        };
    },

    /**
     * Create a CodeMirror autocompletion source for [[wikilinks]].
     * @param {HTMLElement} container - The codemirror-container element
     * @returns {function} CM6 completion source function
     */
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
    }
};
