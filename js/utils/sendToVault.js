const SendToVault = {
    _activePicker: null,

    async show(blockIds, anchorEl) {
        const ids = Array.isArray(blockIds) ? blockIds : [blockIds];
        if (ids.length === 0) return;

        const vaultList = await Store.getVaultList();
        const currentVaultName = Store.directoryHandle?.name;
        const otherVaults = vaultList.filter(v => v.name !== currentVaultName);

        if (otherVaults.length === 0) {
            Common.showToast('No other vaults available');
            return;
        }

        if (otherVaults.length === 1) {
            this._closePicker();
            this._showActionPicker(ids, anchorEl, otherVaults[0].name);
            return;
        }

        this._showVaultPicker(ids, anchorEl, otherVaults);
    },

    _showVaultPicker(blockIds, anchorEl, vaults) {
        this._closePicker();

        const menu = document.createElement('div');
        menu.className = 'task-context-menu block-action-menu';
        menu.setAttribute('role', 'menu');

        const vaultIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:0.5rem"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';

        menu.innerHTML = vaults.map(v =>
            `<div class="menu-item" data-vault="${escapeHtml(v.name)}" role="menuitem" tabindex="-1">${vaultIcon}${escapeHtml(v.name)}</div>`
        ).join('');

        const rect = anchorEl.getBoundingClientRect();
        menu.style.left = `${rect.right - 180}px`;
        menu.style.top = `${rect.bottom + 4}px`;
        document.body.appendChild(menu);

        requestAnimationFrame(() => {
            const menuRect = menu.getBoundingClientRect();
            if (menuRect.bottom > window.innerHeight) {
                menu.style.top = `${rect.top - menuRect.height - 4}px`;
            }
        });

        const closeHandler = (evt) => {
            if (!menu.contains(evt.target) && evt.target !== anchorEl) {
                this._closePicker();
            }
        };

        menu.addEventListener('click', (evt) => {
            evt.stopPropagation();
            const item = evt.target.closest('.menu-item');
            if (!item) return;
            const vaultName = item.dataset.vault;
            this._closePicker();
            this._showActionPicker(blockIds, anchorEl, vaultName);
        });

        document.addEventListener('click', closeHandler);
        document.addEventListener('scroll', closeHandler, true);
        this._activePicker = { menu, closeHandler, scrollHandler: closeHandler };
    },

    _showActionPicker(blockIds, anchorEl, vaultName) {
        this._closePicker();

        const menu = document.createElement('div');
        menu.className = 'task-context-menu block-action-menu';
        menu.setAttribute('role', 'menu');

        const copyIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:0.5rem"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
        const moveIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:0.5rem"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>';

        const escapedName = escapeHtml(vaultName);
        menu.innerHTML = `
            <div class="menu-item" data-action="copy" role="menuitem" tabindex="-1">${copyIcon}Copy to ${escapedName}</div>
            <div class="menu-item" data-action="move" role="menuitem" tabindex="-1">${moveIcon}Move to ${escapedName}</div>
        `;

        const rect = anchorEl.getBoundingClientRect();
        menu.style.left = `${rect.right - 180}px`;
        menu.style.top = `${rect.bottom + 4}px`;
        document.body.appendChild(menu);

        requestAnimationFrame(() => {
            const menuRect = menu.getBoundingClientRect();
            if (menuRect.bottom > window.innerHeight) {
                menu.style.top = `${rect.top - menuRect.height - 4}px`;
            }
        });

        const closeHandler = (evt) => {
            if (!menu.contains(evt.target) && evt.target !== anchorEl) {
                this._closePicker();
            }
        };

        menu.addEventListener('click', (evt) => {
            evt.stopPropagation();
            const item = evt.target.closest('.menu-item');
            if (!item) return;
            const action = item.dataset.action;
            this._closePicker();
            this._executeAction(blockIds, vaultName, action);
        });

        document.addEventListener('click', closeHandler);
        document.addEventListener('scroll', closeHandler, true);
        this._activePicker = { menu, closeHandler, scrollHandler: closeHandler };
    },

    async _executeAction(blockIds, vaultName, action) {
        const count = blockIds.length;

        // Check for duplicates upfront
        const duplicateIds = [];
        for (const blockId of blockIds) {
            try {
                const isDup = await Store.checkVaultDuplicate(blockId, vaultName);
                if (isDup) duplicateIds.push(blockId);
            } catch { /* ignore check errors, will be caught during copy */ }
        }

        let idsToCopy = blockIds;

        if (duplicateIds.length > 0) {
            const nonDupCount = count - duplicateIds.length;
            let choice;

            if (count === 1) {
                choice = await this._showDuplicateSingleDialog(vaultName);
            } else {
                choice = await this._showDuplicateBulkDialog(vaultName, duplicateIds.length, count, nonDupCount);
            }

            if (choice === 'abort') return;
            if (choice === 'skip') {
                idsToCopy = blockIds.filter(id => !duplicateIds.includes(id));
                if (idsToCopy.length === 0) {
                    Common.showToast('All notes already exist in ' + vaultName);
                    return;
                }
            }
        }

        if (action === 'move') {
            const confirmed = await Modal.confirm({
                title: 'Move ' + (idsToCopy.length === 1 ? 'Note' : 'Notes'),
                message: `Move ${idsToCopy.length === 1 ? 'this note' : idsToCopy.length + ' notes'} to ${escapeHtml(vaultName)}? ${idsToCopy.length === 1 ? 'It' : 'They'} will be deleted from this vault.`,
                confirmText: 'Move',
                cancelText: 'Cancel'
            });
            if (!confirmed) return;
        }

        let copied = 0;
        let lastError = null;

        for (const blockId of idsToCopy) {
            try {
                await Store.sendBlockToVault(blockId, vaultName);
                copied++;
            } catch (e) {
                lastError = e;
                break;
            }
        }

        if (lastError) {
            Common.showToast(`Failed to send note: ${lastError.message}`, 'error');
            return;
        }

        if (action === 'move' && copied > 0) {
            for (const blockId of idsToCopy.slice(0, copied)) {
                try {
                    await App.deleteBlock(blockId, { showToast: false });
                } catch (e) {
                    console.error('Failed to delete after move:', e);
                }
            }
        }

        const verb = action === 'copy' ? 'Copied' : 'Moved';
        const noun = copied === 1 ? 'note' : 'notes';
        const skipped = duplicateIds.length > 0 && idsToCopy.length < blockIds.length
            ? ` (${duplicateIds.length} skipped)` : '';
        Common.showToast(`${verb} ${copied} ${noun} to ${vaultName}${skipped}`);
    },

    _showDuplicateSingleDialog(vaultName) {
        return new Promise((resolve) => {
            const modal = Modal.create({
                title: 'Duplicate Note',
                content: `<p style="margin-bottom: 16px;">This note already exists in ${escapeHtml(vaultName)} with identical content.</p>
                    <div style="display: flex; gap: 10px; justify-content: flex-end;">
                        <button class="modal-cancel-btn" style="padding: 8px 16px; background: transparent; border: 1px solid var(--border); border-radius: 4px; cursor: pointer;">Abort</button>
                        <button class="modal-confirm-btn" style="padding: 8px 16px; background: var(--accent, #3b82f6); color: white; border: none; border-radius: 4px; cursor: pointer;">Continue</button>
                    </div>`
            });
            modal.querySelector('.modal-cancel-btn').addEventListener('click', () => { modal.close(); resolve('abort'); });
            modal.querySelector('.modal-confirm-btn').addEventListener('click', () => { modal.close(); resolve('continue'); });
        });
    },

    _showDuplicateBulkDialog(vaultName, dupCount, totalCount, nonDupCount) {
        return new Promise((resolve) => {
            const hasNonDups = nonDupCount > 0;
            const content = `<p style="margin-bottom: 16px;">${dupCount} of ${totalCount} notes already exist in ${escapeHtml(vaultName)} with identical content.</p>
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button class="modal-cancel-btn" style="padding: 8px 16px; background: transparent; border: 1px solid var(--border); border-radius: 4px; cursor: pointer;">Abort</button>
                    <button class="modal-confirm-btn" style="padding: 8px 16px; background: var(--accent, #3b82f6); color: white; border: none; border-radius: 4px; cursor: pointer;">${hasNonDups ? 'Skip duplicates' : 'OK'}</button>
                </div>`;
            const modal = Modal.create({
                title: 'Duplicate Notes',
                content
            });
            modal.querySelector('.modal-cancel-btn').addEventListener('click', () => { modal.close(); resolve('abort'); });
            modal.querySelector('.modal-confirm-btn').addEventListener('click', () => { modal.close(); resolve(hasNonDups ? 'skip' : 'abort'); });
        });
    },

    _closePicker() {
        if (this._activePicker) {
            this._activePicker.menu.remove();
            document.removeEventListener('click', this._activePicker.closeHandler);
            document.removeEventListener('scroll', this._activePicker.scrollHandler, true);
            this._activePicker = null;
        }
    }
};
