/**
 * Selection Manager - Handles tag and contact selection state
 * Extracted from App to separate concerns
 */

const SelectionManager = {
    STORAGE_KEY: 'noteview-selection-state',

    // Render generation counter to cancel stale long-press timers
    _renderGen: 0,

    // Selection state
    selections: {
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
    HISTORY_DEBOUNCE_MS: 3000,
    HISTORY_MAX_ENTRIES: 50,

    // Computed tag prefix for dynamic recognition
    // Time.* tags are generated dynamically; Todo.* and Status.* are static
    _dynamicTimeTags: [],

    // Selecting a Time.* tag removes all other Time.* tags; same for Todo.*
    // Handled via prefix-based exclusion in addContextTag()

    // Archived tags state
    _archivedTags: new Set(),
    _archiveExpanded: false,

    /**
     * Initialize the selection manager
     */
    init(options = {}) {
        Logger.log('[SelectionManager] init:start', {
            existingContext: Array.from(this.selections.context),
            options
        });
        if (options.isSwitch) {
            this.selections.context.clear();
            this.selections.excluded.clear();
            this.selections.contact = '';
            this.saveSelectionState();
            if (this._historyDebounceTimer) {
                clearTimeout(this._historyDebounceTimer);
                this._historyDebounceTimer = null;
            }
            this._pushHistory();
        } else {
            this.loadSelectionState();
            this.initHistory();
        }
        this.normalizeContextSelection();
        this.updateSelectionUI();
        this.initClearContextBtn();
        this.initContextNavBtns();
        this.initTimePropertySelect();
        this.loadArchivedTags().then(() => {
            this.generateDynamicTimeTags();
            this.renderContextSidebar();
            this.initArchiveToggle();
        });
        Logger.log('[SelectionManager] init:complete', {
            restoredContext: Array.from(this.selections.context)
        });
    },

    loadSelectionState() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            Logger.log('[SelectionManager] loadSelectionState:raw', raw);
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
                'unassigned': 'Todo.unassigned'
            };
            context = context.map(tag => tagMigration[tag] || tag)
                .map(tag => tag === 'Status.unassigned' ? 'Todo.unassigned' : tag)
                .filter(tag => tag !== 'Todo.all');

            this.selections.context = new Set(context.filter(tag => typeof tag === 'string' && tag.trim() !== ''));

            let excluded = Array.isArray(parsed?.excluded) ? parsed.excluded : [];
            excluded = excluded.map(tag => tagMigration[tag] || tag);
            this.selections.excluded = new Set(excluded.filter(tag => typeof tag === 'string' && tag.trim() !== ''));

            // Migrate old time selection to context
            if (parsed?.time && typeof parsed.time === 'string' && parsed.time.trim() !== '') {
                const timeMigration = { 'today': 'Time.today', 'thisWeek': 'Time.thisWeek', 'thisMonth': 'Time.thisMonth' };
                const migrated = timeMigration[parsed.time];
                if (migrated) this.selections.context.add(migrated);
            }
            Logger.log('[SelectionManager] loadSelectionState:parsed', {
                context: Array.from(this.selections.context),
                excluded: Array.from(this.selections.excluded)
            });
        } catch (error) {
            console.warn('Could not load selection state:', error);
            this.selections.context = new Set();
            this.selections.excluded = new Set();
        }
    },

    saveSelectionState() {
        try {
            const payload = JSON.stringify({
                context: Array.from(this.selections.context),
                excluded: Array.from(this.selections.excluded)
            });
            localStorage.setItem(this.STORAGE_KEY, payload);
            Logger.log('[SelectionManager] saveSelectionState', payload);
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

        Logger.log('[SelectionManager] normalizeContextSelection', {
            before,
            after: Array.from(this.selections.context),
            excluded: Array.from(this.selections.excluded)
        });

        this.saveSelectionState();
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
        Logger.log('[SelectionManager] addContextTag:before', {
            tag,
            context: Array.from(this.selections.context)
        });
        if (tag === 'Status.untagged') {
            for (const t of Array.from(this.selections.context)) {
                if (this.isComputedContextTag(t)) this.selections.context.delete(t);
            }
        } else {
            this.selections.context.delete('Status.untagged');
            // Prefix-based exclusion: Time.* excludes other Time.*, Todo.* excludes other Todo.*
            if (tag.startsWith('Time.')) {
                for (const t of Array.from(this.selections.context)) {
                    if (t.startsWith('Time.') && t !== tag) this.selections.context.delete(t);
                }
            } else if (tag.startsWith('Todo.')) {
                for (const t of Array.from(this.selections.context)) {
                    if (t.startsWith('Todo.') && t !== tag) this.selections.context.delete(t);
                }
            }
        }
        this.selections.context.add(tag);
        this.selections.excluded.delete(tag);
        this.saveSelectionState();
        this.updateSelectionUI();
        Logger.log('[SelectionManager] addContextTag:after', {
            tag,
            context: Array.from(this.selections.context)
        });
    },

    /**
     * Remove a context tag from selections
     * @param {string} tag - Tag to remove
     */
    removeContextTag(tag) {
        Logger.log('[SelectionManager] removeContextTag:before', {
            tag,
            context: Array.from(this.selections.context)
        });
        this.selections.context.delete(tag);
        this.saveSelectionState();
        this.updateSelectionUI();
        Logger.log('[SelectionManager] removeContextTag:after', {
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
     * Initialize the clear context button
     */
    initClearContextBtn() {
        const btn = document.getElementById('clearContextBtn');
        if (btn) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.clearContextTags();
                App.render();
            });
        }
    },

    initContextNavBtns() {
        const backBtn = document.getElementById('contextBackBtn');
        const forwardBtn = document.getElementById('contextForwardBtn');
        if (backBtn) {
            backBtn.addEventListener('click', () => this.historyBack());
        }
        if (forwardBtn) {
            forwardBtn.addEventListener('click', () => this.historyForward());
        }
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
            // Migrate old time entry to context
            if (entry.time && typeof entry.time === 'string' && entry.time.trim() !== '') {
                const timeMigration = { 'today': 'Time.today', 'thisWeek': 'Time.thisWeek', 'thisMonth': 'Time.thisMonth' };
                const migrated = timeMigration[entry.time];
                if (migrated) this.selections.context.add(migrated);
            }
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
        // Return non-time computed tags (Todo.*, Status.*)
        return [
            'Todo.open', 'Todo.inProgress', 'Todo.done', 'Todo.blocked',
            'Todo.canceled', 'Todo.unblocked', 'Todo.unassigned', 'Status.untagged'
        ];
    },

    /**
     * Get all time tags (static relative + dynamic quarter/year + active date/range)
     * @returns {string[]} Array of Time.* tags
     */
    getTimeTags() {
        return [...TimeFilter.RELATIVE_TIME_TAGS, ...this._dynamicTimeTags];
    },

    /**
     * Generate dynamic time tags from vault block data
     */
    generateDynamicTimeTags() {
        const dateProperty = Store.timeProperty || 'lastUpdated';
        this._dynamicTimeTags = TimeFilter.generateDynamicTimeTags(Store.blocks, dateProperty);
    },

    /**
     * Initialize the time property dropdown
     */
    initTimePropertySelect() {
        const select = document.getElementById('timePropertySelect');
        if (!select) return;
        select.value = Store.timeProperty || 'lastUpdated';
        select.addEventListener('change', () => {
            Store.timeProperty = select.value;
            Store._filteredBlocksCache.invalidate();
            this.generateDynamicTimeTags();
            this.renderContextSidebar();
            App.render();
        });
    },

    /**
     * Check whether a context tag is computed
     * @param {string} tag - Context tag id
     * @returns {boolean} True when the tag is computed
     */
    isComputedContextTag(tag) {
        return tag.startsWith('Time.') || tag.startsWith('Todo.') || tag === 'Status.untagged';
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
     * Get tags to assign to a new note based on current selection.
     * For group path selections, includes the group name as a tag.
     */
    getTagsForNewNote() {
        const result = new Set();

        for (const item of this.selections.context) {
            if (this.isComputedContextTag(item)) continue;
            if (item.startsWith('path:')) {
                result.add(item.slice(5).toLowerCase());
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
        if (tag.startsWith('Time.')) return TimeFilter.getTimeTagDisplayName(tag);
        const displayNames = {
            'work': 'Work',
            'personal': 'Personal',
            'ideas': 'Ideas'
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

    // --- Archived tag management ---

    async loadArchivedTags() {
        const tags = await AppSettings.getArchivedTags();
        this._archivedTags = new Set(tags);
    },

    initArchiveToggle() {
        const header = document.querySelector('.archive-section-toggle');
        if (!header) return;
        header.addEventListener('click', () => {
            this._archiveExpanded = !this._archiveExpanded;
            const container = document.getElementById('archivedTags');
            const toggle = header.querySelector('.tag-group-toggle');
            if (this._archiveExpanded) {
                container.style.display = '';
                if (toggle) toggle.textContent = '▼';
            } else {
                container.style.display = 'none';
                if (toggle) toggle.textContent = '▶';
            }
        });
    },

    async _toggleTagArchive(tag) {
        const updated = new Set(this._archivedTags);
        if (updated.has(tag)) {
            updated.delete(tag);
        } else {
            updated.add(tag);
        }
        await AppSettings.setArchivedTags(Array.from(updated));
        this._archivedTags = updated;
        this.renderContextSidebar();
    },

    _showTagContextMenu(e, tag) {
        this._closeTagContextMenu();

        if (this.isComputedContextTag(tag)) return;

        const isArchived = this._archivedTags.has(tag);
        const label = isArchived ? 'Unarchive tag' : 'Archive tag';

        const menu = document.createElement('div');
        menu.className = 'task-context-menu tag-context-menu';
        menu.setAttribute('role', 'menu');
        menu.innerHTML = `
            <div class="menu-item" data-action="archive" role="menuitem" tabindex="-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:0.5rem">
                    ${isArchived
                        ? '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>'
                        : '<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>'
                    }
                </svg>
                ${label}
            </div>
        `;

        menu.style.left = `${Math.min(e.clientX, window.innerWidth - 220)}px`;
        menu.style.top = `${Math.min(e.clientY, window.innerHeight - 60)}px`;
        document.body.appendChild(menu);

        requestAnimationFrame(() => {
            const menuRect = menu.getBoundingClientRect();
            if (menuRect.bottom > window.innerHeight) {
                menu.style.top = `${e.clientY - menuRect.height - 4}px`;
            }
            const firstItem = menu.querySelector('[role="menuitem"]');
            if (firstItem) firstItem.focus();
        });

        const closeHandler = (evt) => {
            if (!menu.contains(evt.target)) {
                this._closeTagContextMenu();
            }
        };

        const handleAction = async (evt) => {
            const item = evt.target.closest('.menu-item');
            if (!item) return;
            if (item.dataset.action === 'archive') {
                await this._toggleTagArchive(tag);
            }
            this._closeTagContextMenu();
        };

        menu.addEventListener('click', handleAction);
        document.addEventListener('click', closeHandler);

        menu._cleanup = () => {
            menu.removeEventListener('click', handleAction);
            document.removeEventListener('click', closeHandler);
        };
    },

    _closeTagContextMenu() {
        const existing = document.querySelector('.tag-context-menu');
        if (existing) {
            if (existing._cleanup) existing._cleanup();
            existing.remove();
        }
    },

    /**
     * Render the vault-derived context tags in the sidebar
     */
    renderContextSidebar() {
        const userContainer = document.getElementById('contextTags');
        const computedContainer = document.getElementById('computedTags');
        const timeContainer = document.getElementById('timeTags');
        if (!userContainer) return;

        const selectedCustomTags = Array.from(this.selections.context)
            .filter(tag => !this.isComputedContextTag(tag) && !tag.startsWith('path:'));
        const userTags = Array.from(new Set([
            ...this.getAllContextTags(),
            ...selectedCustomTags
        ])).sort();

        const computedTags = this.getComputedContextTags();
        const timeTags = this.getTimeTags();

        Logger.log('[SelectionManager] renderContextSidebar', {
            userTags,
            computedTags,
            timeTags,
            selectedContext: Array.from(this.selections.context)
        });

        // Split user tags into active and archived
        const activeUserTags = userTags.filter(tag => !this._archivedTags.has(tag));
        const archivedUserTags = userTags.filter(tag => this._archivedTags.has(tag));

        // Render active user tags
        this._renderTagList(userContainer, activeUserTags, false);
        // Render time tags into their own section
        if (timeContainer) {
            this._renderTimeTagList(timeContainer, timeTags);
        }
        // Render computed tags (Todo.*, Status.*)
        if (computedContainer) {
            this._renderTagList(computedContainer, computedTags, true);
        }

        // Render archived tags
        const archivedContainer = document.getElementById('archivedTags');
        const archivedGroup = document.getElementById('archivedTagGroup');
        if (archivedContainer && archivedGroup) {
            if (archivedUserTags.length > 0) {
                archivedGroup.style.display = '';
                this._renderTagList(archivedContainer, archivedUserTags, false, true);
            } else {
                archivedGroup.style.display = 'none';
            }
        }
    },

    /**
     * Render time tags into a container with collapsible category groups
     * @param {HTMLElement} container - Target container
     * @param {string[]} tags - Time.* tags to render
     */
    _renderTimeTagList(container, tags) {
        const gen = ++this._renderGen;
        if (tags.length === 0) {
            container.innerHTML = '<div style="color:var(--text-muted); font-size:12px; padding:4px 8px;">No time filters</div>';
            return;
        }

        const { groups, flat } = Common.buildMultiLevelTagTree(tags, 2);
        let html = '';

        // Quick tags — flat, no group wrapper
        const timeEntry = groups.get('Time');
        const quickTags = timeEntry ? timeEntry.leaves : [];
        quickTags.forEach(tag => {
            const isSelected = this.selections.context.has(tag);
            const selClass = isSelected ? 'selected' : '';
            html += `<div class="tag-radio-option ${selClass} computed" data-group="context" data-tag="${escapeHtml(tag)}">`;
            html += `<span class="tag-badge">${escapeHtml(this.getTagDisplayName(tag))}</span>`;
            html += `</div>`;
        });

        // Check if any non-quick time tag is active (to auto-expand "More options")
        const activeTime = TimeFilter.deriveTimeSelectionFromContext(this.selections.context);
        const hasActiveNonQuick = activeTime && !quickTags.includes(activeTime);
        const moreExpandedClass = hasActiveNonQuick ? 'expanded' : '';

        // "More options" collapsible — contains quarters, years, range picker
        html += `<div class="tag-group-hierarchy ${moreExpandedClass}" data-group-path="__time_more">`;
        html += `<div class="tag-group-parent">`;
        html += `<span class="tag-group-toggle">&#9654;</span>`;
        html += `<span class="tag-group-name">More options</span>`;
        html += `</div>`;
        html += `<div class="tag-group-children">`;

        // Subgroups (quarter, year)
        if (timeEntry) {
            timeEntry.subgroups.forEach((subTags, subName) => {
                const hasActiveSelection = subTags.some(t => this.selections.context.has(t));
                const subExpandedClass = hasActiveSelection ? 'expanded' : '';
                const label = TimeFilter.TIME_CATEGORY_LABELS[subName] || Common.capitalizeFirst(subName);

                html += `<div class="tag-group-hierarchy ${subExpandedClass}" data-group-path="__time_${subName}">`;
                html += `<div class="tag-group-parent">`;
                html += `<span class="tag-group-toggle">&#9654;</span>`;
                html += `<span class="tag-group-name">${escapeHtml(label)}</span>`;
                html += `</div>`;
                html += `<div class="tag-group-children">`;
                subTags.forEach(tag => {
                    const isSelected = this.selections.context.has(tag);
                    const selClass = isSelected ? 'selected' : '';
                    html += `<div class="tag-radio-option ${selClass} computed" data-group="context" data-tag="${escapeHtml(tag)}">`;
                    html += `<span class="tag-badge">${escapeHtml(this.getTagDisplayName(tag))}</span>`;
                    html += `</div>`;
                });
                html += `</div></div>`;
            });
        }

        // Range picker inside "More options"
        const hasRange = activeTime && activeTime.startsWith('Time.range.');
        const rangeStartVal = hasRange ? activeTime.slice('Time.range.'.length).split('..')[0] : '';
        const rangeEndVal = hasRange ? activeTime.slice('Time.range.'.length).split('..')[1] : '';
        const rangeHighlightClass = hasRange ? 'time-picker-active' : '';

        html += `<div class="tag-group-hierarchy ${hasRange ? 'expanded' : ''}" data-group-path="__time_range_picker">`;
        html += `<div class="tag-group-parent">`;
        html += `<span class="tag-group-toggle">&#9654;</span>`;
        html += `<span class="tag-group-name">Date Range</span>`;
        html += `</div>`;
        html += `<div class="tag-group-children">`;
        html += `<div class="time-date-picker ${rangeHighlightClass}">`;
        html += `<input type="date" class="time-range-start" value="${escapeHtml(rangeStartVal)}" title="Start date">`;
        html += `<span style="font-size:0.65rem;color:var(--text-muted);">–</span>`;
        html += `<input type="date" class="time-range-end" value="${escapeHtml(rangeEndVal)}" title="End date">`;
        html += `</div>`;
        html += `</div></div>`;

        html += `</div></div>`; // close "More options"

        container.innerHTML = html;

        // Attach click handlers for time tag options
        container.querySelectorAll('.tag-radio-option').forEach(option => {
            let pressTimer = null;
            let longPressed = false;

            option.addEventListener('contextmenu', (e) => e.preventDefault());

            option.addEventListener('pointerdown', (e) => {
                if (e.button !== 0 || e.shiftKey) return;
                longPressed = false;
                pressTimer = setTimeout(() => {
                    if (this._renderGen !== gen) return;
                    longPressed = true;
                    const tag = option.dataset.tag;
                    this.toggleExcludedTag(tag, this.selections.excluded.has(tag));
                    this.renderContextSidebar();
                    App.render();
                }, this.LONG_PRESS_MS);
            });

            const cancelPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
            option.addEventListener('pointerup', cancelPress);
            option.addEventListener('pointerleave', cancelPress);
            option.addEventListener('pointercancel', cancelPress);

            option.addEventListener('click', (e) => {
                e.stopPropagation();
                if (longPressed) { longPressed = false; return; }
                const tag = option.dataset.tag;

                if (e.shiftKey) {
                    this.toggleExcludedTag(tag, this.selections.excluded.has(tag));
                    this.renderContextSidebar();
                    App.render();
                    return;
                }

                if (this.selections.context.has(tag)) {
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

        // Attach group toggle handlers
        container.querySelectorAll('.tag-group-parent').forEach(parentEl => {
            const toggleEl = parentEl.querySelector('.tag-group-toggle');
            if (toggleEl) {
                toggleEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    parentEl.closest('.tag-group-hierarchy')?.classList.toggle('expanded');
                });
            }
        });

        // Attach range picker handler
        const rangeStart = container.querySelector('.time-range-start');
        const rangeEnd = container.querySelector('.time-range-end');
        if (rangeStart && rangeEnd) {
            const checkRange = () => {
                const start = rangeStart.value;
                const end = rangeEnd.value;
                // Clear if either field is emptied
                if (!start || !end) {
                    for (const t of Array.from(this.selections.context)) {
                        if (t.startsWith('Time.range.')) this.selections.context.delete(t);
                    }
                    this.saveSelectionState();
                    this.renderContextSidebar();
                    App.render();
                    return;
                }
                if (start <= end) {
                    const tag = `Time.range.${start}..${end}`;
                    this.addContextTag(tag);
                    this.renderContextSidebar();
                    App.render();
                }
            };
            rangeStart.addEventListener('change', checkRange);
            rangeEnd.addEventListener('change', checkRange);
        }
    },

    /**
     * Render a list of tags into a container, grouping by single-level hierarchy
     * @param {HTMLElement} container - Target container
     * @param {string[]} tags - Tags to render
     * @param {boolean} isComputedSection - Whether this is the computed tags section
     */
    _renderTagList(container, tags, isComputedSection, isArchivedSection = false) {
        const gen = ++this._renderGen;
        if (tags.length === 0) {
            container.innerHTML = isComputedSection || isArchivedSection
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

            html += `<div class="${groupClasses.join(' ')}" data-group-path="${escapeHtml(groupName)}">`;
            html += `<div class="tag-group-parent">`;
            html += `<span class="tag-group-toggle">&#9654;</span>`;
            html += `<span class="tag-group-name">${escapeHtml(Common.capitalizeFirst(groupName))}</span>`;
            html += `</div>`;
            html += `<div class="tag-group-children">`;

            groupTags.forEach(tag => {
                const directlySelected = this.selections.context.has(tag);
                const isExcluded = this.selections.excluded.has(tag);
                const isSelected = isComputedSection
                    ? this.selections.context.has(tag)
                    : directlySelected;
                const selClass = isSelected ? 'selected' : '';
                const exclClass = isExcluded ? 'excluded' : '';
                const computedClass = isComputedSection ? 'computed' : '';
                const archivedClass = isArchivedSection ? 'archived-tag' : '';

                html += `<div class="tag-radio-option ${selClass} ${exclClass} ${computedClass} ${archivedClass}" data-group="context" data-tag="${escapeHtml(tag)}">`;
                html += `<span class="tag-badge">${escapeHtml(this.getTagDisplayName(tag))}</span>`;
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
            const archivedClass = isArchivedSection ? 'archived-tag' : '';

            html += `<div class="tag-radio-option ${selClass} ${exclClass} ${computedClass} ${archivedClass}" data-group="context" data-tag="${escapeHtml(tag)}">`;
            html += `<span class="tag-badge">${escapeHtml(this.getTagDisplayName(tag))}</span>`;
            html += `</div>`;
        });

        container.innerHTML = html;

        // Attach tag click/long-press/shift-click handlers
        container.querySelectorAll('.tag-radio-option').forEach(option => {
            let pressTimer = null;
            let longPressed = false;

            // Right-click: show tag context menu (archive/unarchive)
            option.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this._showTagContextMenu(e, option.dataset.tag);
            });

            option.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return; // Only primary button
                if (e.shiftKey) return; // Let shift+click handle via click handler
                longPressed = false;
                pressTimer = setTimeout(() => {
                    if (this._renderGen !== gen) return;
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

                if (this.isComputedContextTag(tag)) {
                    option.classList.toggle('selected', this.selections.context.has(tag));
                    App.render();
                } else {
                    this.renderContextSidebar();
                    App.render();
                }
            });
        });

        // Attach group header handlers: arrow = toggle expand, name = select group
        container.querySelectorAll('.tag-group-parent').forEach(parentEl => {
            // Arrow toggle
            const toggleEl = parentEl.querySelector('.tag-group-toggle');
            if (toggleEl) {
                toggleEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    parentEl.closest('.tag-group-hierarchy')?.classList.toggle('expanded');
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

            if (group === 'context') {
                const directlySelected = this.selections.context.has(tag);
                isExcluded = this.selections.excluded.has(tag);
                isSelected = directlySelected;
            } else if (group === 'contact') {
                isSelected = this.selections.contact === tag;
            } else if (group === 'view') {
                isSelected = Store.currentView === tag;
            }

            option.classList.toggle('selected', isSelected);
            option.classList.toggle('excluded', isExcluded);
        });

        const clearBtn = document.getElementById('clearContextBtn');
        if (clearBtn) {
            clearBtn.disabled = this.selections.context.size === 0;
        }

        const backBtn = document.getElementById('contextBackBtn');
        const forwardBtn = document.getElementById('contextForwardBtn');
        if (backBtn) backBtn.disabled = !this.canGoBack();
        if (forwardBtn) forwardBtn.disabled = !this.canGoForward();
    },

    /**
     * Update tag counts and dim unused tags (optimized to avoid full re-render)
     */
    updateTagCounts({ skipRender = false } = {}) {
        const tagCounts = {};
        let hasOpenTodos = false;
        let hasInProgressTodos = false;
        let hasDoneTodos = false;
        let hasBlockedTodos = false;
        let hasCanceledTodos = false;
        let hasUnblockedTodos = false;
        let hasUntagged = false;
        let hasUnassigned = false;

        // Pre-compute which time tags have matching blocks
        const timeTagHasBlocks = {};
        const timeTags = this.getTimeTags();

        const currentProp = Store.timeProperty || 'lastUpdated';

        Store.blocks.forEach(block => {
            (block.tags || []).forEach(tag => {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            });
            if (block.content && block.content.match(/\[[ \/]\]/)) hasOpenTodos = true;

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

            // Check time tags against block date
            let dateVal = block[currentProp];
            if (!dateVal && (currentProp === 'due' || currentProp === 'start' || currentProp === 'completed')) {
                const dates = tasks
                    .map(t => { const v = TaskParser.getBadgeValue(t, currentProp).trim(); return v ? new Date(v).getTime() : Number.NaN; })
                    .filter(d => !Number.isNaN(d));
                if (dates.length > 0) {
                    dateVal = new Date(Math.min(...dates));
                }
            }
            if (dateVal) {
                timeTags.forEach(timeTag => {
                    if (!timeTagHasBlocks[timeTag] && TimeFilter.checkTimeFilter(dateVal, timeTag)) {
                        timeTagHasBlocks[timeTag] = true;
                    }
                });
            }
        });

        // Refresh dynamic time tags
        this.generateDynamicTimeTags();

        if (!skipRender) this.renderContextSidebar();

        // Optimized update: only modify opacity, don't re-render entire DOM
        document.querySelectorAll('.tag-radio-option').forEach(option => {
            const group = option.dataset.group;
            if (group === 'view') return;

            const tag = option.dataset.tag;
            let hasBlocks = false;

            if (tag && tag.startsWith('Time.')) {
                hasBlocks = timeTagHasBlocks[tag] || false;
            } else if (tag === 'Todo.open') hasBlocks = hasOpenTodos;
            else if (tag === 'Todo.inProgress') hasBlocks = hasInProgressTodos;
            else if (tag === 'Todo.done') hasBlocks = hasDoneTodos;
            else if (tag === 'Todo.blocked') hasBlocks = hasBlockedTodos;
            else if (tag === 'Todo.canceled') hasBlocks = hasCanceledTodos;
            else if (tag === 'Todo.unblocked') hasBlocks = hasUnblockedTodos;
            else if (tag === 'Todo.unassigned') hasBlocks = hasUnassigned;
            else if (tag === 'Status.untagged') hasBlocks = hasUntagged;
            else hasBlocks = tag === '' || (tagCounts[tag] || 0) > 0;

            // In kanban view, state-based Todo.* tags map directly to columns — no filter effect
            const kanbanColumnTags = new Set(['Todo.open', 'Todo.inProgress', 'Todo.done', 'Todo.blocked', 'Todo.canceled']);
            const isIneffectiveInKanban = Store.currentView === 'kanban' && kanbanColumnTags.has(tag);
            const newOpacity = (!hasBlocks && !option.classList.contains('selected')) || isIneffectiveInKanban ? '0.4' : '1';
            if (option.style.opacity !== newOpacity) {
                option.style.opacity = newOpacity;
            }

            if (tag === 'Status.untagged') {
                option.classList.toggle('has-untagged', hasBlocks);
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
                <div class="tag-radio-option ${selClass}" data-group="contact" data-tag="${escapeHtml(contact)}" style="opacity: ${opacity}">
                    <span class="tag-badge">@${escapeHtml(contact)}</span>
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
