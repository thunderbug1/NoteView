/**
 * Settings View - Handles the settings page UI
 */

const SettingsView = {
    async render(blocks) {
        const container = document.getElementById('viewContainer');
        if (!container) return;

        const directoryName = Store.directoryHandle ? Store.directoryHandle.name : 'No directory selected';

        container.innerHTML = `
            <div class="settings-view">
                <div class="settings-header">
                    <button id="settingsBackBtn" class="settings-back-btn" title="Back to Notes">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="19" y1="12" x2="5" y2="12"></line>
                            <polyline points="12 19 5 12 12 5"></polyline>
                        </svg>
                    </button>
                    <h2>Settings</h2>
                </div>

                <div class="settings-section">
                    <h3>Vault Configuration</h3>
                    <div class="settings-item">
                        <div class="settings-item-info">
                            <label>Current Vault Directory</label>
                            <div class="directory-path-display">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                                </svg>
                                <span>${escapeHtml(directoryName)}</span>
                            </div>
                            <p class="settings-item-hint">This is the folder where your markdown notes and git history are stored.</p>
                        </div>
                        <button id="changeVaultBtn" class="settings-btn secondary">
                            Change Directory...
                        </button>
                    </div>
                </div>

                <div class="settings-section">
                    <h3>Tag Management</h3>
                    <div class="settings-item">
                        <div class="settings-item-info">
                            <label>Manage Tags</label>
                            <p class="settings-item-hint">Rename or delete tags across all notes in this vault.</p>
                        </div>
                        <button id="manageTagsBtn" class="settings-btn secondary">
                            Manage Tags...
                        </button>
                    </div>
                </div>

                <div class="settings-section">
                    <h3>Editor Shortcuts</h3>
                    <div class="settings-item">
                        <div class="settings-item-info">
                            <label>New Note</label>
                            <p class="settings-item-hint">Quickly add a new note from anywhere.</p>
                        </div>
                        <div id="newNoteShortcut" class="shortcut-key" title="Click to remap">${escapeHtml(Store.shortcuts.newNote)}</div>
                    </div>
                </div>

                <div class="settings-section">
                    <h3>About NoteView</h3>
                    <div class="settings-item">
                        <p>NoteView is a block-based markdown note-taker with built-in version control and flexible views.</p>
                    </div>
                </div>
            </div>
        `;

        this.attachEventListeners();
    },

    attachEventListeners() {
        const changeBtn = document.getElementById('changeVaultBtn');
        if (changeBtn) {
            changeBtn.addEventListener('click', () => App.changeVaultDirectory());
        }

        const backBtn = document.getElementById('settingsBackBtn');
        if (backBtn) {
            backBtn.addEventListener('click', () => App.setView('document'));
        }

        const manageTagsBtn = document.getElementById('manageTagsBtn');
        if (manageTagsBtn) {
            manageTagsBtn.addEventListener('click', () => this.openTagModal());
        }

        // Shortcut remapping
        const newNoteShortcutBtn = document.getElementById('newNoteShortcut');
        if (newNoteShortcutBtn) {
            newNoteShortcutBtn.addEventListener('click', () => {
                if (newNoteShortcutBtn.classList.contains('recording')) return;

                newNoteShortcutBtn.classList.add('recording');
                newNoteShortcutBtn.textContent = 'Press keys...';

                const handleKeydown = async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const keys = [];
                    if (e.ctrlKey) keys.push('Ctrl');
                    if (e.altKey) keys.push('Alt');
                    if (e.shiftKey) keys.push('Shift');
                    if (e.metaKey) keys.push('Meta');

                    const key = e.key === ' ' ? 'Space' : (e.key.length === 1 ? e.key.toUpperCase() : e.key);

                    // Simple validation: must have at least one modifier and a final key
                    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

                    keys.push(key);
                    const newShortcut = keys.join('+');

                    window.removeEventListener('keydown', handleKeydown, true);
                    newNoteShortcutBtn.classList.remove('recording');
                    newNoteShortcutBtn.textContent = newShortcut;

                    const shortcuts = { ...Store.shortcuts, newNote: newShortcut };
                    await Store.saveShortcuts(shortcuts);

                    // Update FAB title if visible
                    const fab = document.getElementById('fabNewNote');
                    if (fab) fab.title = `New Note (${newShortcut})`;
                };

                window.addEventListener('keydown', handleKeydown, true);
            });
        }
    },

    openTagModal() {
        const allTags = SelectionManager.getAllContextTags();

        // Count blocks per tag
        const tagCounts = {};
        for (const tag of allTags) {
            tagCounts[tag] = Store.blocks.filter(b => b.tags?.includes(tag)).length;
        }

        const tagListHtml = allTags.length === 0
            ? '<div class="tag-editor-empty">No tags found in this vault</div>'
            : `<div class="tag-editor-list">${allTags.map(tag => `
                <div class="tag-editor-row" data-tag="${escapeHtml(tag)}">
                    <span class="tag-name">${escapeHtml(tag)}</span>
                    <span class="tag-count">${tagCounts[tag]} note${tagCounts[tag] !== 1 ? 's' : ''}</span>
                    <div class="tag-actions">
                        <button class="tag-action-btn rename" data-tag="${escapeHtml(tag)}">Rename</button>
                        <button class="tag-action-btn delete" data-tag="${escapeHtml(tag)}">Delete</button>
                    </div>
                </div>`).join('')}</div>`;

        const modal = Modal.create({
            title: 'Manage Tags',
            content: tagListHtml,
            width: '480px'
        });

        this.attachTagListeners(modal);
    },

    attachTagListeners(modal) {
        const tagList = modal.querySelector('.tag-editor-list');
        if (!tagList) return;

        tagList.addEventListener('click', async (e) => {
            const btn = e.target.closest('.tag-action-btn');
            if (!btn) return;

            const tag = btn.dataset.tag;
            const row = btn.closest('.tag-editor-row');

            if (btn.classList.contains('rename')) {
                this.startInlineRename(row, tag, modal);
            } else if (btn.classList.contains('delete')) {
                const count = Store.blocks.filter(b => b.tags?.includes(tag)).length;
                if (confirm(`Remove "${tag}" from ${count} note${count !== 1 ? 's' : ''}?`)) {
                    btn.disabled = true;
                    btn.textContent = 'Deleting...';
                    await Store.deleteTag(tag);
                    modal.close();
                    this.openTagModal();
                }
            }
        });
    },

    startInlineRename(row, oldTag, modal) {
        const nameEl = row.querySelector('.tag-name');
        const actionsEl = row.querySelector('.tag-actions');

        // Replace name with input
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'rename-input';
        input.value = oldTag;

        nameEl.replaceWith(input);
        input.focus();
        input.select();

        // Replace action buttons with Save/Cancel
        actionsEl.innerHTML = `
            <button class="tag-action-btn save">Save</button>
            <button class="tag-action-btn cancel">Cancel</button>
        `;

        const doSave = async () => {
            const newTag = input.value.trim();
            if (!newTag || newTag === oldTag) {
                modal.close();
                this.openTagModal();
                return;
            }
            // Check for duplicate
            if (SelectionManager.getAllContextTags().includes(newTag)) {
                alert(`Tag "${newTag}" already exists.`);
                input.focus();
                return;
            }
            actionsEl.querySelector('.save').disabled = true;
            actionsEl.querySelector('.save').textContent = 'Saving...';
            await Store.renameTag(oldTag, newTag);
            modal.close();
            this.openTagModal();
        };

        const doCancel = () => {
            modal.close();
            this.openTagModal();
        };

        actionsEl.querySelector('.save').addEventListener('click', doSave);
        actionsEl.querySelector('.cancel').addEventListener('click', doCancel);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') doSave();
            if (e.key === 'Escape') doCancel();
        });
    }
};

window.SettingsView = SettingsView;
