/**
 * Common utility functions
 */

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Format a date string to a readable format
 * @param {string|Date} dateStr - Date string or Date object
 * @param {boolean} includeTime - Whether to include time
 * @returns {string} Formatted date string
 */
function formatDate(dateStr, includeTime = false) {
    const date = new Date(dateStr);
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    if (includeTime) {
        options.hour = '2-digit';
        options.minute = '2-digit';
    }
    return date.toLocaleDateString(undefined, options);
}

/**
 * Truncate HTML text to a maximum length
 * @param {string} html - HTML string to truncate
 * @param {number} maxLength - Maximum length in characters
 * @returns {string} Truncated text
 */
function truncateText(html, maxLength) {
    const div = document.createElement('div');
    div.innerHTML = html;
    const text = div.textContent || '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

/**
 * Capitalize the first character of a string
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 */
function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Parse a hierarchical tag string (separated by ".")
 * @param {string} tag - Tag string (e.g., "Project.Frontend.UI")
 * @returns {{ segments: string[], leaf: string, full: string }}
 */
function parseHierarchicalTag(tag) {
    const parts = tag.split('.');
    if (parts.length === 1) {
        return { segments: [], leaf: tag, full: tag };
    }
    return {
        segments: parts.slice(0, -1),
        leaf: parts[parts.length - 1],
        full: tag
    };
}

/**
 * Format a tag for display — shows leaf portion capitalized
 * @param {string} tag - Tag string
 * @returns {string} Display text
 */
function formatTagDisplay(tag) {
    const { leaf } = parseHierarchicalTag(tag);
    return capitalizeFirst(leaf);
}

/**
 * Build a nested tree from a flat list of tags.
 * Returns { tree: Map, flat: string[] }
 * Each tree node is a Map<string, { children: Map, tags: string[] }>
 * Flat tags (no dots) go into the flat array.
 */
function buildTagTree(tags) {
    const tree = new Map();
    const flat = [];

    tags.forEach(tag => {
        const { segments, leaf } = parseHierarchicalTag(tag);
        if (segments.length === 0) {
            flat.push(tag);
            return;
        }

        let node = tree;
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (!node.has(seg)) {
                node.set(seg, { children: new Map(), tags: [] });
            }
            const entry = node.get(seg);
            if (i === segments.length - 1) {
                // Last segment — this is the parent, tag is a leaf here
                entry.tags.push(tag);
            }
            node = entry.children;
        }
    });

    // Sort tags within each node
    function sortNode(map) {
        const sorted = new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
        sorted.forEach(entry => {
            entry.tags.sort();
            sortNode(entry.children);
        });
        return sorted;
    }

    flat.sort();
    return { tree: sortNode(tree), flat };
}

/**
 * Render badge HTML for an array of tags
 * @param {Array<string>} tags - Array of tag strings
 * @returns {string} HTML string of badge elements
 */
function renderBadges(tags) {
    return tags.map(tag => `<span class="badge">${escapeHtml(tag)}</span>`).join(' ');
}

/**
 * Format a date as a relative time string (e.g., "2 hours ago", "yesterday")
 * @param {string|Date} dateStr - Date string or Date object
 * @returns {string} Relative time string
 */
function formatRelativeDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDate(dateStr);
}

/**
 * Debounce a function call
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Export for use in other modules
window.Common = {
    escapeHtml,
    formatDate,
    truncateText,
    capitalizeFirst,
    renderBadges,
    formatRelativeDate,
    debounce,
    parseHierarchicalTag,
    formatTagDisplay,
    buildTagTree
};
