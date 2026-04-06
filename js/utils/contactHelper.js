/**
 * Contact Helper Utility - Shared contact extraction and matching logic
 * Handles @mentions and [assignee::] patterns from markdown content
 */

/**
 * Regex for matching @mentions at the start of words
 * Matches: @username (but not email@example.com)
 */
const CONTACT_MENTION_REGEX = /(?:^|\s)@([a-zA-Z0-9_]+)(?!\S)/g;

/**
 * Regex for matching [assignee::] badges in task text
 * Matches: [assignee:: username] or [assignee::@username]
 */
const CONTACT_ASSIGNEE_REGEX = /\[assignee::\s*([^\]]+)\]/g;

/**
 * Extract all unique @mentions from content
 * @param {string} content - Markdown content to search
 * @returns {Set<string>} Set of lowercase usernames (without @ symbol)
 */
function extractMentions(content) {
    const mentions = new Set();
    if (!content) return mentions;

    let match;
    CONTACT_MENTION_REGEX.lastIndex = 0;

    while ((match = CONTACT_MENTION_REGEX.exec(content)) !== null) {
        mentions.add(match[1].toLowerCase());
    }

    return mentions;
}

/**
 * Extract all assignees from [assignee::] badges in content
 * @param {string} content - Markdown content to search
 * @returns {Set<string>} Set of lowercase usernames (optional @ symbol stripped)
 */
function extractAssignees(content) {
    const assignees = new Set();
    if (!content) return assignees;

    let match;
    CONTACT_ASSIGNEE_REGEX.lastIndex = 0;

    while ((match = CONTACT_ASSIGNEE_REGEX.exec(content)) !== null) {
        let username = match[1].trim();
        // Strip optional @ if user typed [@Alice]
        if (username.startsWith('@')) {
            username = username.substring(1);
        }
        assignees.add(username.toLowerCase());
    }

    return assignees;
}

/**
 * Extract all contacts (mentions + assignees) from content
 * @param {string} content - Markdown content to search
 * @returns {Set<string>} Set of lowercase usernames
 */
function extractContacts(content) {
    const mentions = extractMentions(content);
    const assignees = extractAssignees(content);
    return new Set([...mentions, ...assignees]);
}

/**
 * Check if content mentions a specific contact
 * @param {string} content - Markdown content to search
 * @param {string} contactName - Contact name to search for (lowercase)
 * @returns {boolean} True if the contact is mentioned or assigned
 */
function hasContact(content, contactName) {
    if (!content || !contactName) return false;

    const searchLower = contactName.toLowerCase();

    // Check for @mention
    const mentionRegex = new RegExp(`(?:^|\\s)@${searchLower}(?!\\S)`, 'i');
    if (mentionRegex.test(content)) return true;

    // Check for [assignee::] badge
    const assigneeRegex = new RegExp(`\\[assignee::\\s*@?${searchLower}\\]`, 'i');
    if (assigneeRegex.test(content)) return true;

    return false;
}

// Export for use in other modules
window.ContactHelper = {
    CONTACT_MENTION_REGEX,
    CONTACT_ASSIGNEE_REGEX,
    extractMentions,
    extractAssignees,
    extractContacts,
    hasContact
};
