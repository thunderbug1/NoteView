/**
 * Vault Modal - Vault management UI (create, open, switch, remove vaults)
 */

const VaultModal = {
    updateVaultSwitcherName() {
        const nameEl = document.getElementById('vaultSwitcherName');
        if (nameEl) {
            nameEl.textContent = Store.directoryHandle ? Store.directoryHandle.name : 'No vault';
        }
    },

    async showDropdown(btn) {
        // Remove any existing dropdown
        const existing = document.getElementById('vaultDropdown');
        if (existing) { existing.remove(); return; }

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
                item.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v.name}</span>`;
                if (v.name !== currentName) {
                    item.addEventListener('click', () => {
                        menu.remove();
                        VaultModal.switchVault(v.name);
                    });
                }
                menu.appendChild(item);
            });
        }

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
            menu.remove();
            VaultModal.showManager();
        });
        menu.appendChild(manageItem);

        // Position above the button
        document.body.appendChild(menu);
        const rect = btn.getBoundingClientRect();
        const availHeight = rect.top - 8; // space above the button
        menu.style.position = 'fixed';
        menu.style.top = 'auto'; // override .task-context-menu top:0
        menu.style.left = `${rect.left}px`;
        menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
        menu.style.minWidth = `${rect.width}px`;
        menu.style.maxHeight = `min(${availHeight}px, 300px)`;
        menu.style.overflowY = 'auto';

        // Close on outside click
        setTimeout(() => {
            const closeDropdown = (e) => {
                if (!menu.contains(e.target) && e.target !== btn) {
                    menu.remove();
                    document.removeEventListener('click', closeDropdown);
                }
            };
            document.addEventListener('click', closeDropdown);
        }, 50);
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

        const folderIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;

        const dotsIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="12" cy="19" r="2"></circle></svg>`;

        const renderList = (vaults) => vaults.map(v => `
            <div class="vault-manager-row${v.name === currentName ? ' active' : ''}" data-vault="${v.name}">
                ${folderIcon}
                <span class="vault-manager-name">${v.name}</span>
                <button class="vault-manager-menu-btn" data-vault="${v.name}" title="Vault options">${dotsIcon}</button>
            </div>
        `).join('');

        const modal = Modal.create({
            title: 'Manage Vaults',
            content: `
                <div class="vault-manager">
                    <div class="vault-manager-sidebar">
                        <div class="vault-manager-list" id="vaultManagerList">
                            ${vaultList.length > 0 ? renderList(vaultList) : '<div style="text-align:center;color:var(--text-muted);padding:2rem 0">No vaults added yet</div>'}
                        </div>
                    </div>
                    <div class="vault-manager-actions">
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
                        </div>
                    </div>
                </div>
            `,
            width: '600px'
        });

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

        function closeVaultMenu() {
            const existing = document.getElementById('vaultContextMenu');
            if (existing) existing.remove();
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
                    });
                }
            });

            setTimeout(() => {
                const closeMenu = (e) => {
                    if (!menu.contains(e.target) && e.target !== btn) {
                        closeVaultMenu();
                        document.removeEventListener('click', closeMenu);
                    }
                };
                document.addEventListener('click', closeMenu);
            }, 50);
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

        const createBtn = modal.querySelector('#createVaultBtn');
        if (createBtn) createBtn.addEventListener('click', openVaultFromPicker);

        const openBtn = modal.querySelector('#openFolderAsVaultBtn');
        if (openBtn) openBtn.addEventListener('click', openVaultFromPicker);
    }
};
