/**
 * Tag Modal - Tag management for notes
 * Supports single-level tag grouping with grouped browse, smart autocomplete,
 * quick-remove selected bar, inline tag renaming, and guided tag creation.
 */

const TagModal = {
    show(blockId) {
        const allTags = SelectionManager.getAllContextTags();
        const block = Store.blocks.find(b => b.id === blockId);
        const initialTags = block ? (block.tags || []) : [];
        let selectedTags = new Set(initialTags);

        // Build tree structure
        const treeData = Common.buildTagTree(allTags);

        const content = `
            <div id="tagModalSelectedBar" class="tag-modal-selected">
                ${this._renderSelectedBar(selectedTags)}
            </div>
            <div class="tag-modal-input-row" style="position:relative;">
                <input type="text" id="tagModalInput" placeholder="Search or create tag..." autocomplete="off" autofocus>
                <div id="tagAutocomplete" class="tag-autocomplete" style="display:none;"></div>
            </div>
            <div id="tagModalList" class="tag-modal-list">
                ${this._renderTree(treeData, selectedTags)}
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
        const selectedBar = document.getElementById('tagModalSelectedBar');
        const autocomplete = document.getElementById('tagAutocomplete');
        let acSelectedIndex = -1;
        let acItems = [];

        setTimeout(() => input.focus(), 10);

        // --- Helpers ---

        const updateSelectedBar = () => {
            selectedBar.innerHTML = this._renderSelectedBar(selectedTags);

            // Remove buttons
            selectedBar.querySelectorAll('.tag-pill-remove').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const pill = btn.closest('.tag-pill');
                    const tag = pill.dataset.tag;
                    selectedTags.delete(tag);
                    updateSelectedBar();
                    updateItemVisuals();
                    input.focus();
                });
            });

            // Click badge in pill → inline rename
            selectedBar.querySelectorAll('.tag-pill .badge').forEach(badge => {
                badge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const pill = badge.closest('.tag-pill');
                    const oldTag = pill.dataset.tag;
                    if (!oldTag || pill.querySelector('.pill-rename-input')) return;

                    const originalHtml = pill.innerHTML;
                    pill.innerHTML = `<input class="pill-rename-input" type="text" value="${oldTag}">`;
                    const renameInput = pill.querySelector('.pill-rename-input');
                    renameInput.focus();
                    renameInput.select();

                    const doSave = async () => {
                        const newTag = renameInput.value.trim().toLowerCase();
                        if (!newTag || newTag === oldTag) {
                            updateSelectedBar();
                            return;
                        }

                        const existing = SelectionManager.getAllContextTags();
                        if (existing.includes(newTag)) {
                            updateSelectedBar();
                            return;
                        }

                        await Store.renameTag(oldTag, newTag);

                        // Update local state
                        if (selectedTags.has(oldTag)) {
                            selectedTags.delete(oldTag);
                            selectedTags.add(newTag);
                        }
                        const idx = allTags.indexOf(oldTag);
                        if (idx !== -1) allTags[idx] = newTag;

                        updateSelectedBar();
                        updateItemVisuals();
                        input.focus();
                    };

                    const doCancel = () => {
                        updateSelectedBar();
                    };

                    renameInput.addEventListener('keydown', (ev) => {
                        if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); doSave(); }
                        if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); doCancel(); }
                    });

                    renameInput.addEventListener('blur', () => {
                        setTimeout(() => {
                            if (pill.querySelector('.pill-rename-input')) doCancel();
                        }, 100);
                    });
                });
            });
        };

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

        const toggleTag = (tag) => {
            if (selectedTags.has(tag)) {
                selectedTags.delete(tag);
            } else {
                selectedTags.add(tag);
            }
            updateSelectedBar();
            updateItemVisuals();
        };

        // --- Save ---

        const saveChanges = async () => {
            const newTags = Array.from(selectedTags).sort();

            if (blockId === 'new') {
                DocumentView.pendingNewTags = newTags;

                for (const tag of newTags) {
                    if (!allTags.includes(tag)) {
                        SelectionManager.addContextTagToUI(tag);
                    }
                }

                const newBlock = document.querySelector('.block[data-id="new"]');
                if (newBlock) {
                    const tagsDiv = newBlock.querySelector('.block-tags');
                    if (tagsDiv) {
                        const addBtn = tagsDiv.querySelector('.add-tag-btn');
                        const badgesHtml = newTags.map(tag => this._renderBadge(tag)).join('');
                        tagsDiv.querySelectorAll('.badge').forEach(b => b.remove());
                        if (addBtn) {
                            addBtn.insertAdjacentHTML('beforebegin', badgesHtml);
                        } else {
                            tagsDiv.insertAdjacentHTML('afterbegin', badgesHtml);
                        }
                    }
                }
            } else if (blockId) {
                if (JSON.stringify(newTags) !== JSON.stringify([...initialTags].sort())) {
                    await App.updateBlockProperty(blockId, 'tags', newTags);
                }
            }
            modal.close();
        };

        // --- Item click + double-click rename ---

        modal.querySelectorAll('.tag-modal-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // Don't toggle if clicking inside rename input
                if (e.target.closest('.tag-rename-input')) return;
                e.stopPropagation();
                toggleTag(item.dataset.tag);
                input.focus();
            });

            // Double-click to rename
            item.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this._startRename(item, modal, allTags, selectedTags, updateSelectedBar, updateItemVisuals, input, treeData);
            });
        });

        // --- Group header: click to select/deselect all children ---

        modal.querySelectorAll('.tag-modal-group-header').forEach(header => {
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                const group = header.closest('.tag-modal-group');
                const allTags = Array.from(group.querySelectorAll(':scope > .tag-modal-group-items > .tag-modal-item'))
                    .map(item => item.dataset.tag);
                const allSelected = allTags.every(t => selectedTags.has(t));

                if (allSelected) {
                    allTags.forEach(t => selectedTags.delete(t));
                } else {
                    allTags.forEach(t => selectedTags.add(t));
                }

                updateSelectedBar();
                updateItemVisuals();
                input.focus();
            });
        });

        // --- Tag creation ---

        const createTag = (tagStr) => {
            const tagsToAdd = tagStr.split(/[\s,]+/).map(t => t.trim().toLowerCase()).filter(t => t);
            const computedTags = SelectionManager.getComputedContextTags().map(tag => tag.toLowerCase());

            for (const tag of tagsToAdd) {
                if (computedTags.includes(tag)) {
                    console.warn("Cannot assign computed tags directly to a note.");
                    continue;
                }

                selectedTags.add(tag);

                if (!allTags.includes(tag)) {
                    allTags.push(tag);
                    this._insertTagIntoList(modal, tag, toggleTag, input);
                }
            }

            updateSelectedBar();
            updateItemVisuals();
            input.value = '';
            promptBtn.style.display = 'none';
        };

        modal.querySelector('#tagModalSaveBtn').addEventListener('click', saveChanges);
        promptBtn.addEventListener('click', () => {
            createTag(input.value.trim().toLowerCase());
        });

        // --- Smart autocomplete input ---

        const showAutocomplete = (suggestions) => {
            acItems = suggestions;
            acSelectedIndex = -1;

            if (suggestions.length === 0) {
                autocomplete.style.display = 'none';
                return;
            }

            autocomplete.innerHTML = suggestions.map((s, i) => {
                const display = s.isGroup
                    ? `<span class="ac-group-icon">&#9654;</span> ${Common.capitalizeFirst(s.text)}`
                    : Common.capitalizeFirst(s.text);
                const hint = s.isGroup ? ' <span class="ac-hint">group</span>' : '';
                return `<div class="ac-item" data-index="${i}" data-completed="${s.completed}">${display}${hint}</div>`;
            }).join('');
            autocomplete.style.display = 'block';

            // Click handlers on suggestions
            autocomplete.querySelectorAll('.ac-item').forEach(el => {
                el.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const completed = el.dataset.completed;
                    if (completed.endsWith('.')) {
                        // Group — set input to group path + dot
                        input.value = completed.toLowerCase();
                        input.focus();
                        input.dispatchEvent(new Event('input'));
                    } else {
                        // Leaf tag — toggle it
                        toggleTag(completed);
                        input.value = '';
                        input.focus();
                        input.dispatchEvent(new Event('input'));
                    }
                });
            });
        };

        const hideAutocomplete = () => {
            autocomplete.style.display = 'none';
            acItems = [];
            acSelectedIndex = -1;
        };

        const highlightAcItem = (index) => {
            const items = autocomplete.querySelectorAll('.ac-item');
            items.forEach((el, i) => {
                el.classList.toggle('ac-active', i === index);
            });
            // Scroll into view
            if (items[index]) {
                items[index].scrollIntoView({ block: 'nearest' });
            }
        };

        const computeSuggestions = (val) => {
            if (!val) {
                hideAutocomplete();
                return;
            }

            const dotPos = val.indexOf('.');
            const suggestions = [];

            if (dotPos !== -1) {
                // Typed "group." — suggest tags in that group
                const groupName = val.substring(0, dotPos).toLowerCase();
                const partial = val.substring(dotPos + 1).toLowerCase();

                // Find the group (case-insensitive)
                const groupKey = Array.from(treeData.groups.keys()).find(k => k.toLowerCase() === groupName);
                if (groupKey) {
                    const groupTags = treeData.groups.get(groupKey);
                    groupTags.forEach(tag => {
                        const { leaf } = Common.parseHierarchicalTag(tag);
                        if (leaf.toLowerCase().startsWith(partial)) {
                            suggestions.push({
                                text: leaf,
                                completed: tag,
                                isGroup: false
                            });
                        }
                    });
                }
            } else {
                // Bare text — match group names and flat tags
                treeData.groups.forEach((_, groupName) => {
                    if (groupName.toLowerCase().startsWith(val)) {
                        suggestions.push({
                            text: groupName,
                            completed: groupName + '.',
                            isGroup: true
                        });
                    }
                });

                treeData.flat.forEach(tag => {
                    if (tag.toLowerCase().startsWith(val)) {
                        suggestions.push({
                            text: tag,
                            completed: tag,
                            isGroup: false
                        });
                    }
                });
            }

            showAutocomplete(suggestions.slice(0, 8));
        };

        input.addEventListener('input', () => {
            const val = input.value.trim().toLowerCase();
            const lastDot = val.lastIndexOf('.');
            let exactMatch = false;

            // Filter the main list (existing behavior)
            if (lastDot !== -1) {
                const groupName = val.substring(0, lastDot).toLowerCase();
                const leafSearch = val.substring(lastDot + 1).toLowerCase();

                modal.querySelectorAll('.tag-modal-item').forEach(item => {
                    const tag = item.dataset.tag;
                    const { segments, leaf } = Common.parseHierarchicalTag(tag);
                    if (segments.length > 0 && segments[0].toLowerCase() === groupName) {
                        item.style.display = (leaf.toLowerCase().includes(leafSearch) || leafSearch === '') ? 'block' : 'none';
                    } else {
                        item.style.display = 'none';
                    }
                    if (tag === val) exactMatch = true;
                });
                modal.querySelectorAll('.tag-modal-group').forEach(group => this._updateGroupVisibility(group));
                modal.querySelectorAll('.tag-modal-flat-item').forEach(item => { item.style.display = 'none'; });
            } else {
                modal.querySelectorAll('.tag-modal-item').forEach(item => {
                    const tag = item.dataset.tag;
                    const displayName = Common.formatTagDisplay(tag).toLowerCase();
                    item.style.display = (tag.includes(val) || displayName.includes(val) || val === '') ? 'block' : 'none';
                    if (tag === val) exactMatch = true;
                });
                modal.querySelectorAll('.tag-modal-group').forEach(group => this._updateGroupVisibility(group));
            }

            // Autocomplete suggestions
            computeSuggestions(val);

            // Create prompt
            const isComputedTag = SelectionManager.getComputedContextTags().some(tag => tag.toLowerCase() === val);
            if (val && !exactMatch && !selectedTags.has(val) && !isComputedTag) {
                promptBtn.style.display = 'flex';
                const dotPos = val.indexOf('.');
                if (dotPos !== -1 && dotPos < val.length - 1) {
                    promptBtn.querySelector('.create-text').textContent =
                        `Create '${val}' in ${Common.capitalizeFirst(val.split('.')[0])}`;
                } else {
                    promptBtn.querySelector('.create-text').textContent = `Create '${val}'`;
                }
            } else {
                promptBtn.style.display = 'none';
            }
        });

        input.addEventListener('keydown', (e) => {
            const isAcOpen = autocomplete.style.display !== 'none' && acItems.length > 0;

            if (e.key === 'ArrowDown' && isAcOpen) {
                e.preventDefault();
                acSelectedIndex = Math.min(acSelectedIndex + 1, acItems.length - 1);
                highlightAcItem(acSelectedIndex);
            } else if (e.key === 'ArrowUp' && isAcOpen) {
                e.preventDefault();
                acSelectedIndex = Math.max(acSelectedIndex - 1, 0);
                highlightAcItem(acSelectedIndex);
            } else if (e.key === 'Tab') {
                e.preventDefault();
                if (isAcOpen && acSelectedIndex >= 0) {
                    // Accept the highlighted suggestion
                    const item = acItems[acSelectedIndex];
                    if (item.isGroup) {
                        input.value = item.completed.toLowerCase();
                        input.dispatchEvent(new Event('input'));
                    } else {
                        toggleTag(item.completed);
                        input.value = '';
                        input.dispatchEvent(new Event('input'));
                    }
                } else if (isAcOpen && acItems.length > 0) {
                    // No selection — accept first suggestion
                    const item = acItems[0];
                    if (item.isGroup) {
                        input.value = item.completed.toLowerCase();
                        input.dispatchEvent(new Event('input'));
                    } else {
                        // Complete to common prefix or full tag
                        input.value = item.completed.toLowerCase();
                        input.dispatchEvent(new Event('input'));
                    }
                } else {
                    // No dropdown — do Tab completion (one segment)
                    const val = input.value.trim().toLowerCase();
                    if (!val) return;
                    computeSuggestions(val);
                }
            } else if (e.key === 'Enter') {
                if (isAcOpen && acSelectedIndex >= 0) {
                    e.preventDefault();
                    const item = acItems[acSelectedIndex];
                    if (item.isGroup) {
                        input.value = item.completed.toLowerCase();
                        hideAutocomplete();
                        input.dispatchEvent(new Event('input'));
                    } else {
                        toggleTag(item.completed);
                        input.value = '';
                        hideAutocomplete();
                        input.dispatchEvent(new Event('input'));
                    }
                } else {
                    hideAutocomplete();
                    const val = input.value.trim().toLowerCase();
                    if (val && !allTags.includes(val)) {
                        createTag(val);
                    } else if (val) {
                        const exactTag = allTags.find(t => t.toLowerCase() === val);
                        if (exactTag) toggleTag(exactTag);
                        input.value = '';
                        input.dispatchEvent(new Event('input'));
                    } else {
                        saveChanges();
                    }
                }
            } else if (e.key === 'Escape') {
                if (isAcOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    hideAutocomplete();
                } else {
                    modal.close();
                }
            }
        });

        // Close autocomplete on blur
        input.addEventListener('blur', () => {
            setTimeout(hideAutocomplete, 150);
        });
    },

    // --- Rendering helpers ---

    /**
     * Render the selected tags bar with removable pills
     */
    _renderSelectedBar(selectedTags) {
        const tags = Array.from(selectedTags);
        if (tags.length === 0) {
            return '<span class="tag-modal-selected-empty">No tags selected</span>';
        }

        return tags.sort().map(tag => {
            const badgeHtml = this._renderBadge(tag);
            return `<span class="tag-pill" data-tag="${tag}">
                ${badgeHtml}
                <span class="tag-pill-remove">&times;</span>
            </span>`;
        }).join('');
    },

    /**
     * Render the full tag tree (groups + flat tags) for the modal
     */
    _renderTree({ groups, flat }, selectedTags) {
        let html = '';

        // Render single-level groups
        groups.forEach((groupTags, groupName) => {
            const allSelected = groupTags.every(t => selectedTags.has(t));
            const selClass = allSelected ? 'group-selected' : '';

            html += `<div class="tag-modal-group ${selClass}" data-group-path="${groupName}">`;
            html += `<div class="tag-modal-group-header">${Common.capitalizeFirst(groupName)}</div>`;
            html += `<div class="tag-modal-group-items">`;

            groupTags.forEach(tag => {
                const { leaf } = Common.parseHierarchicalTag(tag);
                html += `<div class="tag-modal-item ${selectedTags.has(tag) ? 'selected' : ''}" data-tag="${tag}">`;
                html += `<span class="tag-checkbox">${selectedTags.has(tag) ? '✓' : ''}</span>`;
                html += `${Common.capitalizeFirst(leaf)}`;
                html += `<span class="tag-edit-hint">&#9998;</span>`;
                html += `</div>`;
            });

            html += `</div></div>`;
        });

        // Render flat tags
        flat.forEach(tag => {
            html += `<div class="tag-modal-item tag-modal-flat-item ${selectedTags.has(tag) ? 'selected' : ''}" data-tag="${tag}">`;
            html += `<span class="tag-checkbox">${selectedTags.has(tag) ? '✓' : ''}</span>`;
            html += `${SelectionManager.getTagDisplayName(tag)}`;
            html += `<span class="tag-edit-hint">&#9998;</span>`;
            html += `</div>`;
        });

        return html;
    },

    /**
     * Show/hide a group based on whether it has visible items.
     */
    _updateGroupVisibility(group) {
        const items = group.querySelectorAll(':scope > .tag-modal-group-items > .tag-modal-item');
        let hasVisible = false;

        items.forEach(item => {
            if (item.style.display !== 'none') hasVisible = true;
        });

        group.style.display = hasVisible ? 'block' : 'none';
    },

    /**
     * Insert a newly created tag into the list at the correct position.
     */
    _insertTagIntoList(modal, tag, toggleFn, inputEl) {
        const list = modal.querySelector('#tagModalList');
        const { segments, leaf } = Common.parseHierarchicalTag(tag);

        const newItem = document.createElement('div');
        newItem.className = 'tag-modal-item selected';
        newItem.dataset.tag = tag;

        if (segments.length > 0) {
            const groupName = segments[0];
            let group = list.querySelector(`:scope > .tag-modal-group[data-group-path="${groupName}"]`);

            if (!group) {
                // Create the group
                group = document.createElement('div');
                group.className = 'tag-modal-group';
                group.dataset.groupPath = groupName;
                group.innerHTML = `
                    <div class="tag-modal-group-header">${Common.capitalizeFirst(groupName)}</div>
                    <div class="tag-modal-group-items"></div>
                `;
                // Insert before flat tags or in sorted order among groups
                const firstFlat = list.querySelector(':scope > .tag-modal-flat-item');
                if (firstFlat) {
                    list.insertBefore(group, firstFlat);
                } else {
                    const existingGroups = Array.from(list.querySelectorAll(':scope > .tag-modal-group'));
                    let inserted = false;
                    for (const existing of existingGroups) {
                        if (existing.dataset.groupPath.localeCompare(groupName) > 0) {
                            list.insertBefore(group, existing);
                            inserted = true;
                            break;
                        }
                    }
                    if (!inserted) list.appendChild(group);
                }
            }

            const parentContainer = group.querySelector('.tag-modal-group-items');
            newItem.innerHTML = `<span class="tag-checkbox">✓</span> ${Common.capitalizeFirst(leaf)}<span class="tag-edit-hint">&#9998;</span>`;

            // Insert in sorted order
            const existingItems = Array.from(parentContainer.querySelectorAll(':scope > .tag-modal-item'));
            let inserted = false;
            for (const existing of existingItems) {
                if (existing.dataset.tag.localeCompare(tag) > 0) {
                    parentContainer.insertBefore(newItem, existing);
                    inserted = true;
                    break;
                }
            }
            if (!inserted) {
                parentContainer.appendChild(newItem);
            }
        } else {
            newItem.innerHTML = `<span class="tag-checkbox">✓</span> ${SelectionManager.getTagDisplayName(tag)}`;
            newItem.classList.add('tag-modal-flat-item');
            const flatItems = Array.from(list.querySelectorAll(':scope > .tag-modal-flat-item'));
            let inserted = false;
            for (const existing of flatItems) {
                if (existing.dataset.tag.localeCompare(tag) > 0) {
                    list.insertBefore(newItem, existing);
                    inserted = true;
                    break;
                }
            }
            if (!inserted) {
                list.appendChild(newItem);
            }
        }

        newItem.addEventListener('click', (e) => {
            if (e.target.closest('.tag-rename-input')) return;
            e.stopPropagation();
            toggleFn(tag);
            inputEl.focus();
        });

        newItem.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            this._startRename(newItem, modal, null, null, null, null, inputEl, null);
        });
    },

    /**
     * Start inline rename on a tag item
     */
    _startRename(item, modal, allTags, selectedTags, updateSelectedBar, updateItemVisuals, inputEl, treeData) {
        const oldTag = item.dataset.tag;
        if (!oldTag) return;

        // Prevent double-triggering
        if (item.querySelector('.tag-rename-input')) return;

        const checkboxEl = item.querySelector('.tag-checkbox');
        const hintEl = item.querySelector('.tag-edit-hint');
        const originalHtml = item.innerHTML;

        // Replace content with input
        item.innerHTML = `<input class="tag-rename-input" type="text" value="${oldTag}">`;
        const renameInput = item.querySelector('.tag-rename-input');
        renameInput.focus();
        renameInput.select();

        // Temporarily disable click toggle
        item.style.pointerEvents = 'auto';

        const doSave = async () => {
            const newTag = renameInput.value.trim().toLowerCase();
            if (!newTag || newTag === oldTag) {
                // Cancel — restore
                item.innerHTML = originalHtml;
                return;
            }

            // Check for duplicate
            const existingTags = SelectionManager.getAllContextTags();
            if (existingTags.includes(newTag) && newTag !== oldTag) {
                alert(`Tag "${newTag}" already exists.`);
                renameInput.focus();
                return;
            }

            // Rename via Store
            await Store.renameTag(oldTag, newTag);

            // Update selectedTags if provided
            if (selectedTags && selectedTags.has(oldTag)) {
                selectedTags.delete(oldTag);
                selectedTags.add(newTag);
            }

            // Update allTags if provided
            if (allTags) {
                const idx = allTags.indexOf(oldTag);
                if (idx !== -1) allTags[idx] = newTag;
            }

            // Update the DOM item
            item.dataset.tag = newTag;
            const { leaf } = Common.parseHierarchicalTag(newTag);
            item.innerHTML = `<span class="tag-checkbox">✓</span> ${Common.capitalizeFirst(leaf)}<span class="tag-edit-hint">&#9998;</span>`;

            // Update selected bar
            if (updateSelectedBar) updateSelectedBar();
            if (updateItemVisuals) updateItemVisuals();

            inputEl.focus();
        };

        const doCancel = () => {
            item.innerHTML = originalHtml;
        };

        renameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                doSave();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                doCancel();
            }
        });

        renameInput.addEventListener('blur', () => {
            // Small delay to allow Enter to fire first
            setTimeout(() => {
                if (item.querySelector('.tag-rename-input')) {
                    doCancel();
                }
            }, 100);
        });
    },

    /**
     * Find the common prefix of an array of strings
     */
    _commonPrefix(strings) {
        if (strings.length === 0) return '';
        let prefix = strings[0];
        for (let i = 1; i < strings.length; i++) {
            while (!strings[i].startsWith(prefix)) {
                prefix = prefix.slice(0, -1);
                if (!prefix) return '';
            }
        }
        return prefix;
    },

    /**
     * Render a badge HTML for a tag (group-aware, single-level)
     */
    _renderBadge(tag) {
        const { segments, leaf } = Common.parseHierarchicalTag(tag);
        if (segments.length > 0) {
            const parentText = Common.capitalizeFirst(segments[0]);
            return `<span class="badge badge-hierarchical" data-tag="${tag}"><span class="badge-parent">${parentText}</span>${Common.formatTagDisplay(tag)}</span>`;
        }
        return `<span class="badge" data-tag="${tag}">${Common.capitalizeFirst(tag)}</span>`;
    }
};
