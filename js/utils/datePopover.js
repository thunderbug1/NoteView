/**
 * DatePopover — Shared date picker popover builder.
 * Creates a due/start date picker UI, handles positioning and close-on-outside.
 * Callers provide callbacks for applying changes and clearing values.
 */
window.DatePopover = {
    /**
     * Build and show a date picker popover.
     * @param {Object} opts
     * @param {HTMLElement} anchor — Element to position near
     * @param {string} dueValue — Current due date value
     * @param {string} startValue — Current start date value
     * @param {string} cssClass — CSS class for the popover (e.g. 'date-popover', 'kanban-date-menu')
     * @param {Function} onApply — Called with { due, start } when user applies changes
     * @param {Function} onClear — Called when user clears all dates
     * @param {Object} [fieldClassNames] — Override CSS class names for fields/labels/inputs/buttons
     * @returns {{ popover: HTMLElement, dueInput: HTMLInputElement, startInput: HTMLInputElement, close: Function }}
     */
    create({ anchor, dueValue, startValue, cssClass, onApply, onClear, fieldClassNames }) {
        document.querySelector(`.${cssClass}`)?.remove();

        const fc = fieldClassNames || {};
        const fieldCls = fc.field || 'date-popover-field';
        const labelCls = fc.label || 'date-popover-label';
        const inputCls = fc.input || 'date-popover-input';
        const toggleCls = fc.toggle || 'date-popover-start-toggle';
        const arrowCls = fc.arrow || 'date-popover-arrow';
        const startRowCls = fc.startRow || 'date-popover-start-row';
        const actionsCls = fc.actions || 'date-popover-actions';
        const btnCls = fc.btn || 'date-popover-btn';

        const popover = document.createElement('div');
        popover.className = cssClass;

        // Due date row
        const dueLabel = document.createElement('label');
        dueLabel.className = fieldCls;
        dueLabel.innerHTML = `<span class="${labelCls}">Due</span>`;
        const dueInput = document.createElement('input');
        dueInput.type = 'date';
        dueInput.value = (dueValue || '').trim();
        dueInput.className = inputCls;
        dueInput.addEventListener('mousedown', (e) => e.stopPropagation());
        dueLabel.appendChild(dueInput);

        // Start date toggle
        const hasStart = !!startValue;
        const startToggle = document.createElement('button');
        startToggle.className = toggleCls;
        startToggle.type = 'button';
        startToggle.innerHTML = hasStart
            ? `<span class="${arrowCls} expanded">▸</span> Start date`
            : `<span class="${arrowCls}">▸</span> Start date`;

        // Start date row
        const startRow = document.createElement('div');
        startRow.className = startRowCls + (hasStart ? ' expanded' : '');
        const startLabel = document.createElement('label');
        startLabel.className = fieldCls;
        startLabel.innerHTML = `<span class="${labelCls}">Start</span>`;
        const startInput = document.createElement('input');
        startInput.type = 'date';
        startInput.value = (startValue || '').trim();
        startInput.className = inputCls;
        startInput.addEventListener('mousedown', (e) => e.stopPropagation());
        startLabel.appendChild(startInput);
        startRow.appendChild(startLabel);

        startToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isExpanded = startRow.classList.toggle('expanded');
            startToggle.querySelector(`.${arrowCls.split(' ')[0]}`).classList.toggle('expanded', isExpanded);
            if (isExpanded) startInput.focus();
        });

        // Actions row (Save / Clear) — only added if callbacks provided
        if (onApply || onClear) {
            const btnRow = document.createElement('div');
            btnRow.className = actionsCls;

            if (onApply) {
                const saveBtn = document.createElement('button');
                saveBtn.textContent = 'Save';
                saveBtn.className = btnCls + (fc.save ? ' ' + fc.save : '');
                saveBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    onApply({ due: dueInput.value, start: startInput.value });
                    close();
                });
                btnRow.appendChild(saveBtn);
            }

            if (onClear) {
                const clearBtn = document.createElement('button');
                clearBtn.textContent = 'Clear';
                clearBtn.className = btnCls + (fc.clear ? ' ' + fc.clear : '');
                clearBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    onClear();
                    close();
                });
                btnRow.appendChild(clearBtn);
            }

            popover.appendChild(dueLabel);
            popover.appendChild(startToggle);
            popover.appendChild(startRow);
            popover.appendChild(btnRow);
        } else {
            popover.appendChild(dueLabel);
            popover.appendChild(startToggle);
            popover.appendChild(startRow);
        }

        document.body.appendChild(popover);

        // Position
        const rect = anchor.getBoundingClientRect();
        const popW = 240;
        let left = rect.left + rect.width / 2 - popW / 2;
        let top = rect.bottom + 6;
        left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
        if (top + 200 > window.innerHeight) top = rect.top - 200;
        popover.style.left = left + 'px';
        popover.style.top = top + 'px';
        popover.style.position = 'fixed';
        popover.style.zIndex = '1000';

        // Close on outside click/tap
        function close() {
            popover.remove();
            document.removeEventListener('mousedown', closeOnOutside);
            document.removeEventListener('touchstart', closeOnOutside);
            document.removeEventListener('click', closeOnOutside);
        }

        const closeOnOutside = (e) => {
            if (!popover.contains(e.target)) {
                close();
            }
        };
        document.addEventListener('mousedown', closeOnOutside);
        document.addEventListener('touchstart', closeOnOutside, { passive: true });

        dueInput.focus();

        return { popover, dueInput, startInput, close };
    }
};
