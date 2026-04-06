/**
 * Selection Manager - Handles tag and contact selection state
 * Extracted from App to separate concerns
 */

const SelectionManager = {
    // Selection state
    selections: {
        time: '',
        context: new Set(),
        contact: ''
    },

    /**
     * Initialize the selection manager
     */
    init() {
        // Can be used for setup if needed
    },

    /**
     * Set the time selection
     * @param {string} timeSelection - Time selection value
     */
    setTimeSelection(timeSelection) {
        this.selections.time = timeSelection;
        this.updateSelectionUI();
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
        if (tag === 'untagged') {
            this.selections.context.clear();
        } else {
            this.selections.context.delete('untagged');
        }
        this.selections.context.add(tag);
        this.updateSelectionUI();
    },

    /**
     * Remove a context tag from selections
     * @param {string} tag - Tag to remove
     */
    removeContextTag(tag) {
        this.selections.context.delete(tag);
        this.updateSelectionUI();
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
        this.updateSelectionUI();
    },

    /**
     * Get active context tags (excluding computed tags)
     * @returns {Array} Array of active context tags
     */
    getActiveTags() {
        return Array.from(this.selections.context).filter(tag =>
            tag !== 'allTodos' && tag !== 'openTodos' && tag !== 'blockedTodos' && tag !== 'unblockedTodos' && tag !== 'untagged'
        );
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
            'allTodos': 'All Todos',
            'openTodos': 'Open Todos',
            'blockedTodos': 'Blocked Todos',
            'unblockedTodos': 'Unblocked Todos',
            'untagged': 'Untagged',
            'today': 'Today',
            'thisWeek': 'This Week',
            'thisMonth': 'This Month'
        };
        return displayNames[tag] || tag;
    },

    /**
     * Get all context tags from UI and Store
     * @returns {Array} Sorted array of all context tags
     */
    getAllContextTags() {
        const tags = new Set();
        document.querySelectorAll('#contextTags .tag-radio-option').forEach(opt => {
            if (opt.dataset.tag && !['allTodos', 'openTodos', 'blockedTodos', 'unblockedTodos', 'untagged'].includes(opt.dataset.tag)) {
                tags.add(opt.dataset.tag);
            }
        });
        Store.blocks.forEach(b => {
            (b.tags || []).forEach(t => tags.add(t));
        });
        return Array.from(tags).sort();
    },

    /**
     * Update the UI to reflect current selections
     */
    updateSelectionUI() {
        document.querySelectorAll('.tag-radio-option').forEach(option => {
            const group = option.dataset.group;
            const tag = option.dataset.tag;

            let isSelected = false;

            if (group === 'time') {
                isSelected = this.selections.time === tag;
            } else if (group === 'context') {
                isSelected = this.selections.context.has(tag);
            } else if (group === 'contact') {
                isSelected = this.selections.contact === tag;
            } else if (group === 'view') {
                isSelected = Store.currentView === tag;
            }

            if (isSelected) {
                option.classList.add('selected');
            } else {
                option.classList.remove('selected');
            }
        });
    },

    /**
     * Update tag counts and dim unused tags (optimized to avoid full re-render)
     */
    updateTagCounts() {
        const tagCounts = {};
        let hasAllTodos = false;
        let hasOpenTodos = false;
        let hasBlockedTodos = false;
        let hasUnblockedTodos = false;
        let hasUntagged = false;

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
            const hasBlocked = tasks.some(t => t.state === 'b' || t.badges.some(b => b.type === 'dependsOn'));
            const hasUnblocked = tasks.some(t => (t.state === ' ' || t.state === '/') && !t.badges.some(b => b.type === 'dependsOn'));
            
            if (hasBlocked) hasBlockedTodos = true;
            if (hasUnblocked) hasUnblockedTodos = true;
            
            if (!block.tags || block.tags.length === 0) hasUntagged = true;

            const dateVal = block[currentProp];
            if (dateVal) {
                const bDate = new Date(dateVal);
                if (bDate.toDateString() === now.toDateString()) hasToday = true;
                if (bDate >= startOfWeek) hasThisWeek = true;
                if (bDate.getFullYear() === now.getFullYear() && bDate.getMonth() === now.getMonth()) hasThisMonth = true;
            }
        });

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
                if (tag === 'allTodos') hasBlocks = hasAllTodos;
                else if (tag === 'openTodos') hasBlocks = hasOpenTodos;
                else if (tag === 'blockedTodos') hasBlocks = hasBlockedTodos;
                else if (tag === 'unblockedTodos') hasBlocks = hasUnblockedTodos;
                else if (tag === 'untagged') hasBlocks = hasUntagged;
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
        const selectedContext = this.getActiveTags();

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
            html = '<div style="color:var(--text-muted); font-size:12px; padding:4px 8px;">Mention @someone to add</div>';
        }

        container.innerHTML = html;

        container.querySelectorAll('.tag-radio-option').forEach(option => {
            option.addEventListener('click', () => {
                const tag = option.dataset.tag;
                const wasSelected = option.classList.contains('selected');

                if (wasSelected) {
                    this.selections.contact = '';
                } else {
                    this.selections.contact = tag;
                }
                this.updateSelectionUI();
                App.render();
            });
        });
    },

    /**
     * Add a new context tag to the UI
     * @param {string} tag - Tag to add
     */
    addContextTagToUI(tag) {
        if (['alltodos', 'opentodos', 'blockedtodos', 'unblockedtodos', 'untagged'].includes(tag.toLowerCase())) return;

        const exists = Array.from(document.querySelectorAll('#contextTags .tag-radio-option'))
            .some(opt => opt.dataset.tag === tag);

        if (!exists) {
            const container = document.getElementById('contextTags');
            if (!container) return;
            const newOption = document.createElement('div');
            newOption.className = 'tag-radio-option';
            newOption.dataset.group = 'context';
            newOption.dataset.tag = tag;
            newOption.innerHTML = `<span class="tag-badge">${this.getTagDisplayName(tag)} <button class="delete-tag-btn" title="Delete tag">&times;</button></span>`;

            newOption.addEventListener('click', (e) => {
                if (e.target.closest('.delete-tag-btn') || newOption.classList.contains('add-new-context-tag')) return;
                const wasSelected = newOption.classList.contains('selected');
                this.toggleContextTag(tag, wasSelected);
                App.render();
            });

            container.appendChild(newOption);
        }
    },

    /**
     * Prompt user and remove a tag from all blocks
     * @param {string} tag - Tag to remove
     */
    async promptAndRemoveTag(tag) {
        const input = prompt(`To absolutely delete the tag '${tag}' and remove it from ALL notes, type the exact tag name below:`);
        if (input !== tag) {
            if (input !== null) alert("Tag name didn't match. Aborting delete.");
            return;
        }

        let updatedCount = 0;
        for (const block of Store.blocks) {
            if (block.tags && block.tags.includes(tag)) {
                block.tags = block.tags.filter(t => t !== tag);
                updatedCount++;
                await Store.saveBlock(block);
            }
        }

        if (this.selections.context.has(tag)) {
            this.selections.context.delete(tag);
        }

        const options = document.querySelectorAll(`#contextTags .tag-radio-option[data-tag="${tag}"]`);
        options.forEach(opt => opt.remove());

        alert(`Tag '${tag}' removed from ${updatedCount} note(s).`);
        await App.render();
    }
};

window.SelectionManager = SelectionManager;
