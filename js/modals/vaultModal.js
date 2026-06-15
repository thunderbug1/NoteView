/**
 * Vault Modal - Vault management UI (create, open, switch, remove vaults)
 */

const VaultModal = {
    _closeDropdownHandler: null,
    _prevHandle: null,
    _managerModal: null,

    updateVaultSwitcherName() {
        const nameEl = document.getElementById('vaultSwitcherName');
        if (nameEl) {
            nameEl.textContent = Store.directoryHandle ? Store.directoryHandle.name : 'No vault';
        }
    },

    async showDropdown(btn) {
        // Remove any existing dropdown and its listener
        const existing = document.getElementById('vaultDropdown');
        if (existing) {
            this._removeCloseDropdownHandler();
            existing.remove();
            return;
        }

        const vaultList = await Store.getVaultList();
        const currentName = Store.directoryHandle?.name || '';

        const menu = document.createElement('div');
        menu.id = 'vaultDropdown';
        menu.className = 'task-context-menu';

        // Vault items
        if (vaultList.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'vault-dropdown-item';
            empty.style.opacity = '0.5';
            empty.style.cursor = 'default';
            empty.textContent = 'No vaults yet';
            menu.appendChild(empty);
        } else {
            vaultList.forEach(v => {
                const item = document.createElement('div');
                item.className = 'vault-dropdown-item' + (v.name === currentName ? ' active' : '');
                item.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(v.name)}</span>`;
                if (v.name !== currentName) {
                    item.addEventListener('click', () => {
                        VaultModal._removeCloseDropdownHandler();
                        menu.remove();
                        VaultModal.switchVault(v.name);
                    });
                }
                menu.appendChild(item);
            });
        }

        // Pre-warm permissions for local vaults while we have user gesture (skip OPFS — no permission needed)
        vaultList.forEach(v => {
            if (Store.isOPFSVault(v)) return;
            Store.getVaultHandle(v.name).then(handle => {
                if (!handle) return;
                handle.queryPermission({ mode: 'readwrite' }).then(perm => {
                    if (perm !== 'granted') {
                        handle.requestPermission({ mode: 'readwrite' }).catch(() => {});
                    }
                }).catch(err => console.warn('[VaultModal] queryPermission failed for', v.name, err));
            }).catch(err => console.warn('[VaultModal] getVaultHandle failed for', v.name, err));
        });

        // Divider
        const divider = document.createElement('div');
        divider.className = 'menu-divider';
        divider.style.margin = '0.3rem 0';
        menu.appendChild(divider);

        // Manage Vaults option
        const manageItem = document.createElement('div');
        manageItem.className = 'vault-dropdown-item';
        manageItem.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82V9a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg><span>Manage Vaults...</span>`;
        manageItem.addEventListener('click', () => {
            VaultModal._removeCloseDropdownHandler();
            menu.remove();
            VaultModal.showManager();
        });
        menu.appendChild(manageItem);

        // Position above the button, or below if not enough room
        document.body.appendChild(menu);
        const rect = btn.getBoundingClientRect();
        const spaceAbove = rect.top - 8;
        const spaceBelow = window.innerHeight - rect.bottom - 8;
        const showAbove = spaceAbove >= 120 || spaceAbove >= spaceBelow;
        menu.style.position = 'fixed';
        menu.style.left = `${rect.left}px`;
        menu.style.minWidth = `${rect.width}px`;
        menu.style.overflowY = 'auto';
        if (showAbove) {
            menu.style.top = 'auto';
            menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
            menu.style.maxHeight = `min(${spaceAbove}px, 300px)`;
        } else {
            menu.style.top = `${rect.bottom + 4}px`;
            menu.style.bottom = 'auto';
            menu.style.maxHeight = `min(${spaceBelow}px, 300px)`;
        }

        // Close on outside click
        const closeDropdown = (e) => {
            if (!menu.contains(e.target) && e.target !== btn) {
                this._removeCloseDropdownHandler();
                menu.remove();
            }
        };
        document.addEventListener('click', closeDropdown);
        this._closeDropdownHandler = closeDropdown;
    },

    _removeCloseDropdownHandler() {
        if (this._closeDropdownHandler) {
            document.removeEventListener('click', this._closeDropdownHandler);
            this._closeDropdownHandler = null;
        }
    },

    async switchVault(name) {
        const container = document.getElementById('viewContainer');
        if (container) container.innerHTML = '<div class="loading">Loading notes...</div>';

        try {
            const handle = await Store.getVaultHandle(name);
            if (!handle) {
                // Vault handle was removed — clean up
                await Store.deleteVault(name);
                VaultModal.updateVaultSwitcherName();
                return;
            }

            await Store.switchToVault(handle);
            await App.completeInitialization();
            VaultModal.updateVaultSwitcherName();
        } catch (err) {
            if (err.message?.includes('Permission denied')) {
                // Try showing the permission button
                const handle = await Store.getVaultHandle(name);
                if (handle) {
                    App.showPermissionButton(handle);
                }
            } else if (err.name === 'AbortError') {
                // User cancelled
            } else {
                App.showError(err.message || 'Failed to switch vault');
            }
        }
    },

    async showManager() {
        const vaultList = await Store.getVaultList();
        const currentName = Store.directoryHandle?.name || '';
        const hasLocalPicker = 'showDirectoryPicker' in window;

        const folderIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;

        const browserIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;

        const dotsIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="12" cy="19" r="2"></circle></svg>`;

        const renderList = (vaults) => vaults.map(v => `
            <div class="vault-manager-row${v.name === currentName ? ' active' : ''}" data-vault="${escapeHtml(v.name)}">
                ${Store.isOPFSVault(v) ? browserIcon : folderIcon}
                <span class="vault-manager-name">${escapeHtml(v.name)}</span>
                <button class="vault-manager-menu-btn" data-vault="${escapeHtml(v.name)}" title="Vault options">${dotsIcon}</button>
            </div>
        `).join('');

        const localActions = hasLocalPicker ? `
                        <div class="vault-manager-action">
                            <div class="vault-manager-action-text">
                                <h4>Create new vault</h4>
                                <p>Create a new folder for your notes</p>
                            </div>
                            <button class="vault-manager-action-btn primary" id="createVaultBtn">Create</button>
                        </div>
                        <div class="vault-manager-action">
                            <div class="vault-manager-action-text">
                                <h4>Open folder as vault</h4>
                                <p>Open an existing folder on your device</p>
                            </div>
                            <button class="vault-manager-action-btn secondary" id="openFolderAsVaultBtn">Open</button>
                        </div>` : '';

        const modal = Modal.create({
            title: 'Manage Vaults',
            onClose: () => {
                closeVaultMenu();
                VaultModal._managerModal = null;
                if (!Store.directoryHandle) {
                    App.showDirectoryPicker();
                }
            },
            content: `
                <div class="vault-manager">
                    <div class="vault-manager-sidebar">
                        <div class="vault-manager-list" id="vaultManagerList">
                            ${vaultList.length > 0 ? renderList(vaultList) : '<div style="text-align:center;color:var(--text-muted);padding:2rem 0">No vaults added yet</div>'}
                        </div>
                    </div>
                    <div class="vault-manager-actions">
                        ${localActions}
                        <div class="vault-manager-action">
                            <div class="vault-manager-action-text">
                                <h4>Create browser vault</h4>
                                <p>No permission prompts — stays in browser storage</p>
                            </div>
                            <button class="vault-manager-action-btn secondary" id="createBrowserVaultBtn">Create</button>
                        </div>
                        <div class="vault-manager-action">
                            <div class="vault-manager-action-text">
                                <h4>Scan QR Code</h4>
                                <p>Scan a vault config from another device</p>
                            </div>
                            <button class="vault-manager-action-btn secondary" id="scanQrVaultBtn">Scan</button>
                        </div>
                    </div>
                </div>
            `,
            width: '600px'
        });

        VaultModal._managerModal = modal;
        VaultModal._prevHandle = Store.directoryHandle;

        const refreshList = async () => {
            const list = await Store.getVaultList();
            const listEl = modal.querySelector('#vaultManagerList');
            if (listEl) {
                if (list.length > 0) {
                    listEl.innerHTML = renderList(list);
                    wireRowEvents();
                } else {
                    listEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:2rem 0">No vaults added yet</div>';
                }
            }
        };

        let _vaultMenuCloseHandler = null;

        function closeVaultMenu() {
            const existing = document.getElementById('vaultContextMenu');
            if (existing) existing.remove();
            if (_vaultMenuCloseHandler) {
                document.removeEventListener('click', _vaultMenuCloseHandler);
                _vaultMenuCloseHandler = null;
            }
        }

        function showVaultContextMenu(btn, vaultName) {
            closeVaultMenu();
            const menu = document.createElement('div');
            menu.id = 'vaultContextMenu';
            menu.className = 'task-context-menu';
            menu.style.width = '220px';
            menu.innerHTML = `
                <div class="menu-item menu-item-danger" data-action="remove">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;flex-shrink:0"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    Remove from list
                </div>
            `;

            document.body.appendChild(menu);
            const rect = btn.getBoundingClientRect();
            menu.style.position = 'fixed';
            menu.style.top = 'auto';
            menu.style.left = 'auto';
            menu.style.right = `${window.innerWidth - rect.right}px`;
            menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
            menu.style.overflow = 'visible';

            // Ensure menu stays on screen
            requestAnimationFrame(() => {
                const menuRect = menu.getBoundingClientRect();
                if (menuRect.left < 8) {
                    menu.style.right = 'auto';
                    menu.style.left = `${rect.left}px`;
                }
                if (menuRect.top < 8) {
                    menu.style.bottom = 'auto';
                    menu.style.top = `${rect.bottom + 4}px`;
                }
            });

            menu.querySelector('[data-action="remove"]').addEventListener('click', () => {
                closeVaultMenu();
                const confirmed = window.confirm(`Remove "${vaultName}" from your vault list?\n\nYour files are not deleted.`);
                if (confirmed) {
                    Store.deleteVault(vaultName).then(async () => {
                        await refreshList();
                        // If the removed vault was the active one, close it
                        if (vaultName === (Store.directoryHandle?.name || '')) {
                            Store.directoryHandle = null;
                            Store.blocks = [];
                            Store.currentView = 'document';
                            document.getElementById('app')?.classList.add('no-vault');
                            const fab = document.getElementById('fabNewNote');
                            if (fab) fab.style.display = 'none';
                            document.getElementById('viewContainer').innerHTML = '';
                            VaultModal.updateVaultSwitcherName();
                        }
                    }).catch(err => {
                        console.error('Failed to delete vault:', err);
                        showToast('Failed to remove vault: ' + (err.message || 'Unknown error'));
                    });
                }
            });

            const closeMenu = (e) => {
                if (!menu.contains(e.target) && e.target !== btn) {
                    closeVaultMenu();
                }
            };
            _vaultMenuCloseHandler = closeMenu;
            document.addEventListener('click', closeMenu);
        }

        function wireRowEvents() {
            modal.querySelectorAll('.vault-manager-row').forEach(row => {
                row.addEventListener('click', (e) => {
                    if (e.target.closest('.vault-manager-menu-btn')) return;
                    const name = row.dataset.vault;
                    if (name === currentName) return;
                    modal.close();
                    VaultModal.switchVault(name);
                });
            });
            modal.querySelectorAll('.vault-manager-menu-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showVaultContextMenu(btn, btn.dataset.vault);
                });
            });
        }

        wireRowEvents();

        const openVaultFromPicker = async () => {
            try {
                const handle = await window.showDirectoryPicker();
                modal.close();
                const container = document.getElementById('viewContainer');
                if (container) container.innerHTML = '<div class="loading">Loading notes...</div>';

                await Store.switchToVault(handle);
                await App.completeInitialization();
                VaultModal.updateVaultSwitcherName();
            } catch (err) {
                if (err.name === 'AbortError') return;
                App.showError(err.message || 'Failed to open vault');
            }
        };

        const openBrowserVaultWizard = () => {
            modal.close();
            VaultModal._openBrowserVaultWizard();
        };

        const browserVaultBtn = modal.querySelector('#createBrowserVaultBtn');
        if (browserVaultBtn) browserVaultBtn.addEventListener('click', openBrowserVaultWizard);

        const openBtn = modal.querySelector('#openFolderAsVaultBtn');
        if (openBtn) openBtn.addEventListener('click', openVaultFromPicker);

        const createBtn = modal.querySelector('#createVaultBtn');
        if (createBtn) createBtn.addEventListener('click', openVaultFromPicker);

        const scanQrBtn = modal.querySelector('#scanQrVaultBtn');
        if (scanQrBtn) {
            scanQrBtn.addEventListener('click', () => {
                modal.close();
                VaultModal.openQrScanner();
            });
        }
    },

    async _openBrowserVaultWizard(prefillData = null) {
        const prevDirectoryHandle = VaultModal._prevHandle || Store.directoryHandle;
        const defaultProxy = window.AppSettings ? await AppSettings.getDefaultCorsProxy() : '';

        const wizardModal = Modal.create({
                title: 'Browser Vault Setup Wizard',
                content: `
                    <div class="vault-wizard">
                        <!-- Progress Indicator -->
                        <div class="wizard-steps">
                            <div class="wizard-step-indicator active" data-step="1">1. Vault Name</div>
                            <div class="wizard-step-indicator" data-step="2">2. Git Sync</div>
                            <div class="wizard-step-indicator" data-step="3">3. Connection</div>
                        </div>

                        <!-- Step 1: Vault Name -->
                        <div class="wizard-panel active" data-panel="1">
                            <h3 class="wizard-title">Give your browser vault a name</h3>
                            <p class="wizard-intro-text">Browser vaults are securely stored in your browser's private database (OPFS). They require no security prompts or disk permissions.</p>
                            
                            <div class="wizard-form-group">
                                <label for="wizardVaultName">Vault Name</label>
                                <input type="text" id="wizardVaultName" placeholder="My Vault" value="My Vault" autofocus>
                                <span class="field-hint">Use a simple name, e.g. "Work Notes" or "Personal"</span>
                            </div>

                            <div class="wizard-footer">
                                <button class="vault-manager-action-btn secondary close-wizard-btn">Cancel</button>
                                <button class="vault-manager-action-btn secondary" id="wizardScanQrBtn" style="margin-right:auto">Scan QR Code</button>
                                <button class="vault-manager-action-btn primary next-step-btn" data-next="2">Next: Git Sync</button>
                            </div>
                        </div>

                        <!-- Step 2: Git Sync Settings -->
                        <div class="wizard-panel" data-panel="2">
                            <h3 class="wizard-title">Git Cloud Synchronization <span class="wizard-optional">(Optional)</span></h3>
                            <p class="wizard-intro-text">Connect to a remote Git repository (like GitHub or GitLab) to sync your notes across multiple devices and back them up in the cloud.</p>
                            
                            <div class="wizard-toggle-sync">
                                <label class="switch-container">
                                    <input type="checkbox" id="wizardEnableGit" checked>
                                    <span class="switch-slider"></span>
                                    <span class="switch-label">Enable Git Sync for this vault</span>
                                </label>
                            </div>

                            <div id="wizardGitFields" class="wizard-git-fields">
                                <div class="wizard-form-group">
                                    <label for="wizardGitUrl">Git Remote URL (HTTPS)</label>
                                    <input type="url" id="wizardGitUrl" placeholder="https://github.com/username/notes.git">
                                    <span class="field-hint">HTTPS URL only (SSH is not supported in the browser).</span>
                                </div>
                                
                                 <div class="wizard-form-row">
                                     <div class="wizard-form-group">
                                         <label for="wizardGitUser">Username</label>
                                         <input type="text" id="wizardGitUser" placeholder="github-username">
                                     </div>
                                     <div class="wizard-form-group">
                                         <label for="wizardGitToken">Personal Access Token / Password</label>
                                         <div class="wizard-api-key-field">
                                             <input type="password" id="wizardGitToken" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" autocomplete="off">
                                             <button type="button" class="wizard-toggle-token-visibility" id="wizardToggleTokenVisibility" title="Show token">
                                                 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                             </button>
                                         </div>
                                         <span class="field-hint">For GitHub, use a Personal Access Token (PAT) with <b>repo</b> scope.</span>
                                     </div>
                                 </div>

                                <div class="wizard-form-group">
                                    <label for="wizardGitProxy">CORS Proxy URL</label>
                                    <input type="url" id="wizardGitProxy" value="${escapeHtml(defaultProxy)}" placeholder="https://cors.isomorphic-git.org">
                                    <span class="field-hint">Proxy to bypass browser CORS limits. Default: https://cors.isomorphic-git.org</span>
                                </div>
                            </div>

                             <div class="wizard-footer">
                                <button class="vault-manager-action-btn secondary prev-step-btn" data-prev="1">Back</button>
                                <button class="vault-manager-action-btn primary" id="wizardStartVerificationBtn">Verify & Create Vault</button>
                                <button class="vault-manager-action-btn secondary" id="wizardSkipVerificationBtn" style="margin-left:0.5rem">Skip Verification</button>
                            </div>
                        </div>

                        <!-- Step 3: Verification & Setup -->
                        <div class="wizard-panel" data-panel="3">
                            <h3 class="wizard-title" id="wizardVerifyTitle">Verifying Git Connection</h3>
                            
                            <div class="wizard-status-container">
                                <div class="wizard-spinner-large" id="wizardStatusSpinner"></div>
                                <div class="wizard-status-success-icon" id="wizardStatusSuccessIcon" style="display:none">
                                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                </div>
                                <div class="wizard-status-error-icon" id="wizardStatusErrorIcon" style="display:none">
                                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </div>
                                <p id="wizardStatusMessage" class="wizard-status-message">Testing remote git repository connection...</p>
                            </div>

                            <div class="wizard-error-box" id="wizardErrorBox" style="display:none">
                                <h4 id="wizardErrorHeadline">Verification Failed</h4>
                                <p id="wizardErrorMessage">Could not connect to the Git repository. Please check your credentials and repository URL.</p>
                            </div>

                            <div class="wizard-footer" id="wizardVerificationFooter">
                                <button class="vault-manager-action-btn secondary prev-step-btn" id="wizardErrorBackBtn" data-prev="2" style="display:none">Edit Settings</button>
                                <button class="vault-manager-action-btn primary" id="wizardSuccessDoneBtn" style="display:none">Launch Vault</button>
                            </div>
                        </div>
                    </div>
                `,
                width: '550px',
                onClose: () => {
                    if (!Store.directoryHandle) {
                        App.showDirectoryPicker();
                    }
                }
            });

            // Handle panel switching
            const indicators = wizardModal.querySelectorAll('.wizard-step-indicator');
            const panels = wizardModal.querySelectorAll('.wizard-panel');

            const showPanel = (panelNum) => {
                panels.forEach(p => p.classList.remove('active'));
                indicators.forEach(ind => ind.classList.remove('active'));

                const activePanel = wizardModal.querySelector(`[data-panel="${panelNum}"]`);
                if (activePanel) activePanel.classList.add('active');

                // Activate indicators up to panelNum
                indicators.forEach(ind => {
                    const stepNum = parseInt(ind.dataset.step);
                    if (stepNum <= panelNum) {
                        ind.classList.add('active');
                    }
                });
            };

            // Switch Git fields visibility
            const enableGitCheckbox = wizardModal.querySelector('#wizardEnableGit');
            const gitFields = wizardModal.querySelector('#wizardGitFields');
            if (enableGitCheckbox && gitFields) {
                enableGitCheckbox.addEventListener('change', () => {
                    if (enableGitCheckbox.checked) {
                        gitFields.classList.remove('disabled');
                    } else {
                        gitFields.classList.add('disabled');
                    }
                });
            }

            // Wire next/prev buttons
            wizardModal.querySelectorAll('.next-step-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const nextNum = parseInt(btn.dataset.next);
                    if (nextNum === 2) {
                        const nameInput = wizardModal.querySelector('#wizardVaultName');
                        if (!nameInput.value.trim()) {
                            alert('Please enter a vault name.');
                            nameInput.focus();
                            return;
                        }
                    }
                    showPanel(nextNum);
                });
            });

            wizardModal.querySelectorAll('.prev-step-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const prevNum = parseInt(btn.dataset.prev);
                    showPanel(prevNum);
                });
            });

            wizardModal.querySelectorAll('.close-wizard-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    Store.directoryHandle = prevDirectoryHandle;
                    wizardModal.close();
                    VaultModal.showManager();
                });
            });

            // Toggle token visibility
            const toggleTokenBtn = wizardModal.querySelector('#wizardToggleTokenVisibility');
            if (toggleTokenBtn) {
                toggleTokenBtn.addEventListener('click', () => {
                    const input = wizardModal.querySelector('#wizardGitToken');
                    if (input.type === 'password') {
                        input.type = 'text';
                        toggleTokenBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
                        toggleTokenBtn.title = 'Hide token';
                    } else {
                        input.type = 'password';
                        toggleTokenBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
                        toggleTokenBtn.title = 'Show token';
                    }
                });
            }

            // Start verification process
            const verifyBtn = wizardModal.querySelector('#wizardStartVerificationBtn');
            if (verifyBtn) {
                verifyBtn.addEventListener('click', async () => {
                    const name = wizardModal.querySelector('#wizardVaultName').value.trim();
                    const enableGit = wizardModal.querySelector('#wizardEnableGit').checked;
                    
                    if (!name) {
                        alert('Please enter a vault name.');
                        showPanel(1);
                        return;
                    }

                    if (!enableGit) {
                        // Directly create browser vault (OPFS) without git connection
                        try {
                            wizardModal.close();
                            const container = document.getElementById('viewContainer');
                            if (container) container.innerHTML = '<div class="loading">Creating browser vault...</div>';

                            await Store.createOPFSVault(name);
                            await App.completeInitialization();
                            VaultModal.updateVaultSwitcherName();
                        } catch (err) {
                            App.showError(err.message || 'Failed to create browser vault');
                        }
                        return;
                    }

                    // Git is enabled — verify first!
                    const gitUrl = wizardModal.querySelector('#wizardGitUrl').value.trim();
                    const gitUser = wizardModal.querySelector('#wizardGitUser').value.trim();
                    const gitToken = wizardModal.querySelector('#wizardGitToken').value.trim();
                    const gitProxy = wizardModal.querySelector('#wizardGitProxy').value.trim();

                    if (!gitUrl) {
                        alert('Please enter a Git repository URL.');
                        wizardModal.querySelector('#wizardGitUrl').focus();
                        return;
                    }

                    showPanel(3);

                    const spinner = wizardModal.querySelector('#wizardStatusSpinner');
                    const successIcon = wizardModal.querySelector('#wizardStatusSuccessIcon');
                    const errorIcon = wizardModal.querySelector('#wizardStatusErrorIcon');
                    const statusMsg = wizardModal.querySelector('#wizardStatusMessage');
                    const errorBox = wizardModal.querySelector('#wizardErrorBox');
                    const errorMsgEl = wizardModal.querySelector('#wizardErrorMessage');
                    const errorBackBtn = wizardModal.querySelector('#wizardErrorBackBtn');
                    const successDoneBtn = wizardModal.querySelector('#wizardSuccessDoneBtn');

                    // Reset status view
                    spinner.style.display = 'block';
                    successIcon.style.display = 'none';
                    errorIcon.style.display = 'none';
                    errorBox.style.display = 'none';
                    errorBackBtn.style.display = 'none';
                    successDoneBtn.style.display = 'none';
                    statusMsg.textContent = 'Initializing private directory...';

                    let tempHandle = null;
                    try {
                        // 1. Create OPFS directory locally
                        const opfsRoot = await navigator.storage.getDirectory();
                        tempHandle = await opfsRoot.getDirectoryHandle(name, { create: true });

                        // 2. Initialize Git locally inside this handle
                        statusMsg.textContent = 'Initializing Git repository...';
                        const initSuccess = await GitStore.init(tempHandle);
                        if (!initSuccess) {
                            throw new Error('Failed to initialize Git inside the browser directory.');
                        }

                        // 3. Configure Git credentials & remote URL
                        statusMsg.textContent = 'Setting up credentials...';
                        const auth = (gitUser || gitToken) ? { username: gitUser, password: gitToken } : null;

                        await GitStore._loadGitLibs();
                        
                        // Set credentials in window.GitHttp directly so connection can check it
                        window.GitHttp.clearCredentials();
                        if (auth) {
                            window.GitHttp.setCredentials(auth);
                        }

                        // Temporarily assign remote config to GitRemote
                        GitRemote.config = { name: 'origin', url: gitUrl, auth };
                        if (window.SyncManager) {
                            SyncManager._config = SyncManager._config || {};
                            SyncManager._config.corsProxy = gitProxy || undefined;
                            SyncManager._config.branch = SyncManager._config.branch || 'main';
                        }

                        // Save the full remote config including sync settings
                        const remoteConfig = { name: 'origin', url: gitUrl, auth, sync: SyncManager._config };
                        
                        // Set directoryHandle temporarily so saveRemoteConfig and pull can run correctly
                        Store.directoryHandle = tempHandle;
                        await Store.saveRemoteConfig(remoteConfig);

                        // 4. Add remote and test connection via fetch
                        statusMsg.textContent = 'Adding remote repository...';
                        await GitStore.git.addRemote({
                            fs: GitStore.fs,
                            dir: GitStore.dir,
                            remote: 'origin',
                            url: gitUrl,
                            force: true
                        });

                        statusMsg.textContent = 'Connecting to git remote repository...';
                        await GitStore.git.fetch({
                            fs: GitStore.fs,
                            dir: GitStore.dir,
                            http: window.GitHttp,
                            remote: 'origin',
                            corsProxy: gitProxy || undefined,
                            onAuth: () => auth,
                            singleBranch: true,
                            depth: 1
                        });

                        // 5. Connection works! Try to pull notes (if existing)
                        statusMsg.textContent = 'Connection successful! Fetching branch...';

                        try {
                            statusMsg.textContent = 'Downloading notes from remote repository...';
                            await GitRemote.pull();
                        } catch (pullErr) {
                            // If branch main doesn't exist, it's just a fresh empty repository. Not an error!
                            if (pullErr.message?.includes('not found') || pullErr.message?.includes('Could not resolve')) {
                                Logger.log('Remote branch not found. Assuming fresh new repository.', pullErr);
                            } else {
                                // Real pull error (e.g. invalid permissions or checkout issue)
                                throw pullErr;
                            }
                        }

                        // 6. Complete and save vault!
                        statusMsg.textContent = 'Vault setup complete!';
                        spinner.style.display = 'none';
                        successIcon.style.display = 'block';
                        successDoneBtn.style.display = 'block';

                        // Save vault to vaultList and make active
                        await Store.saveVault(tempHandle, 'opfs');
                        await Store.setLastActiveVault(name);

                        // Wire done button to launch vault
                        successDoneBtn.addEventListener('click', async () => {
                            wizardModal.close();
                            const container = document.getElementById('viewContainer');
                            if (container) container.innerHTML = '<div class="loading">Launching notes...</div>';
                            await App.completeInitialization();
                            VaultModal.updateVaultSwitcherName();
                        });

                    } catch (err) {
                        console.error('Verification wizard error:', err);
                        
                        // Clean up: delete the locally created directory so it's not a zombie directory
                        let cleanupFailed = false;
                        let cleanupMsg = '';
                        try {
                            const opfsRoot = await navigator.storage.getDirectory();
                            await opfsRoot.removeEntry(name, { recursive: true });
                            Logger.log('Cleanup successful: removed partial vault', name);
                        } catch (cleanUpErr) {
                            console.warn('Cleanup failed:', cleanUpErr);
                            cleanupFailed = true;
                            cleanupMsg = cleanUpErr.message || 'Unknown error';
                            
                            // Try to clean up the vault list entry
                            try {
                                const vaultList = await Store.getVaultList();
                                const zombieEntry = vaultList.find(v => v.name === name && v.type === 'opfs');
                                if (zombieEntry) {
                                    await Store.deleteVault(name);
                                    Logger.log('Removed zombie vault entry from vault list', name);
                                    cleanupFailed = false; // Mark as resolved since we cleaned the metadata
                                }
                            } catch (listCleanupErr) {
                                console.warn('Failed to clean vault list:', listCleanupErr);
                            }
                        }

                        // Restore previous directory handle
                        Store.directoryHandle = prevDirectoryHandle;

                        // Restore previous config to avoid breaking existing vaults
                        try {
                            await GitRemote.init();
                        } catch (e) {}

                        spinner.style.display = 'none';
                        errorIcon.style.display = 'block';
                        errorBox.style.display = 'block';
                        errorBackBtn.style.display = 'block';
                        successDoneBtn.style.display = 'none';
                        
                        // Classify error type for better UX
                        let errorType = 'generic';
                        let friendlyMsg = err.message || err.toString();
                        let isTransient = false;
                        let actionHint = '';
                        
                        if (friendlyMsg.includes('401') || friendlyMsg.toLowerCase().includes('unauthorized') || friendlyMsg.toLowerCase().includes('auth')) {
                            errorType = 'auth';
                            friendlyMsg = 'Authentication failed. Please verify your username and Personal Access Token (PAT). Remember, GitHub and GitLab require a PAT, not your login password.';
                            actionHint = '<a href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token" target="_blank" style="color:var(--accent);text-decoration:underline">How to create a PAT</a>';
                        } else if (friendlyMsg.includes('403') || friendlyMsg.toLowerCase().includes('forbidden')) {
                            errorType = 'forbidden';
                            friendlyMsg = 'Access denied. Your token may not have the required permissions or the repository branch may be protected.';
                            actionHint = 'Ensure your PAT has the "repo" scope and that push access is enabled.';
                        } else if (friendlyMsg.includes('404') || friendlyMsg.toLowerCase().includes('not found')) {
                            errorType = 'notfound';
                            friendlyMsg = 'Repository not found. Double check the HTTPS URL. Make sure it exists and that your token has read/write access.';
                        } else if (friendlyMsg.toLowerCase().includes('cors') || friendlyMsg.toLowerCase().includes('fetch') || friendlyMsg.toLowerCase().includes('networkerror')) {
                            errorType = 'cors';
                            friendlyMsg = 'Network or CORS error. In-browser Git sync requires a CORS Proxy to work. Make sure your CORS proxy URL is correct and active, or try isomorphic-git\'s default proxy.';
                            actionHint = '<a href="https://isomorphic-git.org/docs/en/corsProxy" target="_blank" style="color:var(--accent);text-decoration:underline">Learn about CORS proxies</a>';
                        } else if (friendlyMsg.toLowerCase().includes('timeout') || friendlyMsg.toLowerCase().includes('timed out') || friendlyMsg.toLowerCase().includes('network')) {
                            errorType = 'network';
                            isTransient = true;
                            friendlyMsg = 'Network timeout or connection error. This might be a temporary issue.';
                            actionHint = 'Check your internet connection and try again.';
                        } else if (friendlyMsg.toLowerCase().includes('failed to init git') || friendlyMsg.toLowerCase().includes('initialize')) {
                            errorType = 'init';
                            friendlyMsg = 'Failed to initialize Git repository. This may be due to storage limits or browser restrictions.';
                        }
                        
                        statusMsg.textContent = isTransient ? 'Connection timeout' : 'Verification failed.';
                        
                        // Build detailed error message
                        let detailedMsg = `<p>${escapeHtml(friendlyMsg)}</p>`;
                        if (actionHint) {
                            detailedMsg += `<p style="margin-top:0.5rem;font-size:0.85rem;color:var(--text-secondary)">${actionHint}</p>`;
                        }
                        if (cleanupFailed) {
                            detailedMsg += `<div style="margin-top:0.75rem;padding:0.75rem;background:rgba(245,158,11,0.15);border-left:3px solid var(--color-warning,#f59e0b);border-radius:4px">
                                <p style="margin:0;font-size:0.85rem;color:var(--text-primary)">
                                    <strong>⚠️ Partial cleanup failed</strong><br>
                                    Could not remove the partially created vault. Go to <strong>Manage Vaults</strong> and remove "${escapeHtml(name)}" manually.
                                </p>
                                <p style="margin:0.25rem 0 0 0;font-size:0.75rem;color:var(--text-muted)">Error: ${escapeHtml(cleanupMsg)}</p>
                            </div>`;
                        }
                        
                        errorMsgEl.innerHTML = detailedMsg;
                        
                        // Add retry button for transient errors
                        const retryBtnId = 'wizardRetryBtn';
                        let existingRetryBtn = document.getElementById(retryBtnId);
                        if (existingRetryBtn) existingRetryBtn.remove();
                        
                        if (isTransient) {
                            const retryBtn = document.createElement('button');
                            retryBtn.id = retryBtnId;
                            retryBtn.className = 'vault-manager-action-btn primary';
                            retryBtn.textContent = 'Retry';
                            retryBtn.style.marginLeft = '0.5rem';
                            retryBtn.addEventListener('click', () => {
                                verifyBtn.click();
                            });
                            errorBackBtn.insertAdjacentElement('afterend', retryBtn);
                        }
                    }
                });
            }

            // Skip verification - create vault without testing connection
            const skipVerifyBtn = wizardModal.querySelector('#wizardSkipVerificationBtn');
            if (skipVerifyBtn) {
                skipVerifyBtn.addEventListener('click', async () => {
                    const name = wizardModal.querySelector('#wizardVaultName').value.trim();
                    const gitUrl = wizardModal.querySelector('#wizardGitUrl').value.trim();
                    const gitUser = wizardModal.querySelector('#wizardGitUser').value.trim();
                    const gitToken = wizardModal.querySelector('#wizardGitToken').value.trim();
                    const gitProxy = wizardModal.querySelector('#wizardGitProxy').value.trim();

                    if (!name) {
                        alert('Please enter a vault name.');
                        showPanel(1);
                        return;
                    }

                    if (!gitUrl) {
                        alert('Please enter a Git repository URL.');
                        showPanel(2);
                        return;
                    }

                    try {
                        wizardModal.close();
                        const container = document.getElementById('viewContainer');
                        if (container) container.innerHTML = '<div class="loading">Creating browser vault...</div>';

                        // Create OPFS vault
                        await Store.createOPFSVault(name);

                        // Configure git remote
                        const auth = (gitUser || gitToken) ? { username: gitUser, password: gitToken } : null;
                        const remoteConfig = { 
                            name: 'origin', 
                            url: gitUrl, 
                            auth,
                            sync: {
                                corsProxy: gitProxy || undefined,
                                branch: 'main'
                            }
                        };

                        await Store.saveRemoteConfig(remoteConfig);
                        GitRemote.config = remoteConfig;
                        if (window.GitHttp) window.GitHttp.setCredentials(auth);

                        if (GitStore.git && GitStore.fs) {
                            try {
                                await GitStore.git.addRemote({
                                    fs: GitStore.fs, dir: GitStore.dir,
                                    remote: 'origin', url: gitUrl, force: true
                                });
                            } catch (err) {
                                console.warn('[Wizard] Failed to add remote:', err);
                            }
                        }

                        await App.completeInitialization();
                        VaultModal.updateVaultSwitcherName();
                    } catch (err) {
                        console.error('Skip verification error:', err);
                        App.showError(err.message || 'Failed to create browser vault');
                    }
                });
            }

        // Wire Scan QR button inside wizard step 1
        const wizardScanBtn = wizardModal.querySelector('#wizardScanQrBtn');
        if (wizardScanBtn) {
            wizardScanBtn.addEventListener('click', () => {
                VaultModal.openQrScanner(wizardModal);
            });
        }

        // Apply prefill data from QR scan
        if (prefillData) {
            const nameInput = wizardModal.querySelector('#wizardVaultName');
            const gitUrlInput = wizardModal.querySelector('#wizardGitUrl');
            const gitUserInput = wizardModal.querySelector('#wizardGitUser');
            const gitTokenInput = wizardModal.querySelector('#wizardGitToken');
            const gitProxyInput = wizardModal.querySelector('#wizardGitProxy');
            const enableGitCheckbox = wizardModal.querySelector('#wizardEnableGit');
            const gitFieldsEl = wizardModal.querySelector('#wizardGitFields');

            if (prefillData.name) nameInput.value = prefillData.name;
            if (prefillData.gitUrl) gitUrlInput.value = prefillData.gitUrl;
            if (prefillData.gitUser) gitUserInput.value = prefillData.gitUser;
            if (prefillData.gitToken) gitTokenInput.value = prefillData.gitToken;
            if (prefillData.gitProxy) gitProxyInput.value = prefillData.gitProxy;
            if (prefillData.enableGit === false) {
                enableGitCheckbox.checked = false;
                gitFieldsEl.classList.add('disabled');
            } else if (prefillData.gitUrl) {
                enableGitCheckbox.checked = true;
                gitFieldsEl.classList.remove('disabled');
            }
        }
    },

    _normalizeQrData(raw) {
        if (!raw || typeof raw !== 'string') {
            return { success: false, error: 'No data provided or invalid data type.' };
        }

        // Try QRTransfer v1 format first
        if (window.QRTransfer && typeof QRTransfer._validateData === 'function') {
            const v1Data = QRTransfer._validateData(raw);
            if (v1Data) {
                if (!v1Data.g) {
                    return { success: false, error: 'Missing required git configuration. Expected "g" field with git repository details.' };
                }
                if (!v1Data.g.u) {
                    return { success: false, error: 'Missing required git repository URL. Expected "g.u" field.' };
                }
                return {
                    success: true,
                    data: {
                        name: v1Data.n || null,
                        gitUrl: v1Data.g.u || null,
                        gitUser: v1Data.g.un || null,
                        gitToken: v1Data.g.pw || null,
                        gitProxy: v1Data.g.c || null,
                        enableGit: !!v1Data.g.u
                    }
                };
            }
            // If QRTransfer validation failed, continue to try vault-config format
        }

        // Try simplified vault-config format
        let parsed;
        try { parsed = JSON.parse(raw); } catch (e) {
            return { success: false, error: 'Invalid JSON syntax: ' + (e.message || 'unknown error') };
        }
        if (!parsed) {
            return { success: false, error: 'Empty JSON data.' };
        }
        
        // Check if this is QRTransfer v1 format (has "v" field)
        if (parsed.v === 1) {
            if (!parsed.g) {
                return { success: false, error: 'Missing required git configuration. Expected "g" field with git repository details.' };
            }
            if (!parsed.g.u) {
                return { success: false, error: 'Missing required git repository URL. Expected "g.u" field.' };
            }
            return {
                success: true,
                data: {
                    name: parsed.n || null,
                    gitUrl: parsed.g.u || null,
                    gitUser: parsed.g.un || null,
                    gitToken: parsed.g.pw || null,
                    gitProxy: parsed.g.c || null,
                    enableGit: !!parsed.g.u
                }
            };
        }
        
        // Check vault-config format
        if (parsed.type !== 'vault-config') {
            return { success: false, error: 'Invalid vault configuration. Expected either QRTransfer v1 format (with "v":1) or vault-config format (with "type":"vault-config").' };
        }
        if (!parsed.gitUrl) {
            return { success: false, error: 'Missing required git repository URL. Expected "gitUrl" field.' };
        }

        return {
            success: true,
            data: {
                name: parsed.name || null,
                gitUrl: parsed.gitUrl || null,
                gitUser: parsed.gitUser || null,
                gitToken: parsed.gitToken || null,
                gitProxy: parsed.gitProxy || null,
                enableGit: !!parsed.gitUrl
            }
        };
    },

    openQrScanner(targetWizard = null) {
        VaultModal._prevHandle = VaultModal._prevHandle || Store.directoryHandle;

        const scannerModal = Modal.create({
            title: 'Scan Vault QR Code',
            content: `
                <div class="qr-scanner-container" id="qrScannerContainer">
                    <video id="qrScannerVideo" autoplay playsinline muted></video>
                    <div class="qr-scanner-overlay"></div>
                </div>
                <div class="qr-scanner-status" id="qrScannerStatus">Starting camera...</div>
                <button class="qr-paste-toggle" id="qrPasteToggle">Or paste vault config JSON</button>
                <div class="qr-paste-area" id="qrPasteArea">
                    <textarea id="qrPasteInput" rows="5" placeholder='{"type":"vault-config","name":"My Notes","gitUrl":"https://github.com/user/notes.git","gitUser":"user","gitToken":"ghp_xxx"}&#10;&#10;Or QRTransfer v1 format:{"v":1,"n":"My Notes","g":{"u":"https://github.com/user/notes.git","un":"user","pw":"token"}}'></textarea>
                    <button class="settings-btn secondary" id="qrPasteApply">Apply</button>
                </div>
                <canvas id="qrScannerCanvas" style="display:none"></canvas>
            `,
            onClose: () => {
                if (window.QRTransfer) QRTransfer._stopScanner();
            }
        });

        const video = scannerModal.querySelector('#qrScannerVideo');
        const canvas = scannerModal.querySelector('#qrScannerCanvas');
        const statusEl = scannerModal.querySelector('#qrScannerStatus');
        const container = scannerModal.querySelector('#qrScannerContainer');

        const handleResult = (raw) => {
            if (window.QRTransfer) QRTransfer._stopScanner();
            scannerModal.close();
            const result = VaultModal._normalizeQrData(raw);
            if (!result.success) {
                App.showError('QR code does not contain a valid vault configuration.\n\nDetails: ' + result.error);
                return;
            }
            const normalized = result.data;
            if (targetWizard) {
                // Populate existing wizard fields
                const nameInput = targetWizard.querySelector('#wizardVaultName');
                const gitUrlInput = targetWizard.querySelector('#wizardGitUrl');
                const gitUserInput = targetWizard.querySelector('#wizardGitUser');
                const gitTokenInput = targetWizard.querySelector('#wizardGitToken');
                const gitProxyInput = targetWizard.querySelector('#wizardGitProxy');
                const enableGitCheckbox = targetWizard.querySelector('#wizardEnableGit');
                const gitFieldsEl = targetWizard.querySelector('#wizardGitFields');

                if (normalized.name) nameInput.value = normalized.name;
                if (normalized.gitUrl) gitUrlInput.value = normalized.gitUrl;
                if (normalized.gitUser) gitUserInput.value = normalized.gitUser;
                if (normalized.gitToken) gitTokenInput.value = normalized.gitToken;
                if (normalized.gitProxy) gitProxyInput.value = normalized.gitProxy;
                if (normalized.enableGit === false) {
                    enableGitCheckbox.checked = false;
                    gitFieldsEl.classList.add('disabled');
                } else if (normalized.gitUrl) {
                    enableGitCheckbox.checked = true;
                    gitFieldsEl.classList.remove('disabled');
                }
            } else {
                VaultModal._openBrowserVaultWizard(normalized);
            }
        };

        if (window.QRTransfer) {
            QRTransfer._startScanner(video, canvas, statusEl, container, handleResult);
        } else {
            container.style.display = 'none';
            statusEl.textContent = 'QR scanner not available. Use the paste option below.';
        }

        // Paste fallback
        const pasteToggle = scannerModal.querySelector('#qrPasteToggle');
        const pasteArea = scannerModal.querySelector('#qrPasteArea');
        const pasteInput = scannerModal.querySelector('#qrPasteInput');
        const pasteApply = scannerModal.querySelector('#qrPasteApply');

        pasteToggle.addEventListener('click', () => {
            pasteArea.classList.toggle('visible');
            if (window.QRTransfer) QRTransfer._stopScanner();
            if (pasteArea.classList.contains('visible')) {
                statusEl.textContent = 'Paste vault config JSON below.';
                container.style.display = 'none';
            }
        });

        pasteApply.addEventListener('click', () => {
            const raw = pasteInput.value.trim();
            if (!raw) {
                App.showError('Please paste vault configuration JSON first.');
                return;
            }
            
            // Basic validation to catch common mistakes
            if (!raw.startsWith('{') && !raw.startsWith('[')) {
                App.showError('Invalid JSON format. JSON must start with { or [');
                return;
            }
            
            try {
                JSON.parse(raw);
            } catch (e) {
                App.showError('Invalid JSON syntax: ' + (e.message || 'unknown error'));
                return;
            }
            
            handleResult(raw);
        });
    }
};
