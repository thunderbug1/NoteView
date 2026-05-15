/**
 * Time Filter Utility - Shared time filtering logic
 * Used by Store and TimelineView for consistent time-based filtering
 */

const TIME_TAG_PREFIX = 'Time.';

/**
 * Derive the active Time.* tag from a context selection set.
 * Returns the first Time.* tag found, or '' if none.
 * @param {Set<string>} contextSet
 * @returns {string} The full Time.* tag, or ''
 */
function deriveTimeSelectionFromContext(contextSet) {
    for (const tag of contextSet) {
        if (tag.startsWith(TIME_TAG_PREFIX)) return tag;
    }
    return '';
}

/**
 * Check if a date passes the given time filter tag
 * @param {Date|string} date - The date to check (Date object or ISO string)
 * @param {string} timeTag - Full Time.* tag (e.g., 'Time.today', 'Time.quarter.Q1-2026')
 * @returns {boolean} True if the date passes the filter, false otherwise
 */
function checkTimeFilter(date, timeTag) {
    if (!timeTag || !timeTag.startsWith(TIME_TAG_PREFIX)) return true;

    const checkDate = date instanceof Date ? date : new Date(date);
    const now = new Date();

    const key = timeTag.slice(TIME_TAG_PREFIX.length);

    switch (key) {
        case 'today': {
            return checkDate.toDateString() === now.toDateString();
        }
        case 'yesterday': {
            const yesterday = new Date(now);
            yesterday.setDate(now.getDate() - 1);
            return checkDate.toDateString() === yesterday.toDateString();
        }
        case 'thisWeek': {
            const startOfWeek = new Date(now);
            startOfWeek.setDate(now.getDate() - now.getDay());
            startOfWeek.setHours(0, 0, 0, 0);
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 7);
            return checkDate >= startOfWeek && checkDate < endOfWeek;
        }
        case 'lastWeek': {
            const startOfThisWeek = new Date(now);
            startOfThisWeek.setDate(now.getDate() - now.getDay());
            startOfThisWeek.setHours(0, 0, 0, 0);
            const endOfLastWeek = new Date(startOfThisWeek);
            endOfLastWeek.setMilliseconds(-1);
            const startOfLastWeek = new Date(startOfThisWeek);
            startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);
            return checkDate >= startOfLastWeek && checkDate <= endOfLastWeek;
        }
        case 'thisMonth': {
            return checkDate.getMonth() === now.getMonth() &&
                   checkDate.getFullYear() === now.getFullYear();
        }
        case 'lastMonth': {
            const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            return checkDate.getMonth() === lm.getMonth() &&
                   checkDate.getFullYear() === lm.getFullYear();
        }
    }

    // Prefixed types: quarter.Q1-2026, year.2025, date.2026-05-08, range.start..end
    if (key.startsWith('quarter.')) {
        const qStr = key.slice(8); // "Q1-2026"
        const match = qStr.match(/^Q(\d)-(\d{4})$/);
        if (!match) return true;
        const q = parseInt(match[1], 10);
        const y = parseInt(match[2], 10);
        const qStart = new Date(y, (q - 1) * 3, 1);
        const qEnd = new Date(y, q * 3, 1);
        qEnd.setMilliseconds(-1);
        return checkDate >= qStart && checkDate <= qEnd;
    }

    if (key.startsWith('year.')) {
        const yStr = key.slice(5);
        const y = parseInt(yStr, 10);
        if (Number.isNaN(y)) return true;
        return checkDate.getFullYear() === y;
    }

    if (key.startsWith('date.')) {
        const dateStr = key.slice(5); // "2026-05-08"
        const target = new Date(dateStr + 'T00:00:00');
        if (Number.isNaN(target.getTime())) return true;
        return checkDate.toDateString() === target.toDateString();
    }

    if (key.startsWith('range.')) {
        const rangeStr = key.slice(6); // "2026-05-01..2026-05-08"
        const parts = rangeStr.split('..');
        if (parts.length !== 2) return true;
        const start = new Date(parts[0] + 'T00:00:00');
        const end = new Date(parts[1] + 'T23:59:59.999');
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return true;
        return checkDate >= start && checkDate <= end;
    }

    return true;
}

