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

    render(blocks) {
        const container = document.getElementById('viewContainer');
        container.className = 'kanban-view';
        
        const tasks = this.extractTasks(blocks);
        
        let html = '';
        this.columns.forEach(col => {
            const colTasks = SortManager.sortItems('kanban', tasks.filter(t => t.state === col.state));
            html += `
                <div class="kanban-column" data-column-id="${col.id}">
                    <h4>${col.label} <span class="count">(${colTasks.length})</span></h4>
                    <div class="blocks">
                        ${colTasks.map(task => this.renderTaskCard(task)).join('')}
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

        if (!contextSelection || contextSelection.size === 0) {
            return tasks;
        }

        return tasks.filter(task => {
            if (contextSelection.has('openTodos') && !TaskParser.isOpenTask(task)) {
                return false;
            }
            if (contextSelection.has('blockedTodos') && !TaskParser.isBlockedTask(task)) {
                return false;
            }
            if (contextSelection.has('unblockedTodos') && !TaskParser.isUnblockedTask(task)) {
                return false;
            }
            if (contextSelection.has('unassigned') && !TaskParser.isUnassignedTask(task)) {
                return false;
            }
            return true;
        });
    },

    renderTaskCard(task) {
        const column = this.getColumnByState(task.state);
        return `
            <div class="block kanban-card" draggable="true" data-id="${task.id}" data-block-id="${task.blockId}" data-match-index="${task.matchIndex}" data-match-length="${task.matchLength}" data-prefix="${task.prefix}" data-column-id="${column ? column.id : ''}">
                <div class="kanban-card-content">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <p class="kanban-task-text">${escapeHtml(task.text)}</p>
                        <button class="kanban-edit-btn" title="Edit properties" style="background:transparent; border:none; cursor:pointer; color:var(--text-muted); padding:2px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
                    </div>
                    <div class="kanban-card-footer">
                        ${task.badges.map(b => `<span class="badge badge-${b.type} kanban-badge" data-type="${b.type}" data-value="${b.value}">${escapeHtml(b.type)}: ${escapeHtml(b.value)}</span>`).join('')}
                    </div>
                </div>
            </div>
        `;
    },

    attachEventListeners(container) {
        const cards = container.querySelectorAll('.kanban-card');
        const columns = container.querySelectorAll('.kanban-column .blocks');
        let dragInProgress = false;

        const buildDragPayload = (card) => JSON.stringify({
            id: card.dataset.id,
            blockId: card.dataset.blockId,
            matchIndex: parseInt(card.dataset.matchIndex, 10),
            matchLength: parseInt(card.dataset.matchLength, 10),
            prefix: card.dataset.prefix,
            columnId: card.dataset.columnId
        });

        // Card dragging
        cards.forEach(card => {
            card.addEventListener('dragstart', (e) => {
                card.classList.add('dragging');
                dragInProgress = true;

                const payload = buildDragPayload(card);
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', payload);
                    e.dataTransfer.setData('application/json', payload);
                }
            });

            card.addEventListener('dragend', () => {
                card.classList.remove('dragging');
                setTimeout(() => {
                    dragInProgress = false;
                }, 0);
            });
            
            // Edit modal on click
            const editBtn = card.querySelector('.kanban-edit-btn');
            if (editBtn) {
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const block = Store.blocks.find(b => b.id === card.dataset.blockId);
                    if (block) {
                        const tasks = KanbanView.extractTasks([block]);
                        const taskToEdit = tasks.find(t => t.id === card.dataset.id);
                        if (taskToEdit) {
                            KanbanView.showEditModal(taskToEdit, block);
                        }
                    }
                });
            }

            // Edit on card click
            card.addEventListener('click', (e) => {
                if (dragInProgress) return;
                if (e.target.closest('.kanban-badge')) return; // Ignore if badge clicked
                if (e.target.closest('.kanban-edit-btn')) return;
                App.showBlockContentModal(card.dataset.blockId);
            });

            // Badge clicks
            card.querySelectorAll('.kanban-badge').forEach(badge => {
                badge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const type = badge.dataset.type;
                    if (type === 'assignee') {
                        const blockId = card.dataset.blockId;
                        const block = Store.blocks.find(b => b.id === blockId);
                        if (!block) return;
                        
                        App.showAssigneeModal((contact) => {
                            // Find the exact task in block content and update it
                            // Re-extract tasks to find the exact one in current content
                            const tasks = KanbanView.extractTasks([block]);
                            const taskToUpdate = tasks.find(t => t.id === card.dataset.id);
                            
                            if (taskToUpdate) {
                                // Update assignee in originalText
                                let newText = taskToUpdate.originalText;
                                if (newText.includes('[assignee::')) {
                                    newText = newText.replace(/\[assignee::\s*[^\]]+\]/, `[assignee:: ${contact}]`);
                                } else {
                                    newText += ` [assignee:: ${contact}]`;
                                }
                                
                                const content = block.content;
                                const beforeTask = content.substring(0, taskToUpdate.matchIndex);
                                let nextNewline = content.indexOf('\n', taskToUpdate.matchIndex);
                                if (nextNewline === -1) nextNewline = content.length;
                                
                                const newLine = taskToUpdate.prefix + '[' + taskToUpdate.state + '] ' + newText;
                                const newContent = beforeTask + newLine + content.substring(nextNewline);
                                
                                const commitMessage = `Update assignee for '${taskToUpdate.text}'`;
                                App.saveBlockContent(block.id, newContent, { commit: true, commitMessage }).then(() => {
                                    App.render();
                                });
                            }
                        }, block.tags);
                    }
                });
            });
        });

        // Column dropping
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

    showEditModal(task, block) {
        const due = TaskParser.getBadgeValue(task, 'due');
        const assignee = TaskParser.getBadgeValue(task, 'assignee');
        const priority = TaskParser.getBadgeValue(task, 'priority');

        const content = `
            <div style="padding-top: 10px;">
                <div style="margin-bottom: 10px;">
                    <label style="display:block; margin-bottom:5px; font-weight:bold; font-size:12px; color:var(--text-secondary);">Deadline</label>
                    <input type="date" id="editModalDue" value="${due}" style="width:100%; padding:8px; box-sizing:border-box; border:1px solid var(--border-color); border-radius:4px; font-family:inherit;">
                </div>
                <div style="margin-bottom: 10px;">
                    <label style="display:block; margin-bottom:5px; font-weight:bold; font-size:12px; color:var(--text-secondary);">Assignee</label>
                    <div style="display: flex; gap: 8px;">
                        <input type="text" id="editModalAssignee" value="${assignee}" placeholder="@username" style="flex:1; padding:8px; box-sizing:border-box; border:1px solid var(--border-color); border-radius:4px; font-family:inherit;">
                        <button id="editModalAssigneeBtn" style="padding: 0 10px; background:var(--bg-hover, #f1f5f9); border:1px solid var(--border-color); border-radius:4px; cursor:pointer;" title="Select from Contacts">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                        </button>
                    </div>
                </div>
                <div style="margin-bottom: 15px;">
                    <label style="display:block; margin-bottom:5px; font-weight:bold; font-size:12px; color:var(--text-secondary);">Priority</label>
                    <select id="editModalPriority" style="width:100%; padding:8px; box-sizing:border-box; border:1px solid var(--border-color); border-radius:4px; font-family:inherit;">
                        <option value="" ${!priority ? 'selected' : ''}>None</option>
                        <option value="Urgent" ${priority === 'Urgent' ? 'selected' : ''}>Urgent</option>
                        <option value="High" ${priority === 'High' ? 'selected' : ''}>High</option>
                        <option value="Medium" ${priority === 'Medium' ? 'selected' : ''}>Medium</option>
                        <option value="Low" ${priority === 'Low' ? 'selected' : ''}>Low</option>
                    </select>
                </div>
                <button id="editModalSave" style="width:100%; padding:8px; background:var(--accent-color, #3b82f6); color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">Save</button>
                <button id="editModalOpenDoc" style="width:100%; padding:8px; background:transparent; color:var(--text-secondary); border:1px solid var(--border-color); border-radius:4px; cursor:pointer; margin-top:8px;">Open Document</button>
            </div>
        `;

        const modal = Modal.create({
            title: 'Edit Task',
            content,
            width: '300px'
        });

        modal.querySelector('#editModalOpenDoc').addEventListener('click', () => {
            modal.close();
            App.editBlock(task.blockId);
        });

        modal.querySelector('#editModalAssigneeBtn').addEventListener('click', (e) => {
            e.preventDefault();
            App.showAssigneeModal((contact) => {
                document.getElementById('editModalAssignee').value = contact;
            }, block.tags);
        });

        modal.querySelector('#editModalSave').addEventListener('click', async () => {
            const nDue = document.getElementById('editModalDue').value;
            const nAssignee = document.getElementById('editModalAssignee').value.trim();
            const nPriority = document.getElementById('editModalPriority').value;

            const allBadgeRegex = /\s*\[([a-zA-Z0-9_]+)::\s*([^\]]+)\]/g;
            let newText = task.originalText;

            const keepTags = [];
            let match;
            while ((match = allBadgeRegex.exec(task.originalText)) !== null) {
                if (!['due', 'assignee', 'priority'].includes(match[1])) {
                    keepTags.push(`[${match[1]}:: ${match[2]}]`);
                }
            }

            newText = newText.replace(/\s*\[([a-zA-Z0-9_]+)::\s*([^\]]+)\]/g, '').trimEnd();

            if (nDue) newText += ` [due:: ${nDue}]`;
            if (nAssignee) newText += ` [assignee:: ${nAssignee}]`;
            if (nPriority) newText += ` [priority:: ${nPriority}]`;
            keepTags.forEach(t => newText += ` ${t}`);

            const blockContent = block.content;
            const beforeTask = blockContent.substring(0, task.matchIndex);
            let nextNewline = blockContent.indexOf('\n', task.matchIndex);
            if (nextNewline === -1) nextNewline = blockContent.length;

            const newLine = task.prefix + '[' + task.state + '] ' + newText;
            const newContent = beforeTask + newLine + blockContent.substring(nextNewline);

            const commitMessage = `Update properties for '${task.text}'`;
            await App.saveBlockContent(block.id, newContent, { commit: true, commitMessage });

            modal.close();
            App.render();
        });
    }
};
