/**
 * Kanban View - Columns defined by todo state
 */

const KanbanView = {
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

    render(blocks) {
        const container = document.getElementById('viewContainer');
        container.className = 'kanban-view';

        const tasks = this.extractTasks(blocks);
        const hierarchy = this.buildTaskHierarchy(tasks);

        let html = '';
        this.columns.forEach(col => {
            const colTasks = tasks.filter(t => t.state === col.state);
            const tasksById = new Map(colTasks.map(t => [t.id, t]));
            const colHtml = this.renderColumnTasks(colTasks, hierarchy, tasksById);

            html += `
                <div class="kanban-column" data-column-id="${col.id}">
                    <h4>${col.label} <span class="count">(${colTasks.length})</span></h4>
                    <div class="blocks">
                        ${colHtml}
                    </div>
                </div>
            `;
        });

        container.innerHTML = `<div class="kanban-board">${html}</div>`;
        this.attachEventListeners(container);
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
            if (contextSelection.has('Status.unassigned') && !TaskParser.isUnassignedTask(task, { onlyActive: true })) {
                return false;
            }
            return true;
        });
    },

    renderTaskCard(task, depth = 0) {
        const column = this.getColumnByState(task.state);
        const nestedClass = depth > 0 ? ' kanban-card--nested' : '';
        const nestedStyle = depth > 0 ? ` style="margin-left: ${depth * 1.25}rem;"` : '';
        const urgency = TaskParser.getDeadlineUrgency(task);
        const urgencyClass = urgency ? ` deadline-${urgency}` : '';

        const hasDue = task.badges.some(b => b.type === 'due');
        const hasAssignee = task.badges.some(b => b.type === 'assignee');
        const hasPriority = task.badges.some(b => b.type === 'priority');

        let actionBtns = '';
        if (!hasDue) {
            actionBtns += `<button class="kanban-action-btn" data-action="due" title="Add deadline"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg></button>`;
        }
        if (!hasAssignee) {
            actionBtns += `<button class="kanban-action-btn" data-action="assignee" title="Add assignee"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></button>`;
        }
        if (!hasPriority) {
            actionBtns += `<button class="kanban-action-btn" data-action="priority" title="Add priority"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg></button>`;
        }
        // Copy button — always shown
        actionBtns += `<button class="kanban-action-btn" data-action="copy" title="Copy task text"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>`;

        return `
            <div class="block kanban-card${nestedClass}${urgencyClass}" draggable="true" data-id="${task.id}" data-block-id="${task.blockId}" data-match-index="${task.matchIndex}" data-match-length="${task.matchLength}" data-prefix="${task.prefix}" data-column-id="${column ? column.id : ''}" data-depth="${depth}"${nestedStyle}>
                <div class="kanban-card-content">
                    <p class="kanban-task-text">${escapeHtml(task.text)}</p>
                    <div class="kanban-action-btns">${actionBtns}</div>
                    <div class="kanban-card-footer">
                        ${task.badges.map(b => {
                            const dueUrgencyCls = (b.type === 'due' && urgency) ? ` badge-due-${urgency}` : '';
                            return `<span class="badge badge-${b.type} kanban-badge${dueUrgencyCls}" data-type="${b.type}" data-value="${b.value}"${b.type === 'priority' ? ` data-priority="${b.value.toLowerCase()}"` : ''}>${escapeHtml(b.type)}: ${escapeHtml(b.value)}</span>`;
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
    renderColumnTasks(colTasks, hierarchy, tasksById) {
        const colTaskIds = new Set(colTasks.map(t => t.id));

        // Roots: parentId is null OR parent not in this column
        const rootTasks = colTasks.filter(t => {
            const entry = hierarchy.get(t.id);
            return !entry.parentId || !colTaskIds.has(entry.parentId);
        });

        const sortedRoots = SortManager.sortItems('kanban', rootTasks);
        let html = '';
        for (const root of sortedRoots) {
            html += this.renderTaskWithChildren(root, hierarchy, tasksById, colTaskIds, 0);
        }
        return html;
    },

    /**
     * Recursively render a task card and its children that are in the same column.
     */
    renderTaskWithChildren(task, hierarchy, tasksById, colTaskIds, depth) {
        let html = this.renderTaskCard(task, depth);
        const entry = hierarchy.get(task.id);
        for (const childId of entry.children) {
            if (colTaskIds.has(childId)) {
                const childTask = tasksById.get(childId);
                if (childTask) {
                    html += this.renderTaskWithChildren(childTask, hierarchy, tasksById, colTaskIds, depth + 1);
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

                if (action === 'due') {
                    const dateInput = document.createElement('input');
                    dateInput.type = 'date';
                    dateInput.style.position = 'absolute';
                    dateInput.style.opacity = '0';
                    dateInput.style.pointerEvents = 'none';
                    document.body.appendChild(dateInput);

                    dateInput.addEventListener('change', () => {
                        if (dateInput.value) {
                            KanbanView.updateTaskBadge(card, 'due', dateInput.value);
                        }
                        dateInput.remove();
                    });

                    dateInput.addEventListener('blur', () => {
                        dateInput.remove();
                    });

                    // Position near the button
                    const rect = btn.getBoundingClientRect();
                    dateInput.style.left = rect.left + 'px';
                    dateInput.style.top = rect.bottom + 'px';
                    dateInput.showPicker ? dateInput.showPicker() : dateInput.click();
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

                if (type === 'due') {
                    KanbanView.showDueMenu(badge, card);
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

        KanbanView.setupColumnDropTargets(columns);
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
     * Show a floating menu with date picker and clear option for due date.
     */
    showDueMenu(badgeOrBtn, card) {
        const existing = document.querySelector('.kanban-due-menu');
        if (existing) existing.remove();

        const currentValue = badgeOrBtn.dataset ? (badgeOrBtn.dataset.value || '') : '';

        const menu = document.createElement('div');
        menu.className = 'kanban-due-menu';
        menu.innerHTML = `
            <input type="date" value="${currentValue}" style="width:100%; padding:6px; box-sizing:border-box; border:1px solid var(--border); border-radius:4px; font-family:inherit; font-size:0.85rem;">
            <button class="kanban-due-clear" style="width:100%; padding:6px; background:transparent; border:none; cursor:pointer; color:var(--text-muted); font-size:0.8rem; text-align:center; font-family:inherit;">Clear</button>
        `;

        const rect = badgeOrBtn.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.left = rect.left + 'px';
        menu.style.top = (rect.bottom + 4) + 'px';
        menu.style.zIndex = '1000';

        document.body.appendChild(menu);

        const dateInput = menu.querySelector('input[type="date"]');
        dateInput.focus();

        const close = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', close);
            }
        };
        setTimeout(() => document.addEventListener('click', close), 0);

        dateInput.addEventListener('change', () => {
            if (dateInput.value) {
                KanbanView.updateTaskBadge(card, 'due', dateInput.value);
            }
            menu.remove();
            document.removeEventListener('click', close);
        });

        menu.querySelector('.kanban-due-clear').addEventListener('click', (e) => {
            e.stopPropagation();
            KanbanView.updateTaskBadge(card, 'due', null);
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
        setTimeout(() => document.addEventListener('click', close), 0);

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
