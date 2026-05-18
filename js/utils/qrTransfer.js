/**
 * QR Transfer — Export/import vault settings via QR code
 */
const QRTransfer = {

    _stream: null,
    _scanRafId: null,

    // --- Data gathering / applying ---

    async exportSettings() {
        const remoteConfig = await Store.getRemoteConfig();
        const syncCfg = { ...SyncManager._config };

        const data = { v: 1 };
        if (Store.directoryHandle) data.n = Store.directoryHandle.name;

        // Git remote
        if (remoteConfig) {
            const g = {};
            if (remoteConfig.url) g.u = remoteConfig.url;
            if (remoteConfig.name) g.n = remoteConfig.name;
            if (remoteConfig.branch) g.b = remoteConfig.branch;
            if (remoteConfig.auth) {
                if (remoteConfig.auth.username) g.un = remoteConfig.auth.username;
                if (remoteConfig.auth.password) g.pw = remoteConfig.auth.password;
            }
            if (remoteConfig.corsProxy || syncCfg.corsProxy) g.c = remoteConfig.corsProxy || syncCfg.corsProxy;
            if (Object.keys(g).length) data.g = g;
        }

        // AI settings
        if (AIAssistant.enabled || AIAssistant.profiles.length || AIAssistant.presets.length) {
            const a = { e: !!AIAssistant.enabled };
            if (AIAssistant.profiles.length) {
                a.p = AIAssistant.profiles.map(p => ({ i: p.id, n: p.name, u: p.endpointUrl, m: p.model }));
            }
            if (AIAssistant.presets.length) {
                a.pr = AIAssistant.presets.map(pr => ({ i: pr.id, t: pr.title }));
            }
            if (AIAssistant._apiKeys && Object.keys(AIAssistant._apiKeys).length) {
                a.k = { ...AIAssistant._apiKeys };
            }
            data.a = a;
        }

        // Sync settings
        if (syncCfg.autoSync || syncCfg.syncInterval || syncCfg.commitThreshold !== 5) {
            data.s = {
                a: !!syncCfg.autoSync,
                i: syncCfg.syncInterval || 0,
                t: syncCfg.commitThreshold || 5
            };
        }

        return JSON.stringify(data);
    },

    _validateData(raw) {
        if (typeof raw !== 'string') return null;

        let payload = raw;
        if (raw.includes('#import=')) {
            payload = raw.split('#import=')[1];
        } else if (raw.includes('?import=')) {
            payload = raw.split('?import=')[1].split('#')[0];
        }

        let jsonString;
        if (payload.startsWith('Z:')) {
            try {
                jsonString = LZString.decompressFromEncodedURIComponent(payload.slice(2));
            } catch { return null; }
            if (!jsonString) return null;
        } else {
            jsonString = payload;
        }

        let data;
        try { data = JSON.parse(jsonString); } catch { return null; }
        if (!data || data.v !== 1) return null;
        return data;
    },

    async importSettings(data) {
        const hasGit = !!data.g;
        const hasAI = !!data.a;
        const hasSync = !!data.s;

        // Apply git remote config
        if (hasGit) {
            const config = await Store.getRemoteConfig() || {};
            config.url = data.g.u || config.url;
            config.name = data.g.n || config.name || 'origin';
            config.branch = data.g.b || config.branch || 'main';
            config.auth = {
                username: data.g.un || '',
                password: data.g.pw || ''
            };
            if (data.g.c !== undefined) config.corsProxy = data.g.c;
            await Store.saveRemoteConfig(config);
            GitRemote.config = config;
            window.GitHttp.setCredentials(config.auth);
        }

        // Apply AI settings
        if (hasAI) {
            await AIAssistant.applyImport({
                enabled: data.a.e,
                profiles: (data.a.p || []).map(p => ({ id: p.i, name: p.n, endpointUrl: p.u, model: p.m })),
                presets: (data.a.pr || []).map(pr => ({ id: pr.i, title: pr.t, instruction: pr.s || '' })),
                keys: data.a.k || {}
            });
        }

        // Apply sync settings
        if (hasSync || hasGit) {
            const updates = {};
            if (hasSync) {
                updates.autoSync = data.s.a;
                updates.syncInterval = data.s.i;
                updates.commitThreshold = data.s.t;
            }
            if (hasGit && data.g.c !== undefined) {
                updates.corsProxy = data.g.c;
            }
            await SyncManager.saveConfig(updates);
        }

        return { hasGit, hasAI, hasSync };
    },

    _describePayload(data) {
        const parts = [];
        if (data.n) parts.push('Vault: ' + escapeHtml(data.n));
        if (data.g) {
            const url = data.g.u || '(unknown)';
            parts.push('Git remote: ' + escapeHtml(url.length > 50 ? url.slice(0, 47) + '...' : url));
        }
        if (data.a) {
            const profiles = (data.a.p || []).length;
            const presets = (data.a.pr || []).length;
            const keys = Object.keys(data.a.k || {}).length;
            parts.push(`AI: ${profiles} profile${profiles !== 1 ? 's' : ''}, ${presets} preset${presets !== 1 ? 's' : ''} (titles only), ${keys} API key${keys !== 1 ? 's' : ''}`);
        }
        if (data.s) {
            parts.push(`Sync: ${data.s.a ? 'auto' : 'manual'}, interval ${data.s.i}m`);
        }
        return parts;
    },

    _describePayloadWithIcons(data) {
        const items = [];
        if (data.n) {
            items.push({
                icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
                label: 'Vault Name',
                value: escapeHtml(data.n),
                class: 'vault'
            });
        }
        if (data.g) {
            const url = data.g.u || '(unknown)';
            const displayUrl = url.length > 40 ? url.slice(0, 37) + '...' : url;
            items.push({
                icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>`,
                label: 'Git Sync Remote',
                value: escapeHtml(displayUrl),
                class: 'git'
            });
        }
        if (data.a) {
            const profiles = (data.a.p || []).length;
            const presets = (data.a.pr || []).length;
            const keys = Object.keys(data.a.k || {}).length;
            let val = `${profiles} profile${profiles !== 1 ? 's' : ''}`;
            if (presets) val += `, ${presets} preset${presets !== 1 ? 's' : ''}`;
            if (keys) val += ` (${keys} API key${keys !== 1 ? 's' : ''})`;
            items.push({
                icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>`,
                label: 'AI Setup',
                value: val,
                class: 'ai'
            });
        }
        if (data.s) {
            items.push({
                icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>`,
                label: 'Sync Config',
                value: `${data.s.a ? 'Auto-sync' : 'Manual sync'} (every ${data.s.i}m)`,
                class: 'sync'
            });
        }
        return items;
    },

    // --- QR generation ---

    _generateQR(text) {
        const qr = qrcode(0, 'M');
        qr.addData(text);
        qr.make();
        return qr.createSvgTag({ cellSize: 2, margin: 2, scalable: true, alt: 'QR code with vault settings' });
    },

    // --- Export modal ---

    async showExportModal() {
        if (!Store.directoryHandle) {
            showToast('Open a vault first to export settings.');
            return;
        }

        let json;
        try {
            json = await this.exportSettings();
        } catch (e) {
            showToast('Failed to gather settings.');
            return;
        }

        const compressed = LZString.compressToEncodedURIComponent(json);
        const importPayload = 'Z:' + compressed;

        const currentUrl = window.location.origin + window.location.pathname;
        const qrPayload = currentUrl + '#import=' + importPayload;

        if (qrPayload.length > 2500) {
            showToast('Settings too large for a single QR code. Remove some AI profiles or presets.');
            return;
        }

        let svgMarkup;
        try {
            svgMarkup = this._generateQR(qrPayload);
        } catch (e) {
            showToast('Failed to generate QR code.');
            return;
        }

        const parsed = JSON.parse(json);
        const items = this._describePayloadWithIcons(parsed);

        const modal = Modal.create({
            title: 'Transfer Settings',
            width: 'min(600px, 90vw)',
            content: `
                <div class="qr-transfer-display">
                    ${svgMarkup}
                    <div style="display:flex;gap:0.5rem;width:100%;justify-content:center;margin-top:0.25rem;">
                        <button class="settings-btn secondary" id="qrCopyLinkBtn">Copy Transfer Link</button>
                        <button class="settings-btn secondary" id="qrCopyJsonBtn">Copy JSON</button>
                    </div>
                    <div class="qr-transfer-warning">
                        This QR code/link contains API keys and git credentials. Only share with trusted devices.
                    </div>
                    <div class="qr-transfer-cards">
                        ${items.map(item => `
                            <div class="qr-transfer-card ${item.class}">
                                <div class="qr-transfer-card-header">
                                    ${item.icon}
                                    <span class="qr-transfer-card-label">${item.label}</span>
                                </div>
                                <div class="qr-transfer-card-value">${item.value}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `
        });

        const copyLinkBtn = modal.querySelector('#qrCopyLinkBtn');
        if (copyLinkBtn) {
            copyLinkBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(qrPayload);
                    showToast('Transfer link copied to clipboard.');
                } catch {
                    showToast('Failed to copy link.');
                }
            });
        }

        const copyBtn = modal.querySelector('#qrCopyJsonBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(json);
                    showToast('Settings JSON copied to clipboard.');
                } catch {
                    showToast('Failed to copy to clipboard.');
                }
            });
        }
    },

    // --- Import modal ---

    showImportModal() {
        const modal = Modal.create({
            title: 'Scan QR Code',
            content: `
                <div class="qr-scanner-container" id="qrScannerContainer">
                    <video id="qrScannerVideo" autoplay playsinline muted></video>
                    <div class="qr-scanner-overlay"></div>
                </div>
                <div class="qr-scanner-status" id="qrScannerStatus">Starting camera...</div>
                <button class="qr-paste-toggle" id="qrPasteToggle">Or paste settings JSON manually</button>
                <div class="qr-paste-area" id="qrPasteArea">
                    <textarea id="qrPasteInput" placeholder="Paste the JSON from another device..."></textarea>
                    <button class="settings-btn secondary" id="qrPasteApply">Apply</button>
                </div>
                <canvas id="qrScannerCanvas" style="display:none"></canvas>
            `,
            onClose: () => {
                this._stopScanner();
            }
        });

        const video = modal.querySelector('#qrScannerVideo');
        const canvas = modal.querySelector('#qrScannerCanvas');
        const statusEl = modal.querySelector('#qrScannerStatus');
        const container = modal.querySelector('#qrScannerContainer');

        // Camera scanner
        this._startScanner(video, canvas, statusEl, container, (result) => {
            this._stopScanner();
            this._handleScanResult(result);
            modal.close();
        });

        // Paste fallback
        const pasteToggle = modal.querySelector('#qrPasteToggle');
        const pasteArea = modal.querySelector('#qrPasteArea');
        const pasteInput = modal.querySelector('#qrPasteInput');
        const pasteApply = modal.querySelector('#qrPasteApply');

        pasteToggle.addEventListener('click', () => {
            pasteArea.classList.toggle('visible');
            this._stopScanner();
            if (pasteArea.classList.contains('visible')) {
                statusEl.textContent = 'Paste JSON below.';
                container.style.display = 'none';
            }
        });

        pasteApply.addEventListener('click', () => {
            const raw = pasteInput.value.trim();
            if (!raw) { showToast('Paste settings JSON first.'); return; }
            const data = this._validateData(raw);
            if (!data) { showToast('Invalid settings data. Check the JSON format.'); return; }
            modal.close();
            this._handleScanResult(raw);
        });
    },

    _handleScanResult(raw) {
        const data = this._validateData(raw);
        if (!data) {
            showToast('Could not read settings from QR code or link.');
            return;
        }

        const items = this._describePayloadWithIcons(data);
        const hasVault = !!Store.directoryHandle;
        const hasLocalPicker = 'showDirectoryPicker' in window;

        let vaultActions = '';
        if (!hasVault) {
            vaultActions = `
                <div class="qr-vault-setup" style="margin-top:0.75rem">
                    <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:0.75rem">Choose where to store the new vault:</p>
                    <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
                        ${hasLocalPicker ? '<button class="settings-btn primary" id="qrNewFolderBtn">Select Local Folder...</button>' : ''}
                        <button class="settings-btn ${hasLocalPicker ? 'secondary' : 'primary'}" id="qrNewBrowserBtn">Create Browser Vault...</button>
                    </div>
                </div>
            `;
        } else {
            vaultActions = `
                <div class="qr-vault-setup" style="margin-top:0.75rem">
                    <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:0.75rem">Apply to current vault or create a new one:</p>
                    <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
                        <button class="settings-btn primary" id="qrApplyCurrentBtn">Apply to Current Vault</button>
                        ${hasLocalPicker ? '<button class="settings-btn secondary" id="qrNewFolderBtn">New Local Folder...</button>' : ''}
                        <button class="settings-btn secondary" id="qrNewBrowserBtn">New Browser Vault...</button>
                    </div>
                </div>
            `;
        }

        const modal = Modal.create({
            title: 'Import Settings',
            width: 'min(550px, 90vw)',
            content: `
                <div class="qr-import-confirm">
                    <div class="qr-transfer-cards">
                        ${items.map(item => `
                            <div class="qr-transfer-card ${item.class}">
                                <div class="qr-transfer-card-header">
                                    ${item.icon}
                                    <span class="qr-transfer-card-label">${item.label}</span>
                                </div>
                                <div class="qr-transfer-card-value">${item.value}</div>
                            </div>
                        `).join('')}
                    </div>
                    ${data.g && (data.g.pw || data.g.un) ? '<div class="qr-transfer-warning">This includes git credentials that will be stored locally.</div>' : ''}
                    ${data.a && data.a.k && Object.keys(data.a.k).length ? '<div class="qr-transfer-warning">This includes API keys that will be stored locally.</div>' : ''}
                    ${vaultActions}
                    <div class="qr-import-actions" style="margin-top:0.5rem">
                        <button class="settings-btn secondary" id="qrImportCancel">Cancel</button>
                    </div>
                </div>
            `
        });

        modal.querySelector('#qrImportCancel').addEventListener('click', () => modal.close());

        // Apply to current vault
        const applyCurrentBtn = modal.querySelector('#qrApplyCurrentBtn');
        if (applyCurrentBtn) {
            applyCurrentBtn.addEventListener('click', async () => {
                try {
                    await this.importSettings(data);
                    modal.close();
                    showToast('Settings imported successfully.');
                    if (typeof App !== 'undefined' && App.render) App.render();
                } catch (e) {
                    showToast('Failed to import settings.');
                }
            });
        }

        // New folder vault
        const newFolderBtn = modal.querySelector('#qrNewFolderBtn');
        if (newFolderBtn) {
            newFolderBtn.addEventListener('click', async () => {
                modal.close();
                try {
                    const handle = await window.showDirectoryPicker();
                    await this._createVaultAndImport(handle, data);
                } catch (err) {
                    if (err.name !== 'AbortError') {
                        showToast('Failed to create vault.');
                    }
                }
            });
        }

        // New browser vault
        const newBrowserBtn = modal.querySelector('#qrNewBrowserBtn');
        if (newBrowserBtn) {
            newBrowserBtn.addEventListener('click', async () => {
                const name = window.prompt('Browser vault name:', data.n || (data.g?.u ? this._repoNameFromUrl(data.g.u) : 'New Vault'));
                if (!name) return;
                modal.close();
                try {
                    await Store.createOPFSVault(name);
                    await this.importSettings(data);
                    await this._pullIfAvailable(data);
                    VaultModal.updateVaultSwitcherName();
                    await App.completeInitialization();
                    showToast('Vault created and settings imported.');
                } catch (e) {
                    showToast('Failed to create browser vault.');
                }
            });
        }
    },

    async _createVaultAndImport(handle, data) {
        const container = document.getElementById('viewContainer');
        if (container) container.innerHTML = '<div class="loading">Setting up vault...</div>';

        await Store.switchToVault(handle);
        await this.importSettings(data);
        await this._pullIfAvailable(data);

        VaultModal.updateVaultSwitcherName();
        await App.completeInitialization();
        showToast('Vault created and settings imported.');
    },

    async _pullIfAvailable(data) {
        if (!data.g || !data.g.u) return;
        try {
            await GitRemote.setRemote(
                data.g.n || 'origin',
                data.g.u,
                { username: data.g.un || '', password: data.g.pw || '' }
            );
            const container = document.getElementById('viewContainer');
            if (container) container.innerHTML = '<div class="loading">Pulling notes from remote...</div>';
            await GitRemote.pull();
            await Store.loadBlocks();
        } catch (e) {
            showToast('Pull failed: ' + (e.message || 'check your connection'));
        }
    },

    _repoNameFromUrl(url) {
        try {
            const parts = url.replace(/\.git$/, '').split('/');
            return parts[parts.length - 1] || 'New Vault';
        } catch {
            return 'New Vault';
        }
    },

    // --- Camera lifecycle ---

    async _startScanner(video, canvas, statusEl, container, onResult) {
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' }
            });
            this._stream = stream;
            video.srcObject = stream;
            await video.play();
            statusEl.textContent = 'Point camera at QR code...';

            const ctx = canvas.getContext('2d', { willReadFrequently: true });

            const scanFrame = () => {
                if (!this._stream) return;

                if (video.readyState === video.HAVE_ENOUGH_DATA) {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const code = jsQR(imageData.data, imageData.width, imageData.height);
                    if (code && code.data) {
                        onResult(code.data);
                        return;
                    }
                }

                this._scanRafId = requestAnimationFrame(scanFrame);
            };

            this._scanRafId = requestAnimationFrame(scanFrame);
        } catch (e) {
            // Clean up stream if setup failed after getUserMedia succeeded
            if (stream) {
                stream.getTracks().forEach(t => t.stop());
                this._stream = null;
            }
            container.style.display = 'none';
            if (e.name === 'NotAllowedError') {
                statusEl.textContent = 'Camera permission denied. Use paste instead.';
            } else if (e.name === 'NotFoundError') {
                statusEl.textContent = 'No camera found. Use paste instead.';
            } else {
                statusEl.textContent = 'Camera unavailable. Use paste instead.';
            }
        }
    },

    _stopScanner() {
        if (this._scanRafId) {
            cancelAnimationFrame(this._scanRafId);
            this._scanRafId = null;
        }
        if (this._stream) {
            this._stream.getTracks().forEach(t => t.stop());
            this._stream = null;
        }
    }
};
