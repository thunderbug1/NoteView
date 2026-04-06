/**
 * Task Parser Utility - Extract tasks from markdown checkbox syntax
 * Shared by KanbanView and TimelineView
 */

// Valid task states and their normalized values
const TASK_STATES = {
    'x': 'x',  // done
    'X': 'x',
    'b': 'b',  // blocked
    'B': 'b',
    '/': '/',  // in progress
    '-': '-',  // canceled
    ' ': ' '   // todo (default)
};

// Badge keys that we want to extract
const KNOWN_BADGE_KEYS = ['due', 'assignee', 'dependsOn', 'priority'];

// Regex patterns
const CHECKBOX_REGEX = /^(\s*[-*+]\s+)\[([ xX\/bB\-])\](.*)$/gm;
const BADGE_REGEX = /\[([a-zA-Z0-9_]+)::\s*([^\]]+)\]/g;

/**
 * Normalize task state character
 * @param {string} state - Raw state character from checkbox
 * @returns {string} Normalized state character
 */
function normalizeState(state) {
    const lower = state.toLowerCase();
    return TASK_STATES[lower] || ' ';
}

/**
 * Extract badges from task text
 * @param {string} text - Raw task text after checkbox
 * @returns {Object} Object with badges array and cleanText (text without badges)
 */
function extractBadges(text) {
    const badges = [];
    let cleanText = text;
    let match;

    // Reset regex state
    BADGE_REGEX.lastIndex = 0;

    while ((match = BADGE_REGEX.exec(text)) !== null) {
        const key = match[1];
        const val = match[2].trim();
        if (KNOWN_BADGE_KEYS.includes(key)) {
            badges.push({ type: key, value: val });
        }
        cleanText = cleanText.replace(match[0], '');
    }

    return { badges, cleanText: cleanText.trim() };
}

/**
 * Strip badges from text (used by TimelineView for task identity)
 * @param {string} text - Text with potential badges
 * @returns {string} Text without badges
 */
function stripBadges(text) {
    return text.replace(/\s*\[[a-zA-Z0-9_]+::\s*[^\]]+\]/g, '').trim();
}

/**
 * Parse tasks from a single block's content
 * @param {Object} block - Block object with content property
 * @returns {Array} Array of task objects
 */
function parseTasksFromBlock(block) {
    const tasks = [];
    if (!block.content) return tasks;

    let match;
    // Reset regex state
    CHECKBOX_REGEX.lastIndex = 0;

    while ((match = CHECKBOX_REGEX.exec(block.content)) !== null) {
        const prefix = match[1];
        const state = normalizeState(match[2]);
        const originalText = match[3].trim();

        const { badges, cleanText } = extractBadges(originalText);

        tasks.push({
            id: `task-${block.id}-${match.index}`,
            blockId: block.id,
            state,
            text: cleanText,
            originalText,
            matchIndex: match.index,
            matchLength: match[0].length,
            badges,
            prefix
        });
    }

    return tasks;
}

/**
 * Parse tasks from multiple blocks
 * @param {Array} blocks - Array of block objects
 * @returns {Array} Array of task objects
 */
function parseTasksFromBlocks(blocks) {
    const tasks = [];
    blocks.forEach(block => {
        tasks.push(...parseTasksFromBlock(block));
    });
    return tasks;
}

/**
 * Parse tasks from raw markdown content (used by TimelineView)
 * Returns a Map of taskKey -> { state, text, originalText }
 * @param {string} content - Raw markdown content
 * @returns {Map} Map of task keys to task data
 */
function parseTasksFromContent(content) {
    const tasks = new Map();
    if (!content) return tasks;

    let match;
    // Reset regex state
    CHECKBOX_REGEX.lastIndex = 0;

    while ((match = CHECKBOX_REGEX.exec(content)) !== null) {
        const state = normalizeState(match[2]);
        const originalText = match[3].trim();
        const cleanText = stripBadges(originalText);

        if (cleanText) {
            // Use clean text as key. If duplicate task text exists, append index
            let key = cleanText;
            let i = 2;
            while (tasks.has(key)) {
                key = `${cleanText}#${i++}`;
            }
            tasks.set(key, { state, text: cleanText, originalText });
        }
    }

    return tasks;
}

// Export for use in other modules
window.TaskParser = {
    normalizeState,
    extractBadges,
    stripBadges,
    parseTasksFromBlock,
    parseTasksFromBlocks,
    parseTasksFromContent,
    KNOWN_BADGE_KEYS,
    CHECKBOX_REGEX,
    BADGE_REGEX
};
