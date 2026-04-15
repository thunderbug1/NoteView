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
const KNOWN_BADGE_KEYS = ['due', 'assignee', 'priority'];

// Regex patterns
const CHECKBOX_REGEX = /^(\s*[-*+]\s+)\[([ xX\/bB\-])\](.*)$/gm;
const BADGE_REGEX = /\[([a-zA-Z0-9_]+)::\s*([^\]]+)\]/g;
const TASK_MENTION_REGEX = /(?:^|\s)@([a-zA-Z0-9_]+)(?!\S)/g;
const PRIORITY_RANKS = {
    urgent: 0,
    high: 1,
    medium: 2,
    low: 4
};

const UPCOMING_DAYS = 3;

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

function normalizeContactToken(value) {
    if (!value) return '';

    let normalized = String(value).trim().toLowerCase();
    if (normalized.startsWith('@')) {
        normalized = normalized.substring(1);
    }

    return normalized;
}

function getTaskIndent(prefix) {
    const leadingWhitespace = (prefix.match(/^\s*/) || [''])[0];
    return leadingWhitespace.replace(/\t/g, '    ').length;
}

function extractMentionContacts(text) {
    const contacts = new Set();
    if (!text) return contacts;

    let match;
    TASK_MENTION_REGEX.lastIndex = 0;
    while ((match = TASK_MENTION_REGEX.exec(text)) !== null) {
        const normalized = normalizeContactToken(match[1]);
        if (normalized) {
            contacts.add(normalized);
        }
    }

    return contacts;
}

function extractBadgeContacts(badges) {
    const contacts = new Set();
    (badges || []).forEach(badge => {
        if (badge.type !== 'assignee') return;
        const normalized = normalizeContactToken(badge.value);
        if (normalized) {
            contacts.add(normalized);
        }
    });
    return contacts;
}

function mergeContactSets(...sets) {
    return new Set(sets.flatMap(set => Array.from(set || [])));
}

function getAssignmentContacts(task) {
    if (Array.isArray(task?.assignmentContacts)) {
        return new Set(task.assignmentContacts.map(normalizeContactToken).filter(Boolean));
    }

    return extractBadgeContacts(task?.badges || []);
}

/**
 * Get a badge value by type
 * @param {Object} task - Parsed task object
 * @param {string} type - Badge type
 * @returns {string} Badge value or empty string
 */
function getBadgeValue(task, type) {
    return task?.badges?.find(badge => badge.type === type)?.value || '';
}

/**
 * Get normalized priority rank for a task
 * @param {Object} task - Parsed task object
 * @returns {number} Numeric rank where lower is more important
 */
function getPriorityRank(task) {
    const priority = getBadgeValue(task, 'priority').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(PRIORITY_RANKS, priority)
        ? PRIORITY_RANKS[priority]
    : 3;
}

/**
 * Parse due date badge into a comparable timestamp
 * @param {Object} task - Parsed task object
 * @returns {number} Timestamp or NaN for invalid/missing values
 */
function getDueTimestamp(task) {
    const due = getBadgeValue(task, 'due').trim();
    if (!due) return Number.NaN;

    const timestamp = new Date(due).getTime();
    return Number.isNaN(timestamp) ? Number.NaN : timestamp;
}

/**
 * Build a stable source-order key for tie breaking
 * @param {Object} task - Parsed task object
 * @returns {string} Comparable source-order key
 */
