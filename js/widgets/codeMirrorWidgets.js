/**
 * CodeMirror Widgets - Widget classes for live markdown preview
 * Provides interactive widgets for tasks, badges, and inline fields
 */

/**
 * Show a popover for editing or removing a due date badge.
 * Works on both desktop and mobile (touch-friendly).
 */
function showDuePopover(event, view, from, to, currentValue) {
    // Close any existing popover
    document.querySelector('.due-popover')?.remove();

    const popover = document.createElement('div');
    popover.className = 'due-popover';

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = currentValue.trim();
    dateInput.className = 'due-popover-input';

    const btnRow = document.createElement('div');
    btnRow.className = 'due-popover-actions';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.className = 'due-popover-btn due-popover-save';
    saveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dateInput.value) {
            view.dispatch({ changes: { from, to, insert: `[due:: ${dateInput.value}]` } });
        }
        popover.remove();
    });

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.className = 'due-popover-btn due-popover-remove';
    removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        view.dispatch({ changes: { from, to, insert: '' } });
        popover.remove();
    });

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(removeBtn);
    popover.appendChild(dateInput);
    popover.appendChild(btnRow);
    document.body.appendChild(popover);

    // Position near the click/tap
    const rect = (event.target instanceof HTMLElement ? event.target : event.target.parentElement).getBoundingClientRect();
    const popW = 220;
    let left = rect.left + rect.width / 2 - popW / 2;
    let top = rect.bottom + 6;
    // Keep within viewport
    left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
    if (top + 120 > window.innerHeight) top = rect.top - 120;
    popover.style.left = left + 'px';
    popover.style.top = top + 'px';

    // Close on outside click/tap
    const closeOnOutside = (e) => {
        if (!popover.contains(e.target)) {
            popover.remove();
            document.removeEventListener('mousedown', closeOnOutside);
            document.removeEventListener('touchstart', closeOnOutside);
        }
    };
    // Delay to avoid the opening click immediately closing it
    setTimeout(() => {
        document.addEventListener('mousedown', closeOnOutside);
        document.addEventListener('touchstart', closeOnOutside, { passive: true });
    }, 0);

    dateInput.addEventListener('mousedown', (e) => e.stopPropagation());
    dateInput.addEventListener('change', () => {
        if (dateInput.value) {
            view.dispatch({ changes: { from, to, insert: `[due:: ${dateInput.value}]` } });
        }
        popover.remove();
    });

    // Auto-focus the date input
    setTimeout(() => dateInput.focus(), 10);
}

/**
 * Create CodeMirror widget classes with access to DocumentView methods
 * @param {Object} documentView - The DocumentView instance containing helper methods
 * @returns {Object} Object containing all widget classes
 */
