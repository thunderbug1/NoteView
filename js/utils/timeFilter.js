/**
 * Time Filter Utility - Shared time filtering logic
 * Used by Store and TimelineView for consistent time-based filtering
 */

/**
 * Check if a date passes the given time filter
 * @param {Date|string} date - The date to check (Date object or ISO string)
 * @param {string} timeSelection - Time filter: '', 'today', 'thisWeek', 'thisMonth'
 * @returns {boolean} True if the date passes the filter, false otherwise
 */
function checkTimeFilter(date, timeSelection) {
    // No filter selected - all dates pass
    if (!timeSelection) {
        return true;
    }

    // Convert to Date object if needed
    const checkDate = date instanceof Date ? date : new Date(date);
    const now = new Date();

    if (timeSelection === 'today') {
        return checkDate.toDateString() === now.toDateString();
    } else if (timeSelection === 'thisWeek') {
        // Start of this week (Sunday)
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        return checkDate >= startOfWeek;
    } else if (timeSelection === 'thisMonth') {
        return checkDate.getMonth() === now.getMonth() &&
               checkDate.getFullYear() === now.getFullYear();
    }

    // Unknown filter - pass through
    return true;
}

// Export for use in other modules
window.TimeFilter = {
    checkTimeFilter
};
