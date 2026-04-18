/**
 * Settings View - Handles the settings page UI
 */

const SettingsView = {

    /**
     * Shortcut definitions for the settings UI
     */
    _shortcutDefs: [
        { key: 'newNote', label: 'New Note', hint: 'Quickly add a new note from anywhere.' },
        { key: 'aiAssistant', label: 'AI Assistant', hint: 'Open AI assistant for the focused note.' },
        { key: 'contextBack', label: 'Context Back', hint: 'Navigate to the previous filter selection.' },
        { key: 'contextForward', label: 'Context Forward', hint: 'Navigate to the next filter selection.' },
        { key: 'toggleTask', label: 'Toggle Task', hint: 'Convert current line to/from task checkbox.' }
    ],

    _renderProfiles() {
        if (AIAssistant.profiles.length === 0) {
            return '<div style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem 0">No model profiles configured yet.</div>';
        }
        return AIAssistant.profiles.map(p => `
            <div class="ai-profile-item" data-profile-id="${escapeHtml(p.id)}">
                <div class="ai-profile-info">
                    <div class="ai-profile-name">${escapeHtml(p.name)}</div>
                    <div class="ai-profile-details">${escapeHtml(p.model)} &middot; ${escapeHtml(p.endpointUrl)}</div>
                </div>
                <div class="ai-profile-actions">
                    <button class="edit-profile-btn" data-profile-id="${escapeHtml(p.id)}">Edit</button>
                    <button class="clone-profile-btn" data-profile-id="${escapeHtml(p.id)}">Clone</button>
                    <button class="delete-profile-btn" data-profile-id="${escapeHtml(p.id)}">Delete</button>
                </div>
            </div>
        `).join('');
    },

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
                    <h3>Keyboard Shortcuts</h3>
                    ${this._shortcutDefs.map(def => `
                    <div class="settings-item">
                        <div class="settings-item-info">
                            <label>${escapeHtml(def.label)}</label>
                            <p class="settings-item-hint">${escapeHtml(def.hint)}</p>
                        </div>
                        <div id="shortcut-${def.key}" class="shortcut-key" data-shortcut-key="${def.key}" title="Click to remap">${escapeHtml(Store.shortcuts[def.key] || '')}</div>
                    </div>`).join('')}
                </div>

                <div class="settings-section">
                    <h3>AI Configuration</h3>
                    <div class="settings-item">
                        <div class="settings-item-info">
                            <label>Enable AI Features</label>
                            <p class="settings-item-hint">Show AI assistant button in note metadata bar. Configure model profiles and presets below.</p>
                        </div>
                        <div class="ai-toggle-switch ${AIAssistant.enabled ? 'active' : ''}" id="aiToggleSwitch" title="Toggle AI features"></div>
                    </div>

                    <div class="ai-settings-details ${AIAssistant.enabled ? 'visible' : ''}" id="aiSettingsDetails">
                        <div class="settings-item" style="flex-direction:column;align-items:stretch">
                            <div class="settings-item-info" style="margin-bottom:0.75rem">
                                <label>Model Profiles</label>
                                <p class="settings-item-hint">Add one or more OpenAI-compatible endpoints. Select which to use per query in the AI overlay.</p>
                            </div>
                            <div class="ai-profile-list" id="aiProfileList">
                                ${this._renderProfiles()}
                            </div>
                            <button class="ai-add-profile-btn" id="aiAddProfileBtn">+ Add Model Profile</button>
                            <div id="aiProfileFormContainer"></div>
                        </div>

                        <div class="settings-item">
                            <div class="settings-item-info">
                                <label>Manage Presets</label>
                                <p class="settings-item-hint">Create, edit, or delete reusable prompt presets shown in the AI overlay.</p>
                            </div>
                            <button id="managePresetsBtn" class="settings-btn secondary">Manage Presets...</button>
                        </div>

                        <div class="settings-item">
                            <div class="settings-item-info">
                                <label>Import from Vault</label>
                                <p class="settings-item-hint">Copy AI configuration (profiles, presets, API keys) from another vault.</p>
                            </div>
                            <button id="importAISettingsBtn" class="settings-btn secondary">Import...</button>
                        </div>
                    </div>
                </div>

                <div class="settings-section" id="templatesSection">
                    <h3>Note Templates</h3>
                    <div class="settings-item">
                        <div class="settings-item-info">
                            <label>Manage Templates</label>
                            <p class="settings-item-hint">Create, edit, or delete templates available in the new note action bar.</p>
                        </div>
                        <button id="manageTemplatesBtn" class="settings-btn secondary">Manage Templates...</button>
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

        // Shortcut remapping (unified for all shortcuts)
        document.querySelectorAll('.shortcut-key[data-shortcut-key]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.classList.contains('recording')) return;

                btn.classList.add('recording');
                btn.textContent = 'Press keys...';

                const shortcutKey = btn.dataset.shortcutKey;

                const handleKeydown = async (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const keys = [];
                    if (e.ctrlKey) keys.push('Ctrl');
                    if (e.altKey) keys.push('Alt');
                    if (e.shiftKey) keys.push('Shift');
                    if (e.metaKey) keys.push('Meta');

                    const key = e.key === ' ' ? 'Space' : (e.key.length === 1 ? e.key.toUpperCase() : e.key);

                    // Must have at least one modifier and a final key
                    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

                    keys.push(key);
                    const newShortcut = keys.join('+');

                    window.removeEventListener('keydown', handleKeydown, true);
                    btn.classList.remove('recording');
                    btn.textContent = newShortcut;

                    const shortcuts = { ...Store.shortcuts, [shortcutKey]: newShortcut };
                    await Store.saveShortcuts(shortcuts);

                    // Update FAB title if this is the newNote shortcut
                    if (shortcutKey === 'newNote') {
                        const fab = document.getElementById('fabNewNote');
                        if (fab) fab.title = `New Note (${newShortcut})`;
                    }
                };

                window.addEventListener('keydown', handleKeydown, true);
            });
        });

        // AI toggle
        const aiToggle = document.getElementById('aiToggleSwitch');
        if (aiToggle) {
            aiToggle.addEventListener('click', async () => {
                const newState = !AIAssistant.enabled;
                await AIAssistant.toggleEnabled(newState);
                aiToggle.classList.toggle('active', newState);
                document.getElementById('aiSettingsDetails').classList.toggle('visible', newState);
            });
        }

        // Add profile button
        const addProfileBtn = document.getElementById('aiAddProfileBtn');
        if (addProfileBtn) {
            addProfileBtn.addEventListener('click', () => this._showProfileForm());
        }

        // Profile list delegation (edit/delete)
        const profileList = document.getElementById('aiProfileList');
        if (profileList) {
            profileList.addEventListener('click', async (e) => {
                const editBtn = e.target.closest('.edit-profile-btn');
                const cloneBtn = e.target.closest('.clone-profile-btn');
                const deleteBtn = e.target.closest('.delete-profile-btn');
                if (editBtn) {
                    const profile = AIAssistant.profiles.find(p => p.id === editBtn.dataset.profileId);
                    if (profile) this._showProfileForm(profile);
                } else if (cloneBtn) {
                    const profile = AIAssistant.profiles.find(p => p.id === cloneBtn.dataset.profileId);
                    if (profile) {
                        await AIAssistant.createProfile({
                            name: profile.name + ' (copy)',
                            endpointUrl: profile.endpointUrl,
                            apiKey: AIAssistant._apiKeys[profile.id] || '',
                            model: profile.model
                        });
                        profileList.innerHTML = this._renderProfiles();
                    }
                } else if (deleteBtn) {
                    const id = deleteBtn.dataset.profileId;
                    if (confirm('Delete this model profile?')) {
                        AIAssistant.deleteProfile(id).then(() => {
                            profileList.innerHTML = this._renderProfiles();
                        });
                    }
                }
            });
        }

        // Manage presets button
        const managePresetsBtn = document.getElementById('managePresetsBtn');
        if (managePresetsBtn) {
            managePresetsBtn.addEventListener('click', () => this._openPresetModal());
        }

        // Manage templates button
        const manageTemplatesBtn = document.getElementById('manageTemplatesBtn');
        if (manageTemplatesBtn) {
            manageTemplatesBtn.addEventListener('click', () => this._openTemplateModal());
        }

        // Import AI settings button
        const importAIBtn = document.getElementById('importAISettingsBtn');
        if (importAIBtn) {
            importAIBtn.addEventListener('click', () => this._openImportVaultPicker());
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
    },

    // --- AI Profile Form ---

    _showProfileForm(existingProfile = null) {
        const container = document.getElementById('aiProfileFormContainer');
        if (!container) return;

        const isEdit = !!existingProfile;
        const p = existingProfile || { name: '', endpointUrl: '', model: 'gpt-4o' };
        const currentKey = isEdit ? (AIAssistant._apiKeys[existingProfile.id] || '') : '';

        container.innerHTML = `
            <div class="ai-profile-form">
                <div class="ai-form-row">
                    <label>Name</label>
                    <input type="text" id="aiProfileName" value="${escapeHtml(p.name)}" placeholder="e.g. GPT-4o, Local Llama">
                </div>
                <div class="ai-form-row">
                    <label>Endpoint URL</label>
                    <input type="url" id="aiProfileEndpoint" value="${escapeHtml(p.endpointUrl)}" placeholder="https://api.openai.com/v1">
                </div>
                <div class="ai-form-row">
                    <label>API Key <span style="font-weight:400;font-size:0.75rem;color:var(--text-muted)">(stored separately, excluded from git)</span></label>
                    <div class="ai-api-key-field">
                        <input type="password" id="aiProfileApiKey" value="${escapeHtml(currentKey)}" placeholder="${isEdit ? 'Leave blank to keep current key' : 'sk-...'}" autocomplete="off">
                        <button type="button" class="ai-toggle-key-visibility" title="Show API key">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </button>
                    </div>
                </div>
                <div class="ai-form-row">
                    <label>Model</label>
                    <input type="text" id="aiProfileModel" value="${escapeHtml(p.model)}" placeholder="gpt-4o">
                </div>
                <div class="ai-form-actions">
                    <button class="ai-form-cancel" id="aiProfileCancel">Cancel</button>
                    <button class="ai-form-save" id="aiProfileSave">${isEdit ? 'Update' : 'Add Profile'}</button>
                </div>
            </div>
        `;

        container.querySelector('#aiProfileCancel').addEventListener('click', () => {
            container.innerHTML = '';
        });

        container.querySelector('.ai-toggle-key-visibility').addEventListener('click', () => {
            const input = container.querySelector('#aiProfileApiKey');
            const btn = container.querySelector('.ai-toggle-key-visibility');
            if (input.type === 'password') {
                input.type = 'text';
                btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
                btn.title = 'Hide API key';
            } else {
                input.type = 'password';
                btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
                btn.title = 'Show API key';
            }
        });

        container.querySelector('#aiProfileSave').addEventListener('click', async () => {
            const name = container.querySelector('#aiProfileName').value.trim();
            const endpointUrl = container.querySelector('#aiProfileEndpoint').value.trim();
            const apiKey = container.querySelector('#aiProfileApiKey').value;
            const model = container.querySelector('#aiProfileModel').value.trim() || 'gpt-4o';

            if (!name || !endpointUrl) {
                alert('Name and Endpoint URL are required.');
                return;
            }

            if (isEdit) {
                const updates = { name, endpointUrl, model };
                if (apiKey) updates.apiKey = apiKey;  // only update key if provided
                await AIAssistant.updateProfile(existingProfile.id, updates);
            } else {
                await AIAssistant.createProfile({ name, endpointUrl, apiKey, model });
            }

            container.innerHTML = '';
            document.getElementById('aiProfileList').innerHTML = this._renderProfiles();
        });
    },

    // --- Preset Management Modal ---

    _openPresetModal() {
        const presetsHtml = AIAssistant.presets.length === 0
            ? '<div style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem 0">No presets configured. Add one below.</div>'
            : `<div class="tag-editor-list">${AIAssistant.presets.map(p => `
                <div class="tag-editor-row" data-preset-id="${escapeHtml(p.id)}">
                    <span class="tag-name">${escapeHtml(p.title)}</span>
                    <span class="tag-count" style="font-size:0.75rem;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.instruction)}</span>
                    <div class="tag-actions">
                        <button class="tag-action-btn rename" data-preset-id="${escapeHtml(p.id)}">Edit</button>
                        <button class="tag-action-btn delete" data-preset-id="${escapeHtml(p.id)}">Delete</button>
                    </div>
                </div>`).join('')}</div>`;

        const modal = Modal.create({
            title: 'Manage AI Presets',
            content: `
                ${presetsHtml}
                <button class="ai-add-profile-btn" id="addPresetBtn" style="margin-top:0.75rem">+ Add Preset</button>
                <div id="presetFormContainer"></div>
            `,
            width: '520px'
        });

        // Add preset button
        modal.querySelector('#addPresetBtn').addEventListener('click', () => {
            this._showPresetForm(modal, null);
        });

        // Preset list delegation
        const list = modal.querySelector('.tag-editor-list');
        if (list) {
            list.addEventListener('click', (e) => {
                const btn = e.target.closest('.tag-action-btn');
                if (!btn) return;
                const presetId = btn.dataset.presetId;
                const preset = AIAssistant.presets.find(p => p.id === presetId);
                if (!preset) return;

                if (btn.classList.contains('rename')) {
                    this._showPresetForm(modal, preset);
                } else if (btn.classList.contains('delete')) {
                    AIAssistant.deletePreset(presetId).then(() => {
                        modal.close();
                        this._openPresetModal();
                    });
                }
            });
        }
    },

    _showPresetForm(modal, existingPreset = null) {
        const container = modal.querySelector('#presetFormContainer');
        if (!container) return;

        const isEdit = !!existingPreset;
        const p = existingPreset || { title: '', instruction: '' };

        container.innerHTML = `
            <div class="ai-profile-form" style="margin-top:0.5rem">
                <div class="ai-form-row">
                    <label>Title</label>
                    <input type="text" id="presetTitle" value="${escapeHtml(p.title)}" placeholder="e.g. Summarize">
                </div>
                <div class="ai-form-row">
                    <label>Instruction</label>
                    <input type="text" id="presetInstruction" value="${escapeHtml(p.instruction)}" placeholder="The prompt text sent to the AI...">
                </div>
                <div class="ai-form-actions">
                    <button class="ai-form-cancel" id="presetCancel">Cancel</button>
                    <button class="ai-form-save" id="presetSave">${isEdit ? 'Update' : 'Add Preset'}</button>
                </div>
            </div>
        `;

        container.querySelector('#presetCancel').addEventListener('click', () => {
            container.innerHTML = '';
        });

        container.querySelector('#presetSave').addEventListener('click', async () => {
            const title = container.querySelector('#presetTitle').value.trim();
            const instruction = container.querySelector('#presetInstruction').value.trim();
            if (!title || !instruction) {
                alert('Title and instruction are required.');
                return;
            }
            if (isEdit) {
                await AIAssistant.updatePreset(existingPreset.id, title, instruction);
            } else {
                await AIAssistant.createPreset(title, instruction);
            }
            modal.close();
            this._openPresetModal();
        });
    },

    // --- AI Import from Vault ---

    async _openImportVaultPicker() {
        const vaultList = await Store.getVaultList();
        const currentVaultName = Store.directoryHandle?.name;
        const otherVaults = vaultList.filter(v => v.name !== currentVaultName);

        if (otherVaults.length === 0) {
            AIAssistant._showToast('No other vaults available');
            return;
        }

        const vaultItems = otherVaults.map(v => `
            <div class="tag-editor-row vault-import-row" data-vault-name="${escapeHtml(v.name)}" style="cursor:pointer">
                <span class="tag-name">${escapeHtml(v.name)}</span>
            </div>
        `).join('');

        const modal = Modal.create({
            title: 'Import AI Settings from Vault',
            content: `
                <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:0.75rem">Select a vault to copy its AI configuration from:</p>
                <div class="tag-editor-list">${vaultItems}</div>
            `,
            width: '420px'
        });

        const list = modal.querySelector('.tag-editor-list');
        if (list) {
            list.addEventListener('click', async (e) => {
                const row = e.target.closest('.vault-import-row');
                if (!row) return;
                const vaultName = row.dataset.vaultName;
                modal.close();
                await this._confirmImport(vaultName);
            });
        }
    },

    async _confirmImport(vaultName) {
        const data = await AIAssistant.importFromVault(vaultName);
        if (!data) {
            AIAssistant._showToast('No AI settings found in that vault');
            return;
        }

        const profileList = data.profiles.map(p =>
            `<li>${escapeHtml(p.name)} (${escapeHtml(p.model)})</li>`
        ).join('');

        const presetList = data.presets.map(p =>
            `<li>${escapeHtml(p.title)}</li>`
        ).join('');

        const hasKeys = Object.keys(data.keys).length > 0;

        const content = `
            <div style="font-size:0.9rem">
                <p style="margin-bottom:0.75rem">Import from <strong>${escapeHtml(vaultName)}</strong>:</p>
                <div style="margin-bottom:0.5rem"><strong>${data.profiles.length} profile${data.profiles.length !== 1 ? 's' : ''}:</strong></div>
                <ul style="margin:0 0 0.75rem 1.25rem;padding:0;list-style:disc">${profileList || '<li style="color:var(--text-muted)">None</li>'}</ul>
                <div style="margin-bottom:0.5rem"><strong>${data.presets.length} preset${data.presets.length !== 1 ? 's' : ''}:</strong></div>
                <ul style="margin:0 0 0.75rem 1.25rem;padding:0;list-style:disc">${presetList || '<li style="color:var(--text-muted)">None</li>'}</ul>
                ${hasKeys ? '<p style="color:var(--text-muted)">API keys will be copied.</p>' : ''}
                <p style="color:var(--color-danger, #f44);margin-top:0.75rem;font-weight:500">This will replace your current AI settings.</p>
            </div>
            <div class="ai-form-actions" style="margin-top:1rem">
                <button class="ai-form-cancel" id="importCancelBtn">Cancel</button>
                <button class="ai-form-save" id="importConfirmBtn">Import</button>
            </div>
        `;

        const modal = Modal.create({
            title: 'Confirm Import',
            content,
            width: '440px'
        });

        modal.querySelector('#importCancelBtn').addEventListener('click', () => modal.close());
        modal.querySelector('#importConfirmBtn').addEventListener('click', async () => {
            await AIAssistant.applyImport(data);
            modal.close();
            this.render();
            AIAssistant._showToast('AI settings imported successfully');
        });
    },

    // --- Template Management ---

    async _openTemplateModal() {
        const templates = await AppSettings.getTemplates();
        const templatesHtml = templates.length === 0
            ? '<div style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem 0">No templates yet. Add one below.</div>'
            : `<div class="tag-editor-list">${templates.map(t => `
                <div class="tag-editor-row" data-template-id="${escapeHtml(t.id)}">
                    <span class="tag-name">${escapeHtml(t.name)}</span>
                    <span class="tag-count" style="font-size:0.75rem;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t.content || '(blank)')}</span>
                    <div class="tag-actions">
                        <button class="tag-action-btn rename" data-template-id="${escapeHtml(t.id)}">Edit</button>
                        <button class="tag-action-btn delete" data-template-id="${escapeHtml(t.id)}">Delete</button>
                    </div>
                </div>`).join('')}</div>`;

        const modal = Modal.create({
            title: 'Manage Note Templates',
            content: `
                ${templatesHtml}
                <button class="ai-add-profile-btn" id="addTemplateBtn" style="margin-top:0.75rem">+ Add Template</button>
                <div id="templateFormContainer"></div>
            `,
            width: '520px'
        });

        modal.querySelector('#addTemplateBtn').addEventListener('click', () => {
            this._showTemplateForm(modal, null);
        });

        const list = modal.querySelector('.tag-editor-list');
        if (list) {
            list.addEventListener('click', async (e) => {
                const btn = e.target.closest('.tag-action-btn');
                if (!btn) return;
                const templateId = btn.dataset.templateId;
                const template = templates.find(t => t.id === templateId);
                if (!template) return;

                if (btn.classList.contains('rename')) {
                    this._showTemplateForm(modal, template);
                } else if (btn.classList.contains('delete')) {
                    const updated = templates.filter(t => t.id !== templateId);
                    await AppSettings.saveTemplates(updated);
                    modal.close();
                    this._openTemplateModal();
                }
            });
        }
    },

    _showTemplateForm(modal, existingTemplate = null) {
        const container = modal.querySelector('#templateFormContainer');
        if (!container) return;

        const isEdit = !!existingTemplate;
        const t = existingTemplate || { name: '', content: '' };

        container.innerHTML = `
            <div class="ai-profile-form" style="margin-top:0.5rem">
                <div class="ai-form-row">
                    <label>Name</label>
                    <input type="text" id="templateName" value="${escapeHtml(t.name)}" placeholder="e.g. Meeting Notes">
                </div>
                <div class="ai-form-row">
                    <label>Content</label>
                    <textarea id="templateContent" rows="6" style="width:100%;font-family:monospace;font-size:0.85rem;padding:0.5rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text);resize:vertical" placeholder="# Template content&#10;- [ ] Task goes here">${escapeHtml(t.content)}</textarea>
                    <p class="settings-item-hint" style="margin-top:0.35rem">Use <code>${'\\${1:placeholder}'}</code> for tab stops. Tab navigates between them. <code>$0</code> marks the final cursor position.</p>
                </div>
                <div class="ai-form-actions">
                    <button class="ai-form-cancel" id="templateCancel">Cancel</button>
                    <button class="ai-form-save" id="templateSave">${isEdit ? 'Update' : 'Add Template'}</button>
                </div>
            </div>
        `;

        container.querySelector('#templateCancel').addEventListener('click', () => {
            container.innerHTML = '';
        });

        container.querySelector('#templateSave').addEventListener('click', async () => {
            const name = container.querySelector('#templateName').value.trim();
            const content = container.querySelector('#templateContent').value;
            if (!name) {
                alert('Template name is required.');
                return;
            }

            const templates = await AppSettings.getTemplates();
            if (isEdit) {
                const idx = templates.findIndex(tp => tp.id === t.id);
                if (idx >= 0) {
                    templates[idx] = { ...templates[idx], name, content };
                }
            } else {
                templates.push({
                    id: 'tpl-' + Date.now(),
                    name,
                    content
                });
            }
            await AppSettings.saveTemplates(templates);
            modal.close();
            this._openTemplateModal();
        });
    }
};

window.SettingsView = SettingsView;
