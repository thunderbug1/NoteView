/**
 * Kanban View - Columns defined by todo state
 */

const KanbanView = {
    collapsedGroups: new Map(),
    showUpcoming: false,
    UPCOMING_STORAGE_KEY: 'noteview-kanban-show-upcoming',

    loadShowUpcoming() {
        try {
            return localStorage.getItem(this.UPCOMING_STORAGE_KEY) === 'true';
        } catch { return false; }
    },

    saveShowUpcoming(val) {
        try {
            localStorage.setItem(this.UPCOMING_STORAGE_KEY, String(val));
        } catch {}
    },

    columns: [
        { id: 'todo', label: 'Todo', state: ' ' },
        { id: 'progress', label: 'In Progress', state: '/' },
        { id: 'done', label: 'Done', state: 'x' },
        { id: 'blocked', label: 'Blocked', state: 'b' },
        { id: 'canceled', label: 'Canceled', state: '-' }
    ],

    getColumnByState(state) {
        return this.columns.find(col => col.state === state) || null;
    },

    getColumnById(id) {
        return this.columns.find(col => col.id === id) || null;
    },

    /**
     * Build parent-child relationships from task indentation.
     * Returns a Map of taskId -> { parentId: string|null, children: string[] }.
     */
    buildTaskHierarchy(tasks) {
        const hierarchy = new Map();

        // Group tasks by blockId (hierarchy is scoped per document)
        const byBlock = new Map();
        for (const task of tasks) {
            if (!byBlock.has(task.blockId)) byBlock.set(task.blockId, []);
            byBlock.get(task.blockId).push(task);
            hierarchy.set(task.id, { parentId: null, children: [] });
        }

        // Walk each block's tasks in document order using an ancestor stack
        for (const [, blockTasks] of byBlock) {
            const stack = []; // { taskId, indent }
            for (const task of blockTasks) {
                while (stack.length > 0 && stack[stack.length - 1].indent >= task.indent) {
                    stack.pop();
                }
                if (stack.length > 0) {
                    const parent = stack[stack.length - 1];
                    hierarchy.get(task.id).parentId = parent.taskId;
                    hierarchy.get(parent.taskId).children.push(task.id);
                }
                stack.push({ taskId: task.id, indent: task.indent });
            }
        }

        return hierarchy;
    },

    render(blocks, options = {}) {
        const container = document.getElementById('viewContainer');
        container.className = 'kanban-view';

        // Parse all tasks and build full hierarchy BEFORE filtering,
        // so parent-child relationships stay correct when parents are filtered out.
        const allTasks = TaskParser.parseTasksFromBlocks(blocks);
        const fullHierarchy = this.buildTaskHierarchy(allTasks);
        const allTasksById = new Map(allTasks.map(t => [t.id, t]));

        // Apply sidebar filters
        const tasks = this.applyTaskFilters(allTasks);

        // Start-date filtering
        this.showUpcoming = this.loadShowUpcoming();
        const notStartedIds = new Set(
            tasks.filter(t => TaskParser.isNotStarted(t)).map(t => t.id)
        );
        const hiddenCount = notStartedIds.size;
        const visibleTasks = this.showUpcoming
            ? tasks
            : tasks.filter(t => !notStartedIds.has(t.id));

        const { groupBy } = options;

        if (groupBy) {
            const blockMap = new Map(blocks.map(b => [b.id, b]));
            this.renderGroupedKanban(container, visibleTasks, fullHierarchy, allTasksById, groupBy, blockMap, hiddenCount);
        } else {
            this.renderFlatKanban(container, visibleTasks, fullHierarchy, allTasksById, hiddenCount);
        }

        this.attachEventListeners(container);
    },

    renderToolbar(hiddenCount) {
        if (hiddenCount === 0 && !this.showUpcoming) return '';
        const activeClass = this.showUpcoming ? ' active' : '';
        const label = this.showUpcoming
            ? 'Hide upcoming'
            : `Show upcoming (${hiddenCount})`;
        return `<div class="kanban-toolbar">
            <button class="kanban-toolbar-btn kanban-toggle-upcoming${activeClass}" data-action="toggle-upcoming">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>
                ${label}
            </button>
        </div>`;
    },

    renderFlatKanban(container, tasks, fullHierarchy, allTasksById, hiddenCount = 0) {
        let html = '';
        this.columns.forEach(col => {
            const colTasks = tasks.filter(t => t.state === col.state);
            const colTaskIds = new Set(colTasks.map(t => t.id));
            const tasksById = new Map(colTasks.map(t => [t.id, t]));

            const orphanedIds = new Set();
            for (const task of colTasks) {
                const entry = fullHierarchy.get(task.id);
                if (entry?.parentId) {
                    const parentTask = allTasksById.get(entry.parentId);
                    if (parentTask && parentTask.state === col.state && !colTaskIds.has(entry.parentId)) {
                        orphanedIds.add(task.id);
                    }
                }
            }

            const colHtml = this.renderColumnTasks(colTasks, fullHierarchy, tasksById, colTaskIds, orphanedIds);

            html += `
                <div class="kanban-column" data-column-id="${col.id}">
                    <div class="kanban-column-header">
                        <h4>${col.label} <span class="count">(${colTasks.length})</span></h4>
                        <button class="kanban-add-task-btn" data-column-id="${col.id}" title="Add task">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        </button>
                    </div>
                    <div class="blocks">
                        ${colHtml}
                    </div>
                </div>
            `;
        });

        container.innerHTML = `${this.renderToolbar(hiddenCount)}<div class="kanban-board">${html}</div>`;
    },

    renderGroupedKanban(container, tasks, fullHierarchy, allTasksById, namespace, blockMap, hiddenCount = 0) {
        // Group tasks by tag namespace via their source block
        const groupTasks = new Map();
        const ungroupedTasks = [];

        for (const task of tasks) {
            const block = blockMap.get(task.blockId);
            if (!block) { ungroupedTasks.push(task); continue; }

            const tags = block.tags || [];
            let assigned = false;
            for (const tag of tags) {
                const { segments, leaf } = Common.parseHierarchicalTag(tag);
                if (segments.length > 0 && segments[0] === namespace) {
                    const key = leaf;
                    if (!groupTasks.has(key)) groupTasks.set(key, []);
                    groupTasks.get(key).push(task);
                    assigned = true;
                    break;
                }
            }
            if (!assigned) ungroupedTasks.push(task);
        }

        const sortedGroups = new Map([...groupTasks.entries()].sort((a, b) => a[0].localeCompare(b[0])));

        let html = '';
        for (const [key, groupTaskList] of sortedGroups) {
            html += this.renderSwimlane(key, groupTaskList, fullHierarchy, allTasksById, namespace, false);
        }
        if (ungroupedTasks.length > 0) {
            html += this.renderSwimlane(null, ungroupedTasks, fullHierarchy, allTasksById, namespace, true);
        }

        container.innerHTML = `${this.renderToolbar(hiddenCount)}${html}`;
    },

    renderSwimlane(key, tasks, fullHierarchy, allTasksById, namespace, isUngrouped) {
        const label = isUngrouped ? 'Other' : `${Common.capitalizeFirst(namespace)} / ${Common.capitalizeFirst(key)}`;
        let columnsHtml = '';

        this.columns.forEach(col => {
            const colTasks = tasks.filter(t => t.state === col.state);
            const colTaskIds = new Set(colTasks.map(t => t.id));
            const tasksById = new Map(colTasks.map(t => [t.id, t]));

            const orphanedIds = new Set();
            for (const task of colTasks) {
                const entry = fullHierarchy.get(task.id);
                if (entry?.parentId) {
                    const parentTask = allTasksById.get(entry.parentId);
                    if (parentTask && parentTask.state === col.state && !colTaskIds.has(entry.parentId)) {
                        orphanedIds.add(task.id);
                    }
                }
            }

            const colHtml = this.renderColumnTasks(colTasks, fullHierarchy, tasksById, colTaskIds, orphanedIds);

            columnsHtml += `
                <div class="kanban-column" data-column-id="${col.id}">
                    <div class="kanban-column-header">
                        <h4>${col.label} <span class="count">(${colTasks.length})</span></h4>
                        <button class="kanban-add-task-btn" data-column-id="${col.id}" title="Add task">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        </button>
                    </div>
                    <div class="blocks">
                        ${colHtml}
                    </div>
                </div>
            `;
        });

        const groupKey = key || '__ungrouped';
        const isCollapsed = this.collapsedGroups.get(groupKey) || false;
        const swimlaneClass = isUngrouped ? 'kanban-swimlane kanban-swimlane-ungrouped' : 'kanban-swimlane';
        return `
            <div class="${swimlaneClass}${isCollapsed ? ' kanban-swimlane-collapsed' : ''}" data-group-key="${escapeHtml(groupKey)}">
                <div class="kanban-swimlane-label">
                    <button class="kanban-swimlane-collapse">${isCollapsed ? '&#9654;' : '&#9660;'}</button>
                    ${escapeHtml(label)} <span class="kanban-swimlane-count">(${tasks.length})</span>
                </div>
                <div class="kanban-board">${columnsHtml}</div>
            </div>
        `;
    },

    /**
     * Apply sidebar filters to a parsed task list.
     */
    applyTaskFilters(tasks) {
        const contextSelection = SelectionManager.selections?.context;
        const contactSelection = SelectionManager.selections?.contact;

        if ((!contextSelection || contextSelection.size === 0) && !contactSelection) {
            return tasks;
        }

        return tasks.filter(task => {
            if (contactSelection && !ContactHelper.hasTaskContact(task, contactSelection)) {
                return false;
            }
            if (contextSelection.has('Todo.open') && !TaskParser.isOpenTask(task)) {
                return false;
            }
            if (contextSelection.has('Todo.blocked') && !TaskParser.isBlockedTask(task)) {
                return false;
            }
            if (contextSelection.has('Todo.unblocked') && !TaskParser.isUnblockedTask(task)) {
                return false;
            }
            if (contextSelection.has('Status.unassigned') && !TaskParser.isUnassignedTask(task)) {
                return false;
            }
            return true;
        });
    },

    extractTasks(blocks) {
        const tasks = TaskParser.parseTasksFromBlocks(blocks);
        const contextSelection = SelectionManager.selections?.context;
        const contactSelection = SelectionManager.selections?.contact;

        if ((!contextSelection || contextSelection.size === 0) && !contactSelection) {
            return tasks;
        }

        return tasks.filter(task => {
            if (contactSelection && !ContactHelper.hasTaskContact(task, contactSelection)) {
                return false;
            }
            if (contextSelection.has('Todo.open') && !TaskParser.isOpenTask(task)) {
                return false;
            }
            if (contextSelection.has('Todo.blocked') && !TaskParser.isBlockedTask(task)) {
                return false;
            }
            if (contextSelection.has('Todo.unblocked') && !TaskParser.isUnblockedTask(task)) {
                return false;
            }
            if (contextSelection.has('Status.unassigned') && !TaskParser.isUnassignedTask(task)) {
                return false;
            }
            return true;
        });
    },

    renderTaskCard(task, depth = 0, isOrphaned = false) {
        const column = this.getColumnByState(task.state);
        const nestedClass = depth > 0 ? ' kanban-card--nested' : '';
        const orphanedClass = isOrphaned ? ' kanban-card--orphaned' : '';
        const nestedStyle = depth > 0 ? ` style="margin-left: ${depth * 1.25}rem;"` : '';
        const urgency = TaskParser.getDeadlineUrgency(task);
        const urgencyClass = urgency ? ` deadline-${urgency}` : '';

        const hasDue = task.badges.some(b => b.type === 'due');
        const hasAssignee = task.badges.some(b => b.type === 'assignee');
        const hasPriority = task.badges.some(b => b.type === 'priority');
        const hasStart = task.badges.some(b => b.type === 'start');

        let actionBtns = '';
        if (!hasDue || !hasStart) {
            actionBtns += `<button class="kanban-action-btn" data-action="date" title="Add date"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg></button>`;
        }
        if (!hasAssignee) {
            actionBtns += `<button class="kanban-action-btn" data-action="assignee" title="Add assignee"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></button>`;
        }
        if (!hasPriority) {
            actionBtns += `<button class="kanban-action-btn" data-action="priority" title="Add priority"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg></button>`;
        }
        // Copy button — always shown
        actionBtns += `<button class="kanban-action-btn" data-action="copy" title="Copy task text"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>`;
        // Delete button — always shown
        actionBtns += `<button class="kanban-action-btn kanban-action-delete" data-action="delete" title="Delete note"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`;

        return `
            <div class="block kanban-card${nestedClass}${orphanedClass}${urgencyClass}" draggable="true" data-id="${task.id}" data-block-id="${task.blockId}" data-match-index="${task.matchIndex}" data-match-length="${task.matchLength}" data-prefix="${task.prefix}" data-column-id="${column ? column.id : ''}" data-depth="${depth}"${nestedStyle}>
                <div class="kanban-card-content">
                    <p class="kanban-task-text">${escapeHtml(task.text)}</p>
                    <div class="kanban-action-btns">${actionBtns}</div>
                    <div class="kanban-card-footer">
                        ${task.badges.map(b => {
                            const dueUrgencyCls = (b.type === 'due' && urgency) ? ` badge-due-${urgency}` : '';
                            return `<span class="badge badge-${b.type} kanban-badge${dueUrgencyCls}" data-type="${b.type}" data-value="${escapeHtml(b.value)}"${b.type === 'priority' ? ` data-priority="${escapeHtml(b.value.toLowerCase())}"` : ''}>${escapeHtml(b.type)}: ${escapeHtml(b.value)}</span>`;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * Render a column's tasks with hierarchy nesting.
     * Only root tasks (those without a parent in this column) are sorted;
     * children maintain document order under their parent.
     */
    renderColumnTasks(colTasks, hierarchy, tasksById, colTaskIds, orphanedIds = new Set()) {
        // Roots: parentId is null OR parent not in this column
        const rootTasks = colTasks.filter(t => {
            const entry = hierarchy.get(t.id);
            return !entry.parentId || !colTaskIds.has(entry.parentId);
        });

        const sortedRoots = SortManager.sortItems('kanban', rootTasks);
        let html = '';
        for (const root of sortedRoots) {
            html += this.renderTaskWithChildren(root, hierarchy, tasksById, colTaskIds, 0, orphanedIds);
        }
        return html;
    },

    /**
     * Recursively render a task card and its children that are in the same column.
     */
    renderTaskWithChildren(task, hierarchy, tasksById, colTaskIds, depth, orphanedIds = new Set()) {
        const isOrphaned = orphanedIds.has(task.id);
        let html = this.renderTaskCard(task, depth, isOrphaned);
        const entry = hierarchy.get(task.id);
        for (const childId of entry.children) {
            if (colTaskIds.has(childId)) {
                const childTask = tasksById.get(childId);
                if (childTask) {
                    html += this.renderTaskWithChildren(childTask, hierarchy, tasksById, colTaskIds, depth + 1, orphanedIds);
                }
            }
        }
        return html;
    },

    buildDragPayload(card) {
        return JSON.stringify({
            id: card.dataset.id,
            blockId: card.dataset.blockId,
            matchIndex: parseInt(card.dataset.matchIndex, 10),
            matchLength: parseInt(card.dataset.matchLength, 10),
            prefix: card.dataset.prefix,
            columnId: card.dataset.columnId
        });
    },

    setupCardDragDrop(card, dragState) {
        card.addEventListener('dragstart', (e) => {
            card.classList.add('dragging');
            dragState.inProgress = true;

            const payload = KanbanView.buildDragPayload(card);
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', payload);
                e.dataTransfer.setData('application/json', payload);
            }
        });

        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            setTimeout(() => {
                dragState.inProgress = false;
            }, 0);
        });
    },

    setupCardClickHandlers(card, dragState) {
        // Action button clicks (due, assignee, priority)
        card.querySelectorAll('.kanban-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;

                if (action === 'date') {
                    KanbanView.showDateMenu(btn, card);
                }

                if (action === 'assignee') {
                    const block = Store.blocks.find(b => b.id === card.dataset.blockId);
                    if (!block) return;
                    App.showAssigneeModal((contact) => {
                        KanbanView.updateTaskBadge(card, 'assignee', contact);
                    }, block.tags);
                }

                if (action === 'priority') {
                    KanbanView.showPriorityMenu(btn, card);
                }

                if (action === 'copy') {
                    const taskText = card.querySelector('.kanban-task-text')?.textContent || '';
                    navigator.clipboard.writeText(taskText).then(() => {
                        const origSvg = btn.innerHTML;
                        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                        btn.style.color = 'var(--success, #22c55e)';
                        setTimeout(() => {
                            btn.innerHTML = origSvg;
                            btn.style.color = '';
                        }, 1500);
                    });
                }

                if (action === 'delete') {
                    const blockId = card.dataset.blockId;
                    const delModal = Modal.create({
                        title: 'Delete Note',
                        content: `
                            <p style="margin-bottom: 20px;">Delete this note permanently?</p>
                            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                                <button class="modal-cancel-btn" style="padding: 8px 16px; background: transparent; border: 1px solid var(--border); border-radius: 4px; cursor: pointer;">Cancel</button>
                                <button class="modal-confirm-btn" style="padding: 8px 16px; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer;">Delete</button>
                            </div>
                        `
                    });
                    delModal.querySelector('.modal-confirm-btn').addEventListener('click', () => {
                        delModal.close();
                        App.deleteBlock(blockId);
                    });
                    delModal.querySelector('.modal-cancel-btn').addEventListener('click', () => {
                        delModal.close();
                    });
                }
            });
        });

        // Card click opens document
        card.addEventListener('click', (e) => {
            if (dragState.inProgress) return;
            if (e.target.closest('.kanban-badge')) return;
            if (e.target.closest('.kanban-action-btn')) return;
            App.showBlockContentModal(card.dataset.blockId, {
                matchIndex: card.dataset.matchIndex ? parseInt(card.dataset.matchIndex, 10) : null
            });
        });

        // Badge clicks — allow editing/removing existing badges
        card.querySelectorAll('.kanban-badge').forEach(badge => {
            badge.addEventListener('click', (e) => {
                e.stopPropagation();
                const type = badge.dataset.type;

                if (type === 'due' || type === 'start') {
                    KanbanView.showDateMenu(badge, card);
                }

                if (type === 'assignee') {
                    const blockId = card.dataset.blockId;
                    const block = Store.blocks.find(b => b.id === blockId);
                    if (!block) return;

                    App.showAssigneeModal((contact) => {
                        KanbanView.updateTaskBadge(card, 'assignee', contact);
                    }, block.tags);
                }

                if (type === 'priority') {
                    KanbanView.showPriorityMenu(badge, card);
                }
            });
        });
    },

    setupMobileInteractions(card) {
        let longPressTimer = null;
        let longPressTriggered = false;

        card.addEventListener('touchstart', (e) => {
            longPressTriggered = false;
            longPressTimer = setTimeout(() => {
                longPressTriggered = true;
                const payload = KanbanView.buildDragPayload(card);
                KanbanView.showMoveModal(JSON.parse(payload));
            }, 500);
        }, { passive: true });

        card.addEventListener('touchmove', () => {
            clearTimeout(longPressTimer);
        }, { passive: true });

        card.addEventListener('touchend', () => {
            clearTimeout(longPressTimer);
        });
    },

    setupColumnDropTargets(columns) {
        columns.forEach(column => {
            const colContainer = column.closest('.kanban-column');

            column.addEventListener('dragover', (e) => {
                e.preventDefault(); // Necessary to allow dropping
                colContainer.classList.add('drag-over');
            });

            column.addEventListener('dragleave', () => {
                colContainer.classList.remove('drag-over');
            });

            column.addEventListener('drop', async (e) => {
                e.preventDefault();
                colContainer.classList.remove('drag-over');

                const targetColumn = KanbanView.getColumnById(colContainer.dataset.columnId);
                const targetState = targetColumn ? targetColumn.state : null;
                const dataJson = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');

                if (dataJson && targetState !== null) {
                    const data = JSON.parse(dataJson);
                    if (data.columnId === colContainer.dataset.columnId) {
                        return;
                    }
                    const block = Store.blocks.find(b => b.id === data.blockId);

                    if (block && block.content) {
                        // We need to update the file content
                        // the exact character sequence to replace is: [prefix][oldState]
                        // We can't use matchIndex blindly if file changed, but assuming no other edits happened it's fine.
                        // A safer way: re-parse blocks or do string splice
                        const content = block.content;
                        const targetPos = data.matchIndex + data.prefix.length + 1; // +1 for the '['

                        // Check if the bracket is indeed at targetPos
                        if (content[targetPos - 1] === '[' && content[targetPos + 1] === ']') {
                            const newStateLabel = targetColumn?.label || targetState;
                            const commitMessage = `Move task to ${newStateLabel}`;
                            const newContent = content.substring(0, targetPos) + targetState + content.substring(targetPos + 1);
                            await App.saveBlockContent(block.id, newContent, { commit: true, commitMessage });
                            App.render();
                        } else {
                            // Fallback: full re-render if indices don't match cleanly (e.g. concurrent edits)
                            App.render();
                        }
                    }
                }
            });
        });
    },

    attachEventListeners(container) {
        // Show/hide upcoming toggle
        container.querySelectorAll('.kanban-toggle-upcoming').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                KanbanView.showUpcoming = !KanbanView.showUpcoming;
                KanbanView.saveShowUpcoming(KanbanView.showUpcoming);
                App.render();
            });
        });

        // Swimlane collapse toggle
        container.querySelectorAll('.kanban-swimlane-label').forEach(label => {
            label.addEventListener('click', (e) => {
                const swimlane = label.closest('.kanban-swimlane');
                if (!swimlane) return;
                const key = swimlane.dataset.groupKey;
                const board = swimlane.querySelector('.kanban-board');
                const btn = label.querySelector('.kanban-swimlane-collapse');
                const isCollapsed = this.collapsedGroups.get(key) || false;
                this.collapsedGroups.set(key, !isCollapsed);
                if (isCollapsed) {
                    swimlane.classList.remove('kanban-swimlane-collapsed');
                    if (board) board.style.display = '';
                    if (btn) btn.innerHTML = '&#9660;';
                } else {
                    swimlane.classList.add('kanban-swimlane-collapsed');
                    if (board) board.style.display = 'none';
                    if (btn) btn.innerHTML = '&#9654;';
                }
            });
        });

        const cards = container.querySelectorAll('.kanban-card');
        const columns = container.querySelectorAll('.kanban-column .blocks');
        const isMobile = window.innerWidth <= 768;
        const dragState = { inProgress: false };

        // Disable native drag on mobile
        if (isMobile) {
            cards.forEach(card => card.setAttribute('draggable', 'false'));
        }

        cards.forEach(card => {
            KanbanView.setupCardDragDrop(card, dragState);
            KanbanView.setupCardClickHandlers(card, dragState);
            if (isMobile) {
                KanbanView.setupMobileInteractions(card);
            }
        });

        // Add-task buttons
        container.querySelectorAll('.kanban-add-task-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const col = KanbanView.getColumnById(btn.dataset.columnId);
                if (!col) return;
                KanbanView.showCreateTaskModal(col);
            });
        });

        KanbanView.setupColumnDropTargets(columns);
    },

    highlightAndScrollToCard(card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.remove('kanban-card-highlight');
        void card.offsetWidth;
        card.classList.add('kanban-card-highlight');
        setTimeout(() => card.classList.remove('kanban-card-highlight'), 1500);
    },

    showCreateTaskModal(col) {
        const assigneeOptions = Array.from(Store.contacts.keys())
            .map(name => `<option value="${Common.escapeHtml(name)}">${Common.escapeHtml(name)}</option>`)
            .join('');

        const content = `
            <div class="task-create-form">
                <input type="text" class="task-create-input" placeholder="Task description…" autofocus>
                <div class="task-create-fields">
                    <label>Priority
                        <select class="task-create-priority">
                            <option value="">—</option>
                            <option value="urgent">Urgent</option>
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                        </select>
                    </label>
                    <label>Assignee
                        <select class="task-create-assignee">
                            <option value="">—</option>
                            ${assigneeOptions}
                        </select>
                    </label>
                    <label>Due
                        <input type="date" class="task-create-due">
                    </label>
                    <label>Start
                        <input type="date" class="task-create-start">
                    </label>
                </div>
                <div class="task-create-actions">
                    <button class="modal-cancel-btn">Cancel</button>
                    <button class="modal-confirm-btn">Create</button>
                </div>
            </div>
        `;

        const modal = Modal.create({
            title: `New ${col.label} Task`,
            content,
            width: '420px',
            onClose: () => {}
        });

        const input = modal.querySelector('.task-create-input');
        const confirmBtn = modal.querySelector('.modal-confirm-btn');
        const cancelBtn = modal.querySelector('.modal-cancel-btn');

        const create = async () => {
            const desc = input.value.trim();
            if (!desc) { input.focus(); return; }

            let taskLine = `- [${col.state}] ${desc}`;
            const priority = modal.querySelector('.task-create-priority').value;
            if (priority) taskLine += ` [priority:: ${priority}]`;
            const assignee = modal.querySelector('.task-create-assignee').value;
            if (assignee) taskLine += ` [assignee:: ${assignee}]`;
            const due = modal.querySelector('.task-create-due').value;
            if (due) taskLine += ` [due:: ${due}]`;
            const start = modal.querySelector('.task-create-start').value;
            if (start) taskLine += ` [start:: ${start}]`;

            modal.close();
            const newBlock = await Store.createBlock(taskLine);
            TimelineView.invalidateCache();
            SelectionManager.updateTagCounts();
            await App.render();
            const container = document.getElementById('viewContainer');
            const newCard = container.querySelector(`.kanban-card[data-block-id="${newBlock.id}"]`);
            if (newCard) KanbanView.highlightAndScrollToCard(newCard);
        };

        confirmBtn.addEventListener('click', create);
        cancelBtn.addEventListener('click', () => modal.close());
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); create(); }
            if (e.key === 'Escape') modal.close();
        });
        input.focus();
    },

    showMoveModal(data) {
        const currentColumn = this.getColumnById(data.columnId);
        const columns = this.columns.filter(col => col.id !== data.columnId);

        const content = `
            <div style="padding-top: 10px; display: flex; flex-direction: column; gap: 8px;">
                ${columns.map(col => `
                    <button class="kanban-move-btn" data-target-column="${col.id}" style="
                        width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 6px;
                        background: var(--bg-primary, #fff); cursor: pointer; font-family: inherit;
                        font-size: 14px; font-weight: 500; text-align: left;
                    ">${col.label}</button>
                `).join('')}
            </div>
        `;

        const modal = Modal.create({
            title: `Move to...`,
            content,
            width: '280px'
        });

        modal.querySelectorAll('.kanban-move-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const targetColumnId = btn.dataset.targetColumn;
                const targetColumn = KanbanView.getColumnById(targetColumnId);
                if (!targetColumn) return;

                const block = Store.blocks.find(b => b.id === data.blockId);
                if (!block || !block.content) { modal.close(); return; }

                const blockContent = block.content;
                const targetPos = data.matchIndex + data.prefix.length + 1;

                if (blockContent[targetPos - 1] === '[' && blockContent[targetPos + 1] === ']') {
                    const commitMessage = `Move task to ${targetColumn.label}`;
                    const newContent = blockContent.substring(0, targetPos) + targetColumn.state + blockContent.substring(targetPos + 1);
                    await App.saveBlockContent(block.id, newContent, { commit: true, commitMessage });
                }

                modal.close();
                App.render();
            });
        });
    },

    /**
     * Update or remove a badge field on a task within block content and save.
     * Pass null as value to remove the badge.
     */
    updateTaskBadge(card, fieldName, value) {
        const block = Store.blocks.find(b => b.id === card.dataset.blockId);
        if (!block) return;

        const tasks = KanbanView.extractTasks([block]);
        const task = tasks.find(t => t.id === card.dataset.id);
        if (!task) return;

        let newText = task.originalText;
        const fieldRegex = new RegExp(`\\s*\\[${fieldName}::\\s*[^\\]]+\\]`, 'g');

        if (value === null) {
            newText = newText.replace(fieldRegex, '');
        } else if (fieldRegex.test(newText)) {
            newText = newText.replace(new RegExp(`\\[${fieldName}::\\s*[^\\]]+\\]`), `[${fieldName}:: ${value}]`);
        } else {
            newText += ` [${fieldName}:: ${value}]`;
        }

        const content = block.content;
        const beforeTask = content.substring(0, task.matchIndex);
        let nextNewline = content.indexOf('\n', task.matchIndex);
        if (nextNewline === -1) nextNewline = content.length;

        const newLine = task.prefix + '[' + task.state + '] ' + newText.trim();
        const newContent = beforeTask + newLine + content.substring(nextNewline);

        const action = value === null ? 'Remove' : 'Update';
        const commitMessage = `${action} ${fieldName} for '${task.text}'`;
        App.saveBlockContent(block.id, newContent, { commit: true, commitMessage }).then(() => {
            App.render();
        });
    },

    /**
     * Show a floating menu with unified due/start date picker.
     */
    showDateMenu(badgeOrBtn, card) {
        const existing = document.querySelector('.kanban-date-menu');
        if (existing) existing.remove();

        // Read current badge values from the card
        const dueBadge = card.querySelector('.kanban-badge[data-type="due"]');
        const startBadge = card.querySelector('.kanban-badge[data-type="start"]');
        const dueValue = dueBadge ? (dueBadge.dataset.value || '') : '';
        const startValue = startBadge ? (startBadge.dataset.value || '') : '';
        const hasStart = !!startValue;

        const menu = document.createElement('div');
        menu.className = 'kanban-date-menu';

        // Due row
        const dueLabel = document.createElement('label');
        dueLabel.className = 'kanban-date-field';
        dueLabel.innerHTML = '<span>Due</span>';
        const dueInput = document.createElement('input');
        dueInput.type = 'date';
        dueInput.value = dueValue;
        dueLabel.appendChild(dueInput);

        // Start toggle
        const startToggle = document.createElement('button');
        startToggle.type = 'button';
        startToggle.className = 'kanban-date-start-toggle';
        startToggle.innerHTML = hasStart
            ? '<span class="kanban-date-arrow expanded">▸</span> Start date'
            : '<span class="kanban-date-arrow">▸</span> Start date';

        // Start row
        const startRow = document.createElement('div');
        startRow.className = 'kanban-date-start-row' + (hasStart ? ' expanded' : '');
        const startLabel = document.createElement('label');
        startLabel.className = 'kanban-date-field';
        startLabel.innerHTML = '<span>Start</span>';
        const startInput = document.createElement('input');
        startInput.type = 'date';
        startInput.value = startValue;
        startLabel.appendChild(startInput);
        startRow.appendChild(startLabel);

        startToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isExpanded = startRow.classList.toggle('expanded');
            startToggle.querySelector('.kanban-date-arrow').classList.toggle('expanded', isExpanded);
            if (isExpanded) startInput.focus();
        });

        menu.appendChild(dueLabel);
        menu.appendChild(startToggle);
        menu.appendChild(startRow);

        const rect = badgeOrBtn.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.left = rect.left + 'px';
        menu.style.top = (rect.bottom + 4) + 'px';
        menu.style.zIndex = '1000';

        document.body.appendChild(menu);

        const close = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', close);
            }
        };
        document.addEventListener('click', close);

        // Apply changes on any date input change
        dueInput.addEventListener('change', () => {
            if (dueInput.value) {
                KanbanView.updateTaskBadge(card, 'due', dueInput.value);
            } else {
                KanbanView.updateTaskBadge(card, 'due', null);
            }
            menu.remove();
            document.removeEventListener('click', close);
        });

        startInput.addEventListener('change', () => {
            if (startInput.value) {
                KanbanView.updateTaskBadge(card, 'start', startInput.value);
            } else {
                KanbanView.updateTaskBadge(card, 'start', null);
            }
            menu.remove();
            document.removeEventListener('click', close);
        });
    },

    /**
     * Show a floating priority picker near the action button or badge.
     */
    showPriorityMenu(btn, card) {
        const existing = document.querySelector('.kanban-priority-menu');
        if (existing) existing.remove();

        const priorities = [
            { value: 'Urgent', color: '#ef4444' },
            { value: 'High', color: '#f97316' },
            { value: 'Medium', color: '#3b82f6' },
            { value: 'Low', color: '#94a3b8' }
        ];

        const menu = document.createElement('div');
        menu.className = 'kanban-priority-menu';
        menu.innerHTML = priorities.map(p =>
            `<button class="kanban-priority-option" data-priority="${p.value}" style="color: ${p.color};">${p.value}</button>`
        ).join('') + `<button class="kanban-priority-option" data-priority="" style="color: var(--text-muted);">Clear</button>`;

        const rect = btn.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.left = rect.left + 'px';
        menu.style.top = (rect.bottom + 4) + 'px';
        menu.style.zIndex = '1000';

        document.body.appendChild(menu);

        // Close on outside click
        const close = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', close);
            }
        };
        document.addEventListener('click', close);

        menu.querySelectorAll('.kanban-priority-option').forEach(opt => {
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                const val = opt.dataset.priority;
                KanbanView.updateTaskBadge(card, 'priority', val || null);
                menu.remove();
                document.removeEventListener('click', close);
            });
        });
    }
};