function getSourceOrderKey(task) {
    const blockId = task?.blockId || '';
    const matchIndex = Number.isFinite(task?.matchIndex) ? task.matchIndex : Number.MAX_SAFE_INTEGER;
    return `${blockId}::${String(matchIndex).padStart(12, '0')}`;
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
 * Check whether a task is closed
 * @param {Object} task - Parsed task object
 * @returns {boolean} True when task is done or canceled
 */
function isClosedTask(task) {
    return task.state === 'x' || task.state === '-';
}

/**
 * Check whether a task has an assignee badge
 * @param {Object} task - Parsed task object
 * @returns {boolean} True when task has a non-empty assignee
 */
function hasAssignee(task) {
    return task.badges.some(b => b.type === 'assignee' && b.value && b.value.trim());
}

/**
 * Check whether a task mentions a contact in its text
 * @param {Object} task - Parsed task object
 * @returns {boolean} True when task text contains an @mention
 */
function hasMention(task) {
    return extractMentionContacts(task?.originalText || task?.text || '').size > 0;
}

/**
 * Check whether a task is open
 * @param {Object} task - Parsed task object
 * @returns {boolean} True when task is todo or in progress
 */
function isOpenTask(task) {
    return task.state === ' ' || task.state === '/';
}

/**
 * Check whether a task is blocked
 * @param {Object} task - Parsed task object
 * @returns {boolean} True when task is in blocked state
 */
function isBlockedTask(task) {
    return task.state === 'b';
}

/**
 * Check whether a task is unblocked and actionable
 * @param {Object} task - Parsed task object
 * @returns {boolean} True when task is open (todo or in progress)
 */
function isUnblockedTask(task) {
    return isOpenTask(task);
}

/**
 * Check whether a task has no direct assignee (ignores inherited assignees from parent tasks)
 * @param {Object} task - Parsed task object
 * @returns {boolean} True when task has no assignee badge
 */
function isUnassignedTask(task) {
    return !task?.badges?.some(b => b.type === 'assignee' && b.value);
}

/**
 * Check whether a task collection contains unassigned tasks
 * @param {Array} tasks - Parsed task objects
 * @returns {boolean} True when any matching task is unassigned
 */
function hasUnassignedTasks(tasks) {
    return tasks.some(task => isUnassignedTask(task));
}

/**
 * Classify a task's deadline urgency
 * @param {Object} task - Parsed task object
 * @returns {'overdue'|'upcoming-soon'|'upcoming'|null} Urgency level or null
 */
function getDeadlineUrgency(task) {
    if (isClosedTask(task)) return null;
    const ts = getDueTimestamp(task);
    if (Number.isNaN(ts)) return null;

    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfToday = today.getTime();
    const endOfToday = startOfToday + 86400000;

    if (ts < startOfToday) return 'overdue';
    if (ts < endOfToday) return 'upcoming-soon';
    if (ts < now + UPCOMING_DAYS * 86400000) return 'upcoming';
    return null;
}

/**
 * Get a human-readable relative date label for a task's due date
 * @param {Object} task - Parsed task object
 * @returns {string} e.g. "2 days overdue", "Due today", "Due in 3 days", or raw date
 */
function getDueDateString(task) {
    const due = getBadgeValue(task, 'due').trim();
    if (!due) return '';
    const ts = new Date(due).getTime();
    if (Number.isNaN(ts)) return due;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startOfToday = today.getTime();

    const diffDays = Math.round((ts - startOfToday) / 86400000);
    if (diffDays < 0) return `${Math.abs(diffDays)} day${Math.abs(diffDays) !== 1 ? 's' : ''} overdue`;
    if (diffDays === 0) return 'Due today';
    return `Due in ${diffDays} day${diffDays !== 1 ? 's' : ''}`;
}

/**
 * Extract all open tasks with deadline urgency from blocks
 * @param {Array} blocks - Array of block objects
 * @returns {Array<{task: Object, urgency: string}>} Sorted by urgency then due date
 */
function getTasksWithUrgency(blocks) {
    const tasks = parseTasksFromBlocks(blocks);
    const results = [];
    for (const task of tasks) {
        const urgency = getDeadlineUrgency(task);
        if (urgency) results.push({ task, urgency });
    }
    const order = { overdue: 0, 'upcoming-soon': 1, upcoming: 2 };
    results.sort((a, b) => {
        const ao = order[a.urgency] ?? 9;
        const bo = order[b.urgency] ?? 9;
        if (ao !== bo) return ao - bo;
        return getDueTimestamp(a.task) - getDueTimestamp(b.task);
    });
    return results;
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
    const ancestorStack = [];
    // Reset regex state
    CHECKBOX_REGEX.lastIndex = 0;

    while ((match = CHECKBOX_REGEX.exec(block.content)) !== null) {
        const prefix = match[1];
        const state = normalizeState(match[2]);
        const originalText = match[3].trim();
        const indent = getTaskIndent(prefix);

        const { badges, cleanText } = extractBadges(originalText);
        const directAssignmentContacts = extractBadgeContacts(badges);

        while (ancestorStack.length > 0 && ancestorStack[ancestorStack.length - 1].indent >= indent) {
            ancestorStack.pop();
        }

        const inheritedAssignmentContacts = mergeContactSets(
            ...ancestorStack.map(ancestor => ancestor.assignmentContacts)
        );
        const assignmentContacts = mergeContactSets(inheritedAssignmentContacts, directAssignmentContacts);

        const task = {
            id: `task-${block.id}-${match.index}`,
            blockId: block.id,
            state,
            text: cleanText,
            originalText,
            matchIndex: match.index,
            matchLength: match[0].length,
            badges,
            prefix,
            indent,
            assignmentContacts: Array.from(assignmentContacts),
            inheritedAssignmentContacts: Array.from(inheritedAssignmentContacts)
        };

        tasks.push(task);
        ancestorStack.push({ indent, assignmentContacts });
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
    const ancestorStack = [];
    // Reset regex state
    CHECKBOX_REGEX.lastIndex = 0;

    while ((match = CHECKBOX_REGEX.exec(content)) !== null) {
        const prefix = match[1];
        const state = normalizeState(match[2]);
        const originalText = match[3].trim();
        const { badges, cleanText } = extractBadges(originalText);
        const indent = getTaskIndent(prefix);

        while (ancestorStack.length > 0 && ancestorStack[ancestorStack.length - 1].indent >= indent) {
            ancestorStack.pop();
        }

        const directAssignmentContacts = extractBadgeContacts(badges);
        const inheritedAssignmentContacts = mergeContactSets(
            ...ancestorStack.map(ancestor => ancestor.assignmentContacts)
        );
        const assignmentContacts = mergeContactSets(inheritedAssignmentContacts, directAssignmentContacts);

        if (cleanText) {
            // Use clean text as key. If duplicate task text exists, append index
            let key = cleanText;
            let i = 2;
            while (tasks.has(key)) {
                key = `${cleanText}#${i++}`;
            }
            tasks.set(key, {
                state,
                text: cleanText,
                originalText,
                badges,
                indent,
                assignmentContacts: Array.from(assignmentContacts),
                inheritedAssignmentContacts: Array.from(inheritedAssignmentContacts)
            });
        }

        ancestorStack.push({ indent, assignmentContacts });
    }

    return tasks;
}

// Export for use in other modules
window.TaskParser = {
    normalizeState,
    extractBadges,
    getBadgeValue,
    getPriorityRank,
    getDueTimestamp,
    getDeadlineUrgency,
    getDueDateString,
    getTasksWithUrgency,
    getSourceOrderKey,
    stripBadges,
    isClosedTask,
    hasAssignee,
    hasMention,
    getAssignmentContacts,
    isOpenTask,
    isBlockedTask,
    isUnblockedTask,
    isUnassignedTask,
    hasUnassignedTasks,
    parseTasksFromBlock,
    parseTasksFromBlocks,
    parseTasksFromContent,
    PRIORITY_RANKS,
    UPCOMING_DAYS,
    KNOWN_BADGE_KEYS,
    CHECKBOX_REGEX,
    BADGE_REGEX
};
