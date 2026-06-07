/**
 * GitRemote - Handles git remote operations (push, pull, sync)
 */

const GitRemote = {
    config: null, // { url, name, auth }
    _syncing: false,

    async init() {
        await GitStore._loadGitLibs();
        this.config = await Store.getRemoteConfig();
        if (this.config) {
            window.GitHttp.setCredentials(this.config.auth);
            Logger.log('GitRemote initialized with config:', this.config.name);
        }
    },

    async setRemote(name, url, auth = null) {
        if (!GitStore.git || !GitStore.fs) {
            console.error('GitRemote.setRemote: git not initialized');
            return false;
        }
        const { git, fs, dir } = GitStore;

        // Validate parameters
        if (!name || !url) {
            console.error('GitRemote.setRemote: name and url are required');
            return false;
        }

        // Validate URL format
        if (!url.startsWith('https://')) {
            console.error('GitRemote.setRemote: URL must use HTTPS');
            return false;
        }

        // Backup current config for rollback
        const previousConfig = this.config ? { ...this.config } : null;

        try {
            // 1. Test connection first (if auth provided)
            if (auth && auth.password) {
                try {
                    await git.fetch({
                        fs, dir,
                        http: window.GitHttp,
                        remote: name,
                        url: url,
                        corsProxy: this._getCorsProxy(),
                        onAuth: () => auth,
                        singleBranch: true,
                        depth: 1
                    });
                } catch (fetchErr) {
                    const msg = (fetchErr.message || '').toLowerCase();
                    if (msg.includes('401') || msg.includes('unauthorized')) {
                        throw new Error('Authentication failed. Please verify your username and Personal Access Token (PAT).');
                    } else if (msg.includes('404') || msg.includes('not found')) {
                        throw new Error('Repository not found. Double check the HTTPS URL.');
                    } else if (msg.includes('cors') || msg.includes('fetch') || msg.includes('networkerror')) {
                        throw new Error('Network or CORS error. Check your CORS proxy configuration.');
                    }
                    // If it's a "branch not found" error, that's OK for new repos
                    if (!msg.includes('not found') || !msg.includes('branch')) {
                        throw fetchErr;
                    }
                }
            }

            // 2. Persist config BEFORE adding remote so we don't end up in partial state
            const configBefore = this.config;
            this.config = { name, url, auth };
            window.GitHttp.setCredentials(auth);
            try {
                await Store.saveRemoteConfig(this.config);
            } catch (persistErr) {
                this.config = configBefore;
                window.GitHttp.setCredentials(configBefore?.auth);
                console.error('Failed to persist remote config:', persistErr);
                return false;
            }

            // 3. Add remote (atomic operation)
            try {
                await git.addRemote({
                    fs,
                    dir,
                    remote: name,
                    url: url,
                    force: true
                });
            } catch (addErr) {
                // Roll back persisted config if addRemote fails
                console.error('Failed to add remote after config persisted, rolling back:', addErr);
                try {
                    await Store.saveRemoteConfig(previousConfig);
                    this.config = previousConfig;
                } catch (rollbackErr) {
                    console.error('Rollback failed, manual intervention may be needed:', rollbackErr);
                }
                return false;
            }

            return true;
        } catch (err) {
            console.error('Failed to set remote:', err);
            this.config = previousConfig;
            window.GitHttp.setCredentials(previousConfig?.auth || null);
            throw err;
        }
    },

    async push(force = false) {
        if (!this.config) throw new Error('No remote configured');
        if (!this.config.name || typeof this.config.name !== 'string') {
            throw new Error('Remote name is invalid or missing. Please reconfigure your git remote in Settings.');
        }
        if (!GitStore.git || !GitStore.fs) throw new Error('Git not initialized');
        const { git, fs, dir } = GitStore;
        const ref = (window.SyncManager && SyncManager._config?.branch) || 'main';

        await this._ensureCorrectBranch();

        try {
            await git.push({
                fs,
                dir,
                http: window.GitHttp,
                remote: this.config.name,
                ref,
                force,
                corsProxy: this._getCorsProxy(),
                onAuth: () => this.config.auth
            });
            Logger.log('Push successful');
            return true;
        } catch (err) {
            console.error('Push failed:', err);
            throw err;
        }
    },

    async pull() {
        if (!this.config) throw new Error('No remote configured');
        if (!this.config.name || typeof this.config.name !== 'string') {
            throw new Error('Remote name is invalid or missing. Please reconfigure your git remote in Settings.');
        }
        if (!GitStore.git || !GitStore.fs) throw new Error('Git not initialized');
        const { git, fs, dir } = GitStore;
        const ref = (window.SyncManager && SyncManager._config?.branch) || 'main';
        const remoteName = this.config.name;

        await this._ensureCorrectBranch();

        // Check if local branch exists (fresh repos have none)
        let hasLocalBranch = false;
        try {
            await git.resolveRef({ fs, dir, ref: `refs/heads/${ref}` });
            hasLocalBranch = true;
        } catch (e) {
            if (!(e.code === 'NotFoundError' || e.message?.includes('Could not resolve'))) throw e;
        }

        if (!hasLocalBranch) {
            // Read local settings before fresh checkout so we can restore on failure
            let localSettings = null;
            try {
                localSettings = await fs.readFile('.noteview/settings.json', { encoding: 'utf8' });
            } catch (e) { /* may not exist */ }
            try { await fs.unlink('.noteview/settings.json'); } catch (e) { /* may not exist */ }
            Logger.log('Pull: no local branch, fetching and checking out from remote');
            try {
                await git.fetch({
                    fs, dir,
                    http: window.GitHttp,
                    remote: remoteName,
                    corsProxy: this._getCorsProxy(),
                    onAuth: () => this.config.auth
                });
                const remoteRef = `refs/remotes/${remoteName}/${ref}`;
                let commitOid;
                try {
                    commitOid = await git.resolveRef({ fs, dir, ref: remoteRef });
                } catch (e) {
                    throw new Error(`Remote branch '${ref}' not found. Push some commits first.`);
                }
                await git.writeRef({ fs, dir, ref: `refs/heads/${ref}`, value: commitOid, force: true });
                await git.checkout({ fs, dir, ref, force: true });
                Logger.log('Checkout from remote successful');
                return true;
            } catch (checkoutError) {
                // Restore local settings if checkout failed
                if (localSettings !== null) {
                    try { await fs.writeFile('.noteview/settings.json', localSettings, { encoding: 'utf8' }); } catch (e) { /* best effort */ }
                }
                throw checkoutError;
            }
        }

        try {
            await git.pull({
                fs,
                dir,
                http: window.GitHttp,
                remote: remoteName,
                ref,
                author: GitStore.author,
                corsProxy: this._getCorsProxy(),
                onAuth: () => this.config.auth,
                fastForward: true,
                singleBranch: true
            });
            Logger.log('Pull successful');
            return true;
        } catch (err) {
            // If pull fails due to conflict or diverged history, try hard reset to remote
            if (err instanceof Error && (err.name === 'CheckoutConflictError' || err.code === 'CheckoutConflictError' || err.message?.includes('would be overwritten'))) {
                Logger.log('Pull conflict detected, attempting hard reset to remote');
                try {
                    // Preserve local settings before force checkout
                    let localSettings = null;
                    try {
                        localSettings = await fs.readFile('.noteview/settings.json', { encoding: 'utf8' });
                    } catch (e) { /* may not exist */ }

                    await git.fetch({
                        fs, dir,
                        http: window.GitHttp,
                        remote: remoteName,
                        corsProxy: this._getCorsProxy(),
                        onAuth: () => this.config.auth
                    });
                    const remoteRef = `refs/remotes/${remoteName}/${ref}`;
                    const commitOid = await git.resolveRef({ fs, dir, ref: remoteRef });
                    await git.writeRef({ fs, dir, ref: `refs/heads/${ref}`, value: commitOid, force: true });
                    await git.checkout({ fs, dir, ref, force: true });

                    // Restore local settings if they existed before
                    if (localSettings) {
                        try {
                            await fs.writeFile('.noteview/settings.json', localSettings, { encoding: 'utf8' });
                        } catch (e) { /* ignore */ }
                    }

                    Logger.log('Hard reset to remote successful');
                    return true;
                } catch (resetErr) {
                    console.error('Hard reset also failed:', resetErr);
                    throw resetErr;
                }
            }
            console.error('Pull failed:', err);
            throw err;
        }
    },

    async sync() {
        if (this._syncing) return false;
        this._syncing = true;
        try {
            await this.pull();
            await this.push();
            return true;
        } catch (err) {
            console.error('Sync failed:', err);
            throw err;
        } finally {
            this._syncing = false;
        }
    },

    async getStatus() {
        if (!this.config) return { hasRemote: false };
        if (!GitStore.git || !GitStore.fs) return { hasRemote: false };
        const { git, fs, dir } = GitStore;
        const ref = (window.SyncManager && SyncManager._config?.branch) || 'main';

        await this._ensureCorrectBranch();

        try {
            const head = await git.resolveRef({ fs, dir, ref: 'HEAD' });
            let remoteHead;
            try {
                remoteHead = await git.resolveRef({ fs, dir, ref: `refs/remotes/${this.config.name}/${ref}` });
            } catch (e) {
                // Remote tracking branch might not exist yet. Try to fetch first?
                // For now just return unknown as before.
                return { hasRemote: true, unpushed: 'unknown' };
            }

            if (head === remoteHead) {
                return { hasRemote: true, unpushed: 0 };
            }

            // Count commits ahead of remote HEAD - use smaller depth for performance
            const commits = await git.log({ fs, dir, depth: 100 });
            let unpushed = 0;
            let foundRemote = false;
            for (const commit of commits) {
                if (commit.oid === remoteHead) { foundRemote = true; break; }
                unpushed++;
            }
            if (!foundRemote) unpushed = commits.length;

            return { hasRemote: true, unpushed };
        } catch (err) {
            console.error('Failed to get sync status:', err);
            return { hasRemote: true, error: err.message };
        }
    },

    async _ensureCorrectBranch() {
        if (!GitStore.git || !GitStore.fs) return;
        const { git, fs, dir } = GitStore;
        const ref = (window.SyncManager && SyncManager._config?.branch) || 'main';

        // Check if the configured branch already exists locally
        try {
            await git.resolveRef({ fs, dir, ref: `refs/heads/${ref}` });
            return; // Configured branch already exists, nothing to do
        } catch (e) {
            // Configured branch does not exist locally
        }

        // If the configured branch is not found, try to rename the other default branch.
        if (ref === 'main') {
            await this._renameBranch('master', 'main');
        } else if (ref === 'master') {
            await this._renameBranch('main', 'master');
        }
    },

    async _renameBranch(fromBranch, toBranch) {
        if (!GitStore.git || !GitStore.fs) return false;
        const { git, fs, dir } = GitStore;
        try {
            const fromOid = await git.resolveRef({ fs, dir, ref: `refs/heads/${fromBranch}` });
            Logger.log(`[GitRemote] Found local '${fromBranch}' branch, renaming to '${toBranch}'...`);
            await git.writeRef({ fs, dir, ref: `refs/heads/${toBranch}`, value: fromOid, force: true });
            await git.writeRef({ fs, dir, ref: 'HEAD', value: `refs/heads/${toBranch}`, symbolic: true, force: true });
            await git.deleteRef({ fs, dir, ref: `refs/heads/${fromBranch}` });
            Logger.log(`[GitRemote] Local branch '${fromBranch}' renamed to '${toBranch}'.`);
            return true;
        } catch (e) {
            return false;
        }
    },

    _getCorsProxy() {
        return (window.SyncManager && SyncManager._config.corsProxy) || undefined;
    }
};

window.GitRemote = GitRemote;
