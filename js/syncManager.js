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
    _syncing: false,

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

        // Restore pending count from git state
        if (GitRemote.config) {
            await this._refreshPendingCount();
        }

        if (this._config.autoSync && GitRemote.config) {
            this._startIntervalSync();
        }

        console.log('[SyncManager] initialized', {
            autoSync: this._config.autoSync,
            interval: this._config.syncInterval,
            hasRemote: !!GitRemote.config,
            pendingCommits: this._pendingCommits
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
        if (this._syncing) return false;
        this._syncing = true;

        this._setStatus('syncing', 'Syncing...');
        try {
            await GitRemote.pull();
            await GitRemote.push();
            this._lastSyncTime = new Date().toISOString();
            this._lastError = null;

            // Reconcile pending count from authoritative git state
            await this._refreshPendingCount();

            this._setStatus('idle', 'Synced');

            // Re-render to reflect pulled changes and update unpushed markers
            if (window.App && typeof App.render === 'function') {
                await Store.loadBlocks();
                Store._filteredBlocksCache.invalidate();
                SelectionManager.updateTagCounts();
                TimelineView.invalidateRawDataCache();
                TimelineView.invalidateCache();
                App.render();
            }
            return true;
        } catch (err) {
            if (this._isOverwriteError(err)) {
                this._lastError = err.message;
                this._setStatus('conflict', 'Local changes conflict with remote');
                showToast('Sync blocked: local changes would be overwritten by remote updates.', {
                    actionLabel: 'Resolve',
                    action: () => this._showOverwriteHelp(err)
                });
            } else if (this._isConflictError(err)) {
                this._lastError = err.message;
                this._setStatus('conflict', 'Merge conflict detected');
                showToast('Sync conflict: remote has changes. Manual resolution needed.', {
                    actionLabel: 'Details',
                    action: () => this._showConflictHelp()
                });
            } else {
                this._lastError = err.message;
                this._setStatus('error', err.message);
                const msg = this._isCorsError(err)
                    ? 'Sync failed: CORS blocked — configure a CORS proxy in Settings → Sync'
                    : 'Sync failed: ' + err.message;
                showToast(msg, {
                    actionLabel: 'Retry',
                    action: () => this.sync()
                });
            }
            // Reconcile even on failure — partial sync may have changed count
            await this._refreshPendingCount().catch(() => {});
            return false;
        } finally {
            this._syncing = false;
        }
    },

    // --- Trigger hooks ---

    onCommit() {
        this._pendingCommits++;
        this._setStatus(this._status, this._statusDetail);
        this._scheduleIdleSync();
    },

    onTabVisible() {
        if (this._config.autoSync && GitRemote.config) {
            this._scheduleIdleSync();
        }
    },

    onTabHidden() {
        if (this._syncing || !this._config.autoSync || !GitRemote.config || this._pendingCommits <= 0) return;
        GitRemote.push().then(() => {
            this._refreshPendingCount().catch(() => {});
        }).catch(err => {
            this._lastError = err.message;
            console.warn('[SyncManager] background push failed:', err);
        });
    },

    // --- Scheduling ---

    _scheduleIdleSync() {
        if (this._status === 'syncing') return;
        clearTimeout(this._idleSyncTimer);
        this._idleSyncTimer = setTimeout(() => {
            if (GitRemote.config && this._isNetworkAvailable()) {
                this.sync();
            }
        }, 3000);
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

    // --- Pending count reconciliation ---

    async _refreshPendingCount() {
        try {
            const status = await GitRemote.getStatus();
            if (typeof status.unpushed === 'number') {
                this._pendingCommits = status.unpushed;
                this._setStatus(this._status, this._statusDetail);
            }
        } catch (e) { /* ignore */ }
    },

    // --- Conflict help ---

    _isConflictError(err) {
        const msg = (err.message || err.data?.message || '').toLowerCase();
        return msg.includes('conflict') || msg.includes('non-fast-forward') || msg.includes('merge conflict');
    },

    _isOverwriteError(err) {
        if (err.code === 'CheckoutConflictError') return true;
        const msg = (err.message || err.data?.message || '').toLowerCase();
        return msg.includes('would be overwritten');
    },

    _isCorsError(err) {
        const msg = (err.message || '').toLowerCase();
        return msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('type: failed');
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
            if (!confirm('Force push will overwrite the remote history. Are you sure?')) return;
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

    async _showOverwriteHelp(err) {
        const filepaths = err.data?.filepaths || [];
        const { git, fs, dir } = GitStore;
        const ref = this._config.branch || 'main';
        const remoteName = GitRemote.config.name;

        // Build diff data for each conflicting file
        const diffs = [];
        let fetchError = null;
        try {
            // Ensure remote objects are available (pull already fetched before failing)
            let remoteOid;
            try {
                remoteOid = await git.resolveRef({ fs, dir, ref: `refs/remotes/${remoteName}/${ref}` });
            } catch (e) {
                // Fetch if remote ref not resolved
                await git.fetch({
                    fs, dir, http: window.GitHttp,
                    remote: remoteName, ref,
                    corsProxy: GitRemote._getCorsProxy(),
                    onAuth: () => GitRemote.config.auth
                });
                remoteOid = await git.resolveRef({ fs, dir, ref: `refs/remotes/${remoteName}/${ref}` });
            }

            // Read remote commit tree to get file blob OIDs
            const remoteCommit = await git.readCommit({ fs, dir, oid: remoteOid });
            const tree = await git.readTree({ fs, dir, oid: remoteCommit.commit.tree });

            for (const filepath of filepaths) {
                if (!filepath.endsWith('.md')) continue;
                // Local content
                let localContent = '';
                try { localContent = new TextDecoder().decode(await fs.readFile(filepath)); } catch (e) { /* deleted locally */ }
                // Remote content
                let remoteContent = '';
                const entry = tree.tree.find(e => e.path === filepath);
                if (entry) {
                    try {
                        const { blob } = await git.readBlob({ fs, dir, oid: entry.oid });
                        remoteContent = new TextDecoder().decode(blob);
                    } catch (e) { /* not in remote */ }
                }
                diffs.push({ filepath, localContent, remoteContent });
            }
        } catch (e) {
            fetchError = e;
        }

        // Build file cards HTML
        let filesHtml;
        if (fetchError) {
            filesHtml = `<div style="padding:0.75rem;color:var(--text-secondary);font-size:0.85rem">
                Could not load diff preview: ${escapeHtml(fetchError.message)}.
                <br>Conflicting files: ${escapeHtml(filepaths.join(', '))}.
            </div>`;
        } else if (diffs.length === 0) {
            filesHtml = `<div style="padding:0.75rem;color:var(--text-secondary);font-size:0.85rem">
                Conflicting files: ${escapeHtml(filepaths.join(', '))}.
            </div>`;
        } else {
            filesHtml = diffs.map(({ filepath, localContent, remoteContent }) => {
                const diffLines = this._computeLineDiff(localContent, remoteContent);
                const changedCount = diffLines.filter(l => l.type === 'added' || l.type === 'removed').length;
                const diffBodyId = 'diffBody_' + filepath.replace(/[^a-zA-Z0-9]/g, '_');
                const diffLinesHtml = diffLines.map(l => {
                    const escaped = escapeHtml(l.text);
                    if (l.type === 'removed') return `<div style="background:rgba(244,63,94,0.15);color:var(--color-danger,#f44);padding:0.1rem 0.5rem;font-size:0.8rem;font-family:monospace;white-space:pre-wrap;word-break:break-all">- ${escaped}</div>`;
                    if (l.type === 'added') return `<div style="background:rgba(16,185,129,0.15);color:var(--color-success,#10b981);padding:0.1rem 0.5rem;font-size:0.8rem;font-family:monospace;white-space:pre-wrap;word-break:break-all">+ ${escaped}</div>`;
                    return `<div style="padding:0.1rem 0.5rem;font-size:0.8rem;font-family:monospace;white-space:pre-wrap;word-break:break-all;color:var(--text-secondary)">&nbsp; ${escaped}</div>`;
                }).join('');

                return `
                <div class="overwrite-file-card" style="border:1px solid var(--border);border-radius:var(--radius-sm,6px);overflow:hidden;margin-bottom:0.5rem">
                    <button class="overwrite-file-header" data-target="${diffBodyId}" style="
                        width:100%;display:flex;align-items:center;justify-content:space-between;
                        padding:0.7rem 0.85rem;background:var(--bg-secondary);border:none;cursor:pointer;
                        font-size:0.9rem;color:var(--text-primary);text-align:left;min-height:44px;
                        font-family:inherit
                    ">
                        <span style="font-weight:500">${escapeHtml(filepath)}</span>
                        <span style="font-size:0.75rem;color:var(--text-muted)">${changedCount} line${changedCount !== 1 ? 's' : ''} changed</span>
                    </button>
                    <div id="${diffBodyId}" style="display:none;max-height:200px;overflow-y:auto;border-top:1px solid var(--border);padding:0.25rem 0">
                        ${diffLinesHtml}
                    </div>
                </div>`;
            }).join('');
        }

        const modal = Modal.create({
            title: 'Local Changes Detected',
            content: `
                <div style="font-size:0.9rem;line-height:1.6">
                    <p>You have unsaved edits that conflict with updates from the remote repository.</p>
                    <p style="margin-top:0.5rem"><strong>Nothing has been changed yet.</strong> Choose how to proceed:</p>
                    <div style="margin-top:0.75rem">${filesHtml}</div>
                    <div style="margin-top:1rem;display:flex;flex-direction:column;gap:0.5rem">
                        <button id="overwriteForcePullBtn" style="
                            padding:0.85rem 1rem;border-radius:8px;background:var(--bg-secondary);
                            border:1px solid var(--border);cursor:pointer;text-align:left;
                            font-size:0.9rem;line-height:1.4;min-height:44px;font-family:inherit;width:100%
                        ">
                            <div style="font-weight:600;color:var(--text-primary)">Pull Remote Changes</div>
                            <div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.25rem">
                                Update to match the remote version.
                                <span style="color:var(--color-danger,#f44)">Your unsaved edits will be lost.</span>
                            </div>
                        </button>
                        <button id="overwriteKeepLocalBtn" style="
                            padding:0.85rem 1rem;border-radius:8px;background:var(--bg-secondary);
                            border:1px solid var(--border);cursor:pointer;text-align:left;
                            font-size:0.9rem;line-height:1.4;min-height:44px;font-family:inherit;width:100%
                        ">
                            <div style="font-weight:600;color:var(--text-primary)">Keep Your Changes</div>
                            <div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.25rem">
                                Save your edits and push them.
                                <span style="color:var(--color-danger,#f44)">Remote changes will be overwritten.</span>
                            </div>
                        </button>
                    </div>
                    <div style="margin-top:0.75rem;display:flex;justify-content:flex-end">
                        <button id="overwriteDismissBtn" class="settings-btn secondary">Cancel</button>
                    </div>
                </div>
            `,
            width: '420px'
        });

        // Toggle diff body on file header click
        modal.querySelectorAll('.overwrite-file-header').forEach(btn => {
            btn.addEventListener('click', () => {
                const body = modal.querySelector('#' + btn.dataset.target);
                if (body) body.style.display = body.style.display === 'none' ? 'block' : 'none';
            });
        });

        modal.querySelector('#overwriteDismissBtn').addEventListener('click', () => modal.close());

        // Option A: Force Pull
        modal.querySelector('#overwriteForcePullBtn').addEventListener('click', async () => {
            if (!confirm('This will discard your local edits and use the remote version. Continue?')) return;
            const pullBtn = modal.querySelector('#overwriteForcePullBtn');
            const keepBtn = modal.querySelector('#overwriteKeepLocalBtn');
            pullBtn.disabled = true;
            keepBtn.disabled = true;
            pullBtn.querySelector('div:first-child').textContent = 'Pulling...';
            try {
                const { git, fs, dir } = GitStore;
                const ref = this._config.branch || 'main';
                const remoteName = GitRemote.config.name;

                await git.fetch({
                    fs, dir, http: window.GitHttp,
                    remote: remoteName, ref,
                    corsProxy: GitRemote._getCorsProxy(),
                    onAuth: () => GitRemote.config.auth
                });
                const remoteOid = await git.resolveRef({ fs, dir, ref: `refs/remotes/${remoteName}/${ref}` });
                await git.writeRef({ fs, dir, ref: `refs/heads/${ref}`, value: remoteOid, force: true });
                await git.checkout({ fs, dir, ref, force: true });
                await git.push({
                    fs, dir, http: window.GitHttp,
                    remote: remoteName, ref,
                    corsProxy: GitRemote._getCorsProxy(),
                    onAuth: () => GitRemote.config.auth
                });

                this._pendingCommits = 0;
                this._lastError = null;
                this._setStatus('idle', 'Force pull succeeded');

                if (window.App && typeof App.render === 'function') {
                    await Store.loadBlocks();
                    Store._filteredBlocksCache.invalidate();
                    SelectionManager.updateTagCounts();
                    TimelineView.invalidateRawDataCache();
                    TimelineView.invalidateCache();
                    App.render();
                }

                showToast('Updated to match remote.');
                modal.close();
            } catch (err) {
                pullBtn.disabled = false;
                keepBtn.disabled = false;
                pullBtn.querySelector('div:first-child').textContent = 'Pull Remote Changes';
                alert('Force pull failed: ' + err.message);
            }
        });

        // Option B: Keep Local + Force Push
        modal.querySelector('#overwriteKeepLocalBtn').addEventListener('click', async () => {
            if (!confirm('This will save your local edits and overwrite the remote. Continue?')) return;
            const keepBtn = modal.querySelector('#overwriteKeepLocalBtn');
            const pullBtn = modal.querySelector('#overwriteForcePullBtn');
            keepBtn.disabled = true;
            pullBtn.disabled = true;
            keepBtn.querySelector('div:first-child').textContent = 'Saving...';
            try {
                const { git, fs, dir } = GitStore;
                const ref = this._config.branch || 'main';
                const remoteName = GitRemote.config.name;

                const filenames = await fs.readdir(dir);
                for (const name of filenames) {
                    if (name.endsWith('.md')) {
                        await git.add({ fs, dir, filepath: name });
                    }
                }
                await git.commit({
                    fs, dir,
                    author: GitStore.author,
                    message: 'Local edits preserved during sync conflict'
                });
                await git.push({
                    fs, dir, http: window.GitHttp,
                    remote: remoteName, ref, force: true,
                    corsProxy: GitRemote._getCorsProxy(),
                    onAuth: () => GitRemote.config.auth
                });

                this._pendingCommits = 0;
                this._lastError = null;
                this._setStatus('idle', 'Force push succeeded');
                showToast('Local edits saved and pushed.');
                modal.close();
            } catch (err) {
                keepBtn.disabled = false;
                pullBtn.disabled = false;
                keepBtn.querySelector('div:first-child').textContent = 'Keep Your Changes';
                alert('Failed to save and push: ' + err.message);
            }
        });
    },

    _computeLineDiff(localContent, remoteContent) {
        const localLines = localContent.split('\n');
        const remoteLines = remoteContent.split('\n');
        const result = [];

        const m = localLines.length;
        const n = remoteLines.length;

        // Fall back to simple comparison for very large files (O(n*m) table)
        if (m * n > 500000) {
            return this._simpleDiff(localLines, remoteLines);
        }

        // Build LCS table
        const dp = [];
        for (let i = 0; i <= m; i++) {
            dp[i] = new Uint32Array(n + 1);
        }
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (localLines[i - 1] === remoteLines[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        // Backtrack to produce diff
        const actions = [];
        let i = m, j = n;
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && localLines[i - 1] === remoteLines[j - 1]) {
                actions.push({ type: 'same', text: localLines[i - 1] });
                i--; j--;
            } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                actions.push({ type: 'added', text: remoteLines[j - 1] });
                j--;
            } else {
                actions.push({ type: 'removed', text: localLines[i - 1] });
                i--;
            }
        }
        actions.reverse();

        // Collapse consecutive unchanged lines for readability
        let unchangedBuffer = [];
        for (const action of actions) {
            if (action.type === 'same') {
                unchangedBuffer.push(action.text);
            } else {
                if (unchangedBuffer.length > 3) {
                    result.push({ type: 'same', text: `... ${unchangedBuffer.length} unchanged lines ...` });
                } else {
                    for (const line of unchangedBuffer) result.push({ type: 'same', text: line });
                }
                unchangedBuffer = [];
                result.push(action);
            }
        }
        if (unchangedBuffer.length > 3) {
            result.push({ type: 'same', text: `... ${unchangedBuffer.length} unchanged lines ...` });
        } else {
            for (const line of unchangedBuffer) result.push({ type: 'same', text: line });
        }

        return result;
    },

    _simpleDiff(localLines, remoteLines) {
        const result = [];
        const maxLen = Math.max(localLines.length, remoteLines.length);
        for (let i = 0; i < maxLen; i++) {
            const local = i < localLines.length ? localLines[i] : null;
            const remote = i < remoteLines.length ? remoteLines[i] : null;
            if (local === remote) {
                result.push({ type: 'same', text: local });
            } else {
                if (local !== null) result.push({ type: 'removed', text: local });
                if (remote !== null) result.push({ type: 'added', text: remote });
            }
        }
        return result;
    },

};

window.SyncManager = SyncManager;
