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
    _syncLock: null,
    _networkListenersInstalled: false,
    _idleSyncTimer: null,
    _consecutiveErrors: 0,     // Track consecutive sync failures
    _lastErrorTime: null,

    _config: {
        autoSync: false,
        syncInterval: 0,        // minutes, 0 = off
        commitThreshold: 5,
        branch: 'main',
        corsProxy: ''
    },

    // --- Initialization ---

    async init() {
        this._stopIntervalSync();
        clearTimeout(this._idleSyncTimer);
        this._idleSyncTimer = null;
        this._status = 'idle';
        this._statusDetail = null;
        this._pendingCommits = 0;
        this._lastSyncTime = null;
        this._lastError = null;
        this._syncLock = null;

        await this._loadConfig();
        this._isOnline = navigator.onLine;
        this._setupNetworkListeners();

        if (GitRemote.config) {
            await this._refreshPendingCount();
        }

        if (!window.App || !App._initInProgress) {
            if (this._config.autoSync && GitRemote.config) {
                this._startIntervalSync();
            }
        }

        Logger.log('[SyncManager] initialized', {
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
        // Use default CORS proxy from app settings if not set in remote config
        if (!this._config.corsProxy && window.AppSettings) {
            this._config.corsProxy = await AppSettings.getDefaultCorsProxy();
        }
    },

    async saveConfig(updates) {
        const remoteConfig = await Store.getRemoteConfig() || {};
        const newConfig = { ...this._config, ...updates };
        remoteConfig.sync = newConfig;
        await Store.saveRemoteConfig(remoteConfig);
        Object.assign(this._config, updates);

        this._stopIntervalSync();
        if (this._config.autoSync && GitRemote.config && !App._initInProgress) {
            this._startIntervalSync();
        }
    },

    // --- Core sync ---

    async _acquireSyncLock() {
        if (this._syncLock) return false;
        let resolveLock;
        this._syncLock = new Promise(r => resolveLock = r);
        this._syncLock._resolve = resolveLock;
        return true;
    },

    _releaseSyncLock() {
        if (this._syncLock && this._syncLock._resolve) {
            this._syncLock._resolve();
        }
        this._syncLock = null;
    },

    async sync() {
        if (window.App && App._initInProgress) {
            this._setStatus('idle', 'Initializing vault...');
            return false;
        }
        if (!GitRemote.config) {
            this._setStatus('idle', 'No remote configured');
            return false;
        }
        if (!GitRemote.config.name || typeof GitRemote.config.name !== 'string') {
            this._setStatus('error', 'Remote name is invalid. Please reconfigure in Settings.');
            throw new Error('Remote name is invalid or missing. Please reconfigure your git remote in Settings.');
        }
        if (!this._isNetworkAvailable()) {
            this._setStatus('idle', 'Offline');
            return false;
        }
        if (!(await this._acquireSyncLock())) return false;

        this._setStatus('syncing', 'Syncing...');
        try {
            // Flush and commit any pending edits first
            if (window.DocumentView && typeof DocumentView.flushAllPendingSaves === 'function') {
                await DocumentView.flushAllPendingSaves();
            }

            // Auto-stage and commit any other unstaged local files before sync
            if (window.GitStore && typeof GitStore.commitAll === 'function') {
                try {
                    await GitStore.commitAll('Auto-commit local changes before sync');
                } catch (commitErr) {
                    console.warn('[SyncManager] Auto-commit skipped/failed (possibly nothing to commit):', commitErr);
                }
            }

            await GitRemote.pull();
            await GitRemote.push();
            this._lastSyncTime = new Date().toISOString();
            this._lastError = null;
            this._consecutiveErrors = 0;
            this._lastErrorTime = null;

            // Reconcile pending count from authoritative git state
            await this._refreshPendingCount();

            this._setStatus('idle', 'Synced');

            await this._postSyncRender();
            return true;
        } catch (err) {
            this._consecutiveErrors++;
            this._lastErrorTime = new Date().toISOString();
            
            if (this._isOverwriteError(err)) {
                this._lastError = err.message;
                this._setStatus('conflict', 'Local changes conflict with remote');
                showToast('Sync blocked: local changes would be overwritten by remote updates.', {
                    actionLabel: 'Resolve',
                    action: () => this._showOverwriteHelp(err)
                });
            } else if (this._isConflictError(err)) {
                this._lastError = err.message;
                await this._handleMergeConflict();
            } else {
                this._lastError = err.message;
                this._setStatus('error', err.message);
                
                let msg = 'Sync failed: ' + err.message;
                let actionLabel = 'Retry';
                let action = () => this.sync();
                
                // Check for consecutive errors and escalate message
                if (this._consecutiveErrors >= 3) {
                    msg += ` (${this._consecutiveErrors} consecutive failures)`;
                    actionLabel = 'Retry (Wait)';
                    action = () => {
                        // Add delay before retry for consecutive failures
                        setTimeout(() => this.sync(), 2000 * Math.min(this._consecutiveErrors, 5));
                    };
                }
                
                if (this._isCorsError(err)) {
                    msg = 'Sync failed: CORS blocked — configure a CORS proxy in Settings';
                    actionLabel = 'View Settings';
                    action = () => App.setView('settings');
                } else if (this._isAuthError(err)) {
                    msg = 'Sync failed: Authentication error — check your credentials in Settings';
                    actionLabel = 'View Settings';
                    action = () => App.setView('settings');
                } else if (this._isNetworkError(err)) {
                    msg = 'Sync failed: Network error — check your connection and retry';
                    if (this._consecutiveErrors >= 2) {
                        msg += ' (retrying with delay...)';
                    }
                } else if (this._isProtectedBranchError(err)) {
                    msg = 'Sync failed: Branch is protected. You may need to push to a different branch or use force push.';
                    actionLabel = 'Force Push';
                    action = () => this._forcePush();
                }
                
                showToast(msg, { actionLabel, action });
            }
            // Reconcile even on failure — partial sync may have changed count
            await this._refreshPendingCount().catch(() => {});
            return false;
        } finally {
            this._releaseSyncLock();
        }
    },

    // --- Trigger hooks ---

    onCommit() {
        this._pendingCommits++;
        this._setStatus(this._status, this._statusDetail);
        this._scheduleIdleSync();
    },

    onTabVisible() {
        if (window.App && App._initInProgress) return;
        if (this._config.autoSync && GitRemote.config) {
            this._scheduleIdleSync();
        }
    },

    async onTabHidden() {
        if (window.App && App._initInProgress) return;
        if (!this._config.autoSync || !GitRemote.config || this._pendingCommits <= 0) return;
        if (!(await this._acquireSyncLock())) return;
        try {
            await GitRemote.push();
            await this._refreshPendingCount();
            this._consecutiveErrors = 0;
        } catch (err) {
            this._lastError = err.message;
            this._consecutiveErrors++;
            console.warn('[SyncManager] background push failed:', err);
            if (this._consecutiveErrors >= 2) {
                showToast(`Background sync failed (${this._consecutiveErrors}x). Will retry automatically.`, {
                    actionLabel: 'View Status',
                    action: () => document.getElementById('toolbarSyncBtn')?.click()
                });
            }
        } finally {
            this._releaseSyncLock();
        }
    },

    // --- Scheduling ---

    _scheduleIdleSync() {
        if (this._status === 'syncing') return;
        if (window.App && App._initInProgress) return;
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
        if (window.App && App._initInProgress) return;
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
        if (this._networkListenersInstalled) return;
        this._networkListenersInstalled = true;
        window.addEventListener('online', () => {
            this._isOnline = true;
            this._setStatus(this._status, this._statusDetail);
            if (this._config.autoSync && this._pendingCommits > 0 && GitRemote.config) {
                this._scheduleIdleSync();
            }
        });
        window.addEventListener('offline', () => {
            this._isOnline = false;
            this._setStatus(this._status, 'Offline');
        });
    },

    _isNetworkAvailable() {
        return this._isOnline && navigator.onLine;
    },

    _isEditing() {
        if (Store.currentView !== 'document' || !window.DocumentView) return false;
        return document.activeElement && !!document.activeElement.closest('.cm-editor');
    },

    async _postSyncRender(withLoading = false) {
        if (!window.App || typeof App.render !== 'function') return;
        if (withLoading) App.showViewLoading();
        try {
            // Don't reload blocks from disk while user is editing — their in-editor
            // state would be overwritten. Render is also deferred until editing stops.
            if (!this._isEditing()) {
                await Store.loadBlocks();
                Store._filteredBlocksCache.invalidate();
                SelectionManager.updateTagCounts();
                TimelineView.invalidateRawDataCache();
                TimelineView.invalidateCache();
                App.render();
            }
        } catch (renderErr) {
            console.error('Post-sync render failed:', renderErr);
        } finally {
            if (withLoading) App.hideViewLoading();
        }
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
        if (err.code === 'MergeConflictError') return true;
        const msg = (err.message || err.data?.message || '').toLowerCase();
        return msg.includes('conflict') || msg.includes('non-fast-forward') ||
               msg.includes('not updated') || msg.includes('cannot lock ref') ||
               msg.includes('fetch first');
    },

    _isOverwriteError(err) {
        if (err.code === 'CheckoutConflictError') return true;
        const msg = (err.message || err.data?.message || '').toLowerCase();
        return msg.includes('would be overwritten');
    },

    _isCorsError(err) {
        const msg = (err.message || '').toLowerCase();
        return msg.includes('cors') || msg.includes('load failed');
    },

    _isAuthError(err) {
        const msg = (err.message || '').toLowerCase();
        return msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') ||
               msg.includes('forbidden') || msg.includes('authentication') || msg.includes('credentials');
    },

    _isNetworkError(err) {
        const msg = (err.message || '').toLowerCase();
        return msg.includes('timeout') || msg.includes('timed out') || msg.includes('network') ||
               msg.includes('connection') || msg.includes('econnrefused') || msg.includes('enotfound') ||
               msg.includes('failed to fetch') || msg.includes('networkerror');
    },

    _isProtectedBranchError(err) {
        const msg = (err.message || '').toLowerCase();
        return msg.includes('protected') || msg.includes('permission denied') ||
               (msg.includes('push') && msg.includes('rejected'));
    },

    async _forcePush() {
        if (!GitStore.git || !GitStore.fs) return;
        try {
            const { git, fs, dir } = GitStore;
            const ref = this._config.branch || 'main';
            const remoteName = GitRemote.config.name;
            
            await git.push({
                fs, dir,
                http: window.GitHttp,
                remote: remoteName, ref, force: true,
                corsProxy: GitRemote._getCorsProxy(),
                onAuth: () => GitRemote.config.auth
            });
            
            this._pendingCommits = 0;
            this._lastError = null;
            this._consecutiveErrors = 0;
            this._setStatus('idle', 'Force push succeeded');
            showToast('Force push successful.');
        } catch (err) {
            this._lastError = err.message;
            this._setStatus('error', err.message);
            alert('Force push failed: ' + err.message);
        }
    },

    async _hardResetToRemote() {
        if (!GitStore.git || !GitStore.fs) throw new Error('Git not initialized');
        if (!GitRemote.config) throw new Error('No remote configured');

        const { git, fs, dir } = GitStore;
        const ref = this._config.branch || 'main';
        const remoteName = GitRemote.config.name;

        await git.fetch({
            fs, dir,
            http: window.GitHttp,
            remote: remoteName,
            corsProxy: GitRemote._getCorsProxy(),
            onAuth: () => GitRemote.config.auth
        });
        const remoteRef = `refs/remotes/${remoteName}/${ref}`;
        const commitOid = await git.resolveRef({ fs, dir, ref: remoteRef });
        await git.writeRef({ fs, dir, ref: `refs/heads/${ref}`, value: commitOid, force: true });
        await git.checkout({ fs, dir, ref, force: true });

        this._pendingCommits = 0;
        this._lastError = null;
        this._consecutiveErrors = 0;
        await this._refreshPendingCount().catch(() => {});
        await this._postSyncRender();
    },

    async _handleMergeConflict() {
        this._setStatus('conflict', 'Analyzing conflicts...');

        // Flush any pending saves to disk before resetting the working tree.
        // This prevents data loss if auto-save hasn't fired yet.
        if (window.Store && Store._saveQueue && Store._saveQueue.size > 0) {
            const results = await Promise.allSettled(Array.from(Store._saveQueue.values()));
            const failed = results.filter(r => r.status === 'rejected');
            if (failed.length > 0) {
                console.warn('[SyncManager] Some saves failed before merge conflict resolution:', failed);
                showToast('Warning: Some pending saves failed — changes may be lost');
            }
        }
        // Also flush and commit debounced saves from editors (1-second timers)
        if (window.DocumentView && typeof DocumentView.flushAllPendingSaves === 'function') {
            await DocumentView.flushAllPendingSaves();
        }

        // The failed pull may have left the index/working tree in a dirty merged state.
        // Reset to local HEAD so we can analyze cleanly.
        try {
            if (!GitStore.git || !GitStore.fs) return;
            const { git, fs, dir } = GitStore;
            const ref = this._config.branch || 'main';
            await git.checkout({ fs, dir, ref, force: true });
        } catch (resetErr) {
            console.warn('[SyncManager] failed to reset working tree after failed pull:', resetErr);
        }

        try {
            const conflictData = await this._detectConflicts();

            if (conflictData.files.length === 0) {
                // Verify git store is readable — if all commits failed, recover via hard reset
                const localVerify = await GitStore.getAllFilesAtCommit(conflictData.localOid);
                const remoteVerify = await GitStore.getAllFilesAtCommit(conflictData.remoteOid);
                if (!localVerify && !remoteVerify) {
                    console.warn('[SyncManager] Git object store unreadable, falling back to hard reset');
                    try {
                        await this._hardResetToRemote();
                        this._setStatus('idle', 'Synced (hard reset to remote)');
                        showToast('Sync recovered: reset to remote branch due to unreadable git history.');
                        return;
                    } catch (resetErr) {
                        console.error('[SyncManager] hard reset recovery failed:', resetErr);
                        throw resetErr;
                    }
                }
                // No actual file conflicts — schedule retry
                this._setStatus('idle', 'No conflicts found');
                this._scheduleIdleSync();
                return;
            }

            if (conflictData.allAutoResolved) {
                // All conflicts auto-resolvable — apply without modal
                await this._applyMergeResolution(conflictData);
                const count = conflictData.files.length;
                showToast(`Sync resolved (${count} file${count !== 1 ? 's' : ''} merged automatically).`);
                return;
            }

            // Show per-file resolution modal
            this._setStatus('conflict', 'Merge conflict — manual resolution needed');
            this._showConflictResolutionModal(conflictData);
        } catch (err) {
            console.error('[SyncManager] conflict detection failed:', err);
            this._lastError = err.message;
            this._setStatus('conflict', 'Conflict analysis failed: ' + err.message);
            showToast('Conflict analysis failed: ' + err.message);
        }
    },

    async _detectConflicts() {
        if (!GitStore.git || !GitStore.fs) return null;
        const { git, fs, dir } = GitStore;
        const ref = this._config.branch || 'main';
        const remoteName = GitRemote.config.name;

        const parseFM = (content) => {
            if (typeof parseFrontMatter === 'function') {
                return parseFrontMatter(content);
            }
            let currentContent = content.trimStart();
            const data = {};
            const regex = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
            const match = currentContent.match(regex);
            if (match) {
                const metadataString = match[1];
                currentContent = currentContent.substring(match[0].length).trimStart();
                metadataString.split(/\r?\n/).forEach(line => {
                    const lineMatch = line.match(/^([^:]+):\s*(.*)$/);
                    if (!lineMatch) return;
                    const key = lineMatch[1].trim();
                    const valueStr = lineMatch[2].trim();
                    if (!(key in data)) {
                        try { data[key] = JSON.parse(valueStr); } catch { data[key] = valueStr; }
                    }
                });
            }
            return { content: currentContent, ...data };
        };

        const isEqual = (v1, v2) => {
            if (v1 === v2) return true;
            if (Array.isArray(v1) && Array.isArray(v2)) {
                if (v1.length !== v2.length) return false;
                return v1.every((el, idx) => el === v2[idx]);
            }
            if (v1 && typeof v1 === 'object' && v2 && typeof v2 === 'object') {
                return JSON.stringify(v1) === JSON.stringify(v2);
            }
            return false;
        };

        // Normalize body text so that invisible differences (line endings,
        // trailing whitespace, trailing newlines) don't block auto-resolution
        // of conflicts where only `lastUpdated` actually differs.
        const normalizeForCompare = (text) => {
            if (typeof text !== 'string') return text;
            return text
                .replace(/\r\n/g, '\n')
                .replace(/\r/g, '\n')
                .split('\n')
                .map(line => line.replace(/[ \t]+$/, ''))
                .join('\n')
                .replace(/\n+$/, '')
                .trim();
        };

        // Resolve local and remote HEAD
        const localOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
        let remoteOid;
        try {
            remoteOid = await git.resolveRef({ fs, dir, ref: `refs/remotes/${remoteName}/${ref}` });
        } catch (e) {
            // Remote ref not available — fetch first
            await git.fetch({
                fs, dir, http: window.GitHttp,
                remote: remoteName, ref,
                corsProxy: GitRemote._getCorsProxy(),
                onAuth: () => GitRemote.config.auth
            });
            remoteOid = await git.resolveRef({ fs, dir, ref: `refs/remotes/${remoteName}/${ref}` });
        }

        if (localOid === remoteOid) {
            return { localOid, remoteOid, baseOid: localOid, files: [], allAutoResolved: true };
        }

        // Find merge base
        const baseOid = await GitStore.getMergeBase(localOid, remoteOid);

        let localChanges, remoteChanges;
        if (baseOid) {
            localChanges = await GitStore.getChangedFilesBetween(baseOid, localOid);
            remoteChanges = await GitStore.getChangedFilesBetween(baseOid, remoteOid);

            // Fallback when TREE walker fails: read full file trees and diff manually
            if (!localChanges || !remoteChanges) {
                const baseFiles = await GitStore.getAllFilesAtCommit(baseOid);
                const localFiles = !localChanges ? await GitStore.getAllFilesAtCommit(localOid) : null;
                const remoteFiles = !remoteChanges ? await GitStore.getAllFilesAtCommit(remoteOid) : null;

                // If base commit can't be read, fall back to no-common-ancestor comparison
                if (!baseFiles) {
                    console.warn('[SyncManager] base commit unreadable, treating as no common ancestor');
                    localChanges = localFiles;
                    remoteChanges = remoteFiles;
                } else {
                    if (!localChanges) {
                        localChanges = {};
                        const lf = localFiles || {};
                        for (const fp of new Set([...Object.keys(baseFiles), ...Object.keys(lf)])) {
                            if (baseFiles[fp] !== lf[fp]) {
                                localChanges[fp] = fp in lf ? lf[fp] : null;
                            }
                        }
                    }
                    if (!remoteChanges) {
                        remoteChanges = {};
                        const rf = remoteFiles || {};
                        for (const fp of new Set([...Object.keys(baseFiles), ...Object.keys(rf)])) {
                            if (baseFiles[fp] !== rf[fp]) {
                                remoteChanges[fp] = fp in rf ? rf[fp] : null;
                            }
                        }
                    }
                }
            }
        } else {
            // No common ancestor — compare full file trees
            localChanges = await GitStore.getAllFilesAtCommit(localOid);
            remoteChanges = await GitStore.getAllFilesAtCommit(remoteOid);
        }

        if (!localChanges && !remoteChanges) {
            return { localOid, remoteOid, baseOid, files: [], allAutoResolved: true };
        }

        localChanges = localChanges || {};
        remoteChanges = remoteChanges || {};

        // Build union of all changed files and categorize
        const allPaths = new Set([...Object.keys(localChanges), ...Object.keys(remoteChanges)]);
        const files = [];
        let allAutoResolved = true;

        for (const filepath of allPaths) {
            const inLocal = filepath in localChanges;
            const inRemote = filepath in remoteChanges;
            const localContent = localChanges[filepath];   // null = deleted locally (undefined = not changed)
            const remoteContent = remoteChanges[filepath]; // null = deleted remotely

            let category, resolution;

            if (inLocal && !inRemote) {
                category = 'local-only';
                resolution = 'local';
            } else if (!inLocal && inRemote) {
                category = 'remote-only';
                resolution = 'remote';
            } else if (localContent === null && remoteContent === null) {
                category = 'both-delete';
                resolution = 'remote'; // accept deletion
            } else if (localContent !== null && remoteContent === null) {
                category = 'local-edit-remote-delete';
                resolution = null;
                allAutoResolved = false;
            } else if (localContent === null && remoteContent !== null) {
                category = 'local-delete-remote-edit';
                resolution = null;
                allAutoResolved = false;
            } else if (localContent === remoteContent) {
                // Both changed to same content — auto-resolve
                category = 'same-change';
                resolution = 'local';
            } else {
                category = 'both-changed';
                resolution = null;

                // Check if only lastUpdated differs, and auto-resolve by taking the latest
                if (localContent !== null && localContent !== undefined &&
                    remoteContent !== null && remoteContent !== undefined) {
                    
                    const localParsed = parseFM(localContent);
                    const remoteParsed = parseFM(remoteContent);
                    
                    // Normalize body content so invisible differences (line endings,
                    // trailing whitespace, trailing newlines) don't block auto-resolution.
                    const localNorm = { ...localParsed, content: normalizeForCompare(localParsed.content) };
                    const remoteNorm = { ...remoteParsed, content: normalizeForCompare(remoteParsed.content) };
                    
                    const keys = new Set([
                        ...Object.keys(localParsed),
                        ...Object.keys(remoteParsed)
                    ]);
                    keys.delete('lastUpdated');
                    
                    let onlyLastUpdatedDiffers = true;
                    for (const key of keys) {
                        if (!isEqual(localNorm[key], remoteNorm[key])) {
                            onlyLastUpdatedDiffers = false;
                            Logger.log('[SyncManager] merge conflict NOT auto-resolvable:', {
                                filepath,
                                key,
                                localVal: JSON.stringify(localNorm[key])?.slice(0, 100),
                                remoteVal: JSON.stringify(remoteNorm[key])?.slice(0, 100)
                            });
                            break;
                        }
                    }
                    
                    if (onlyLastUpdatedDiffers) {
                        const localTimeStr = localParsed.lastUpdated;
                        const remoteTimeStr = remoteParsed.lastUpdated;
                        const localTime = localTimeStr ? new Date(localTimeStr).getTime() : 0;
                        const remoteTime = remoteTimeStr ? new Date(remoteTimeStr).getTime() : 0;
                        
                        if (localTime >= remoteTime) {
                            resolution = 'local';
                        } else {
                            resolution = 'remote';
                        }
                    }
                }

                if (!resolution) {
                    allAutoResolved = false;
                }
            }

            // Load base content for files needing manual resolution
            let baseContent = null;
            if (!resolution && baseOid) {
                baseContent = await GitStore.getFileAtCommit(filepath, baseOid);
            }

            files.push({
                filepath,
                category,
                localContent: inLocal ? localContent : undefined,
                remoteContent: inRemote ? remoteContent : undefined,
                baseContent,
                resolution
            });
        }

        return { localOid, remoteOid, baseOid, files, allAutoResolved };
    },

    async _applyMergeResolution(conflictData) {
        if (!GitStore.git || !GitStore.fs) return;
        const { git, fs, dir } = GitStore;
        const { files, localOid, remoteOid } = conflictData;
        const ref = this._config.branch || 'main';
        const remoteName = GitRemote.config.name;

        // Re-flush pending editor saves before applying resolution
        if (window.DocumentView && typeof DocumentView.flushAllPendingSaves === 'function') {
            await DocumentView.flushAllPendingSaves();
        }

        // Write resolved files to working directory
        for (const f of files) {
            const choice = f.resolution || 'local';

            if (choice === 'local') {
                // Keep local version — file is already on disk (or already deleted)
                // If file was deleted locally, ensure it's removed
                if (f.localContent === null || f.localContent === undefined) {
                    if (f.category === 'local-delete-remote-edit' || f.category === 'both-delete') {
                        try { await fs.unlink(f.filepath); } catch (e) { /* already gone */ }
                        await git.remove({ fs, dir, filepath: f.filepath }).catch(() => {});
                    }
                } else {
                    // File exists locally with correct content — just stage it
                    await git.add({ fs, dir, filepath: f.filepath });
                }
            } else {
                // Take remote version
                if (f.remoteContent === null || f.remoteContent === undefined) {
                    // Remote deleted this file — remove it locally
                    try { await fs.unlink(f.filepath); } catch (e) { /* already gone */ }
                    await git.remove({ fs, dir, filepath: f.filepath }).catch(() => {});
                } else {
                    // Write remote content to file
                    await fs.writeFile(f.filepath, new TextEncoder().encode(f.remoteContent));
                    await git.add({ fs, dir, filepath: f.filepath });
                }
            }
        }

        // Create merge commit with both parents
        await git.commit({
            fs, dir,
            author: GitStore.author,
            message: 'Merge: resolved sync conflicts',
            parent: [localOid, remoteOid]
        });

        // Push normally (merge commit has remote HEAD as parent, so no force needed)
        await git.push({
            fs, dir,
            http: window.GitHttp,
            remote: remoteName,
            ref,
            corsProxy: GitRemote._getCorsProxy(),
            onAuth: () => GitRemote.config.auth
        });

        // Post-merge cleanup
        this._pendingCommits = 0;
        this._lastError = null;
        this._setStatus('idle', 'Merge resolved');

        await this._postSyncRender(true);
    },

    // --- Shared full-file merge viewer (used by both conflict modals) ---

    // Returns HTML for a "View full file" toggle + tabbed CodeMirror merge viewer.
    // fileData: { localContent, remoteContent, baseContent } (any side may be null/undefined)
    _fullFileViewerHtml(index, fileData) {
        const hasBase = fileData.baseContent != null;
        const tabStyle = (active) => `
            flex:1;padding:0.4rem 0.5rem;background:${active ? 'var(--bg-secondary)' : 'var(--bg-primary)'};
            border:none;border-bottom:2px solid ${active ? 'var(--color-accent,#3b82f6)' : 'transparent'};
            cursor:pointer;font-size:0.78rem;color:${active ? 'var(--text-primary)' : 'var(--text-muted)'};
            font-family:inherit;min-height:36px
        `;
        const tabs = [
            `<button class="merge-fullfile-tab" data-index="${index}" data-pair="lr" style="${tabStyle(true)}">Local vs Remote</button>`,
            ...(hasBase ? [
                `<button class="merge-fullfile-tab" data-index="${index}" data-pair="bl" style="${tabStyle(false)}">Base &rarr; Local</button>`,
                `<button class="merge-fullfile-tab" data-index="${index}" data-pair="br" style="${tabStyle(false)}">Base &rarr; Remote</button>`,
            ] : [])
        ].join('');
        return `
            <button class="merge-fullfile-toggle" data-index="${index}" style="
                display:block;width:100%;padding:0.45rem 0.75rem;background:none;border:none;border-top:1px solid var(--border);
                cursor:pointer;font-size:0.8rem;color:var(--text-secondary);text-align:left;font-family:inherit
            ">View full file</button>
            <div class="merge-fullfile-body" data-index="${index}" style="display:none">
                <div class="merge-fullfile-tabs" data-index="${index}" style="display:flex;gap:0;border-top:1px solid var(--border)">${tabs}</div>
                <div class="merge-fullfile-editor" data-index="${index}" style="height:50vh;max-height:520px;overflow:hidden"></div>
            </div>`;
    },

    // Wires up the toggle + tab handlers. items[index] must expose localContent/remoteContent/baseContent.
    // viewerContainers is populated with editor containers so the caller can destroy views on close.
    _wireFullFileViewer(modal, items, viewerContainers) {
        const activePairs = {};
        const buildViewer = (index, pairKey) => {
            const fileData = items[index];
            if (!fileData) return;
            const editorContainer = modal.querySelector(`.merge-fullfile-editor[data-index="${index}"]`);
            if (!editorContainer) return;
            editorContainer.innerHTML = '';
            const local = fileData.localContent ?? '';
            const remote = fileData.remoteContent ?? '';
            const base = fileData.baseContent ?? '';
            let original, modified;
            if (pairKey === 'bl') { original = base; modified = local; }
            else if (pairKey === 'br') { original = base; modified = remote; }
            else { original = local; modified = remote; }
            if (!original && !modified) {
                editorContainer.innerHTML = '<div style="padding:1rem;color:var(--text-muted);font-size:0.85rem">No content to display.</div>';
                return;
            }
            if (!window.DiffEditor || !window.CodeMirror?.EditorView) {
                editorContainer.innerHTML = '<div style="padding:1rem;color:var(--text-muted);font-size:0.85rem">Editor not available.</div>';
                return;
            }
            DiffEditor.createMergeViewWhenReady(editorContainer, original, modified, {
                markdown: true, fontSize: '13px',
                colors: { deleted: 'rgba(239,68,68,0.15)', inserted: 'rgba(34,197,94,0.15)' }
            });
            if (!viewerContainers.includes(editorContainer)) viewerContainers.push(editorContainer);
            activePairs[index] = pairKey;
        };

        modal.querySelectorAll('.merge-fullfile-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                const body = modal.querySelector(`.merge-fullfile-body[data-index="${index}"]`);
                if (!body) return;
                const showing = body.style.display !== 'none';
                if (showing) {
                    body.style.display = 'none';
                    btn.textContent = 'View full file';
                } else {
                    body.style.display = 'block';
                    btn.textContent = 'Hide full file';
                    if (!activePairs[index]) buildViewer(index, 'lr');
                }
            });
        });

        modal.querySelectorAll('.merge-fullfile-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                const pairKey = btn.dataset.pair;
                modal.querySelectorAll(`.merge-fullfile-tab[data-index="${index}"]`).forEach(b => {
                    b.style.background = 'var(--bg-primary)';
                    b.style.color = 'var(--text-muted)';
                    b.style.borderBottom = '2px solid transparent';
                });
                btn.style.background = 'var(--bg-secondary)';
                btn.style.color = 'var(--text-primary)';
                btn.style.borderBottom = '2px solid var(--color-accent,#3b82f6)';
                buildViewer(index, pairKey);
            });
        });
    },

    async _showConflictResolutionModal(conflictData) {
        const { files, localOid, remoteOid } = conflictData;
        const autoResolved = files.filter(f => f.resolution);
        const needsResolution = files.filter(f => !f.resolution);

        // Auto-resolved section HTML
        let autoHtml = '';
        if (autoResolved.length > 0) {
            const autoItems = autoResolved.map(f => {
                const label = f.resolution === 'local' ? 'kept local' : 'took remote';
                const icon = f.category === 'both-delete' ? 'deleted' :
                             f.category === 'local-only' ? 'kept local' :
                             f.category === 'same-change' ? 'identical changes' : 'took remote';
                return `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0;font-size:0.85rem">
                    <span style="color:var(--color-success,#10b981);font-size:0.75rem">&#10003;</span>
                    <span style="color:var(--text-secondary)">${escapeHtml(f.filepath)}</span>
                    <span style="color:var(--text-muted);font-size:0.8rem;margin-left:auto">${escapeHtml(icon)}</span>
                </div>`;
            }).join('');

            autoHtml = `
                <div style="margin-bottom:0.75rem">
                    <button id="autoResolvedToggle" style="
                        display:flex;align-items:center;gap:0.4rem;width:100%;padding:0.5rem 0.75rem;
                        background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm,6px);
                        cursor:pointer;font-size:0.85rem;color:var(--text-secondary);text-align:left;font-family:inherit
                    ">
                        <span style="color:var(--color-success,#10b981)">&#10003;</span>
                        Auto-resolved (${autoResolved.length} file${autoResolved.length !== 1 ? 's' : ''})
                        <span style="margin-left:auto;font-size:0.7rem">&#9662;</span>
                    </button>
                    <div id="autoResolvedList" style="display:none;padding:0.5rem 0.75rem;border:1px solid var(--border);border-top:none;border-radius:0 0 var(--radius-sm,6px) var(--radius-sm,6px)">
                        ${autoItems}
                    </div>
                </div>`;
        }

        // Per-file conflict cards
        const conflictCardsHtml = needsResolution.map((f, i) => {
            const localLabel = f.category === 'local-delete-remote-edit' ? 'Keep Deletion' :
                               f.category === 'local-edit-remote-delete' ? 'Keep Local' : 'Keep Local';
            const remoteLabel = f.category === 'local-edit-remote-delete' ? 'Accept Deletion' :
                                f.category === 'local-delete-remote-edit' ? 'Take Remote' : 'Take Remote';

            // Build preview snippets (first 3 non-empty lines of each version)
            const localSnippet = f.localContent
                ? Common.contentPreview(f.localContent)
                : '<em style="color:var(--text-muted)">deleted</em>';
            const remoteSnippet = f.remoteContent
                ? Common.contentPreview(f.remoteContent)
                : '<em style="color:var(--text-muted)">deleted</em>';

            // Diff preview
            let diffPreviewHtml = '';
            if (f.localContent !== null && f.localContent !== undefined &&
                f.remoteContent !== null && f.remoteContent !== undefined) {
                const diffLines = this._computeLineDiff(f.localContent, f.remoteContent);
                const changedCount = diffLines.filter(l => l.type === 'added' || l.type === 'removed').length;
                const diffBodyId = 'mergeDiff_' + i;
                const diffLinesHtml = diffLines.map(l => {
                    const escaped = escapeHtml(l.text);
                    if (l.type === 'removed') return `<div style="background:rgba(244,63,94,0.15);color:var(--color-danger,#f44);padding:0.1rem 0.5rem;font-size:0.8rem;font-family:monospace;white-space:pre-wrap;word-break:break-all">- ${escaped}</div>`;
                    if (l.type === 'added') return `<div style="background:rgba(16,185,129,0.15);color:var(--color-success,#10b981);padding:0.1rem 0.5rem;font-size:0.8rem;font-family:monospace;white-space:pre-wrap;word-break:break-all">+ ${escaped}</div>`;
                    return `<div style="padding:0.1rem 0.5rem;font-size:0.8rem;font-family:monospace;white-space:pre-wrap;word-break:break-all;color:var(--text-secondary)">&nbsp; ${escaped}</div>`;
                }).join('');

                diffPreviewHtml = `
                    <button class="merge-diff-toggle" data-target="${diffBodyId}" data-index="${i}" style="
                        display:block;width:100%;padding:0.4rem 0.75rem;background:none;border:none;
                        cursor:pointer;font-size:0.8rem;color:var(--text-muted);text-align:left;font-family:inherit
                    ">Show diff (${changedCount} line${changedCount !== 1 ? 's' : ''} changed)</button>
                    <div id="${diffBodyId}" data-index="${i}" style="display:none;max-height:200px;overflow-y:auto;border-top:1px solid var(--border);padding:0.25rem 0">
                        <div class="merge-diff-content">${diffLinesHtml}</div>
                        <button class="merge-diff-expand" data-index="${i}" style="
                            display:block;width:100%;padding:0.35rem;background:none;border:none;border-top:1px solid var(--border);
                            cursor:pointer;font-size:0.78rem;color:var(--text-muted);font-family:inherit
                        ">&#9660; Show all lines</button>
                    </div>`;
            } else if (f.localContent === null || f.localContent === undefined) {
                diffPreviewHtml = `<div style="padding:0.4rem 0.75rem;font-size:0.8rem;color:var(--text-muted)">Deleted locally, edited remotely</div>`;
            } else {
                diffPreviewHtml = `<div style="padding:0.4rem 0.75rem;font-size:0.8rem;color:var(--text-muted)">Edited locally, deleted remotely</div>`;
            }

            const cardId = `conflictCard_${i}`;
            return `
            <div id="${cardId}" class="merge-conflict-card" data-filepath="${escapeHtml(f.filepath)}" style="
                border:1px solid var(--border);border-radius:var(--radius-sm,6px);overflow:hidden;margin-bottom:0.5rem
            ">
                <div style="padding:0.6rem 0.85rem;background:var(--bg-secondary);display:flex;align-items:center;justify-content:space-between">
                    <span style="font-weight:500;font-size:0.9rem">${escapeHtml(f.filepath)}</span>
                    <span style="font-size:0.75rem;color:var(--color-danger,#f44)">conflict</span>
                </div>
                ${diffPreviewHtml}
                ${this._fullFileViewerHtml(i, f)}
                <div style="display:flex;gap:0;border-top:1px solid var(--border)">
                    <button class="conflict-choice-btn" data-filepath="${escapeHtml(f.filepath)}" data-choice="local" data-card-index="${i}" style="
                        flex:1;padding:0.65rem;border:none;background:var(--bg-primary);cursor:pointer;
                        font-size:0.85rem;color:var(--text-primary);font-family:inherit;
                        border-right:1px solid var(--border);min-height:44px;text-align:center
                    ">
                        <div style="font-weight:500">${escapeHtml(localLabel)}</div>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.2rem;max-height:2.4em;overflow:hidden;line-height:1.2">${localSnippet}</div>
                    </button>
                    <button class="conflict-choice-btn" data-filepath="${escapeHtml(f.filepath)}" data-choice="remote" data-card-index="${i}" style="
                        flex:1;padding:0.65rem;border:none;background:var(--bg-primary);cursor:pointer;
                        font-size:0.85rem;color:var(--text-primary);font-family:inherit;min-height:44px;text-align:center
                    ">
                        <div style="font-weight:500">${escapeHtml(remoteLabel)}</div>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.2rem;max-height:2.4em;overflow:hidden;line-height:1.2">${remoteSnippet}</div>
                    </button>
                </div>
                <div class="merge-result-preview" style="display:none;padding:0.5rem 0.85rem;border-top:1px solid var(--border);background:var(--bg-secondary);font-size:0.8rem"></div>
            </div>`;
        }).join('');

        const viewerContainers = [];
        const modal = Modal.create({
            title: 'Merge Conflict',
            content: `
                <div style="font-size:0.9rem;line-height:1.6">
                    <p>Your local changes and remote changes diverged. Resolve each conflicting file below.</p>
                    <p style="margin-top:0.25rem;font-size:0.85rem;color:var(--text-secondary)"><strong>Nothing has been changed yet.</strong></p>
                    <div style="margin-top:0.75rem">${autoHtml}</div>
                    ${needsResolution.length > 0 ? `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;flex-wrap:wrap">
                        <span style="font-size:0.85rem;font-weight:500;color:var(--text-primary)">Needs resolution (${needsResolution.length}):</span>
                        <div style="margin-left:auto;display:flex;gap:0.4rem">
                            <button id="conflictAllLocal" class="settings-btn secondary" style="font-size:0.8rem;padding:0.35rem 0.7rem">Keep all local</button>
                            <button id="conflictAllRemote" class="settings-btn secondary" style="font-size:0.8rem;padding:0.35rem 0.7rem">Take all remote</button>
                        </div>
                    </div>` : ''}
                    <div style="max-height:400px;overflow-y:auto">${conflictCardsHtml}</div>
                    <div style="margin-top:1rem;display:flex;gap:0.5rem;justify-content:flex-end">
                        <button id="conflictCancelBtn" class="settings-btn secondary">Cancel</button>
                        <button id="conflictResolveBtn" class="settings-btn primary" style="opacity:0.5;pointer-events:none">Resolve &amp; Sync</button>
                    </div>
                </div>
            `,
            width: '520px',
            onClose: () => {
                for (const c of viewerContainers) {
                    const v = c._diffEditorView;
                    if (v) { try { v.destroy(); } catch (_) { /* cleanup */ } }
                }
            }
        });

        // Track resolutions
        const resolutions = {};
        const totalConflicts = needsResolution.length;

        const updateResolveButton = () => {
            const resolved = Object.keys(resolutions).length;
            const btn = modal.querySelector('#conflictResolveBtn');
            if (resolved >= totalConflicts) {
                btn.style.opacity = '1';
                btn.style.pointerEvents = 'auto';
            } else {
                btn.style.opacity = '0.5';
                btn.style.pointerEvents = 'none';
            }
        };

        // Helper: render diff lines to HTML
        const renderDiffLinesHtml = (diffLines) => {
            return diffLines.map(l => {
                const escaped = escapeHtml(l.text);
                if (l.type === 'removed') return `<div style="background:rgba(244,63,94,0.15);color:var(--color-danger,#f44);padding:0.1rem 0.5rem;font-size:0.8rem;font-family:monospace;white-space:pre-wrap;word-break:break-all">- ${escaped}</div>`;
                if (l.type === 'added') return `<div style="background:rgba(16,185,129,0.15);color:var(--color-success,#10b981);padding:0.1rem 0.5rem;font-size:0.8rem;font-family:monospace;white-space:pre-wrap;word-break:break-all">+ ${escaped}</div>`;
                return `<div style="padding:0.1rem 0.5rem;font-size:0.8rem;font-family:monospace;white-space:pre-wrap;word-break:break-all;color:var(--text-secondary)">&nbsp; ${escaped}</div>`;
            }).join('');
        };

        // Helper: select a choice for a conflict card (by index)
        const selectChoice = (index, choice) => {
            const fileData = needsResolution[index];
            if (!fileData) return;
            resolutions[fileData.filepath] = choice;

            // Update visual state of both buttons in this card
            const card = modal.querySelector('#conflictCard_' + index);
            if (!card) return;
            card.querySelectorAll('.conflict-choice-btn').forEach(b => {
                if (b.dataset.choice === choice) {
                    b.style.background = 'var(--color-success,#10b981)';
                    b.style.color = '#fff';
                    b.style.fontWeight = '600';
                } else {
                    b.style.background = 'var(--bg-primary)';
                    b.style.color = 'var(--text-primary)';
                    b.style.fontWeight = '400';
                }
            });

            // Show result preview
            const resultDiv = card.querySelector('.merge-result-preview');
            if (resultDiv) {
                const chosenContent = choice === 'local' ? fileData.localContent : fileData.remoteContent;
                if (chosenContent) {
                    const preview = Common.contentPreview(chosenContent);
                    resultDiv.innerHTML = `<span style="font-size:0.75rem;color:var(--text-muted)">Will use:</span><br><span style="font-size:0.8rem;color:var(--text-primary);font-family:monospace">${preview}</span>`;
                } else {
                    resultDiv.innerHTML = `<span style="font-size:0.8rem;color:var(--text-muted)"><em>File will be deleted</em></span>`;
                }
                resultDiv.style.display = 'block';
            }
        };

        // Auto-resolved toggle
        const autoToggle = modal.querySelector('#autoResolvedToggle');
        if (autoToggle) {
            autoToggle.addEventListener('click', () => {
                const list = modal.querySelector('#autoResolvedList');
                if (list) list.style.display = list.style.display === 'none' ? 'block' : 'none';
            });
        }

        // Full-file merge viewer (toggle + three-way tabs)
        this._wireFullFileViewer(modal, needsResolution, viewerContainers);

        // Diff toggles (show/hide compact diff)
        modal.querySelectorAll('.merge-diff-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const body = modal.querySelector('#' + btn.dataset.target);
                if (body) {
                    const showing = body.style.display === 'block';
                    body.style.display = showing ? 'none' : 'block';
                    btn.textContent = showing
                        ? btn.textContent.replace('Hide', 'Show')
                        : btn.textContent.replace('Show', 'Hide');
                }
            });
        });

        // Diff expand toggles (compact <-> full context)
        modal.querySelectorAll('.merge-diff-expand').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                const fileData = needsResolution[index];
                if (!fileData) return;
                const body = btn.closest('[id^="mergeDiff_"]');
                if (!body) return;
                const contentDiv = body.querySelector('.merge-diff-content');
                const isFull = body.dataset.fullMode === 'true';

                if (isFull) {
                    const compactDiff = this._computeLineDiff(fileData.localContent, fileData.remoteContent);
                    contentDiv.innerHTML = renderDiffLinesHtml(compactDiff);
                    body.style.maxHeight = '200px';
                    body.dataset.fullMode = 'false';
                    btn.innerHTML = '&#9660; Show all lines';
                } else {
                    const fullDiff = this._computeLineDiff(fileData.localContent, fileData.remoteContent, { noCollapse: true });
                    contentDiv.innerHTML = renderDiffLinesHtml(fullDiff);
                    body.style.maxHeight = '60vh';
                    body.dataset.fullMode = 'true';
                    btn.innerHTML = '&#9650; Collapse';
                }
            });
        });

        // Choice buttons
        modal.querySelectorAll('.conflict-choice-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.cardIndex);
                const choice = btn.dataset.choice;
                selectChoice(index, choice);
                updateResolveButton();
            });
        });

        // Bulk: keep all local
        const allLocalBtn = modal.querySelector('#conflictAllLocal');
        if (allLocalBtn) {
            allLocalBtn.addEventListener('click', () => {
                for (let i = 0; i < needsResolution.length; i++) selectChoice(i, 'local');
                updateResolveButton();
            });
        }

        // Bulk: take all remote
        const allRemoteBtn = modal.querySelector('#conflictAllRemote');
        if (allRemoteBtn) {
            allRemoteBtn.addEventListener('click', () => {
                for (let i = 0; i < needsResolution.length; i++) selectChoice(i, 'remote');
                updateResolveButton();
            });
        }

        // Cancel
        modal.querySelector('#conflictCancelBtn').addEventListener('click', () => modal.close());

        // Resolve & Sync
        modal.querySelector('#conflictResolveBtn').addEventListener('click', async () => {
            const btn = modal.querySelector('#conflictResolveBtn');
            const cancelBtn = modal.querySelector('#conflictCancelBtn');
            btn.disabled = true;
            cancelBtn.disabled = true;
            btn.textContent = 'Resolving...';

            // Apply resolutions to conflictData
            for (const f of needsResolution) {
                f.resolution = resolutions[f.filepath] || 'local';
            }

            try {
                await this._applyMergeResolution(conflictData);
                showToast('Merge resolved and synced.');
                modal.close();
            } catch (err) {
                btn.disabled = false;
                cancelBtn.disabled = false;
                btn.textContent = 'Resolve & Sync';
                alert('Failed to resolve merge: ' + err.message);
            }
        });
    },


    async _showOverwriteHelp(err) {
        if (!GitStore.git || !GitStore.fs) return;
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

            // Resolve local HEAD and merge base so we can show the base version too
            let localOid = null;
            try { localOid = await git.resolveRef({ fs, dir, ref: `refs/heads/${ref}` }); } catch (_) { /* no local ref */ }
            let baseOid = null;
            if (localOid && remoteOid) {
                baseOid = await GitStore.getMergeBase(localOid, remoteOid);
            }

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
                // Base content (common ancestor), if available
                let baseContent = null;
                if (baseOid) {
                    try { baseContent = await GitStore.getFileAtCommit(filepath, baseOid); } catch (_) { /* not in base */ }
                }
                diffs.push({ filepath, localContent, remoteContent, baseContent });
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
            filesHtml = diffs.map(({ filepath, localContent, remoteContent }, idx) => {
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
                    ${this._fullFileViewerHtml(idx, diffs[idx])}
                </div>`;
            }).join('');
        }

        const viewerContainers = [];
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
            width: '420px',
            onClose: () => {
                for (const c of viewerContainers) {
                    const v = c._diffEditorView;
                    if (v) { try { v.destroy(); } catch (_) { /* cleanup */ } }
                }
            }
        });

        // Toggle diff body on file header click
        modal.querySelectorAll('.overwrite-file-header').forEach(btn => {
            btn.addEventListener('click', () => {
                const body = modal.querySelector('#' + btn.dataset.target);
                if (body) body.style.display = body.style.display === 'none' ? 'block' : 'none';
            });
        });

        // Full-file merge viewer (toggle + three-way tabs)
        this._wireFullFileViewer(modal, diffs, viewerContainers);

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
                if (!GitStore.git || !GitStore.fs) {
                    showToast('Git not initialized. Please reopen the vault.');
                    pullBtn.disabled = false;
                    keepBtn.disabled = false;
                    return;
                }
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

                await this._postSyncRender(true);

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
                if (!GitStore.git || !GitStore.fs) {
                    showToast('Git not initialized. Please reopen the vault.');
                    keepBtn.disabled = false;
                    pullBtn.disabled = false;
                    return;
                }
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

    _computeLineDiff(localContent, remoteContent, options = {}) {
        const localLines = localContent.split('\n');
        const remoteLines = remoteContent.split('\n');
        const result = [];

        const m = localLines.length;
        const n = remoteLines.length;

        // Fall back to simple comparison for very large files (O(n*m) table)
        if (m * n > 500000) {
            return this._simpleDiff(localLines, remoteLines);
        }

        // Build full LCS table for backtracking (rolling array to halve memory)
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

        // Backtrack to produce diff using the LCS table
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

        // Skip collapsing unchanged lines when full context is requested
        if (options.noCollapse) {
            return actions;
        }

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
        const remoteCounts = new Map();
        for (const line of remoteLines) {
            remoteCounts.set(line, (remoteCounts.get(line) || 0) + 1);
        }
        for (const line of localLines) {
            const count = remoteCounts.get(line);
            if (count > 0) {
                remoteCounts.set(line, count - 1);
                result.push({ type: 'same', text: line });
            } else {
                result.push({ type: 'removed', text: line });
            }
        }
        for (const line of remoteLines) {
            if (remoteCounts.get(line) > 0) {
                result.push({ type: 'added', text: line });
                remoteCounts.set(line, remoteCounts.get(line) - 1);
            }
        }
        return result;
    },

};

window.SyncManager = SyncManager;
