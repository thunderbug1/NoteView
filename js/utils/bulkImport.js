/**
 * BulkImport - Import multiple vaults and AI settings from a single JSON file
 */

const BulkImport = {

    /**
     * Show bulk import modal
     */
    async showImportModal() {
        const modal = Modal.create({
            title: 'Import All Vaults',
            width: 'min(600px, 90vw)',
            content: `
                <div class="bulk-import-container">
                    <div class="bulk-import-section">
                        <p style="color:var(--text-secondary);margin-bottom:1rem">
                            Import multiple vaults with their configurations (git remote, AI settings, sync config) from a single JSON file.
                        </p>
                        
                        <div class="bulk-import-upload" id="bulkImportDropzone">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent)">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="17 8 12 3 7 8"></polyline>
                                <line x1="12" y1="3" x2="12" y2="15"></line>
                            </svg>
                            <p style="margin-top:0.75rem;font-weight:500">Drop JSON file here or click to select</p>
                            <p style="font-size:0.85rem;color:var(--text-muted)">Supported format: JSON with vault configurations</p>
                            <input type="file" id="bulkImportFileInput" accept=".json" style="display:none">
                        </div>

                        <div id="bulkImportPreview" style="display:none;margin-top:1.5rem">
                            <!-- Preview will be populated here -->
                        </div>
                    </div>

                    <div class="bulk-import-actions" id="bulkImportActions" style="display:none;margin-top:1.5rem;display:flex;justify-content:flex-end;gap:0.5rem">
                        <button class="modal-cancel-btn" id="bulkImportCancel">Cancel</button>
                        <button class="modal-confirm-btn" id="bulkImportConfirm">Import Vaults</button>
                    </div>
                </div>
            `
        });

        const dropzone = modal.querySelector('#bulkImportDropzone');
        const fileInput = modal.querySelector('#bulkImportFileInput');
        const previewContainer = modal.querySelector('#bulkImportPreview');
        const actionsContainer = modal.querySelector('#bulkImportActions');
        const cancelBtn = modal.querySelector('#bulkImportCancel');
        const confirmBtn = modal.querySelector('#bulkImportConfirm');

        let importData = null;
        let conflictResolutions = {};
        let apiKeySelections = {};

        const handleFile = async (file) => {
            try {
                const text = await file.text();
                importData = this.validateImport(text);

                if (!importData) {
                    showToast('Invalid import file format. Please check the JSON structure.');
                    return;
                }

                await this.showPreview(importData, previewContainer, conflictResolutions, apiKeySelections);
                actionsContainer.style.display = 'flex';

            } catch (e) {
                console.error('[BulkImport] Failed to parse file:', e);
                showToast('Failed to read import file: ' + (e.message || 'Unknown error'));
            }
        };

        dropzone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFile(e.target.files[0]);
            }
        });

        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = 'var(--accent)';
            dropzone.style.backgroundColor = 'rgba(var(--accent-rgb), 0.05)';
        });

        dropzone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = '';
            dropzone.style.backgroundColor = '';
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = '';
            dropzone.style.backgroundColor = '';

            const file = e.dataTransfer.files[0];
            if (file && file.type === 'application/json') {
                handleFile(file);
            } else {
                showToast('Please drop a JSON file.');
            }
        });

        cancelBtn.addEventListener('click', () => modal.close());

        confirmBtn.addEventListener('click', async () => {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Importing...';
            cancelBtn.disabled = true;

            try {
                await this.processImport(importData, conflictResolutions, apiKeySelections);
                showToast('Vault import completed successfully.');
                modal.close();
                if (VaultModal.updateVaultSwitcherName) {
                    VaultModal.updateVaultSwitcherName();
                }
            } catch (e) {
                console.error('[BulkImport] Import failed:', e);
                showToast('Import failed: ' + (e.message || 'Unknown error'));
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Import Vaults';
                cancelBtn.disabled = false;
            }
        });
    },

    /**
     * Validate import JSON structure
     */
    validateImport(jsonString) {
        try {
            const data = JSON.parse(jsonString);

            if (!data || typeof data !== 'object') return null;
            if (data.version !== 1) return null;
            if (!Array.isArray(data.vaults) || data.vaults.length === 0) return null;

            for (const vault of data.vaults) {
                if (!vault.name || typeof vault.name !== 'string') return null;
                if (!vault.type || (vault.type !== 'local' && vault.type !== 'opfs')) return null;
            }

            return data;

        } catch (e) {
            console.error('[BulkImport] JSON parse error:', e);
            return null;
        }
    },

    /**
     * Show preview of vaults to import
     */
    async showPreview(data, container, conflictResolutions, apiKeySelections) {
        const existingVaults = await Store.getVaultList();
        const existingNames = new Set(existingVaults.map(v => v.name));

        const vaultsHtml = data.vaults.map(vault => {
            const isConflict = existingNames.has(vault.name);
            const hasGit = !!vault.git;
            const hasAI = !!vault.ai && (vault.ai.profiles?.length > 0 || vault.ai.presets?.length > 0);
            const hasApiKeys = !!vault.ai?.apiKeys && Object.keys(vault.ai.apiKeys).length > 0;
            const hasSync = !!vault.sync;

            const vaultIcon = vault.type === 'opfs'
                ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`
                : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;

            const features = [];
            if (hasGit) features.push('Git');
            if (hasAI) features.push('AI');
            if (hasSync) features.push('Sync');

            return `
                <div class="bulk-import-vault-row ${isConflict ? 'conflict' : ''}" data-vault-name="${escapeHtml(vault.name)}">
                    <div class="bulk-import-vault-header">
                        <span class="bulk-import-vault-icon">${vaultIcon}</span>
                        <span class="bulk-import-vault-name">${escapeHtml(vault.name)}</span>
                        ${isConflict ? `<span class="bulk-import-conflict-badge">Name conflict</span>` : ''}
                        <span class="bulk-import-vault-type">${vault.type === 'opfs' ? 'Browser' : 'Local'}</span>
                    </div>

                    <div class="bulk-import-vault-features">
                        ${features.length > 0 ? features.map(f => `<span class="bulk-import-feature-tag">${escapeHtml(f)}</span>`).join('') : '<span style="color:var(--text-muted);font-size:0.8rem">No configuration</span>'}
                    </div>

                    ${isConflict ? `
                        <div class="bulk-import-conflict-resolution">
                            <label>Vault name already exists. How to handle?</label>
                            <select class="bulk-import-conflict-select" data-vault-name="${escapeHtml(vault.name)}">
                                <option value="skip">Skip this vault</option>
                                <option value="rename" selected>Rename vault</option>
                                <option value="overwrite">Overwrite existing vault</option>
                            </select>
                            <input type="text" class="bulk-import-rename-input" data-vault-name="${escapeHtml(vault.name)}" placeholder="New vault name" value="${escapeHtml(vault.name + '-import')}">
                        </div>
                    ` : ''}

                    ${hasApiKeys ? `
                        <div class="bulk-import-api-keys">
                            <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
                                <input type="checkbox" class="bulk-import-api-keys-checkbox" data-vault-name="${escapeHtml(vault.name)}" checked>
                                <span>Import API keys for this vault</span>
                            </label>
                            <p style="font-size:0.75rem;color:var(--text-muted);margin-top:0.25rem">API keys will be stored in .noteview/keys.json (excluded from git)</p>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        container.style.display = 'block';
        container.innerHTML = `
            <div class="bulk-import-summary">
                <strong>${data.vaults.length} vault${data.vaults.length !== 1 ? 's' : ''} to import</strong>
                ${data.vaults.some(v => existingNames.has(v.name)) ? `<span style="color:var(--warning-color);margin-left:0.5rem">⚠️ Name conflicts detected</span>` : ''}
            </div>
            ${data.vaults.some(v => v.git?.auth?.password || v.ai?.apiKeys) ? `
                <div style="margin-top:0.75rem;padding:0.6rem 0.8rem;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:var(--radius-sm,4px);color:#dc2626;font-size:0.8rem;line-height:1.4">
                    <strong>⚠️ Security Warning:</strong> This export contains API keys and/or git credentials. Review the import settings carefully and only import on trusted devices.
                </div>
            ` : ''}
            <div class="bulk-import-vault-list">
                ${vaultsHtml}
            </div>
        `;

        container.querySelectorAll('.bulk-import-conflict-select').forEach(select => {
            select.addEventListener('change', (e) => {
                const vaultName = e.target.dataset.vaultName;
                const renameInput = container.querySelector(`.bulk-import-rename-input[data-vault-name="${vaultName}"]`);
                
                if (e.target.value === 'rename') {
                    renameInput.style.display = 'block';
                    conflictResolutions[vaultName] = { action: 'rename', newName: renameInput.value };
                } else if (e.target.value === 'overwrite') {
                    renameInput.style.display = 'none';
                    conflictResolutions[vaultName] = { action: 'overwrite' };
                } else {
                    renameInput.style.display = 'none';
                    conflictResolutions[vaultName] = { action: 'skip' };
                }
            });

            const vaultName = select.dataset.vaultName;
            const action = select.value === 'rename' ? 'rename' : (select.value === 'overwrite' ? 'overwrite' : 'skip');
            const newName = container.querySelector(`.bulk-import-rename-input[data-vault-name="${vaultName}"]`).value;
            conflictResolutions[vaultName] = action === 'rename' ? { action: 'rename', newName } : { action };
        });

        container.querySelectorAll('.bulk-import-rename-input').forEach(input => {
            input.addEventListener('input', (e) => {
                const vaultName = e.target.dataset.vaultName;
                if (conflictResolutions[vaultName]?.action === 'rename') {
                    conflictResolutions[vaultName].newName = e.target.value;
                }
            });
        });

        container.querySelectorAll('.bulk-import-api-keys-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const vaultName = e.target.dataset.vaultName;
                apiKeySelections[vaultName] = e.target.checked;
            });
            apiKeySelections[checkbox.dataset.vaultName] = checkbox.checked;
        });
    },

    /**
     * Process the import
     */
    async processImport(data, conflictResolutions, apiKeySelections) {
        const existingVaults = await Store.getVaultList();
        const existingNames = new Set(existingVaults.map(v => v.name));
        const results = { success: [], failed: [], skipped: [] };

        for (const vaultConfig of data.vaults) {
            try {
                const vaultName = vaultConfig.name;
                const resolution = conflictResolutions[vaultName];

                if (existingNames.has(vaultName) && resolution?.action === 'skip') {
                    results.skipped.push(vaultName);
                    console.log('[BulkImport] Skipping vault (user chose skip):', vaultName);
                    continue;
                }

                const finalVaultName = resolution?.action === 'rename' ? resolution.newName : vaultName;

                if (existingNames.has(finalVaultName) && resolution?.action !== 'overwrite') {
                    results.skipped.push(finalVaultName);
                    console.log('[BulkImport] Skipping vault (name still conflicts):', finalVaultName);
                    continue;
                }

                await this.processVault(vaultConfig, finalVaultName, apiKeySelections[vaultName] ?? false, resolution?.action === 'overwrite');
                results.success.push(finalVaultName);

            } catch (e) {
                console.error('[BulkImport] Failed to import vault:', vaultConfig.name, e);
                results.failed.push({ name: vaultConfig.name, error: e.message });
            }
        }

        const summary = `
            Import complete:
            • ${results.success.length} vault${results.success.length !== 1 ? 's' : ''} imported successfully
            ${results.skipped.length > 0 ? `• ${results.skipped.length} vault${results.skipped.length !== 1 ? 's' : ''} skipped` : ''}
            ${results.failed.length > 0 ? `• ${results.failed.length} vault${results.failed.length !== 1 ? 's' : ''} failed` : ''}
        `;

        console.log('[BulkImport]', summary);
        showToast(summary);

        return results;
    },

    /**
     * Process a single vault
     */
    async processVault(vaultConfig, vaultName, includeApiKeys, overwrite) {
        console.log('[BulkImport] Processing vault:', vaultName, 'type:', vaultConfig.type);

        const isOPFS = vaultConfig.type === 'opfs';
        let handle = null;

        if (isOPFS) {
            handle = await this.createOPFSVault(vaultName);
        } else {
            const vaultList = await Store.getVaultList();
            const exists = vaultList.some(v => v.name === vaultName);

            if (!exists) {
                await Store.saveVault({ name: vaultName, type: 'local', addedAt: new Date().toISOString() }, 'local');
            }
            handle = { name: vaultName, type: 'local' };
        }

        if (vaultConfig.git) {
            await this.applyGitConfig(vaultName, vaultConfig.git);
        }

        if (vaultConfig.sync) {
            await this.applySyncConfig(vaultName, vaultConfig.sync);
        }

        if (vaultConfig.ai) {
            await this.applyAISettings(handle, vaultConfig.ai, includeApiKeys, isOPFS);
        }

        console.log('[BulkImport] Vault processed successfully:', vaultName);
    },

    /**
     * Create OPFS vault directory
     */
    async createOPFSVault(name) {
        const opfsRoot = await navigator.storage.getDirectory();
        const vaultHandle = await opfsRoot.getDirectoryHandle(name, { create: true });
        
        await Store.saveVault(vaultHandle, 'opfs');
        await Store.setLastActiveVault(name);
        
        return vaultHandle;
    },

    /**
     * Apply git remote configuration
     */
    async applyGitConfig(vaultName, gitConfig) {
        if (!gitConfig.url) return;

        const remoteConfig = {
            name: gitConfig.name || 'origin',
            url: gitConfig.url,
            branch: gitConfig.branch || 'main',
            auth: gitConfig.auth || { username: '', password: '' }
        };

        if (gitConfig.corsProxy) {
            remoteConfig.corsProxy = gitConfig.corsProxy;
        }

        await Store.saveRemoteConfig(remoteConfig);
        console.log('[BulkImport] Git config applied for vault:', vaultName);
    },

    /**
     * Apply sync configuration
     */
    async applySyncConfig(vaultName, syncConfig) {
        const updates = {
            autoSync: !!syncConfig.autoSync,
            syncInterval: syncConfig.syncInterval || 0,
            commitThreshold: syncConfig.commitThreshold || 5
        };

        await SyncManager.saveConfig(updates);
        console.log('[BulkImport] Sync config applied for vault:', vaultName);
    },

    /**
     * Apply AI settings
     */
    async applyAISettings(vaultHandle, aiConfig, includeApiKeys, isOPFS) {
        if (!aiConfig) return;

        let tempHandle = null;

        if (isOPFS) {
            tempHandle = Store.directoryHandle;
            Store.directoryHandle = vaultHandle;
        }

        try {
            const settings = await AppSettings.load() || {};

            if (aiConfig.enabled !== undefined) {
                settings.ai = settings.ai || {};
                settings.ai.enabled = aiConfig.enabled;
            }

            if (aiConfig.profiles && Array.isArray(aiConfig.profiles)) {
                settings.ai = settings.ai || {};
                settings.ai.profiles = aiConfig.profiles;
            }

            if (aiConfig.presets && Array.isArray(aiConfig.presets)) {
                settings.ai = settings.ai || {};
                settings.ai.presets = aiConfig.presets;
            }

            if (aiConfig.lastProfileId) {
                settings.ai = settings.ai || {};
                settings.ai.lastProfileId = aiConfig.lastProfileId;
            }

            if (aiConfig.lastInstruction) {
                settings.ai = settings.ai || {};
                settings.ai.lastInstruction = aiConfig.lastInstruction;
            }

            await AppSettings.save(settings);

            if (includeApiKeys && aiConfig.apiKeys && typeof aiConfig.apiKeys === 'object') {
                await AppSettings.saveKeys(aiConfig.apiKeys);
                console.log('[BulkImport] API keys imported for vault:', vaultHandle.name);
            }

            console.log('[BulkImport] AI settings applied for vault:', vaultHandle.name);

        } finally {
            if (isOPFS && tempHandle) {
                Store.directoryHandle = tempHandle;
            }
        }
    },

    /**
     * Export all vaults to JSON format
     */
    async exportAllVaults() {
        const vaultList = await Store.getVaultList();
        const vaultsData = [];

        for (const vaultEntry of vaultList) {
            try {
                const handle = await Store.getVaultHandle(vaultEntry.name);
                if (!handle) continue;

                const vaultData = {
                    name: vaultEntry.name,
                    type: vaultEntry.type,
                    addedAt: vaultEntry.addedAt
                };

                const remoteConfig = await Store.getRemoteConfig();
                if (remoteConfig && remoteConfig.url) {
                    vaultData.git = {
                        url: remoteConfig.url,
                        name: remoteConfig.name,
                        branch: remoteConfig.branch,
                        corsProxy: remoteConfig.corsProxy
                    };
                    if (remoteConfig.auth && (remoteConfig.auth.username || remoteConfig.auth.password)) {
                        vaultData.git.auth = {
                            username: remoteConfig.auth.username || '',
                            password: remoteConfig.auth.password || ''
                        };
                    }
                }

                const syncCfg = { ...SyncManager._config };
                if (syncCfg.autoSync || syncCfg.syncInterval || syncCfg.commitThreshold !== 5) {
                    vaultData.sync = {
                        autoSync: syncCfg.autoSync,
                        syncInterval: syncCfg.syncInterval,
                        commitThreshold: syncCfg.commitThreshold
                    };
                }

                let tempHandle = null;
                if (Store.isOPFSVault(vaultEntry)) {
                    tempHandle = Store.directoryHandle;
                    Store.directoryHandle = handle;
                }

                try {
                    const settings = await AppSettings.load();
                    if (settings.ai) {
                        vaultData.ai = {
                            enabled: settings.ai.enabled,
                            profiles: settings.ai.profiles || [],
                            presets: settings.ai.presets || [],
                            lastProfileId: settings.ai.lastProfileId,
                            lastInstruction: settings.ai.lastInstruction
                        };

                        const keys = await AppSettings.loadKeys();
                        if (keys && Object.keys(keys).length > 0) {
                            vaultData.ai.apiKeys = keys;
                        }
                    }
                } finally {
                    if (tempHandle) {
                        Store.directoryHandle = tempHandle;
                    }
                }

                vaultsData.push(vaultData);

            } catch (e) {
                console.error('[BulkImport] Failed to export vault:', vaultEntry.name, e);
            }
        }

        const exportData = {
            version: 1,
            vaults: vaultsData,
            exportedAt: new Date().toISOString()
        };

        return JSON.stringify(exportData, null, 2);
    },

    /**
     * Show export modal
     */
    async showExportModal() {
        const vaultList = await Store.getVaultList();

        if (vaultList.length === 0) {
            showToast('No vaults to export.');
            return;
        }

        try {
            const json = await this.exportAllVaults();
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const modal = Modal.create({
                title: 'Export All Vaults',
                width: 'min(500px, 90vw)',
                content: `
                    <div class="bulk-export-container">
                        <p style="color:var(--text-secondary);margin-bottom:1rem">
                            Export all ${vaultList.length} vault${vaultList.length !== 1 ? 's' : ''} with their configurations to a single JSON file.
                        </p>
                        <div class="bulk-export-summary">
                            <p><strong>${vaultList.length} vault${vaultList.length !== 1 ? 's' : ''}</strong> will be exported</p>
                            <p style="font-size:0.85rem;color:var(--text-muted)">Includes: Git remote, AI profiles, API keys, sync config</p>
                        </div>
                        <div style="margin-top:0.75rem;padding:0.6rem 0.8rem;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:var(--radius-sm,4px);color:#dc2626;font-size:0.8rem;line-height:1.4">
                            <strong>⚠️ Security Warning:</strong> This export includes API keys and git credentials. Store the JSON file securely and do not share it with others.
                        </div>
                        <div style="margin-top:1.5rem;display:flex;justify-content:flex-end;gap:0.5rem">
                            <button class="modal-cancel-btn" id="bulkExportCancel">Cancel</button>
                            <button class="modal-confirm-btn" id="bulkExportDownload">Download JSON</button>
                        </div>
                    </div>
                `
            });

            modal.querySelector('#bulkExportCancel').addEventListener('click', () => modal.close());

            modal.querySelector('#bulkExportDownload').addEventListener('click', () => {
                const a = document.createElement('a');
                a.href = url;
                a.download = `noteview-vaults-export-${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showToast('Export downloaded successfully.');
                modal.close();
            });

        } catch (e) {
            console.error('[BulkImport] Export failed:', e);
            showToast('Export failed: ' + (e.message || 'Unknown error'));
        }
    }
};

window.BulkImport = BulkImport;