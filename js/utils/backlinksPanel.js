/**
 * Backlinks Panel - Renders backlinks (notes referencing the focused note) into the right sidebar
 */

const BacklinksPanel = {
    _clickHandler: null,

    render(blocks, focusedBlockId) {
        const container = document.querySelector('#sidebarRight .sidebar-scroll');
        if (!container) return;

        if (!focusedBlockId) {
            this._clearBacklinks(container);
            return;
        }

        const backlinks = this._findBacklinks(blocks, focusedBlockId);

        if (backlinks.length === 0) {
            this._clearBacklinks(container);
            return;
        }

        if (!this._clickHandler) {
            this._clickHandler = (e) => {
                const item = e.target.closest('.backlink-item');
                if (item) {
                    const blockId = item.dataset.blockId;
                    if (blockId && typeof DocumentView !== 'undefined') {
                        DocumentView.navigateToBlock(blockId);
                    }
                }
            };
            container.addEventListener('click', this._clickHandler);
        }

        let html = '<div class="backlinks-panel">';
        html += '<div class="sidebar-section"><div class="section-header"><h3>Backlinks</h3></div>';
        html += '<div class="backlinks-list">';
        for (const bl of backlinks) {
            const title = Store.getBlockTitle(bl) || bl.id;
            const snippet = this._getSnippet(bl.content, focusedBlockId);
            html += `<div class="backlink-item" data-block-id="${Common.escapeHtml(bl.id)}">
                <span class="backlink-title">${Common.escapeHtml(title)}</span>
                <span class="backlink-snippet">${Common.escapeHtml(snippet)}</span>
            </div>`;
        }
        html += '</div></div></div>';

        this._clearBacklinks(container);
        container.insertAdjacentHTML('beforeend', html);
    },

    _findBacklinks(blocks, targetId) {
        const lowerTarget = targetId.toLowerCase();
        const targetBlock = blocks.find(b => b.id.toLowerCase() === lowerTarget);
        const targetTitle = targetBlock ? Store.getBlockTitle(targetBlock).toLowerCase() : null;

        const results = [];
        for (const block of blocks) {
            if (block.id.toLowerCase() === lowerTarget) continue;
            if (!block.content) continue;
            const regex = /\[\[([^\[\]|]+)/g;
            let match;
            while ((match = regex.exec(block.content)) !== null) {
                const ref = match[1].trim().toLowerCase();
                if (ref === lowerTarget || (targetTitle && ref === targetTitle)) {
                    results.push(block);
                    break;
                }
            }
        }
        return results;
    },

    _getSnippet(content, targetId) {
        const lowerContent = content.toLowerCase();
        const searchStr = `[[${targetId.toLowerCase()}`;
        const idx = lowerContent.indexOf(searchStr);
        if (idx === -1) return '';
        const start = Math.max(0, idx - 30);
        const end = Math.min(content.length, idx + searchStr.length + 30);
        let snippet = content.slice(start, end).replace(/\n/g, ' ');
        if (start > 0) snippet = '...' + snippet;
        if (end < content.length) snippet = snippet + '...';
        return snippet;
    },

    _clearBacklinks(container) {
        const existing = container.querySelector('.backlinks-panel');
        if (existing) existing.remove();
    }
};
