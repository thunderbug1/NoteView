/**
 * Sort Manager - Shared multi-clause sorting UI and comparator helpers
 */

const SortManager = {
    getFieldDefinitions(view) {
        const definitions = {
            document: [
                {
                    field: 'lastUpdated',
                    label: 'Last updated',
                    directions: {
                        asc: 'Oldest first',
                        desc: 'Newest first'
                    },
                    compare: (a, b) => this.compareDates(a?.lastUpdated, b?.lastUpdated)
                },
                {
                    field: 'creationDate',
                    label: 'Created',
                    directions: {
                        asc: 'Oldest first',
                        desc: 'Newest first'
                    },
                    compare: (a, b) => this.compareDates(a?.creationDate, b?.creationDate)
                },
                {
                    field: 'id',
                    label: 'Note ID',
                    directions: {
                        asc: 'A to Z',
                        desc: 'Z to A'
                    },
                    compare: (a, b) => this.compareStrings(a?.id, b?.id)
                }
            ],
            kanban: [
                {
                    field: 'priority',
                    label: 'Priority',
                    directions: {
                        asc: 'Highest first',
                        desc: 'Lowest first'
                    },
                    compare: (a, b) => this.compareNumbers(TaskParser.getPriorityRank(a), TaskParser.getPriorityRank(b))
                },
                {
                    field: 'deadline',
                    label: 'Deadline',
                    directions: {
                        asc: 'Earliest first',
                        desc: 'Latest first'
                    },
                    compare: (a, b) => this.compareNumbers(TaskParser.getDueTimestamp(a), TaskParser.getDueTimestamp(b))
                },
                {
                    field: 'assignee',
                    label: 'Assignee',
                    directions: {
                        asc: 'A to Z',
                        desc: 'Z to A'
                    },
                    compare: (a, b) => this.compareStrings(TaskParser.getBadgeValue(a, 'assignee'), TaskParser.getBadgeValue(b, 'assignee'))
                },
                {
                    field: 'text',
                    label: 'Task text',
                    directions: {
                        asc: 'A to Z',
                        desc: 'Z to A'
                    },
                    compare: (a, b) => this.compareStrings(a?.text, b?.text)
                },
                {
                    field: 'sourceOrder',
                    label: 'Manual order',
                    directions: {
                        asc: 'Top to bottom',
                        desc: 'Bottom to top'
                    },
                    compare: (a, b) => this.compareStrings(TaskParser.getSourceOrderKey(a), TaskParser.getSourceOrderKey(b))
                }
            ]
        };

        return definitions[view] || [];
    },

    getFieldMap(view) {
        return this.getFieldDefinitions(view).reduce((accumulator, definition) => {
            accumulator[definition.field] = definition;
            return accumulator;
        }, {});
    },

    cloneClauses(clauses = []) {
        return JSON.parse(JSON.stringify(clauses));
    },

    normalizeClauses(view, clauses = []) {
        const fieldMap = this.getFieldMap(view);
        const filtered = clauses.filter(clause => fieldMap[clause.field]);
        if (filtered.length > 0) {
            return filtered;
        }

        return this.cloneClauses(Store.getDefaultViewPreferences()?.[view]?.sort?.clauses || []);
    },

    sortItems(view, items) {
        const clauses = this.normalizeClauses(view, Store.getSortConfig(view)?.clauses || []);
        const fieldMap = this.getFieldMap(view);
        return [...items].sort((a, b) => {
            // Pinned items always come first, regardless of sort config
            const aPinned = a.pinned ? 0 : 1;
            const bPinned = b.pinned ? 0 : 1;
            if (aPinned !== bPinned) return aPinned - bPinned;

            return this.compareItems(a, b, clauses, fieldMap);
        });
    },

    compareItems(a, b, clauses, fieldMap) {
        for (const clause of clauses) {
            const definition = fieldMap[clause.field];
            if (!definition) continue;

            const delta = definition.compare(a, b);
            if (delta !== 0) {
                return clause.direction === 'desc' ? -delta : delta;
            }
        }

        return 0;
    },

    compareDates(a, b) {
        const aTime = a ? new Date(a).getTime() : Number.NaN;
        const bTime = b ? new Date(b).getTime() : Number.NaN;
        return this.compareNumbers(aTime, bTime);
    },

    compareNumbers(a, b) {
        const aIsValid = Number.isFinite(a);
        const bIsValid = Number.isFinite(b);

        if (aIsValid !== bIsValid) {
            return aIsValid ? -1 : 1;
        }
        if (!aIsValid && !bIsValid) {
            return 0;
        }
        return a - b;
    },

    compareStrings(a, b) {
        const aValue = (a || '').trim();
        const bValue = (b || '').trim();
        const aHasValue = Boolean(aValue);
        const bHasValue = Boolean(bValue);

        if (aHasValue !== bHasValue) {
            return aHasValue ? -1 : 1;
        }
        if (!aHasValue && !bHasValue) {
            return 0;
        }

        return aValue.localeCompare(bValue, undefined, { numeric: true, sensitivity: 'base' });
    },

    getSummary(view) {
        const fieldMap = this.getFieldMap(view);
        const clauses = this.normalizeClauses(view, Store.getSortConfig(view)?.clauses || []);
        if (clauses.length === 0) {
            return 'No sorting';
        }

        return clauses.map(clause => {
            const definition = fieldMap[clause.field];
            if (!definition) return clause.field;
            return `${definition.label}: ${definition.directions[clause.direction]}`;
        }).join(' then ');
    },

    supportsView(view) {
        return this.getFieldDefinitions(view).length > 0;
    },

    initSidebar(onChange) {
        this.onChange = onChange;
        const button = document.getElementById('openSortConfigBtn');
        if (!button) return;

        if (button.dataset.sortBound === 'true') return;

        button.dataset.sortBound = 'true';
        button.addEventListener('click', () => {
            const view = Store.currentView;
            if (!this.supportsView(view)) return;
            this.openSortModal(view, this.onChange);
        });
    },

    updateSidebar() {
        const section = document.getElementById('sortSidebarSection');
        const button = document.getElementById('openSortConfigBtn');
        if (!section || !button) return;

        const view = Store.currentView;
        const supported = this.supportsView(view);
        section.style.display = supported ? '' : 'none';
        if (!supported) return;

        button.textContent = `${Common.capitalizeFirst(view)} Sort`;
    },

    openSortModal(view, onApply) {
        const definitions = this.getFieldDefinitions(view);
        const fieldMap = this.getFieldMap(view);
        const defaults = this.cloneClauses(Store.getDefaultViewPreferences()?.[view]?.sort?.clauses || []);
        let draftClauses = this.normalizeClauses(view, Store.getSortConfig(view)?.clauses || []);

        const modal = Modal.create({
            title: 'Sort Settings',
            width: '720px',
            content: `
                <div class="sort-config-rows" data-sort-rows></div>
                <div class="sort-config-actions">
                    <button class="sort-config-secondary" data-action="add-sort-clause">Add Sort Level</button>
                    <button class="sort-config-secondary" data-action="reset-sort-clauses">Reset Defaults</button>
                </div>
                <div class="sort-config-footer">
                    <button class="sort-config-secondary" data-action="cancel-sort-config">Cancel</button>
                    <button class="sort-config-primary" data-action="apply-sort-config">Apply</button>
                </div>
            `
        });

        const renderRows = () => {
            const rows = modal.querySelector('[data-sort-rows]');
            if (!rows) return;

            if (draftClauses.length === 0) {
                rows.innerHTML = '<div class="sort-config-empty">No sort rules yet. Add a sort level to start ordering items.</div>';
                return;
            }

            rows.innerHTML = draftClauses.map((clause, index) => {
                const definition = fieldMap[clause.field] || definitions[0];
                const fieldOptions = definitions.map(fieldDefinition => `
                    <option value="${fieldDefinition.field}" ${fieldDefinition.field === clause.field ? 'selected' : ''}>${escapeHtml(fieldDefinition.label)}</option>
                `).join('');
                const directionOptions = Object.entries(definition.directions).map(([direction, label]) => `
                    <option value="${direction}" ${direction === clause.direction ? 'selected' : ''}>${escapeHtml(label)}</option>
                `).join('');

                return `
                    <div class="sort-config-row" data-sort-row-index="${index}">
                        <select data-action="sort-field">
                            ${fieldOptions}
                        </select>
                        <select data-action="sort-direction">
                            ${directionOptions}
                        </select>
                        <div class="sort-config-row-actions">
                            <button class="sort-config-btn" data-action="move-sort-up" title="Move up" ${index === 0 ? 'disabled' : ''}>↑</button>
                            <button class="sort-config-btn" data-action="move-sort-down" title="Move down" ${index === draftClauses.length - 1 ? 'disabled' : ''}>↓</button>
                            <button class="sort-config-btn" data-action="remove-sort-row" title="Remove">×</button>
                        </div>
                    </div>
                `;
            }).join('');
        };

        const getNextField = () => {
            const used = new Set(draftClauses.map(clause => clause.field));
            return definitions.find(definition => !used.has(definition.field))?.field || definitions[0]?.field;
        };

        renderRows();

        modal.element.addEventListener('change', (event) => {
            const row = event.target.closest('[data-sort-row-index]');
            if (!row) return;

            const index = Number.parseInt(row.dataset.sortRowIndex, 10);
            if (!Number.isFinite(index) || !draftClauses[index]) return;

            if (event.target.dataset.action === 'sort-field') {
                const nextField = event.target.value;
                draftClauses[index].field = nextField;
                const nextDefinition = fieldMap[nextField];
                if (!nextDefinition?.directions[draftClauses[index].direction]) {
                    draftClauses[index].direction = Object.keys(nextDefinition?.directions || { asc: true })[0];
                }
                renderRows();
            }

            if (event.target.dataset.action === 'sort-direction') {
                draftClauses[index].direction = event.target.value;
            }
        });

        modal.element.addEventListener('click', (event) => {
            const action = event.target.dataset.action;
            if (!action) return;

            if (action === 'add-sort-clause') {
                const nextField = getNextField();
                if (!nextField) return;

                draftClauses.push({ field: nextField, direction: 'asc' });
                renderRows();
                return;
            }

            if (action === 'reset-sort-clauses') {
                draftClauses = this.cloneClauses(defaults);
                renderRows();
                return;
            }

            if (action === 'cancel-sort-config') {
                modal.close();
                return;
            }

            if (action === 'apply-sort-config') {
                const clauses = draftClauses.length > 0 ? draftClauses : defaults;
                Store.updateSortConfig(view, { clauses });
                modal.close();
                if (onApply) onApply();
                return;
            }

            const row = event.target.closest('[data-sort-row-index]');
            if (!row) return;

            const index = Number.parseInt(row.dataset.sortRowIndex, 10);
            if (!Number.isFinite(index) || !draftClauses[index]) return;

            if (action === 'move-sort-up' && index > 0) {
                [draftClauses[index - 1], draftClauses[index]] = [draftClauses[index], draftClauses[index - 1]];
                renderRows();
                return;
            }

            if (action === 'move-sort-down' && index < draftClauses.length - 1) {
                [draftClauses[index + 1], draftClauses[index]] = [draftClauses[index], draftClauses[index + 1]];
                renderRows();
                return;
            }

            if (action === 'remove-sort-row') {
                draftClauses.splice(index, 1);
                renderRows();
            }
        });
    }
};

window.SortManager = SortManager;