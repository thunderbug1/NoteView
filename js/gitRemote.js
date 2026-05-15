/**
 * GitRemote - Handles git remote operations (push, pull, sync)
 */

const GitRemote = {
    config: null, // { url, name, auth }
    _syncing: false,

    async init() {
        this.config = await Store.getRemoteConfig();
        if (this.config) {
            window.GitHttp.setCredentials(this.config.auth);
        }
    },

    async setRemote(name, url, auth = null) {
        if (!GitStore.git || !GitStore.fs) {
            console.error('GitRemote.setRemote: git not initialized');
            return false;
        }
        const { git, fs, dir } = GitStore;

        // Persist config BEFORE adding remote so we don't end up in partial state
        this.config = { name, url, auth };
        window.GitHttp.setCredentials(auth);
        try {
            await Store.saveRemoteConfig(this.config);
        } catch (err) {
            console.error('Failed to persist remote config:', err);
            this.config = null;
            return false;
        }

        try {
            await git.addRemote({
                fs,
                dir,
                remote: name,
                url: url,
                force: true
            });
        } catch (err) {
            console.error('Failed to add remote:', err);
            // Roll back persisted config
            this.config = null;
            try { await Store.saveRemoteConfig(null); } catch (e) { /* ignore */ }
            return false;
        }

        return true;
    },

    async push(force = false) {
        if (!this.config) throw new Error('No remote configured');
        const { git, fs, dir } = GitStore;
        const ref = (window.SyncManager && SyncManager._config?.branch) || 'main';

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
            return true;
        } catch (err) {
            console.error('Push failed:', err);
            throw err;
        }
    },

    async pull() {
        if (!this.config) throw new Error('No remote configured');
        const { git, fs, dir } = GitStore;
        const ref = (window.SyncManager && SyncManager._config?.branch) || 'main';
        const remoteName = this.config.name;

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
            return true;
        } catch (err) {
            // If pull fails due to conflict or diverged history, try hard reset to remote
            if (err instanceof Error && (err.name === 'CheckoutConflictError' || err.code === 'CheckoutConflictError' || err.message?.includes('would be overwritten'))) {
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
                            await fs.writeFile('.noteview/settings.json', localSettings);
                        } catch (e) { /* ignore */ }
                    }

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
        const { git, fs, dir } = GitStore;
        const ref = (window.SyncManager && SyncManager._config?.branch) || 'main';

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

            // Count commits ahead of remote HEAD
            const commits = await git.log({ fs, dir, depth: 500 });
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

    _getCorsProxy() {
        return (window.SyncManager && SyncManager._config.corsProxy) || undefined;
    }
};

window.GitRemote = GitRemote;
