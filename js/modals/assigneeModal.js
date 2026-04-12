/**
 * Assignee Modal - Contact selection for task assignment
 */

const AssigneeModal = {
    show(onSelect, currentTags = null) {
        // Prioritize contacts that share the current context
        const allContacts = Array.from(Store.contacts.keys()).sort();
        let suggestedContacts = [...allContacts];

        // Define the reference context for matching
        let referenceContext = new Set();
        if (currentTags && currentTags.length > 0) {
            currentTags.forEach(t => referenceContext.add(t));
        } else if (SelectionManager.selections.context.size > 0) {
            referenceContext = new Set(SelectionManager.getActiveTags());
        }

        if (referenceContext.size > 0) {
            // Sort by matching context tags (higher match first), then alphabetically
            suggestedContacts.sort((a, b) => {
                const aTags = Store.contacts.get(a);
                const bTags = Store.contacts.get(b);
                const aMatchCount = Array.from(referenceContext).filter(t => aTags.has(t)).length;
                const bMatchCount = Array.from(referenceContext).filter(t => bTags.has(t)).length;

                if (aMatchCount !== bMatchCount) return bMatchCount - aMatchCount;
                return a.localeCompare(b);
            });
        }

        const content = `
            <input type="text" id="assigneeModalInput" placeholder="Search or enter name..." autofocus>
            <div class="tag-modal-list">
                ${suggestedContacts.map(contact => {
                    const contactTags = Store.contacts.get(contact);
                    const hasMatch = referenceContext.size === 0 || Array.from(referenceContext).some(t => contactTags.has(t));
                    const matchClass = hasMatch ? '' : 'non-matching-context';
                    return `<div class="tag-modal-item ${matchClass}" data-contact="${contact}">@${contact}</div>`;
                }).join('')}
            </div>
            <div id="assigneeModalCreatePrompt" style="display: none;" class="tag-modal-create">
                <span class="create-text"></span>
            </div>
        `;

        const modal = Modal.create({
            title: 'Select Assignee',
            content
        });

        const input = document.getElementById('assigneeModalInput');
        const promptBtn = document.getElementById('assigneeModalCreatePrompt');

        setTimeout(() => input.focus(), 10);

        const selectContact = (contact) => {
            if (contact) {
                // Strip @ if user typed it
                if (contact.startsWith('@')) contact = contact.substring(1);
                onSelect(contact);
            }
            modal.close();
        };

        modal.querySelectorAll('.tag-modal-item').forEach(item => {
            item.addEventListener('click', () => selectContact(item.dataset.contact));
        });

        promptBtn.addEventListener('click', () => {
            selectContact(input.value.trim());
        });

        input.addEventListener('input', () => {
            const val = input.value.trim().toLowerCase().replace(/^@/, '');
            let exactMatch = false;

            modal.querySelectorAll('.tag-modal-item').forEach(item => {
                const contact = item.dataset.contact.toLowerCase();
                if (contact.includes(val)) {
                    item.style.display = 'block';
                } else {
                    item.style.display = 'none';
                }
                if (contact === val) exactMatch = true;
            });

            if (val && !exactMatch) {
                promptBtn.style.display = 'flex';
                promptBtn.querySelector('.create-text').textContent = `Assign to '@${val}'`;
            } else {
                promptBtn.style.display = 'none';
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const val = input.value.trim().replace(/^@/, '');
                const visibleItems = Array.from(modal.querySelectorAll('.tag-modal-item'))
                    .filter(i => i.style.display !== 'none');

                if (visibleItems.length === 1 && val && visibleItems[0].dataset.contact !== val.toLowerCase()) {
                    selectContact(visibleItems[0].dataset.contact);
                } else if (val) {
                    selectContact(val);
                }
            } else if (e.key === 'Escape') {
                modal.close();
            }
        });
    }
};