/**
 * Generate dynamic Time.* tags (quarters, years) from block data.
 * @param {Array} blocks - Store.blocks array
 * @param {string} dateProperty - Block property to read dates from
 * @returns {string[]} Array of Time.quarter.* and Time.year.* tags
 */
function generateDynamicTimeTags(blocks, dateProperty) {
    const quarters = new Set();
    const years = new Set();

    blocks.forEach(block => {
        let dateVal = block[dateProperty];
        if (!dateVal) return;

        // Handle task badge dates (due, start, completed)
        if (dateProperty === 'due' || dateProperty === 'start' || dateProperty === 'completed') {
            const tasks = TaskParser.parseTasksFromBlock(block);
            const dates = tasks
                .map(t => { const v = TaskParser.getBadgeValue(t, dateProperty).trim(); return v ? new Date(v).getTime() : Number.NaN; })
                .filter(d => !Number.isNaN(d));
            if (dates.length === 0) return;
            dateVal = new Date(Math.min(...dates));
        }

        const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
        if (Number.isNaN(d.getTime())) return;
        const y = d.getFullYear();
        const q = Math.floor(d.getMonth() / 3) + 1;
        quarters.add(`${TIME_TAG_PREFIX}quarter.Q${q}-${y}`);
        years.add(`${TIME_TAG_PREFIX}year.${y}`);
    });

    return [...quarters, ...years].sort();
}

/**
 * Get a display name for a time tag
 * @param {string} timeTag - Full Time.* tag
 * @returns {string} Human-readable display name
 */
function getTimeTagDisplayName(timeTag) {
    const key = timeTag.slice(TIME_TAG_PREFIX.length);

    const names = {
        'today': 'Today',
        'yesterday': 'Yesterday',
        'thisWeek': 'This Week',
        'lastWeek': 'Last Week',
        'thisMonth': 'This Month',
        'lastMonth': 'Last Month'
    };
    if (names[key]) return names[key];

    if (key.startsWith('quarter.')) {
        const qStr = key.slice(8);
        const match = qStr.match(/^Q(\d)-(\d{4})$/);
        if (match) return `Q${match[1]} ${match[2]}`;
        return qStr;
    }

    if (key.startsWith('year.')) {
        return key.slice(5);
    }

    if (key.startsWith('date.')) {
        const dateStr = key.slice(5);
        const d = new Date(dateStr + 'T00:00:00');
        if (!Number.isNaN(d.getTime())) {
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        }
        return dateStr;
    }

    if (key.startsWith('range.')) {
        const rangeStr = key.slice(6);
        const parts = rangeStr.split('..');
        if (parts.length === 2) {
            const s = new Date(parts[0] + 'T00:00:00');
            const e = new Date(parts[1] + 'T00:00:00');
            const fmt = { month: 'short', day: 'numeric' };
            if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) {
                return `${s.toLocaleDateString(undefined, fmt)} - ${e.toLocaleDateString(undefined, fmt)}`;
            }
        }
        return rangeStr;
    }

    return key;
}

// Static relative time tags always available
const RELATIVE_TIME_TAGS = [
    `${TIME_TAG_PREFIX}today`,
    `${TIME_TAG_PREFIX}yesterday`,
    `${TIME_TAG_PREFIX}thisWeek`,
    `${TIME_TAG_PREFIX}lastWeek`,
    `${TIME_TAG_PREFIX}thisMonth`,
    `${TIME_TAG_PREFIX}lastMonth`
];

// Category labels for the sub-prefix groups
const TIME_CATEGORY_LABELS = {
    'quarter': 'Quarters',
    'year': 'Years'
};

// Export for use in other modules
window.TimeFilter = {
    checkTimeFilter,
    deriveTimeSelectionFromContext,
    generateDynamicTimeTags,
    getTimeTagDisplayName,
    RELATIVE_TIME_TAGS,
    TIME_CATEGORY_LABELS
};
