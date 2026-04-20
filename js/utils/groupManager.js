/**
 * Group Manager - Group view content by tag namespace
 */

const GroupManager = {
    getAvailableNamespaces(blocks) {
        const namespaces = new Set();
        for (const block of blocks) {
            for (const tag of (block.tags || [])) {
                const { segments } = Common.parseHierarchicalTag(tag);
                if (segments.length > 0) {
                    namespaces.add(segments[0]);
                }
            }
        }
        return [...namespaces].sort();
    },

    groupByNamespace(blocks, namespace) {
        if (!namespace) return null;

        const groups = new Map();
        const ungrouped = [];

        for (const block of blocks) {
            const tags = block.tags || [];
            let assigned = false;

            for (const tag of tags) {
                const { segments, leaf } = Common.parseHierarchicalTag(tag);
                if (segments.length > 0 && segments[0] === namespace) {
                    const key = leaf;
                    if (!groups.has(key)) {
                        groups.set(key, []);
                    }
                    groups.get(key).push(block);
                    assigned = true;
                    break;
                }
            }

            if (!assigned) {
                ungrouped.push(block);
            }
        }

        const sorted = new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])));
        return { groups: sorted, ungrouped };
    },

    getGroupBy(view) {
        return Store.getViewPreferences(view)?.groupBy || null;
    },

    setGroupBy(view, namespace) {
        const current = Store.getViewPreferences(view) || {};
        Store.viewPreferences = {
            ...Store.viewPreferences,
            [view]: {
                ...current,
                groupBy: namespace
            }
        };
        Store.saveViewPreferences();
    },

    supportsView(view) {
        return view === 'document' || view === 'kanban' || view === 'timeline';
    },

    initToolbar(onChange) {
        this.onChange = onChange;
        const button = document.getElementById('toolbarGroupBtn');
        if (!button) return;

        if (button.dataset.groupBound === 'true') return;
        button.dataset.groupBound = 'true';

        button.addEventListener('click', () => {
            const view = Store.currentView;
            if (!this.supportsView(view)) return;
            this.openGroupMenu(view, button);
        });
    },

    updateToolbar() {
        const button = document.getElementById('toolbarGroupBtn');
        if (!button) return;

        const view = Store.currentView;
        const supported = this.supportsView(view);
        button.hidden = !supported;
        if (!supported) return;

        const active = this.getGroupBy(view);
        button.title = active ? `Group: ${Common.capitalizeFirst(active)}` : 'Group';
        button.classList.toggle('active', !!active);
    },

    openGroupMenu(view, anchor) {
        const namespaces = this.getAvailableNamespaces(Store.blocks);
        const active = this.getGroupBy(view);

        let html = '<div class="group-menu">';
        html += `<button class="group-menu-item ${!active ? 'group-menu-active' : ''}" data-namespace="">Off</button>`;

        if (namespaces.length === 0) {
            html += '<div class="group-menu-empty">No tag groups found</div>';
        } else {
            for (const ns of namespaces) {
                html += `<button class="group-menu-item ${active === ns ? 'group-menu-active' : ''}" data-namespace="${escapeHtml(ns)}">${escapeHtml(Common.capitalizeFirst(ns))}</button>`;
            }
        }

        html += '</div>';

        const modal = Modal.create({
            title: 'Group by Tag Group',
            modalClass: 'tag-modal group-modal',
            content: html
        });

        modal.element.addEventListener('click', (e) => {
            const item = e.target.closest('.group-menu-item');
            if (!item) return;

            const ns = item.dataset.namespace || null;
            this.setGroupBy(view, ns);
            modal.close();
            if (this.onChange) this.onChange();
        });
    }
};

window.GroupManager = GroupManager;
