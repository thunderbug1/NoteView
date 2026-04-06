/**
 * Task Menus Module - Context menus for task management
 * Provides menus for changing task states and setting priorities
 */

/**
 * Create task menu functions bound to a DocumentView instance
 * @param {Object} documentView - The DocumentView instance
 * @returns {Object} Object containing menu functions
 */
function createTaskMenus(documentView) {

    /**
     * Show task state context menu
     * @param {number} x - X coordinate for menu position
     * @param {number} y - Y coordinate for menu position
     * @param {Object} view - CodeMirror view instance
     * @param {number} from - Start position of task checkbox
     * @param {number} to - End position of task checkbox
     * @param {string} currentState - Current task state character
     */
    function showTaskMenu(x, y, view, from, to, currentState) {
        let existing = document.getElementById('taskContextMenu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.id = 'taskContextMenu';
        menu.className = 'task-context-menu';

        // Ensure menu stays within viewport
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Approximate menu size
        const menuWidth = 200;
        const menuHeight = 200;

        let menuX = x;
        let menuY = y;

        if (menuX + menuWidth > viewportWidth) menuX = viewportWidth - menuWidth - 10;
        if (menuY + menuHeight > viewportHeight) menuY = viewportHeight - menuHeight - 10;

        menu.style.left = `${menuX}px`;
        menu.style.top = `${menuY}px`;

        const states = [
            { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>', label: 'Todo', val: ' ' },
            { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 16 16 12 12 8"></polyline><line x1="8" y1="12" x2="16" y2="12"></line></svg>', label: 'In Progress', val: '/' },
            { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>', label: 'Done', val: 'x' },
            { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>', label: 'Blocked', val: 'b' },
            { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>', label: 'Canceled', val: '-' }
        ];

        let html = '<div class="menu-section"><div class="menu-title">State</div>';
        states.forEach(s => {
            const isActive = (currentState.toLowerCase() === s.val || (currentState === ' ' && s.val === ' ')) ? 'active' : '';
            html += `<div class="menu-item ${isActive}" data-action="state" data-val="${s.val}">
                <span class="icon">${s.icon}</span> ${s.label}
            </div>`;
        });
        html += '</div>';

        menu.innerHTML = html;
        document.body.appendChild(menu);

        setTimeout(() => {
            const closeMenu = (e) => {
                if (!document.body.contains(menu)) {
                    document.removeEventListener('click', closeMenu);
                    return;
                }
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            };
            document.addEventListener('click', closeMenu);

            menu.addEventListener('click', (e) => {
                const item = e.target.closest('.menu-item');
                if (!item) return;

                const action = item.dataset.action;
                if (action === 'state') {
                    const newVal = item.dataset.val;
                    view.dispatch({ changes: { from, to, insert: `[${newVal}]` } });
                }
                menu.remove();
                document.removeEventListener('click', closeMenu);
            });
        }, 100);
    }

    /**
     * Show priority selection menu
     * @param {number} x - X coordinate for menu position
     * @param {number} y - Y coordinate for menu position
     * @param {Object} view - CodeMirror view instance
     * @param {number} from - Start position of task checkbox
     * @param {number} to - End position of task checkbox
     */
    function showPriorityMenu(x, y, view, from, to) {
        let existing = document.getElementById('taskContextMenu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.id = 'taskContextMenu';
        menu.className = 'task-context-menu';
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        const priorities = [
            { label: 'Urgent', color: '#ef4444' },
            { label: 'High', color: '#f97316' },
            { label: 'Medium', color: '#3b82f6' },
            { label: 'Low', color: '#94a3b8' }
        ];

        let html = '<div class="menu-section"><div class="menu-title">Set Priority</div>';
        priorities.forEach(p => {
            html += `<div class="menu-item" data-action="set-priority" data-val="${p.label}">
                <span class="icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${p.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg></span> ${p.label}
            </div>`;
        });
        html += '<div class="menu-divider"></div>';
        html += `<div class="menu-item" data-action="set-priority" data-val="">
            <span class="icon">&times;</span> Clear Priority
        </div>`;
        html += '</div>';

        menu.innerHTML = html;
        document.body.appendChild(menu);

        setTimeout(() => {
            const closeMenu = (e) => {
                if (!document.body.contains(menu)) {
                    document.removeEventListener('click', closeMenu);
                    return;
                }
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            };
            document.addEventListener('click', closeMenu);

            menu.addEventListener('click', (e) => {
                const item = e.target.closest('.menu-item');
                if (!item) return;

                const val = item.dataset.val;
                if (val !== undefined) {
                    // Check if priority already exists on the line to replace it
                    const line = view.state.doc.lineAt(from);
                    const regex = /\[priority::\s*[^\]]+\]/;
                    const match = line.text.match(regex);

                    if (match) {
                        const matchFrom = line.from + match.index;
                        const matchTo = matchFrom + match[0].length;
                        const replacement = val ? `[priority:: ${val}]` : '';
                        view.dispatch({ changes: { from: matchFrom, to: matchTo, insert: replacement } });
                    } else if (val) {
                        documentView.appendInlineField(view, from, to, 'priority', val);
                    }
                }
                menu.remove();
                document.removeEventListener('click', closeMenu);
            });
        }, 100);
    }

    /**
     * Append an inline field to the end of a task line
     * @param {Object} view - CodeMirror view instance
     * @param {number} checkFrom - Start position of task checkbox
     * @param {number} checkTo - End position of task checkbox
     * @param {string} key - Field key (e.g., 'due', 'assignee', 'priority')
     * @param {string} value - Field value
     */
    function appendInlineField(view, checkFrom, checkTo, key, value) {
        const line = view.state.doc.lineAt(checkFrom);
        const insertPos = line.to;
        // Append field at end of line
        const insertText = ` [${key}:: ${value}]`;
        view.dispatch({ changes: { from: insertPos, to: insertPos, insert: insertText } });
    }

    return {
        showTaskMenu,
        showPriorityMenu,
        appendInlineField
    };
}

// Export for use in other modules
window.TaskMenus = {
    create: createTaskMenus
};
