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
 * Sanitize HTML to prevent XSS while preserving formatting.
 * Strips <script>, <iframe>, <object>, <embed>, <form> elements
 * and removes on* event handler attributes and javascript: URLs.
 * @param {string} html - HTML string to sanitize
 * @returns {string} Sanitized HTML
 */
function sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const remove = doc.querySelectorAll('script, iframe, object, embed, form, base, meta, style, link');
    remove.forEach(el => el.remove());
    doc.querySelectorAll('*').forEach(el => {
        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            const val = attr.value.trim().toLowerCase();
            if (name.startsWith('on') ||
                val.startsWith('javascript:') ||
                val.startsWith('data:') ||
                val.startsWith('vbscript:') ||
                name === 'style') {
                el.removeAttribute(attr.name);
            }
        }
    });
    return doc.body.innerHTML;
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
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Parse a tag string with optional single-level grouping (separated by ".")
 * Normalizes multi-dot tags to single-level: "A.B.C" → "A.C"
 * @param {string} tag - Tag string (e.g., "project.ui")
 * @returns {{ segments: string[], leaf: string, full: string }}
 */
function parseHierarchicalTag(tag) {
    const parts = tag.split('.');
    if (parts.length === 1) {
        return { segments: [], leaf: tag, full: tag };
    }
    // Normalize to single-level: keep only first segment as group
    if (parts.length > 2) {
        const normalized = parts[0] + '.' + parts[parts.length - 1];
        return { segments: [parts[0]], leaf: parts[parts.length - 1], full: normalized };
    }
    return {
        segments: [parts[0]],
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
 * Build a single-level grouping from a flat list of tags.
 * Returns { groups: Map<string, string[]>, flat: string[] }
 * Tags with one dot are grouped by the segment before the dot.
 * Tags with no dots go into the flat array.
 */
function buildTagTree(tags) {
    const groups = new Map();
    const flat = [];

    tags.forEach(tag => {
        const { segments } = parseHierarchicalTag(tag);
        if (segments.length === 0) {
            flat.push(tag);
            return;
        }

        const group = segments[0];
        if (!groups.has(group)) {
            groups.set(group, []);
        }
        groups.get(group).push(tag);
    });

    // Sort tags within each group and sort groups by name
    const sorted = new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    sorted.forEach(tagList => tagList.sort());

    flat.sort();
    return { groups: sorted, flat };
}

/**
 * Build a multi-level grouping from a flat list of tags.
 * Unlike buildTagTree (which normalizes multi-dot to single-level),
 * this preserves the full dot-path hierarchy up to maxDepth.
 * E.g. "Time.quarter.Q1-2026" at maxDepth=2 groups under Time -> quarter -> leaf
 * @param {string[]} tags - Tags to group
 * @param {number} maxDepth - How many dot segments to use as group levels (default 2)
 * @returns {{ groups: Map<string, { subgroups: Map<string, string[]>, leaves: string[] }>, flat: string[] }}
 */
function buildMultiLevelTagTree(tags, maxDepth = 2) {
    const groups = new Map();
    const flat = [];

    tags.forEach(tag => {
        const parts = tag.split('.');
        if (parts.length <= 1) {
            flat.push(tag);
            return;
        }

        const topGroup = parts[0];
        if (!groups.has(topGroup)) {
            groups.set(topGroup, { subgroups: new Map(), leaves: [] });
        }
        const entry = groups.get(topGroup);

        if (parts.length === 2 || maxDepth < 2) {
            entry.leaves.push(tag);
        } else {
            const subGroup = parts[1];
            if (!entry.subgroups.has(subGroup)) {
                entry.subgroups.set(subGroup, []);
            }
            entry.subgroups.get(subGroup).push(tag);
        }
    });

    const sorted = new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    sorted.forEach(entry => {
        const sortedSubs = new Map([...entry.subgroups.entries()].sort((a, b) => a[0].localeCompare(b[0])));
        sortedSubs.forEach(tagList => tagList.sort());
        entry.subgroups = sortedSubs;
        entry.leaves.sort();
    });

    flat.sort();
    return { groups: sorted, flat };
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

/**
 * Show a temporary toast notification at the bottom of the screen
 * @param {string} message - Toast message text
 * @param {Object} [opts] - Options
 * @param {Function} [opts.action] - Click handler for action button
 * @param {string} [opts.actionLabel] - Label for action button
 * @param {number} [opts.duration=4000] - Duration in milliseconds
 */
function showToast(message, { action, actionLabel, duration } = {}) {
    document.querySelectorAll('.nv-toast').forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = 'nv-toast';
    toast.style.cssText = 'position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);' +
        'padding:0.75rem 1.5rem;background:var(--bg-secondary);border:1px solid var(--border);' +
        'border-radius:var(--radius-sm);color:var(--text-primary);font-size:0.85rem;' +
        'z-index:10001;box-shadow:var(--shadow-lg);transition:opacity 0.3s;opacity:1;' +
        'display:flex;align-items:center;gap:0.75rem;max-width:min(90vw,500px);';

    const textSpan = document.createElement('span');
    textSpan.textContent = message;
    toast.appendChild(textSpan);

    if (action && actionLabel) {
        const btn = document.createElement('button');
        btn.textContent = actionLabel;
        btn.style.cssText = 'background:none;border:1px solid var(--accent);color:var(--accent);' +
            'padding:0.25rem 0.75rem;border-radius:var(--radius-sm);cursor:pointer;' +
            'font-size:0.8rem;white-space:nowrap;';
        btn.addEventListener('click', () => {
            action();
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        });
        toast.appendChild(btn);
    }

    document.body.appendChild(toast);
    const timeout = duration || 4000;
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, timeout);
}

function contentPreview(text, maxLines = 3) {
    return text.split('\n').filter(l => l.trim()).slice(0, maxLines).map(l => escapeHtml(l)).join('<br>');
}

// Export for use in other modules
window.Common = {
    escapeHtml,
    sanitizeHtml,
    formatDate,
    truncateText,
    capitalizeFirst,
    renderBadges,
    formatRelativeDate,
    debounce,
    parseHierarchicalTag,
    formatTagDisplay,
    buildTagTree,
    buildMultiLevelTagTree,
    showToast,
    contentPreview
};
