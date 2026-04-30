/**
 * CodeMirror Widgets - Widget classes for live markdown preview
 * Provides interactive widgets for tasks, badges, and inline fields
 */

/**
 * Show a unified popover for editing due and start date badges.
 * The start date row is collapsible — expanded if a start value exists.
 * Works on both desktop and mobile (touch-friendly).
 */
function showDatePopover(event, view, dueFrom, dueTo, dueValue, startFrom, startTo, startValue, fallbackPos) {
    event.stopPropagation();
    document.querySelector('.date-popover')?.remove();

    const popover = document.createElement('div');
    popover.className = 'date-popover';

    // --- Due date row ---
    const dueLabel = document.createElement('label');
    dueLabel.className = 'date-popover-field';
    dueLabel.innerHTML = '<span class="date-popover-label">Due</span>';
    const dueInput = document.createElement('input');
    dueInput.type = 'date';
    dueInput.value = (dueValue || '').trim();
    dueInput.className = 'date-popover-input';
    dueInput.addEventListener('mousedown', (e) => e.stopPropagation());
    dueLabel.appendChild(dueInput);

    // --- Start date toggle + row ---
    const hasStart = !!startValue;
    const startToggle = document.createElement('button');
    startToggle.className = 'date-popover-start-toggle';
    startToggle.type = 'button';
    startToggle.innerHTML = hasStart
        ? '<span class="date-popover-arrow expanded">▸</span> Start date'
        : '<span class="date-popover-arrow">▸</span> Start date';

    const startRow = document.createElement('div');
    startRow.className = 'date-popover-start-row' + (hasStart ? ' expanded' : '');
    const startLabel = document.createElement('label');
    startLabel.className = 'date-popover-field';
    startLabel.innerHTML = '<span class="date-popover-label date-popover-label-start">Start</span>';
    const startInput = document.createElement('input');
    startInput.type = 'date';
    startInput.value = (startValue || '').trim();
    startInput.className = 'date-popover-input';
    startInput.addEventListener('mousedown', (e) => e.stopPropagation());
    startLabel.appendChild(startInput);
    startRow.appendChild(startLabel);

    startToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isExpanded = startRow.classList.toggle('expanded');
        startToggle.querySelector('.date-popover-arrow').classList.toggle('expanded', isExpanded);
        if (isExpanded) startInput.focus();
    });

    // --- Buttons ---
    const btnRow = document.createElement('div');
    btnRow.className = 'date-popover-actions';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.className = 'date-popover-btn date-popover-save';
    saveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        applyChanges();
        popover.remove();
    });

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    clearBtn.className = 'date-popover-btn date-popover-clear';
    clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const changes = [];
        // Remove due badge (and preceding space)
        if (dueFrom != null) {
            let delFrom = dueFrom;
            if (delFrom > 0 && view.state.doc.sliceString(delFrom - 1, delFrom) === ' ') delFrom -= 1;
            changes.push({ from: delFrom, to: dueTo, insert: '' });
        }
        // Remove start badge (and preceding space)
        if (startFrom != null) {
            let delFrom = startFrom;
            if (delFrom > 0 && view.state.doc.sliceString(delFrom - 1, delFrom) === ' ') delFrom -= 1;
            // Adjust if start badge comes before due (positions shifted)
            if (changes.length > 0 && startFrom < dueFrom) {
                // start badge is before due — the positions are relative to original text
            }
            changes.push({ from: delFrom, to: startTo, insert: '' });
        }
        if (changes.length) view.dispatch({ changes });
        popover.remove();
    });

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(clearBtn);

    popover.appendChild(dueLabel);
    popover.appendChild(startToggle);
    popover.appendChild(startRow);
    popover.appendChild(btnRow);
    document.body.appendChild(popover);

    // Position near the click/tap
    const target = event.target instanceof HTMLElement ? event.target : event.target.parentElement;
    const rect = target.getBoundingClientRect();
    const popW = 240;
    let left = rect.left + rect.width / 2 - popW / 2;
    let top = rect.bottom + 6;
    left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
    if (top + 200 > window.innerHeight) top = rect.top - 200;
    popover.style.left = left + 'px';
    popover.style.top = top + 'px';

    function applyChanges() {
        const changes = [];

        // Update or skip due
        if (dueFrom != null) {
            if (dueInput.value) {
                changes.push({ from: dueFrom, to: dueTo, insert: `[due:: ${dueInput.value}]` });
            }
            // If due cleared while existing, remove it
        } else if (dueInput.value) {
            // No existing due badge — will append below
        }

        // Update or skip start
        if (startFrom != null) {
            if (startInput.value) {
                changes.push({ from: startFrom, to: startTo, insert: `[start:: ${startInput.value}]` });
            }
        } else if (startInput.value) {
            // No existing start badge — will append below
        }

        // Apply inline changes first
        if (changes.length) view.dispatch({ changes });

        // Append new badges that don't have an existing position
        // Use the reference position (dueFrom or this.from) for line lookup
        const refPos = dueFrom != null ? dueFrom : (startFrom != null ? startFrom : (fallbackPos || 0));
        if (dueInput.value && dueFrom == null) {
            documentView.appendInlineField(view, refPos, refPos, 'due', dueInput.value);
        }
        if (startInput.value && startFrom == null) {
            documentView.appendInlineField(view, refPos, refPos, 'start', startInput.value);
        }
    }

    // Close on outside click/tap
    const closeOnOutside = (e) => {
        if (!popover.contains(e.target)) {
            popover.remove();
            document.removeEventListener('mousedown', closeOnOutside);
            document.removeEventListener('touchstart', closeOnOutside);
        }
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('touchstart', closeOnOutside, { passive: true });

    // Auto-focus the due input
    dueInput.focus();
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

            wrap.ontouchstart = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const newState = (this.state === 'x' || this.state === 'X') ? ' ' : 'x';
                view.dispatch({
                    changes: { from: this.from, to: this.to, insert: `[${newState}]` },
                    scrollIntoView: false
                });
            };
            wrap.onmousedown = (e) => {
                if (e.button !== 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                const newState = (this.state === 'x' || this.state === 'X') ? ' ' : 'x';
                view.dispatch({
                    changes: { from: this.from, to: this.to, insert: `[${newState}]` },
                    scrollIntoView: false
                });
            };
            wrap.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
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
                wrap.innerHTML = `<span class="icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:2px; vertical-align:text-top;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg></span> `;
                const valSpan = document.createElement('span');
                valSpan.textContent = this.value;
                wrap.appendChild(valSpan);
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
            } else if (this.type === 'start') {
                wrap.innerHTML = `<span class="icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:2px; vertical-align:text-top;"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg></span> `;
                const valSpan = document.createElement('span');
                valSpan.textContent = this.value;
                wrap.appendChild(valSpan);
                wrap.title = 'Tap to edit start date';
            } else if (this.type === 'assignee') {
                wrap.innerHTML = `<span class="icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:2px; vertical-align:text-top;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></span> `;
                const valSpan = document.createElement('span');
                valSpan.textContent = this.value;
                wrap.appendChild(valSpan);
            } else if (this.type === 'priority') {
                const colors = { 'urgent': '#ef4444', 'high': '#f97316', 'medium': '#3b82f6', 'low': '#94a3b8' };
                const color = colors[this.value.toLowerCase()] || 'currentColor';
                wrap.dataset.priority = this.value.toLowerCase();
                wrap.innerHTML = `<span class="icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="3" style="margin-right:2px; vertical-align:text-top;"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg></span> `;
                const valSpan = document.createElement('span');
                valSpan.textContent = this.value;
                wrap.appendChild(valSpan);
            } else if (this.type === 'id') {
                wrap.innerHTML = `<span class="icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:2px; vertical-align:text-top;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></span> `;
                const valSpan = document.createElement('span');
                valSpan.textContent = this.value;
                wrap.appendChild(valSpan);
            }

            const handleBadgeClick = (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (this.type === 'due' || this.type === 'start') {
                    // Find both due and start badges on the same line for the unified popover
                    const line = view.state.doc.lineAt(this.from);
                    const lineText = line.text;
                    let dueFrom = null, dueTo = null, dueValue = '';
                    let startFrom = null, startTo = null, startValue = '';

                    const dueMatch = lineText.match(/\[due::\s*([^\]]+)\]/);
                    if (dueMatch) {
                        dueFrom = line.from + dueMatch.index;
                        dueTo = dueFrom + dueMatch[0].length;
                        dueValue = dueMatch[1].trim();
                    }

                    const startMatch = lineText.match(/\[start::\s*([^\]]+)\]/);
                    if (startMatch) {
                        startFrom = line.from + startMatch.index;
                        startTo = startFrom + startMatch[0].length;
                        startValue = startMatch[1].trim();
                    }

                    showDatePopover(e, view, dueFrom, dueTo, dueValue, startFrom, startTo, startValue);
                    return;
                }

                if (this.type === 'assignee') {
                    const blockId = view.dom.parentElement.dataset.id;
                    const block = Store.blocks.find(b => b.id === blockId);
                    const tags = block ? block.tags : [];
                    App.showAssigneeModal((user) => {
                        if (user === null) {
                            // Remove the badge and preceding space
                            let delFrom = this.from;
                            if (delFrom > 0 && view.state.doc.sliceString(delFrom - 1, delFrom) === ' ') {
                                delFrom -= 1;
                            }
                            view.dispatch({ changes: { from: delFrom, to: this.to, insert: '' } });
                        } else {
                            view.dispatch({
                                changes: { from: this.from, to: this.to, insert: `[assignee:: ${user}]` }
                            });
                        }
                    }, tags);
                    return;
                }

                if (this.type === 'priority') {
                    documentView.showPriorityMenu(e.pageX, e.pageY, view, this.from, this.to);
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
            } catch (e) {
                console.warn('URL truncation fallback:', e);
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

    class WikilinkWidget extends WidgetType {
        constructor(displayText, targetId, from, to, exists) {
            super();
            this.displayText = displayText;
            this.targetId = targetId;
            this.from = from;
            this.to = to;
            this.exists = exists;
        }
        eq(other) {
            return other.displayText === this.displayText && other.targetId === this.targetId && other.from === this.from;
        }
        toDOM(view) {
            const span = document.createElement("span");
            span.className = this.exists ? "md-wikilink" : "md-wikilink md-wikilink-broken";
            span.textContent = this.displayText;
            span.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.shiftKey || !this.exists) {
                    documentView.openNoteModal(this.targetId);
                } else {
                    documentView.navigateToBlock(this.targetId);
                }
            };
            span.onmousedown = (e) => {
                e.stopPropagation();
            };
            return span;
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
            wrap.innerHTML = `<div class="md-fenced-block-header"><div class="md-fenced-block-meta"><span class="md-fenced-block-kind"></span><span class="md-fenced-block-count"></span></div><div class="md-fenced-block-actions"><button type="button" class="md-fenced-block-btn copy-btn" data-action="copy" title="Copy to clipboard"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button><button type="button" class="md-fenced-block-btn" data-action="edit">Edit</button><button type="button" class="md-fenced-block-btn primary" data-action="open">Open</button></div></div><pre class="md-fenced-block-body"></pre>`;

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
                preview.textContent = (this.block.preview || '(empty block)').trim();
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

            wrap.querySelector('[data-action="copy"]').addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const text = (this.block.preview || '').trim();
                navigator.clipboard.writeText(text).then(() => {
                    const btn = wrap.querySelector('[data-action="copy"]');
                    const svg = btn.innerHTML;
                    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
                    setTimeout(() => { btn.innerHTML = svg; }, 1500);
                });
            });

            return wrap;
        }
        ignoreEvent() { return true; }
    }

    class TableWidget extends WidgetType {
        constructor(table) {
            super();
            this.table = table;
        }
        eq(other) {
            return other.table.from === this.table.from
                && other.table.to === this.table.to
                && other.table.rawText === this.table.rawText;
        }
        toDOM(view) {
            const wrap = document.createElement('div');
            wrap.className = 'md-table-preview';

            const table = document.createElement('table');
            table.className = 'md-gfm-table';

            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            this.table.headers.forEach((cell, i) => {
                const th = document.createElement('th');
                th.textContent = cell;
                if (this.table.alignments[i] && this.table.alignments[i] !== 'left') {
                    th.style.textAlign = this.table.alignments[i];
                }
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            this.table.rows.forEach(row => {
                const tr = document.createElement('tr');
                row.forEach((cell, i) => {
                    const td = document.createElement('td');
                    td.textContent = cell;
                    if (this.table.alignments[i] && this.table.alignments[i] !== 'left') {
                        td.style.textAlign = this.table.alignments[i];
                    }
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);

            wrap.appendChild(table);

            wrap.onmousedown = (e) => e.stopPropagation();
            wrap.onclick = (e) => {
                e.stopPropagation();
                view.dispatch({
                    selection: { anchor: this.table.from },
                    scrollIntoView: true
                });
                view.focus();
            };

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
            wrap.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`;
            wrap.title = "Add Date";

            const handleClick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                // No existing badges — open unified popover with empty fields
                showDatePopover(e, view, null, null, '', null, null, '', this.from);
            };

            wrap.onmousedown = handleClick;
            wrap.onclick = handleClick;
            wrap.ontouchend = (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleClick(e);
            };
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
                    if (user) {
                        documentView.appendInlineField(view, this.from, this.to, 'assignee', user);
                    }
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
        WikilinkWidget,
        FencedBlockWidget,
        TableWidget,
        AddDeadlineWidget,
        AddAssigneeWidget,
        AddPriorityWidget
    };
}

// Export for use in other modules
window.CodeMirrorWidgets = {
    create: createCodeMirrorWidgets
};
