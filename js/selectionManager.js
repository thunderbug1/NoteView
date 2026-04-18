/**
 * Selection Manager - Handles tag and contact selection state
 * Extracted from App to separate concerns
 */

const SelectionManager = {
    STORAGE_KEY: 'noteview-selection-state',

    // Selection state
    selections: {
        time: '',
        context: new Set(),
        excluded: new Set(),
        contact: ''
    },

    LONG_PRESS_MS: 400,

    // Context navigation history
    _historyStack: [],
    _historyIndex: -1,
    _historyDebounceTimer: null,
    _isHistoryNavigating: false,
    HISTORY_DEBOUNCE_MS: 500,
    HISTORY_MAX_ENTRIES: 50,

    computedContextTags: ['Todo.all', 'Todo.open', 'Todo.inProgress', 'Todo.done', 'Todo.blocked', 'Todo.canceled', 'Todo.unblocked', 'Status.untagged', 'Status.unassigned'],

    // Selecting a tag in an exclusion group removes all other tags in that group
    computedExclusionGroups: [
        ['Todo.all', 'Todo.open', 'Todo.inProgress', 'Todo.done', 'Todo.blocked', 'Todo.canceled', 'Todo.unblocked']
    ],

    /**
     * Initialize the selection manager
     */
    init() {
        console.log('[SelectionManager] init:start', {
            existingContext: Array.from(this.selections.context)
        });
        this.loadSelectionState();
        this.normalizeContextSelection();
        this.updateSelectionUI();
        this.initHistory();
        console.log('[SelectionManager] init:complete', {
            restoredContext: Array.from(this.selections.context)
        });
    },

    loadSelectionState() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            console.log('[SelectionManager] loadSelectionState:raw', raw);
            if (!raw) {
                return;
            }

            const parsed = JSON.parse(raw);
            let context = Array.isArray(parsed?.context) ? parsed.context : [];

            // Migrate old computed tag IDs to new dot-notation IDs
            const tagMigration = {
                'allTodos': 'Todo.all',
                'openTodos': 'Todo.open',
                'blockedTodos': 'Todo.blocked',
                'unblockedTodos': 'Todo.unblocked',
                'untagged': 'Status.untagged',
                'unassigned': 'Status.unassigned'
            };
            context = context.map(tag => tagMigration[tag] || tag);

            this.selections.context = new Set(context.filter(tag => typeof tag === 'string' && tag.trim() !== ''));

            let excluded = Array.isArray(parsed?.excluded) ? parsed.excluded : [];
            excluded = excluded.map(tag => tagMigration[tag] || tag);
            this.selections.excluded = new Set(excluded.filter(tag => typeof tag === 'string' && tag.trim() !== ''));

            console.log('[SelectionManager] loadSelectionState:parsed', {
                context: Array.from(this.selections.context),
                excluded: Array.from(this.selections.excluded)
            });
        } catch (error) {
            console.warn('Could not load selection state:', error);
            this.selections.context = new Set();
        }
    },

    saveSelectionState() {
        try {
            const payload = JSON.stringify({
                context: Array.from(this.selections.context),
                excluded: Array.from(this.selections.excluded)
            });
            localStorage.setItem(this.STORAGE_KEY, payload);
            console.log('[SelectionManager] saveSelectionState', payload);
        } catch (error) {
            console.warn('Could not save selection state:', error);
        }
        this.scheduleHistoryPush();
    },

    normalizeContextSelection() {
        const before = Array.from(this.selections.context);
        this.selections.context = new Set(
            Array.from(this.selections.context).filter(tag => typeof tag === 'string' && tag.trim() !== '')
        );
        this.selections.excluded = new Set(
            Array.from(this.selections.excluded).filter(tag => typeof tag === 'string' && tag.trim() !== '')
        );

        console.log('[SelectionManager] normalizeContextSelection', {
            before,
            after: Array.from(this.selections.context),
            excluded: Array.from(this.selections.excluded)
        });

        this.saveSelectionState();
    },

    /**
     * Set the time selection
     * @param {string} timeSelection - Time selection value
     */
    setTimeSelection(timeSelection) {
        this.selections.time = timeSelection;
        this.updateSelectionUI();
        this.scheduleHistoryPush();
    },

    /**
     * Get the current time selection
     * @returns {string} Current time selection
     */
    getTimeSelection() {
        return this.selections.time;
    },

    /**
     * Set the contact selection
     * @param {string} contact - Contact selection value
     */
    setContactSelection(contact) {
        this.selections.contact = contact;
        this.updateSelectionUI();
        this.scheduleHistoryPush();
    },

    /**
     * Get the current contact selection
     * @returns {string} Current contact selection
     */
    getContactSelection() {
        return this.selections.contact;
    },

    /**
     * Add a context tag to selections
     * @param {string} tag - Tag to add
     */
    addContextTag(tag) {
        console.log('[SelectionManager] addContextTag:before', {
            tag,
            context: Array.from(this.selections.context)
        });
        if (tag === 'Status.untagged') {
            this.selections.context.clear();
        } else {
            this.selections.context.delete('Status.untagged');
            for (const group of this.computedExclusionGroups) {
                if (group.includes(tag)) {
                    for (const t of group) {
                        if (t !== tag) this.selections.context.delete(t);
                    }
                }
            }
        }
        this.selections.context.add(tag);
        this.selections.excluded.delete(tag);
        this.saveSelectionState();
        this.updateSelectionUI();
        console.log('[SelectionManager] addContextTag:after', {
            tag,
            context: Array.from(this.selections.context)
        });
    },

    /**
     * Remove a context tag from selections
     * @param {string} tag - Tag to remove
     */
    removeContextTag(tag) {
        console.log('[SelectionManager] removeContextTag:before', {
            tag,
            context: Array.from(this.selections.context)
        });
        this.selections.context.delete(tag);
        this.saveSelectionState();
        this.updateSelectionUI();
        console.log('[SelectionManager] removeContextTag:after', {
            tag,
            context: Array.from(this.selections.context)
        });
    },

    /**
     * Toggle a context tag
     * @param {string} tag - Tag to toggle
     * @param {boolean} wasSelected - Whether the tag was previously selected
     */
    toggleContextTag(tag, wasSelected) {
        if (wasSelected) {
            this.removeContextTag(tag);
        } else {
            this.addContextTag(tag);
        }
    },

    /**
     * Add a tag to the excluded set (mutual exclusion with context)
     * @param {string} tag - Tag to exclude
     */
    addExcludedTag(tag) {
        this.selections.context.delete(tag);
        this.selections.excluded.add(tag);
        this.saveSelectionState();
        this.updateSelectionUI();
    },

    /**
     * Remove a tag from the excluded set
     * @param {string} tag - Tag to un-exclude
     */
    removeExcludedTag(tag) {
        this.selections.excluded.delete(tag);
        this.saveSelectionState();
        this.updateSelectionUI();
    },

    /**
     * Toggle a tag's excluded state
     * @param {string} tag - Tag to toggle
     * @param {boolean} wasExcluded - Whether the tag was previously excluded
     */
    toggleExcludedTag(tag, wasExcluded) {
        if (wasExcluded) {
            this.removeExcludedTag(tag);
        } else {
            this.addExcludedTag(tag);
        }
    },

    /**
     * Get all context tags
     * @returns {Array} Array of context tags
     */
    getContextTags() {
        return Array.from(this.selections.context);
    },

    /**
     * Clear all context tags
     */
    clearContextTags() {
        this.selections.context.clear();
        this.selections.excluded.clear();
        this.saveSelectionState();
        this.updateSelectionUI();
    },

    /**
     * Clear all active filters (context, excluded, time, contact, search)
     */
    clearAllFilters() {
        this.selections.context.clear();
        this.selections.excluded.clear();
        this.selections.time = '';
        this.selections.contact = '';
        Store.searchQuery = '';
        this.saveSelectionState();
        this.updateSelectionUI();
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';
    },

    /**
     * Capture current selections as a serializable snapshot
     * @returns {Object} Snapshot with context, excluded, time, contact
     */
    _snapshotSelections() {
        return {
            context: Array.from(this.selections.context).sort(),
            excluded: Array.from(this.selections.excluded).sort(),
            time: this.selections.time || '',
            contact: this.selections.contact || ''
        };
    },

    /**
     * Deep-compare two snapshots
     * @param {Object} a
     * @param {Object} b
     * @returns {boolean}
     */
    _snapshotsEqual(a, b) {
        return JSON.stringify(a) === JSON.stringify(b);
    },

    /**
     * Initialize the context navigation history stack
     */
    initHistory() {
        this._historyStack = [];
        this._historyIndex = -1;
        this._historyDebounceTimer = null;
        this._isHistoryNavigating = false;
        const snapshot = this._snapshotSelections();
        this._historyStack.push(snapshot);
        this._historyIndex = 0;
    },

    /**
     * Schedule a debounced history push. Resets timer on each call.
     * No-ops during navigation restore.
     */
    scheduleHistoryPush() {
        if (this._isHistoryNavigating) return;
        if (this._historyDebounceTimer) {
            clearTimeout(this._historyDebounceTimer);
        }
        this._historyDebounceTimer = setTimeout(() => {
            this._pushHistory();
        }, this.HISTORY_DEBOUNCE_MS);
    },

    /**
     * Push current selections onto the history stack (called after debounce)
     */
    _pushHistory() {
        this._historyDebounceTimer = null;
        const snapshot = this._snapshotSelections();

        // Skip if identical to current entry
        if (this._historyIndex >= 0 &&
            this._snapshotsEqual(snapshot, this._historyStack[this._historyIndex])) {
            return;
        }

        // Truncate forward history
        this._historyStack = this._historyStack.slice(0, this._historyIndex + 1);

        // Push new entry
        this._historyStack.push(snapshot);

        // Trim to max size
        if (this._historyStack.length > this.HISTORY_MAX_ENTRIES) {
            this._historyStack.shift();
        }

        this._historyIndex = this._historyStack.length - 1;
    },

    /**
     * Navigate to the previous context selection
     */
    historyBack() {
        if (this._historyIndex <= 0) return;
        this._historyIndex--;
        this._restoreHistoryEntry(this._historyStack[this._historyIndex]);
    },

    /**
     * Navigate to the next context selection
     */
    historyForward() {
        if (this._historyIndex >= this._historyStack.length - 1) return;
        this._historyIndex++;
        this._restoreHistoryEntry(this._historyStack[this._historyIndex]);
    },

    /**
     * Restore a snapshot to the live selections and re-render
     * @param {Object} entry - Snapshot to restore
     */
    _restoreHistoryEntry(entry) {
        this._isHistoryNavigating = true;
        try {
            this.selections.context = new Set(entry.context);
            this.selections.excluded = new Set(entry.excluded);
            this.selections.time = entry.time;
            this.selections.contact = entry.contact;
            this.saveSelectionState();
            this.updateSelectionUI();
            this.renderContextSidebar();
            App.render();
        } finally {
            this._isHistoryNavigating = false;
        }
    },

    /**
     * Whether the history stack can navigate back
     * @returns {boolean}
     */
    canGoBack() {
        return this._historyIndex > 0;
    },

    /**
     * Whether the history stack can navigate forward
     * @returns {boolean}
     */
    canGoForward() {
        return this._historyIndex < this._historyStack.length - 1;
    },

    /**
     * Get computed context tags
     * @returns {Array} Computed context tag ids
     */
    getComputedContextTags() {
        return [...this.computedContextTags];
    },

    /**
     * Check whether a context tag is computed
     * @param {string} tag - Context tag id
     * @returns {boolean} True when the tag is computed
     */
    isComputedContextTag(tag) {
        return this.computedContextTags.includes(tag);
    },

    /**
     * Get active context tags (excluding computed tags)
     * @returns {Array} Array of active context tags
     */
    getActiveTags() {
        return Array.from(this.selections.context).filter(tag =>
            !this.isComputedContextTag(tag) && !tag.startsWith('path:')
        );
    },

    /**
     * Expand group path selections into their actual tag strings
     * @returns {string[]} All tags covered by direct selections + group path selections
     */
    getExpandedActiveTags() {
        const result = new Set();
        const allTags = this.getAllContextTags();

        for (const item of this.selections.context) {
            if (this.isComputedContextTag(item)) continue;
            if (item.startsWith('path:')) {
                const group = item.slice(5);
                // Match tags whose group segment equals this prefix (single-level)
                allTags.forEach(tag => {
                    const { segments } = Common.parseHierarchicalTag(tag);
                    if (segments.length > 0 && segments[0] === group) {
                        result.add(tag);
                    }
                });
            } else {
                result.add(item);
            }
        }
        return Array.from(result);
    },

    /**
     * Get display name for a tag
     * @param {string} tag - Tag to get display name for
     * @returns {string} Display name
     */
    getTagDisplayName(tag) {
        const displayNames = {
            'work': 'Work',
            'personal': 'Personal',
            'ideas': 'Ideas',
            'today': 'Today',
            'thisWeek': 'This Week',
            'thisMonth': 'This Month'
        };
        if (displayNames[tag]) return displayNames[tag];
        return Common.formatTagDisplay(tag);
    },

    /**
     * Get all context tags from UI and Store
     * @returns {Array} Sorted array of all context tags
     */
    getAllContextTags() {
        const tags = new Set();
        Store.blocks.forEach(b => {
            (b.tags || []).forEach(t => tags.add(t));
        });
        return Array.from(tags).sort();
    },

    /**
     * Add a new context tag to the UI (for tags created in the modal)
     * @param {string} tag - Tag to add
     */
    addContextTagToUI(tag) {
        this.renderContextSidebar();
    },

    /**
     * Render the vault-derived context tags in the sidebar
     */
    renderContextSidebar() {
        const userContainer = document.getElementById('contextTags');
        const computedContainer = document.getElementById('computedTags');
        if (!userContainer) return;

        const selectedCustomTags = Array.from(this.selections.context)
            .filter(tag => !this.isComputedContextTag(tag));
        const userTags = Array.from(new Set([
            ...this.getAllContextTags(),
            ...selectedCustomTags
        ])).sort();

        const computedTags = this.getComputedContextTags();

        console.log('[SelectionManager] renderContextSidebar', {
            userTags,
            computedTags,
            selectedContext: Array.from(this.selections.context)
        });

        // Render user tags
        this._renderTagList(userContainer, userTags, false);
        // Render computed tags
        if (computedContainer) {
            this._renderTagList(computedContainer, computedTags, true);
        }
    },

    /**
     * Render a list of tags into a container, grouping by single-level hierarchy
     * @param {HTMLElement} container - Target container
     * @param {string[]} tags - Tags to render
     * @param {boolean} isComputedSection - Whether this is the computed tags section
     */
    _renderTagList(container, tags, isComputedSection) {
        if (tags.length === 0) {
            container.innerHTML = isComputedSection
                ? ''
                : '<div style="color:var(--text-muted); font-size:12px; padding:4px 8px;">No tags found in this vault</div>';
            return;
        }

        const { groups, flat } = Common.buildTagTree(tags);

        let html = '';

        // Render groups (single-level)
        groups.forEach((groupTags, groupName) => {
            const pathKey = 'path:' + groupName;
            const groupSelected = this.selections.context.has(pathKey);
            const hasSelected = groupTags.some(t => this.selections.context.has(t));
            const expandedClass = 'expanded';

            const groupClasses = ['tag-group-hierarchy', expandedClass];
            if (groupSelected) groupClasses.push('group-selected');

            html += `<div class="${groupClasses.join(' ')}" data-group-path="${groupName}">`;
            html += `<div class="tag-group-parent">`;
            html += `<span class="tag-group-toggle">&#9654;</span>`;
            html += `<span class="tag-group-name">${Common.capitalizeFirst(groupName)}</span>`;
            html += `</div>`;
            html += `<div class="tag-group-children">`;

            groupTags.forEach(tag => {
                const directlySelected = this.selections.context.has(tag);
                const isExcluded = this.selections.excluded.has(tag);
                const coveredByGroup = !isComputedSection && !directlySelected && groupSelected;
                const isSelected = isComputedSection
                    ? this.selections.context.has(tag)
                    : (directlySelected || coveredByGroup);
                const selClass = isSelected ? 'selected' : '';
                const exclClass = isExcluded ? 'excluded' : '';
                const groupMatchClass = coveredByGroup ? 'group-match' : '';
                const computedClass = isComputedSection ? 'computed' : '';

                html += `<div class="tag-radio-option ${selClass} ${exclClass} ${groupMatchClass} ${computedClass}" data-group="context" data-tag="${tag}">`;
                html += `<span class="tag-badge">${this.getTagDisplayName(tag)}</span>`;
                html += `</div>`;
            });

            html += `</div></div>`;
        });

        // Render flat tags
        flat.forEach(tag => {
            const isSelected = this.selections.context.has(tag);
            const isExcluded = this.selections.excluded.has(tag);
            const selClass = isSelected ? 'selected' : '';
            const exclClass = isExcluded ? 'excluded' : '';
            const computedClass = isComputedSection ? 'computed' : '';

            html += `<div class="tag-radio-option ${selClass} ${exclClass} ${computedClass}" data-group="context" data-tag="${tag}">`;
            html += `<span class="tag-badge">${this.getTagDisplayName(tag)}</span>`;
            html += `</div>`;
        });

        container.innerHTML = html;

        // Attach tag click/long-press/shift-click handlers
        container.querySelectorAll('.tag-radio-option').forEach(option => {
            let pressTimer = null;
            let longPressed = false;

            // Suppress browser context menu on tag badges
            option.addEventListener('contextmenu', (e) => e.preventDefault());

            option.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return; // Only primary button
                if (e.shiftKey) return; // Let shift+click handle via click handler
                longPressed = false;
                pressTimer = setTimeout(() => {
                    longPressed = true;
                    const tag = option.dataset.tag;
                    const wasExcluded = this.selections.excluded.has(tag);
                    this.toggleExcludedTag(tag, wasExcluded);
                    this.renderContextSidebar();
                    App.render();
                }, this.LONG_PRESS_MS);
            });

            const cancelPress = () => {
                if (pressTimer) {
                    clearTimeout(pressTimer);
                    pressTimer = null;
                }
            };

            option.addEventListener('pointerup', cancelPress);
            option.addEventListener('pointerleave', cancelPress);
            option.addEventListener('pointercancel', cancelPress);

            option.addEventListener('click', (e) => {
                e.stopPropagation();
                if (longPressed) {
                    longPressed = false;
                    return;
                }

                const tag = option.dataset.tag;

                // Shift+click: toggle exclusion
                if (e.shiftKey) {
                    const wasExcluded = this.selections.excluded.has(tag);
                    this.toggleExcludedTag(tag, wasExcluded);
                    this.renderContextSidebar();
                    App.render();
                    return;
                }

                const directlySelected = this.selections.context.has(tag);
                const isExcluded = this.selections.excluded.has(tag);

                if (isExcluded) {
                    this.addContextTag(tag);
                } else if (directlySelected) {
                    this.selections.context.delete(tag);
                    this.saveSelectionState();
                } else {
                    this.addContextTag(tag);
                    this.saveSelectionState();
                }

                this.renderContextSidebar();
                App.render();
            });
        });

        // Attach group header handlers: arrow = toggle expand, name = select group
        container.querySelectorAll('.tag-group-parent').forEach(parentEl => {
            // Arrow toggle
            const toggleEl = parentEl.querySelector('.tag-group-toggle');
            if (toggleEl) {
                toggleEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    parentEl.closest('.tag-group-hierarchy').classList.toggle('expanded');
                });
            }

            // Name click = toggle group as a whole
            const nameEl = parentEl.querySelector('.tag-group-name');
            if (nameEl) {
                nameEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const groupEl = parentEl.closest('.tag-group-hierarchy');
                    const groupPath = groupEl.dataset.groupPath;
                    const pathKey = 'path:' + groupPath;

                    if (isComputedSection) {
                        // Computed groups: toggle all tags individually
                        const allTags = Array.from(groupEl.querySelectorAll(':scope > .tag-group-children > .tag-radio-option'))
                            .map(opt => opt.dataset.tag);
                        const allSelected = allTags.every(t => this.selections.context.has(t));

                        if (allSelected) {
                            allTags.forEach(t => this.selections.context.delete(t));
                        } else {
                            allTags.forEach(t => this.selections.context.add(t));
                        }
                    } else {
                        // User tag groups: toggle as a path entry (OR filter)
                        if (this.selections.context.has(pathKey)) {
                            this.selections.context.delete(pathKey);
                        } else {
                            this.selections.context.add(pathKey);
                        }
                    }

                    this.saveSelectionState();
                    this.renderContextSidebar();
                    App.render();
                });
            }
        });
    },

    /**
     * Update the UI to reflect current selections
     */
    updateSelectionUI() {
        document.querySelectorAll('.tag-radio-option').forEach(option => {
            const group = option.dataset.group;
            const tag = option.dataset.tag;

            let isSelected = false;
            let isGroupMatch = false;
            let isExcluded = false;

            if (group === 'time') {
                isSelected = this.selections.time === tag;
            } else if (group === 'context') {
                const directlySelected = this.selections.context.has(tag);
                isExcluded = this.selections.excluded.has(tag);
                isSelected = directlySelected;
                // Also check if a parent group path covers this tag
                if (!directlySelected && !this.isComputedContextTag(tag)) {
                    const { segments } = Common.parseHierarchicalTag(tag);
                    if (segments.length > 0 && this.selections.context.has('path:' + segments[0])) {
                        isSelected = true;
                        isGroupMatch = true;
                    }
                }
            } else if (group === 'contact') {
                isSelected = this.selections.contact === tag;
            } else if (group === 'view') {
                isSelected = Store.currentView === tag;
            }

            option.classList.toggle('selected', isSelected);
            option.classList.toggle('group-match', isGroupMatch);
            option.classList.toggle('excluded', isExcluded);
        });
    },

    /**
     * Update tag counts and dim unused tags (optimized to avoid full re-render)
     */
    updateTagCounts() {
        const tagCounts = {};
        let hasAllTodos = false;
        let hasOpenTodos = false;
        let hasInProgressTodos = false;
        let hasDoneTodos = false;
        let hasBlockedTodos = false;
        let hasCanceledTodos = false;
        let hasUnblockedTodos = false;
        let hasUntagged = false;
        let hasUnassigned = false;

        let hasToday = false;
        let hasThisWeek = false;
        let hasThisMonth = false;

        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);

        const currentProp = Store.timeProperty || 'lastUpdated';

        Store.blocks.forEach(block => {
            (block.tags || []).forEach(tag => {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            });
            if (block.content && block.content.match(/\[[ xX\/bB\-]\]/)) hasAllTodos = true;
            if (block.content && block.content.match(/\[[ \/]\]/)) hasOpenTodos = true;
            
            // New computed categories
            const tasks = TaskParser.parseTasksFromBlock(block);
            const hasBlocked = tasks.some(t => TaskParser.isBlockedTask(t));
            const hasUnblocked = tasks.some(t => TaskParser.isUnblockedTask(t));
            const hasUnassignedTasks = TaskParser.hasUnassignedTasks(tasks);
            const hasDone = tasks.some(t => TaskParser.isDoneTask(t));
            const hasInProgress = tasks.some(t => TaskParser.isInProgressTask(t));
            const hasCanceled = tasks.some(t => TaskParser.isCanceledTask(t));

            if (hasBlocked) hasBlockedTodos = true;
            if (hasUnblocked) hasUnblockedTodos = true;
            if (hasUnassignedTasks) hasUnassigned = true;
            if (hasDone) hasDoneTodos = true;
            if (hasInProgress) hasInProgressTodos = true;
            if (hasCanceled) hasCanceledTodos = true;
            
            if (!block.tags || block.tags.length === 0) hasUntagged = true;

            const dateVal = block[currentProp];
            if (dateVal) {
                const bDate = new Date(dateVal);
                if (bDate.toDateString() === now.toDateString()) hasToday = true;
                if (bDate >= startOfWeek) hasThisWeek = true;
                if (bDate.getFullYear() === now.getFullYear() && bDate.getMonth() === now.getMonth()) hasThisMonth = true;
            }
        });

        this.renderContextSidebar();

        // Optimized update: only modify opacity, don't re-render entire DOM
        document.querySelectorAll('.tag-radio-option').forEach(option => {
            const group = option.dataset.group;
            if (group === 'view') return;

            const tag = option.dataset.tag;
            let hasBlocks = false;

            if (group === 'time') {
                if (tag === '') hasBlocks = true;
                else if (tag === 'today') hasBlocks = hasToday;
                else if (tag === 'thisWeek') hasBlocks = hasThisWeek;
                else if (tag === 'thisMonth') hasBlocks = hasThisMonth;
            } else {
                if (tag === 'Todo.all') hasBlocks = hasAllTodos;
                else if (tag === 'Todo.open') hasBlocks = hasOpenTodos;
                else if (tag === 'Todo.inProgress') hasBlocks = hasInProgressTodos;
                else if (tag === 'Todo.done') hasBlocks = hasDoneTodos;
                else if (tag === 'Todo.blocked') hasBlocks = hasBlockedTodos;
                else if (tag === 'Todo.canceled') hasBlocks = hasCanceledTodos;
                else if (tag === 'Todo.unblocked') hasBlocks = hasUnblockedTodos;
                else if (tag === 'Status.untagged') hasBlocks = hasUntagged;
                else if (tag === 'Status.unassigned') hasBlocks = hasUnassigned;
                else hasBlocks = tag === '' || (tagCounts[tag] || 0) > 0;
            }

            // Only update opacity if it needs to change (avoid DOM thrashing)
            const newOpacity = (!hasBlocks && !option.classList.contains('selected')) ? '0.4' : '1';
            if (option.style.opacity !== newOpacity) {
                option.style.opacity = newOpacity;
            }
        });

        // Populate and dim contacts
        this.renderContactsSidebar();
    },

    /**
     * Render the contacts sidebar with proper opacity based on context matches
     */
    renderContactsSidebar() {
        const container = document.getElementById('contactTags');
        if (!container) return;

        const allContacts = Array.from(Store.contacts.keys());
        const selectedContext = this.getExpandedActiveTags();

        allContacts.sort((a, b) => {
            const aTags = Store.contacts.get(a);
            const bTags = Store.contacts.get(b);
            const aMatchCount = selectedContext.filter(t => aTags.has(t)).length;
            const bMatchCount = selectedContext.filter(t => bTags.has(t)).length;

            if (aMatchCount !== bMatchCount) return bMatchCount - aMatchCount;
            return a.localeCompare(b);
        });

        let html = '';
        allContacts.forEach(contact => {
            const contactTags = Store.contacts.get(contact);
            const hasMatch = selectedContext.length === 0 || selectedContext.some(t => contactTags.has(t));
            const isSelected = this.selections.contact === contact;

            const opacity = hasMatch || isSelected ? '1' : '0.4';
            const selClass = isSelected ? 'selected' : '';

            html += `
                <div class="tag-radio-option ${selClass}" data-group="contact" data-tag="${contact}" style="opacity: ${opacity}">
                    <span class="tag-badge">@${contact}</span>
                </div>
            `;
        });

        if (allContacts.length === 0) {
            html = '<div style="color:var(--text-muted); font-size:12px; padding:4px 8px;">Mention @someone or add [assignee:: name] to a task</div>';
        }

        container.innerHTML = html;

        container.querySelectorAll('.tag-radio-option').forEach(option => {
            option.addEventListener('click', () => {
                const tag = option.dataset.tag;
                const wasSelected = option.classList.contains('selected');

                if (wasSelected) {
                    this.setContactSelection('');
                } else {
                    this.setContactSelection(tag);
                }
                App.render();
            });
        });
    }
};

window.SelectionManager = SelectionManager;
