/**
 * SyncManager - Orchestrates automatic git remote syncing
 *
 * Handles when to sync (triggers, timers, visibility) and status tracking.
 * Delegates actual push/pull to GitRemote.
 */

const SyncManager = {
    _status: 'idle',           // 'idle' | 'syncing' | 'error' | 'conflict'
    _statusDetail: null,
    _pendingCommits: 0,
    _syncIntervalId: null,
    _isOnline: true,
    _lastSyncTime: null,
    _lastError: null,
    _idleSyncScheduled: false,

    _config: {
        autoSync: false,
        syncInterval: 0,        // minutes, 0 = off
        commitThreshold: 5,
        branch: 'main',
        corsProxy: ''
    },

    // --- Initialization ---

    async init() {
        await this._loadConfig();
        this._isOnline = navigator.onLine;
        this._setupNetworkListeners();

        if (this._config.autoSync && GitRemote.config) {
            this._startIntervalSync();
        }

        console.log('[SyncManager] initialized', {
            autoSync: this._config.autoSync,
            interval: this._config.syncInterval,
            hasRemote: !!GitRemote.config
        });

        this._setStatus(this._status, this._statusDetail);
    },

    // --- Config persistence ---

    async _loadConfig() {
        const remoteConfig = await Store.getRemoteConfig();
        if (remoteConfig && remoteConfig.sync) {
            Object.assign(this._config, remoteConfig.sync);
        }
    },

    async saveConfig(updates) {
        Object.assign(this._config, updates);

        const remoteConfig = await Store.getRemoteConfig() || {};
        remoteConfig.sync = { ...this._config };
        await Store.saveRemoteConfig(remoteConfig);

        // Restart interval if settings changed
        this._stopIntervalSync();
        if (this._config.autoSync && GitRemote.config) {
            this._startIntervalSync();
        }
    },

    // --- Core sync ---

    async sync() {
        if (!GitRemote.config) {
            this._setStatus('idle', 'No remote configured');
            return false;
        }
        if (!this._isNetworkAvailable()) {
            this._setStatus('idle', 'Offline');
            return false;
        }
        if (this._status === 'syncing') return false;

        this._setStatus('syncing', 'Syncing...');
        try {
            const pulled = await GitRemote.pull();
            await GitRemote.push();
            this._pendingCommits = 0;
            this._lastSyncTime = new Date().toISOString();
            this._lastError = null;
            this._setStatus('idle', 'Synced');
            
            // If data changed via pull, trigger a re-render if the app is active
            if (pulled && window.App && typeof App.render === 'function') {
                App.render();
            }
            return true;
        } catch (err) {
            if (this._isConflictError(err)) {
                this._lastError = err.message;
                this._setStatus('conflict', 'Merge conflict detected');
                showToast('Sync conflict: remote has changes. Manual resolution needed.', {
                    actionLabel: 'Details',
                    action: () => this._showConflictHelp()
                });
            } else {
                this._lastError = err.message;
                this._setStatus('error', err.message);
                showToast('Sync failed: ' + err.message, {
                    actionLabel: 'Retry',
                    action: () => this.sync()
                });
            }
            return false;
        }
    },

    // --- Trigger hooks ---

    onCommit() {
        this._pendingCommits++;
        if (this._config.autoSync && this._pendingCommits >= this._config.commitThreshold) {
            this._scheduleIdleSync();
        }
    },

    onTabVisible() {
        if (this._config.autoSync && GitRemote.config) {
            this._scheduleIdleSync();
        }
    },

    onTabHidden() {
        if (this._config.autoSync && GitRemote.config && this._pendingCommits > 0) {
            const pendingBeforePush = this._pendingCommits;
            GitRemote.push().then(() => {
                this._pendingCommits = Math.max(0, this._pendingCommits - pendingBeforePush);
            }).catch(err => {
                this._lastError = err.message;
                console.warn('[SyncManager] background push failed:', err);
            });
        }
    },

    // --- Scheduling ---

    _scheduleIdleSync() {
        if (this._idleSyncScheduled || this._status === 'syncing') return;
        this._idleSyncScheduled = true;

        const run = () => {
            this._idleSyncScheduled = false;
            this.sync();
        };

        if ('requestIdleCallback' in window) {
            requestIdleCallback(run, { timeout: 10000 });
        } else {
            setTimeout(run, 2000);
        }
    },

    _startIntervalSync() {
        const minutes = this._config.syncInterval;
        if (!minutes || minutes <= 0) return;
        this._stopIntervalSync();
        this._syncIntervalId = setInterval(() => {
            if (this._isNetworkAvailable() && GitRemote.config) {
                this.sync();
            }
        }, minutes * 60000);
    },

    _stopIntervalSync() {
        if (this._syncIntervalId) {
            clearInterval(this._syncIntervalId);
            this._syncIntervalId = null;
        }
    },

    // --- Status ---

    getStatus() {
        return {
            status: this._status,
            detail: this._statusDetail,
            pendingCommits: this._pendingCommits,
            lastSyncTime: this._lastSyncTime,
            lastError: this._lastError,
            hasRemote: !!GitRemote.config,
            autoSync: this._config.autoSync
        };
    },

    _setStatus(status, detail) {
        this._status = status;
        this._statusDetail = detail;
        window.dispatchEvent(new CustomEvent('sync-status-change', {
            detail: this.getStatus()
        }));
    },

    // --- Network ---

    _setupNetworkListeners() {
        window.addEventListener('online', () => {
            this._isOnline = true;
            if (this._config.autoSync && this._pendingCommits > 0 && GitRemote.config) {
                this._scheduleIdleSync();
            }
        });
        window.addEventListener('offline', () => {
            this._isOnline = false;
        });
    },

    _isNetworkAvailable() {
        return this._isOnline && navigator.onLine;
    },

    // --- Conflict help ---

    _isConflictError(err) {
        const msg = (err.message || err.data?.message || '').toLowerCase();
        return msg.includes('conflict') || msg.includes('non-fast-forward') || msg.includes('merge');
    },

    async _showConflictHelp() {
        const modal = Modal.create({
            title: 'Sync Conflict',
            content: `
                <div style="font-size:0.9rem;line-height:1.6">
                    <p>The remote repository has changes that conflict with your local edits.</p>
                    <p style="margin-top:0.75rem"><strong>Your local changes are safe.</strong> Nothing has been lost.</p>
                    <div style="margin-top:1rem;padding:0.75rem;background:var(--bg-secondary);border-radius:var(--radius-sm);border:1px solid var(--border)">
                        <p style="margin:0 0 0.5rem;font-weight:500">Options:</p>
                        <ul style="margin:0;padding-left:1.25rem">
                            <li>Open your vault folder with a git client and resolve the merge conflict manually</li>
                            <li>Force push to overwrite the remote <span style="color:var(--color-danger,#f44)">(loses remote changes)</span></li>
                        </ul>
                    </div>
                    <div style="margin-top:1rem;display:flex;gap:0.5rem;justify-content:flex-end">
                        <button id="conflictDismissBtn" class="settings-btn secondary">Dismiss</button>
                        <button id="conflictForceBtn" class="settings-btn" style="background:var(--color-danger,#f44);color:#fff;border-color:var(--color-danger,#f44)">Force Push</button>
                    </div>
                </div>
            `,
            width: '480px'
        });

        modal.querySelector('#conflictDismissBtn').addEventListener('click', () => modal.close());
        modal.querySelector('#conflictForceBtn').addEventListener('click', async () => {
            const btn = modal.querySelector('#conflictForceBtn');
            btn.disabled = true;
            btn.textContent = 'Pushing...';
            try {
                const { git, fs, dir } = GitStore;
                const ref = this._config.branch || 'main';
                await git.push({
                    fs, dir,
                    remote: GitRemote.config.name,
                    ref,
                    force: true,
                    http: window.GitHttp,
                    onAuth: () => GitRemote.config.auth
                });
                this._pendingCommits = 0;
                this._lastError = null;
                this._setStatus('idle', 'Force push succeeded');
                showToast('Force push succeeded.');
                modal.close();
            } catch (err) {
                btn.disabled = false;
                btn.textContent = 'Force Push';
                alert('Force push failed: ' + err.message);
            }
        });
    },

};

window.SyncManager = SyncManager;
