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
    }
};

window.SettingsView = SettingsView;
