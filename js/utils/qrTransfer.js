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
            if (remoteConfig.corsProxy) g.c = remoteConfig.corsProxy;
            if (Object.keys(g).length) data.g = g;
        }

        // AI settings
        if (AIAssistant.enabled || AIAssistant.profiles.length || AIAssistant.presets.length) {
            const a = {
                e: !!AIAssistant.enabled,
                p: AIAssistant.profiles.map(p => ({ i: p.id, n: p.name, u: p.endpointUrl, m: p.model })),
                pr: AIAssistant.presets.map(pr => ({ i: pr.id, t: pr.title, s: pr.instruction }))
            };
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
        let data;
        try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
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
        }

        // Apply AI settings
        if (hasAI) {
            await AIAssistant.applyImport({
                enabled: data.a.e,
                profiles: (data.a.p || []).map(p => ({ id: p.i, name: p.n, endpointUrl: p.u, model: p.m })),
                presets: (data.a.pr || []).map(pr => ({ id: pr.i, title: pr.t, instruction: pr.s })),
                keys: data.a.k || {}
            });
        }

        // Apply sync settings
        if (hasSync) {
            await SyncManager.saveConfig({
                autoSync: data.s.a,
                syncInterval: data.s.i,
                commitThreshold: data.s.t
            });
        }

        return { hasGit, hasAI, hasSync };
    },

    _describePayload(data) {
        const parts = [];
        if (data.g) {
            const url = data.g.u || '(unknown)';
            parts.push('Git remote: ' + escapeHtml(url.length > 50 ? url.slice(0, 47) + '...' : url));
        }
        if (data.a) {
            const profiles = (data.a.p || []).length;
            const presets = (data.a.pr || []).length;
            const keys = Object.keys(data.a.k || {}).length;
            parts.push(`AI: ${profiles} profile${profiles !== 1 ? 's' : ''}, ${presets} preset${presets !== 1 ? 's' : ''}, ${keys} API key${keys !== 1 ? 's' : ''}`);
        }
        if (data.s) {
            parts.push(`Sync: ${data.s.a ? 'auto' : 'manual'}, interval ${data.s.i}m`);
        }
        return parts;
    },

    // --- QR generation ---

    _generateQR(text) {
        const qr = qrcode(0, 'M');
        qr.addData(text);
        qr.make();
        return qr.createDataURL(8, 0);
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

        if (json.length > 2500) {
            showToast('Settings too large for a single QR code. Remove some AI profiles or presets.');
            return;
        }

        let dataUrl;
        try {
            dataUrl = this._generateQR(json);
        } catch (e) {
            showToast('Failed to generate QR code.');
            return;
        }

        const parsed = JSON.parse(json);
        const summary = this._describePayload(parsed);

        const modal = Modal.create({
            title: 'Transfer Settings',
            content: `
                <div class="qr-transfer-display">
                    <img src="${dataUrl}" alt="QR code with vault settings" />
                    <div class="qr-transfer-warning">
                        This QR code contains API keys and git credentials. Only scan on a trusted device.
                    </div>
                    <div class="qr-transfer-summary">
                        ${summary.map(s => '<span>' + s + '</span>').join('')}
                    </div>
                </div>
            `
        });
    },

    // --- Import modal ---

    showImportModal() {
        if (!Store.directoryHandle) {
            showToast('Open a vault first to import settings.');
            return;
        }

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
            showToast('Could not read settings from QR code.');
            return;
        }

        const summary = this._describePayload(data);
        const modal = Modal.create({
            title: 'Import Settings',
            content: `
                <div class="qr-import-confirm">
                    <div class="qr-transfer-summary">
                        ${summary.map(s => '<span>' + s + '</span>').join('')}
                    </div>
                    ${data.g && (data.g.pw || data.g.un) ? '<div class="qr-transfer-warning">This includes git credentials that will be stored locally.</div>' : ''}
                    ${data.a && data.a.k && Object.keys(data.a.k).length ? '<div class="qr-transfer-warning">This includes API keys that will be stored locally.</div>' : ''}
                    <div class="qr-import-actions">
                        <button class="settings-btn secondary" id="qrImportCancel">Cancel</button>
                        <button class="settings-btn" id="qrImportConfirm">Import</button>
                    </div>
                </div>
            `
        });

        modal.querySelector('#qrImportCancel').addEventListener('click', () => modal.close());
        modal.querySelector('#qrImportConfirm').addEventListener('click', async () => {
            try {
                await this.importSettings(data);
                modal.close();
                showToast('Settings imported successfully.');
                if (typeof App !== 'undefined' && App.render) App.render();
            } catch (e) {
                showToast('Failed to import settings.');
            }
        });
    },

    // --- Camera lifecycle ---

    async _startScanner(video, canvas, statusEl, container, onResult) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
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