function createCodeMirrorWidgets(documentView) {
    const { WidgetType } = window.CodeMirror;

    class CheckboxWidget extends WidgetType {
        constructor(state, from, to) {
            super();
            this.state = state;
            this.from = from;
            this.to = to;
        }
        eq(other) {
            return other.state === this.state && other.from === this.from && other.to === this.to;
        }
        toDOM(view) {
            const wrap = document.createElement("span");
            const stateClassMap = { ' ': 'todo', 'x': 'done', 'X': 'done', '/': 'progress', 'b': 'blocked', 'B': 'blocked', '-': 'canceled' };
            const safeState = stateClassMap[this.state] || 'todo';
            wrap.className = `md-task-checkbox state-${safeState}`;
            wrap.dataset.state = this.state;

            let icon = '';
            if (safeState === 'done') icon = '<svg viewBox="0 0 14 14" width="10" height="10"><path d="M1 7l4 4 8-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            else if (safeState === 'progress') icon = '<div class="half-fill"></div>';
            else if (safeState === 'blocked') icon = '<svg viewBox="0 0 14 14" width="10" height="10"><path d="M2 2l10 10M12 2L2 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
            else if (safeState === 'canceled') icon = '<svg viewBox="0 0 14 14" width="10" height="10"><path d="M2 7h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

            if (icon) wrap.innerHTML = icon;

            wrap.onmousedown = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const newState = (this.state === 'x' || this.state === 'X') ? ' ' : 'x';
                view.dispatch({ changes: { from: this.from, to: this.to, insert: `[${newState}]` } });
            };
            wrap.oncontextmenu = (e) => {
                e.preventDefault();
                if (documentView.showTaskMenu) {
                    documentView.showTaskMenu(e.pageX, e.pageY, view, this.from, this.to, this.state);
                }
            };
            return wrap;
        }
        ignoreEvent() { return true; }
    }

    class BadgeWidget extends WidgetType {
        constructor(type, value, from, to) {
            super();
            this.type = type;
            this.value = value;
            this.from = from;
            this.to = to;
        }
        eq(other) {
            return other.type === this.type && other.value === this.value && other.from === this.from;
        }
        toDOM(view) {
            const wrap = document.createElement("span");
            wrap.className = `md-task-badge badge-${this.type}`;

            if (this.type === 'due') {
                wrap.innerHTML = `<span class="icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:2px; vertical-align:text-top;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg></span> ${this.value}`;
                // Set urgency data attribute for overdue/upcoming styling
                try {
                    const line = view.state.doc.lineAt(this.from);
                    const stateMatch = line.text.match(/^\s*[-*+]\s+\[([ xX\/bB\-])\]/);
                    const isOpen = stateMatch && (stateMatch[1] === ' ' || stateMatch[1] === '/');
                    if (isOpen) {
                        const urgency = TaskParser.getDeadlineUrgency({
                            state: stateMatch[1],
                            badges: [{ type: 'due', value: this.value.trim() }]
                        });
                        if (urgency) wrap.dataset.urgency = urgency;
                    }
                } catch (_) { /* ignore line lookup errors */ }
                wrap.title = 'Tap to edit';
            } else if (this.type === 'assignee') {
                wrap.innerHTML = `<span class="icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:2px; vertical-align:text-top;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></span> ${this.value}`;
            } else if (this.type === 'priority') {
                const colors = { 'urgent': '#ef4444', 'high': '#f97316', 'medium': '#3b82f6', 'low': '#94a3b8' };
                const color = colors[this.value.toLowerCase()] || 'currentColor';
                wrap.dataset.priority = this.value.toLowerCase();
                wrap.innerHTML = `<span class="icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="3" style="margin-right:2px; vertical-align:text-top;"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg></span> ${this.value}`;
            } else if (this.type === 'id') {
                wrap.innerHTML = `<span class="icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:2px; vertical-align:text-top;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></span> ${this.value}`;
            }

            const handleBadgeClick = (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (this.type === 'due') {
                    showDuePopover(e, view, this.from, this.to, this.value);
                    return;
                }

                if (this.type === 'assignee') {
                    const blockId = view.dom.parentElement.dataset.id;
                    const block = Store.blocks.find(b => b.id === blockId);
                    const tags = block ? block.tags : [];
                    App.showAssigneeModal((user) => {
                        view.dispatch({
                            changes: { from: this.from, to: this.to, insert: `[assignee:: ${user}]` }
                        });
                    }, tags);
                    return;
                }

                view.dispatch({ selection: { anchor: this.from, head: this.to } });
                view.focus();
            };
            wrap.onmousedown = handleBadgeClick;
            wrap.onclick = handleBadgeClick;
            return wrap;
        }
        ignoreEvent() { return true; }
    }

    class LinkWidget extends WidgetType {
        constructor(text, url, from, to) {
            super();
            this.text = text;
            this.url = url;
            this.from = from;
            this.to = to;
        }
        eq(other) {
            return other.text === this.text && other.url === this.url && other.from === this.from;
        }
        getDisplayText() {
            if (this.text !== this.url || this.text.length <= 72) {
                return this.text;
            }

            try {
                const parsedUrl = new URL(this.url);
                const prefix = `${parsedUrl.host}${parsedUrl.pathname}`;
                const suffix = `${parsedUrl.search}${parsedUrl.hash}`;
                const head = prefix.slice(0, 44);
                const tail = suffix ? suffix.slice(-16) : this.text.slice(-16);
                return `${head}...${tail}`;
            } catch {
                return `${this.text.slice(0, 56)}...${this.text.slice(-13)}`;
            }
        }
        toDOM(view) {
            const a = document.createElement("a");
            a.className = "md-link-text";
            a.href = this.url;
            a.textContent = this.getDisplayText();
            a.title = this.url;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.onclick = (e) => {
                e.stopPropagation();
            };
            a.onmousedown = (e) => {
                // Allow the link to open normally, prevent CodeMirror from stealing focus
                e.stopPropagation();
            };
            return a;
        }
        ignoreEvent() { return true; }
    }

    class FencedBlockWidget extends WidgetType {
        constructor(block) {
            super();
            this.block = block;
        }
        eq(other) {
            return other.block.from === this.block.from
                && other.block.to === this.block.to
                && other.block.info === this.block.info
                && other.block.preview === this.block.preview;
        }
        toDOM(view) {
            const wrap = document.createElement('div');
            const lineLabel = this.block.lineCount === 1 ? '1 line' : `${this.block.lineCount} lines`;
            const infoLabel = this.block.info || this.block.kind;

            wrap.className = `md-fenced-block-preview kind-${this.block.kind}`;
            wrap.innerHTML = `
                <div class="md-fenced-block-header">
                    <div class="md-fenced-block-meta">
                        <span class="md-fenced-block-kind"></span>
                        <span class="md-fenced-block-count"></span>
                    </div>
                    <div class="md-fenced-block-actions">
                        <button type="button" class="md-fenced-block-btn" data-action="edit">Edit</button>
                        <button type="button" class="md-fenced-block-btn primary" data-action="open">Open</button>
                    </div>
                </div>
                <pre class="md-fenced-block-body"></pre>
            `;

            const kind = wrap.querySelector('.md-fenced-block-kind');
            if (kind) {
                kind.textContent = infoLabel;
            }

            const count = wrap.querySelector('.md-fenced-block-count');
            if (count) {
                count.textContent = lineLabel;
            }

            const preview = wrap.querySelector('.md-fenced-block-body');
            if (preview) {
                preview.textContent = this.block.preview || '(empty block)';
            }

            wrap.querySelector('[data-action="open"]').addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                documentView.openFencedBlockModal(this.block);
            });

            wrap.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                documentView.focusFencedBlock(view, this.block.from);
            });

            return wrap;
        }
        ignoreEvent() { return true; }
    }

    class AddDeadlineWidget extends WidgetType {
        constructor(from, to) {
            super();
            this.from = from;
            this.to = to;
        }
        eq(other) {
            return other.from === this.from && other.to === this.to;
        }
        toDOM(view) {
            const wrap = document.createElement("span");
            wrap.className = "md-add-deadline";
            wrap.style.position = "relative";
            wrap.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`;
            wrap.title = "Add Deadline";

            const dateInput = document.createElement("input");
            dateInput.type = "date";
            dateInput.style.position = "absolute";
            dateInput.style.opacity = "0";
            dateInput.style.width = "100%";
            dateInput.style.height = "100%";
            dateInput.style.left = "0";
            dateInput.style.top = "0";
            dateInput.style.cursor = "pointer";

            dateInput.onmousedown = (e) => {
                // Prevent CodeMirror from swallowing the click, but allow default so the input gets focus and opens the calendar
                e.stopPropagation();
            };

            dateInput.onchange = (e) => {
                if (dateInput.value) {
                    documentView.appendInlineField(view, this.from, this.to, 'due', dateInput.value);
                }
            };

            wrap.appendChild(dateInput);
            return wrap;
        }
        ignoreEvent() { return true; }
    }

    class AddAssigneeWidget extends WidgetType {
        constructor(from, to) {
            super();
            this.from = from;
            this.to = to;
        }
        eq(other) {
            return other.from === this.from && other.to === this.to;
        }
        toDOM(view) {
            const wrap = document.createElement("span");
            wrap.className = "md-add-deadline md-add-action";
            wrap.style.position = "relative";
            wrap.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
            wrap.title = "Add Assignee";

            wrap.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const blockId = view.dom.parentElement.dataset.id;
                const block = Store.blocks.find(b => b.id === blockId);
                const tags = block ? block.tags : [];
                App.showAssigneeModal((user) => {
                    documentView.appendInlineField(view, this.from, this.to, 'assignee', user);
                }, tags);
            };
            return wrap;
        }
        ignoreEvent() { return true; }
    }

    class AddPriorityWidget extends WidgetType {
        constructor(from, to) {
            super();
            this.from = from;
            this.to = to;
        }
        eq(other) {
            return other.from === this.from && other.to === this.to;
        }
        toDOM(view) {
            const wrap = document.createElement("span");
            wrap.className = "md-add-deadline md-add-action";
            wrap.style.position = "relative";
            wrap.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>`;
            wrap.title = "Add Priority";

            wrap.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                documentView.showPriorityMenu(e.pageX, e.pageY, view, this.from, this.to);
            };
            return wrap;
        }
        ignoreEvent() { return true; }
    }

    return {
        CheckboxWidget,
        BadgeWidget,
        LinkWidget,
        FencedBlockWidget,
        AddDeadlineWidget,
        AddAssigneeWidget,
        AddPriorityWidget
    };
}

// Export for use in other modules
window.CodeMirrorWidgets = {
    create: createCodeMirrorWidgets
};
