/**
 * BlockFilter — Filtering logic for blocks.
 * Extracted from Store to avoid duplication between getFilteredBlocks and getBlockingFilters.
 */

window.BlockFilter = {
    /**
     * Test whether a single block passes all active filters.
     * @param {Object} block
     * @param {Object} opts — { contextSelection, excludedSelection, contactSelection, searchQuery, timeProperty }
     * @returns {boolean}
     */
    blockPasses(block, opts) {
        return this.getBlockingReasons(block, opts).length === 0;
    },

    /**
     * Test whether a single block passes all active filters (fast path, no allocation).
     * Used for hot paths like getFilteredBlocks where we don't need reasons.
     * @param {Object} block
     * @param {Object} opts — { contextSelection, excludedSelection, contactSelection, searchQuery, timeProperty }
     * @returns {boolean}
     */
    _blockPassesFast(block, opts) {
        const { contextSelection, excludedSelection, contactSelection, searchQuery, timeProperty } = opts;

        // Derive time selection from context
        const timeTag = TimeFilter.deriveTimeSelectionFromContext(contextSelection);

        // Time filter
        if (timeTag) {
            const property = timeProperty || 'lastUpdated';
            let dateVal = block[property];

            if (property === 'due' || property === 'start' || property === 'completed') {
                const tasks = TaskParser.parseTasksFromBlock(block);
                const dates = tasks
                    .map(t => { const v = TaskParser.getBadgeValue(t, property).trim(); return v ? new Date(v).getTime() : Number.NaN; })
                    .filter(d => !Number.isNaN(d));
                if (dates.length === 0) return false;
                dateVal = new Date(Math.min(...dates));
            }

            if (!dateVal) return false;
            if (!TimeFilter.checkTimeFilter(dateVal, timeTag)) return false;
        }

        // Context filter (multi-select AND) - use tag index for fast path
        if (contextSelection && contextSelection.size > 0) {
            const regularTags = [];
            const pathGroups = [];
            let hasUntagged = false;

            for (const item of contextSelection) {
                if (SelectionManager.isComputedContextTag(item)) continue;
                if (item.startsWith('path:')) {
                    pathGroups.push(item.slice(5));
                } else if (item === 'Status.untagged') {
                    hasUntagged = true;
                } else {
                    regularTags.push(item);
                }
            }

            // Use tag index for regular tags (AND logic) if index is available
            if (regularTags.length > 0 && window.TagIndex?.tagToBlocks?.size > 0) {
                const blockIdSet = window.TagIndex.getBlocksWithTags(regularTags);
                if (!blockIdSet.has(block.id)) return false;
            } else if (regularTags.length > 0) {
                // Fallback to linear scan if index not available
                const blockTags = block.tags || [];
                for (const tag of regularTags) {
                    if (!blockTags.includes(tag)) return false;
                }
            }

            // Use tag index for path groups (AND logic) if index is available
            if (pathGroups.length > 0 && window.TagIndex?.groupToBlocks?.size > 0) {
                for (const group of pathGroups) {
                    const groupBlocks = window.TagIndex.getBlocksWithTagGroup(group);
                    if (!groupBlocks.has(block.id)) return false;
                }
            } else if (pathGroups.length > 0) {
                // Fallback to linear scan if index not available
                const blockTags = block.tags || [];
                for (const group of pathGroups) {
                    const hasMatch = blockTags.some(tag => {
                        const { segments } = Common.parseHierarchicalTag(tag);
                        return segments.length > 0 && segments[0] === group;
                    });
                    if (!hasMatch) return false;
                }
            }

            // Use tag index for untagged check if available
            if (hasUntagged && window.TagIndex?.untaggedBlocks?.size >= 0) {
                if (!window.TagIndex.isBlockUntagged(block.id)) {
                    return false;
                }
            } else if (hasUntagged) {
                // Fallback
                if (block.tags && block.tags.length > 0) return false;
            }

            // Task-level computed: line-level hiding
            const activeTaskComputed = TaskParser.getActiveTaskFilter();
            if (activeTaskComputed.size > 0) {
                const lines = (block.content || '').split('\n');
                const excludeFilters = TaskParser.getActiveExcludedTaskFilter();
                const hidden = TaskParser.getHiddenTaskLineIndices(lines, activeTaskComputed, excludeFilters);
                const hasVisibleContent = lines.some((line, i) => !hidden.has(i) && line.trim());
                if (!hasVisibleContent) return false;
            }
        }

        // Excluded tags - use tag index for fast path
        if (excludedSelection && excludedSelection.size > 0) {
            const regularTags = [];
            const pathGroups = [];
            let hasUntagged = false;

            for (const item of excludedSelection) {
                if (SelectionManager.isComputedContextTag(item)) {
                    if (item.startsWith('Todo.')) continue;
                    if (item === 'Status.untagged') {
                        hasUntagged = true;
                    }
                } else if (item.startsWith('path:')) {
                    pathGroups.push(item.slice(5));
                } else {
                    regularTags.push(item);
                }
            }

            // Use tag index for regular tags (block is excluded if it has ANY of these) if available
            if (regularTags.length > 0 && window.TagIndex?.blocksByTag?.size > 0) {
                const blockTags = window.TagIndex.getBlockTags(block.id);
                for (const tag of regularTags) {
                    if (blockTags.has(tag)) return false;
                }
            } else if (regularTags.length > 0) {
                // Fallback to linear scan
                const blockTags = block.tags || [];
                for (const tag of regularTags) {
                    if (blockTags.includes(tag)) return false;
                }
            }

            // Use tag index for path groups (block is excluded if it has ANY tag in these groups) if available
            if (pathGroups.length > 0 && window.TagIndex?.blocksByTag?.size > 0) {
                const blockTags = window.TagIndex.getBlockTags(block.id);
                for (const tag of blockTags) {
                    const parsed = window.TagIndex.getParsedTag(block.id, tag);
                    if (parsed && parsed.segments.length > 0 && pathGroups.includes(parsed.segments[0])) {
                        return false;
                    }
                }
            } else if (pathGroups.length > 0) {
                // Fallback to linear scan
                const blockTags = block.tags || [];
                for (const group of pathGroups) {
                    if (blockTags.some(tag => {
                        const { segments } = Common.parseHierarchicalTag(tag);
                        return segments.length > 0 && segments[0] === group;
                    })) return false;
                }
            }

            // Use tag index for untagged exclusion if available
            if (hasUntagged && window.TagIndex?.untaggedBlocks?.size >= 0) {
                if (window.TagIndex.isBlockUntagged(block.id)) {
                    return false;
                }
            } else if (hasUntagged) {
                // Fallback
                if (!block.tags || block.tags.length === 0) return false;
            }

            // Line-level exclusion of todo tags
            const excludedTaskFilters = TaskParser.getActiveExcludedTaskFilter();
            if (excludedTaskFilters.size > 0) {
                const lines = (block.content || '').split('\n');
                const activeTaskFilters = TaskParser.getActiveTaskFilter();
                const hidden = TaskParser.getHiddenTaskLineIndices(lines, activeTaskFilters, excludedTaskFilters);
                const hasVisibleContent = lines.some((line, i) => !hidden.has(i) && line.trim());
                if (!hasVisibleContent) return false;
            }
        }

        // Contact filter
        if (contactSelection) {
            if (!ContactHelper.hasContact(block.content || '', contactSelection)) return false;
        }

        // Search filter
        if (searchQuery) {
            const searchLower = searchQuery.toLowerCase();
            const contentMatch = block.content?.toLowerCase().includes(searchLower);
            const tagMatch = block.tags?.some(tag => tag.toLowerCase().includes(searchLower));
            if (!contentMatch && !tagMatch) return false;
        }

        return true;
    },

    /**
     * Determine which active filters would exclude a given block.
     * Returns an array of { type, label } objects. Empty if the block passes all filters.
     * @param {Object} block
     * @param {Object} opts — { contextSelection, excludedSelection, contactSelection, searchQuery, timeProperty }
     * @returns {Array<{type: string, label: string}>}
     */
    getBlockingReasons(block, opts) {
        const { contextSelection, excludedSelection, contactSelection, searchQuery, timeProperty } = opts;
        const reasons = [];

        // Derive time selection from context
        const timeTag = TimeFilter.deriveTimeSelectionFromContext(contextSelection);

        // Time filter
        if (timeTag) {
            const property = timeProperty || 'lastUpdated';
            let dateVal = block[property];

            if (property === 'due' || property === 'start' || property === 'completed') {
                const tasks = TaskParser.parseTasksFromBlock(block);
                const dates = tasks
                    .map(t => { const v = TaskParser.getBadgeValue(t, property).trim(); return v ? new Date(v).getTime() : Number.NaN; })
                    .filter(d => !Number.isNaN(d));
                if (dates.length > 0) {
                    dateVal = new Date(Math.min(...dates));
                }
            }

            if (!dateVal || !TimeFilter.checkTimeFilter(dateVal, timeTag)) {
                reasons.push({ type: 'time', label: SelectionManager.getTagDisplayName(timeTag) });
            }
        }

        // Context tags (AND logic)
        if (contextSelection && contextSelection.size > 0) {
            const blockTags = block.tags || [];

            for (const item of contextSelection) {
                if (SelectionManager.isComputedContextTag(item)) continue;

                if (item.startsWith('path:')) {
                    const group = item.slice(5);
                    const hasMatch = blockTags.some(tag => {
                        const { segments } = Common.parseHierarchicalTag(tag);
                        return segments.length > 0 && segments[0] === group;
                    });
                    if (!hasMatch) {
                        reasons.push({ type: 'context', label: group });
                    }
                } else {
                    if (!blockTags.includes(item)) {
                        reasons.push({ type: 'context', label: item });
                    }
                }
            }

            // Computed context tags (Todo.*) — line-level hiding semantics
            const activeTaskComputed = TaskParser.getActiveTaskFilter();
            if (activeTaskComputed.size > 0) {
                const lines = (block.content || '').split('\n');
                const excludeFilters = TaskParser.getActiveExcludedTaskFilter();
                const hidden = TaskParser.getHiddenTaskLineIndices(lines, activeTaskComputed, excludeFilters);
                const hasVisibleContent = lines.some((_, i) => !hidden.has(i));
                if (!hasVisibleContent) {
                    for (const filter of activeTaskComputed) {
                        reasons.push({ type: 'context', label: filter });
                    }
                }
            }
            if (contextSelection.has('Status.untagged')) {
                if (block.tags && block.tags.length > 0) {
                    reasons.push({ type: 'context', label: 'Status.untagged' });
                }
            }
        }

        // Excluded tags
        if (excludedSelection && excludedSelection.size > 0) {
            const blockTags = block.tags || [];

            for (const item of excludedSelection) {
                if (SelectionManager.isComputedContextTag(item)) {
                    if (item.startsWith('Todo.')) continue;
                    if (item === 'Status.untagged') {
                        if (!block.tags || block.tags.length === 0) {
                            reasons.push({ type: 'excluded', label: 'Status.untagged' });
                        }
                    }
                } else if (item.startsWith('path:')) {
                    const group = item.slice(5);
                    if (blockTags.some(tag => {
                        const { segments } = Common.parseHierarchicalTag(tag);
                        return segments.length > 0 && segments[0] === group;
                    })) {
                        reasons.push({ type: 'excluded', label: item });
                    }
                } else {
                    if (blockTags.includes(item)) {
                        reasons.push({ type: 'excluded', label: item });
                    }
                }
            }

            // Excluded Todo.* tags — check at line level
            const excludedTaskFilters = TaskParser.getActiveExcludedTaskFilter();
            if (excludedTaskFilters.size > 0) {
                const lines = (block.content || '').split('\n');
                const activeTaskFilters = TaskParser.getActiveTaskFilter();
                const hidden = TaskParser.getHiddenTaskLineIndices(lines, activeTaskFilters, excludedTaskFilters);
                const hasVisibleContent = lines.some((_, i) => !hidden.has(i));
                if (!hasVisibleContent) {
                    for (const filter of excludedTaskFilters) {
                        reasons.push({ type: 'excluded', label: filter });
                    }
                }
            }
        }

        // Contact filter
        if (contactSelection) {
            if (!ContactHelper.hasContact(block.content || '', contactSelection)) {
                reasons.push({ type: 'contact', label: '@' + contactSelection });
            }
        }

        // Search filter
        if (searchQuery) {
            const searchLower = searchQuery.toLowerCase();
            const contentMatch = block.content?.toLowerCase().includes(searchLower);
            const tagMatch = block.tags?.some(tag => tag.toLowerCase().includes(searchLower));
            if (!contentMatch && !tagMatch) {
                reasons.push({ type: 'search', label: '"' + searchQuery + '"' });
            }
        }

        return reasons;
    },

    /**
     * Build the filter options object from current SelectionManager state and Store config.
     */
    _currentOpts() {
        return {
            contextSelection: SelectionManager.selections.context,
            excludedSelection: SelectionManager.selections.excluded,
            contactSelection: SelectionManager.selections.contact,
            searchQuery: Store.searchQuery,
            timeProperty: Store.timeProperty || 'lastUpdated',
        };
    }
};
