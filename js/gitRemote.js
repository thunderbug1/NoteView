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
            await this._ensureRemoteInGitConfig();
        }
    },

    async _ensureRemoteInGitConfig() {
        if (!this.config || !this.config.name || !this.config.url) return;
        if (!GitStore.git || !GitStore.fs) return;
        const { git, fs, dir } = GitStore;
        try {
            let configContent = '';
            try {
                configContent = await fs.readFile('.git/config', { encoding: 'utf8' });
            } catch (e) { /* config may not exist yet */ }
            if (configContent.includes(`[remote "${this.config.name}"]`)) return;
            Logger.log('[GitRemote] Remote missing from .git/config, adding:', this.config.name);
            await git.addRemote({ fs, dir, remote: this.config.name, url: this.config.url, force: true });
        } catch (e) {
            console.warn('[GitRemote] Could not reconcile remote in .git/config:', e);
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
                    if (typeof showToast === 'function') {
                        showToast('Remote config is out of sync — please reconfigure in Settings.');
                    }
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
            // If pull fails due to conflict or diverged history, recover by resetting to remote.
            // Before resetting, classify the dirty state: files whose content differs from both
            // local HEAD and the fetched remote HEAD are stashed to a recovery ref so nothing
            // unique is silently destroyed. Junk state (merge leftovers matching a known commit)
            // is safe to reset without stashing.
            if (err instanceof Error && (err.name === 'CheckoutConflictError' || err.code === 'CheckoutConflictError' || err.message?.includes('would be overwritten'))) {
                Logger.log('Pull conflict detected, classifying dirty state before reset');
                try {
                    await git.fetch({
                        fs, dir,
                        http: window.GitHttp,
                        remote: remoteName,
                        corsProxy: this._getCorsProxy(),
                        onAuth: () => this.config.auth
                    });
                    const remoteRef = `refs/remotes/${remoteName}/${ref}`;
                    const commitOid = await git.resolveRef({ fs, dir, ref: remoteRef });

                    let localOid = null;
                    try {
                        localOid = await git.resolveRef({ fs, dir, ref: `refs/heads/${ref}` });
                    } catch (e) { /* no local HEAD */ }

                    const uniqueFiles = await this._findUniqueDirtyFiles(localOid, commitOid);
                    let stashRef = null;
                    if (uniqueFiles.length > 0) {
                        stashRef = await this._stashDirtyFiles(uniqueFiles, `noteview: recovery stash ${new Date().toISOString()}`, ref);
                        Logger.log('Pull conflict: stashed unique local edits to', stashRef);
                    }

                    // Preserve local settings before force checkout
                    let localSettings = null;
                    try {
                        localSettings = await fs.readFile('.noteview/settings.json', { encoding: 'utf8' });
                    } catch (e) { /* may not exist */ }

                    await git.writeRef({ fs, dir, ref: `refs/heads/${ref}`, value: commitOid, force: true });
                    await git.checkout({ fs, dir, ref, force: true });

                    // Restore local settings if they existed before
                    if (localSettings) {
                        try {
                            await fs.writeFile('.noteview/settings.json', localSettings, { encoding: 'utf8' });
                        } catch (e) { /* ignore */ }
                    }

                    Logger.log('Hard reset to remote successful');
                    return { recovered: true, stashed: !!stashRef, stashRef };
                } catch (resetErr) {
                    console.error('Hard reset also failed:', resetErr);
                    throw resetErr;
                }
            }
            Logger.log('Pull failed (caller will handle):', err.message);
            throw err;
        }
    },

    /**
     * Find dirty working-tree files whose content differs from both local HEAD
     * and the fetched remote HEAD — i.e. edits that a hard reset would destroy.
     * Files matching either known commit are junk state (safe to reset), and
     * deletions are treated as intentional (reset restores remote state).
     * Comparison is done on blob oids (via git.hashBlob of the workdir content)
     * so binary files are handled correctly and no content decoding is needed.
     * @returns {Promise<string[]>} filepaths with unique local content
     */
    async _findUniqueDirtyFiles(localOid, remoteOid) {
        const { git, fs, dir } = GitStore;
        const unique = [];
        try {
            const matrix = await git.statusMatrix({ fs, dir, filepaths: ['.'] });

            // Flat path → blob oid maps per commit, built once and cached.
            // Recurses into subtrees so notes in subfolders compare correctly.
            const treeMaps = {};
            const getCommitTreeMap = async (commitOid) => {
                if (!commitOid) return null;
                if (treeMaps[commitOid]) return treeMaps[commitOid];
                const map = {};
                try {
                    const commit = await git.readCommit({ fs, dir, oid: commitOid });
                    const walk = async (treeOid, prefix) => {
                        const { tree } = await git.readTree({ fs, dir, oid: treeOid });
                        for (const entry of tree) {
                            const path = prefix ? `${prefix}/${entry.path}` : entry.path;
                            if (entry.type === 'tree') await walk(entry.oid, path);
                            else if (entry.type === 'blob') map[path] = entry.oid;
                        }
                    };
                    await walk(commit.commit.tree, '');
                } catch (e) { /* treat as empty tree */ }
                treeMaps[commitOid] = map;
                return map;
            };

            for (const [filepath, head, workdir] of matrix) {
                if (head === 1 && workdir === 1) continue;      // unchanged
                if (workdir === 0) continue;                     // deleted locally — intentional

                let workdirContent = null;
                try {
                    workdirContent = await fs.readFile(`${dir}/${filepath}`);
                } catch (e) { continue; }

                let workdirOid = null;
                try {
                    workdirOid = (await git.hashBlob({ object: workdirContent })).oid;
                } catch (e) { continue; }

                let matchesKnown = false;
                for (const commitOid of [localOid, remoteOid]) {
                    const map = await getCommitTreeMap(commitOid);
                    if (map && map[filepath] === workdirOid) { matchesKnown = true; break; }
                }
                if (!matchesKnown) unique.push(filepath);
            }
        } catch (e) {
            // If classification itself fails, assume everything dirty is unique — safest option
            console.warn('[GitRemote] dirty-state classification failed, stashing conservatively:', e);
            try {
                const matrix = await git.statusMatrix({ fs, dir, filepaths: ['.'] });
                for (const [filepath, head, workdir] of matrix) {
                    if (workdir !== 0 && (head !== 1 || workdir !== 1)) unique.push(filepath);
                }
            } catch (e2) { /* nothing more we can do */ }
        }
        return unique;
    },

    /**
     * Commit dirty files to a recovery ref (refs/noteview/recovery/<timestamp>)
     * so they survive the hard reset that follows. isomorphic-git has no GC,
     * so the objects remain readable until the ref is deleted after recovery.
     *
     * git.commit() advances the current branch to the stash commit, so the
     * branch ref is captured and immediately restored afterwards — the stash
     * stays reachable through the recovery ref. If anything crashes before the
     * restore, the branch is left on its original commit (a clean state) rather
     * than accidentally publishing the stash contents via a later pull/merge.
     *
     * @param {string[]} filepaths dirty files to preserve
     * @param {string} message commit message for the stash
     * @param {string} [branch] branch whose ref should be restored after the stash commit
     * @returns {Promise<string>} the recovery ref name
     */
    async _stashDirtyFiles(filepaths, message, branch) {
        const { git, fs, dir } = GitStore;
        let branchOid = null;
        if (branch) {
            try { branchOid = await git.resolveRef({ fs, dir, ref: `refs/heads/${branch}` }); } catch (e) {}
        }
        for (const filepath of filepaths) {
            await git.add({ fs, dir, filepath });
        }
        const sha = await git.commit({
            fs, dir,
            author: GitStore.author,
            message
        });
        const ref = `refs/noteview/recovery/${Date.now()}`;
        await git.writeRef({ fs, dir, ref, value: sha, force: true });
        if (branchOid) {
            await git.writeRef({ fs, dir, ref: `refs/heads/${branch}`, value: branchOid, force: true });
        }
        return ref;
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
        return (window.SyncManager ? SyncManager._config?.corsProxy : undefined) || undefined;
    }
};

window.GitRemote = GitRemote;
