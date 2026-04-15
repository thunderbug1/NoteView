/**
 * Deadline Panel - Renders upcoming/overdue deadline alerts into the right sidebar
 */

const DeadlinePanel = {
    _clickHandler: null,

    render(blocks) {
        const container = document.querySelector('#sidebarRight .sidebar-scroll');
        if (!container) return;

        // Set up delegated click handler once
        if (!this._clickHandler) {
            this._clickHandler = (e) => {
                const item = e.target.closest('.deadline-item');
                if (item) {
                    const blockId = item.dataset.blockId;
                    const matchIndex = item.dataset.matchIndex ? parseInt(item.dataset.matchIndex, 10) : null;
                    if (blockId && typeof App !== 'undefined') {
                        const editor = DocumentView.editors.get(blockId);
                        if (editor) {
                            DocumentView.highlightAndScrollTo(blockId, editor, matchIndex);
                            editor.focus();
                        } else {
                            App.showBlockContentModal(blockId, { matchIndex });
                        }
                    }
                }
            };
            container.addEventListener('click', this._clickHandler);
        }

        const items = TaskParser.getTasksWithUrgency(blocks);

        if (items.length === 0) {
            container.innerHTML = `
                <div class="deadline-panel">
                    <div class="sidebar-section">
                        <div class="section-header"><h3>Deadlines</h3></div>
                        <div class="deadline-empty">No upcoming deadlines</div>
                    </div>
                </div>`;
            return;
        }

        const groups = this._groupByUrgency(items);
        let html = '<div class="deadline-panel">';
        html += '<div class="sidebar-section"><div class="section-header"><h3>Deadlines</h3></div>';

        const labels = {
            overdue: 'Overdue',
            'upcoming-soon': 'Today',
            upcoming: 'Coming up'
        };

        for (const key of ['overdue', 'upcoming-soon', 'upcoming']) {
            const group = groups[key];
            if (!group || group.length === 0) continue;
            html += `<div class="deadline-group">
                <div class="deadline-group-header">${labels[key]}</div>
                <div class="deadline-group-items">
                    ${group.map(({ task, urgency }) => this.renderDeadlineItem(task, urgency)).join('')}
                </div>
            </div>`;
        }

        html += '</div></div>';
        container.innerHTML = html;
    },

    renderDeadlineItem(task, urgency) {
        const dateLabel = TaskParser.getDueDateString(task);
        return `<div class="deadline-item" data-block-id="${task.blockId}" data-task-id="${task.id}" data-match-index="${task.matchIndex}">
            <span class="deadline-item-indicator deadline-indicator-${urgency}"></span>
            <div class="deadline-item-content">
                <span class="deadline-item-text">${escapeHtml(task.text)}</span>
                <span class="deadline-item-date date-${urgency}">${escapeHtml(dateLabel)}</span>
            </div>
        </div>`;
    },

    _groupByUrgency(items) {
        const groups = { overdue: [], 'upcoming-soon': [], upcoming: [] };
        for (const item of items) {
            if (groups[item.urgency]) {
                groups[item.urgency].push(item);
            }
        }
        return groups;
    }
};
