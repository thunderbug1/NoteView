/**
 * Tag Modal - Tag management for notes
 */

const TagModal = {
    show(blockId) {
        const allTags = SelectionManager.getAllContextTags();
        const block = Store.blocks.find(b => b.id === blockId);
        const initialTags = block ? (block.tags || []) : [];
        let selectedTags = new Set(initialTags);

        const content = `
            <div class="tag-modal-input-row">
                <input type="text" id="tagModalInput" placeholder="Search or create tag..." autofocus>
            </div>
            <div class="tag-modal-list">
                ${allTags.map(tag => `
                    <div class="tag-modal-item ${selectedTags.has(tag) ? 'selected' : ''}" data-tag="${tag}">
                        <span class="tag-checkbox">${selectedTags.has(tag) ? '✓' : ''}</span>
                        ${SelectionManager.getTagDisplayName(tag)}
                    </div>
                `).join('')}
            </div>
            <div id="tagModalCreatePrompt" style="display: none;" class="tag-modal-create">
                <span class="create-text"></span>
            </div>
            <div class="tag-modal-footer">
                <button id="tagModalSaveBtn" class="tag-modal-save-btn">Save</button>
            </div>
        `;

        const modal = Modal.create({
            title: 'Manage Tags',
            content
        });

        const input = document.getElementById('tagModalInput');
        const promptBtn = document.getElementById('tagModalCreatePrompt');

        setTimeout(() => input.focus(), 10);

        const updateItemVisuals = () => {
            modal.querySelectorAll('.tag-modal-item').forEach(item => {
                const tag = item.dataset.tag;
                const isSelected = selectedTags.has(tag);
                const checkbox = item.querySelector('.tag-checkbox');
                if (isSelected) {
                    item.classList.add('selected');
                    if (checkbox) checkbox.textContent = '✓';
                } else {
                    item.classList.remove('selected');
                    if (checkbox) checkbox.textContent = '';
                }
            });
        };

        const saveChanges = async () => {
            const newTags = Array.from(selectedTags).sort();

            if (blockId === 'new') {
                // Store pending tags for the new note placeholder
                DocumentView.pendingNewTags = newTags;

                // Add any new tags to the context UI
                for (const tag of newTags) {
                    if (!allTags.includes(tag)) {
                        SelectionManager.addContextTagToUI(tag);
                    }
                }

                // Update the badge display on the new note placeholder
                const newBlock = document.querySelector('.block[data-id="new"]');
                if (newBlock) {
                    const tagsDiv = newBlock.querySelector('.block-tags');
                    if (tagsDiv) {
                        const addBtn = tagsDiv.querySelector('.add-tag-btn');
                        const badgesHtml = newTags.map(tag => `<span class="badge">${Common.capitalizeFirst(tag)}</span>`).join('');
                        // Remove existing badges, keep the + Tag button
                        tagsDiv.querySelectorAll('.badge').forEach(b => b.remove());
                        if (addBtn) {
                            addBtn.insertAdjacentHTML('beforebegin', badgesHtml);
                        } else {
                            tagsDiv.insertAdjacentHTML('afterbegin', badgesHtml);
                        }
                    }
                }
            } else if (blockId) {
                // Only save if tags actually changed
                if (JSON.stringify(newTags) !== JSON.stringify([...initialTags].sort())) {
                    await App.updateBlockProperty(blockId, 'tags', newTags);
                }
            }
            modal.close();
        };

        modal.querySelectorAll('.tag-modal-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const tag = item.dataset.tag;

                if (selectedTags.has(tag)) {
                    selectedTags.delete(tag);
                } else {
                    selectedTags.add(tag);
                }

                updateItemVisuals();
                input.focus();
            });
        });

        const createTag = (tagStr) => {
            const tagsToAdd = tagStr.split(/[\s,]+/).map(t => t.trim().toLowerCase()).filter(t => t);
            const computedTags = SelectionManager.getComputedContextTags().map(tag => tag.toLowerCase());

            for (const tag of tagsToAdd) {
                if (computedTags.includes(tag)) {
                    console.warn("Cannot assign computed tags directly to a note.");
                    continue;
                }

                selectedTags.add(tag);

                // Add to list if not already there
                if (!allTags.includes(tag)) {
                    const list = modal.querySelector('.tag-modal-list');
                    const newItem = document.createElement('div');
                    newItem.className = 'tag-modal-item selected';
                    newItem.dataset.tag = tag;
                    newItem.innerHTML = `<span class="tag-checkbox">✓</span> ${SelectionManager.getTagDisplayName(tag)}`;
                    newItem.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (selectedTags.has(tag)) {
                            selectedTags.delete(tag);
                        } else {
                            selectedTags.add(tag);
                        }
                        updateItemVisuals();
                        input.focus();
                    });
                    list.appendChild(newItem);
                    allTags.push(tag);
                }
            }

            updateItemVisuals();
            input.value = '';
            promptBtn.style.display = 'none';
        };

        modal.querySelector('#tagModalSaveBtn').addEventListener('click', saveChanges);
        promptBtn.addEventListener('click', () => {
            createTag(input.value.trim().toLowerCase());
        });

        input.addEventListener('input', () => {
            const valArr = input.value.split(/[\s,]+/);
            const val = valArr[valArr.length - 1].trim().toLowerCase();
            let exactMatch = false;

            modal.querySelectorAll('.tag-modal-item').forEach(item => {
                const tag = item.dataset.tag;

                // Filter by search
                if (tag.includes(val) || val === '') {
                    item.style.display = 'block';
                } else {
                    item.style.display = 'none';
                }
                if (tag === val) exactMatch = true;
            });

            const isComputedTag = SelectionManager.getComputedContextTags().some(tag => tag.toLowerCase() === val);

            if (val && !exactMatch && !selectedTags.has(val) && !isComputedTag) {
                promptBtn.style.display = 'flex';
                promptBtn.querySelector('.create-text').textContent = `Create tag '${val}'`;
            } else {
                promptBtn.style.display = 'none';
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const val = input.value.trim().toLowerCase();
                if (val && !allTags.includes(val)) {
                    createTag(val);
                } else {
                    saveChanges();
                }
            } else if (e.key === 'Escape') {
                modal.close();
            }
        });
    }
};
