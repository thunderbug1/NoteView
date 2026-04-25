/**
 * GitRemote - Handles git remote operations (push, pull, sync)
 */

const GitRemote = {
    config: null, // { url, name, auth }

    async init() {
        this.config = await Store.getRemoteConfig();
        if (this.config) {
            console.log('GitRemote initialized with config:', this.config.name);
        }
    },

    async setRemote(name, url, auth = null) {
        this.config = { name, url, auth };
        await Store.saveRemoteConfig(this.config);

        // Add remote to local git
        if (!GitStore.git || !GitStore.fs) {
            console.error('GitRemote.setRemote: git not initialized');
            return false;
        }
        const { git, fs, dir } = GitStore;
        try {
            await git.addRemote({
                fs,
                dir,
                remote: name,
                url: url,
                force: true
            });
            return true;
        } catch (err) {
            console.error('Failed to add remote:', err);
            return false;
        }
    },

    async push() {
        if (!this.config) throw new Error('No remote configured');
        const { git, fs, dir } = GitStore;
        const ref = (window.SyncManager && SyncManager._config.branch) || 'main';

        try {
            await git.push({
                fs,
                dir,
                http: window.GitHttp,
                remote: this.config.name,
                ref,
                corsProxy: this._getCorsProxy(),
                onAuth: () => this.config.auth
            });
            console.log('Push successful');
            return true;
        } catch (err) {
            console.error('Push failed:', err);
            throw err;
        }
    },

    async pull() {
        if (!this.config) throw new Error('No remote configured');
        const { git, fs, dir } = GitStore;
        const ref = (window.SyncManager && SyncManager._config.branch) || 'main';
        const remoteName = this.config.name;

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
            console.log('Pull successful');
            await this._afterPull();
            return true;
        } catch (err) {
            // Fresh local repo has no branch to merge into — fetch and checkout manually
            const msg = (err.message || '').toLowerCase();
            if (msg.includes('could not find')) {
                console.log('Pull: local branch missing, fetching and checking out from remote');
                await git.fetch({
                    fs, dir,
                    http: window.GitHttp,
                    remote: remoteName,
                    ref,
                    corsProxy: this._getCorsProxy(),
                    onAuth: () => this.config.auth,
                    singleBranch: true
                });
                // Point local branch at the fetched remote ref
                const remoteRef = `refs/remotes/${remoteName}/${ref}`;
                const commitOid = await git.resolveRef({ fs, dir, ref: remoteRef });
                await git.writeRef({ fs, dir, ref: `refs/heads/${ref}`, value: commitOid, force: true });
                await git.checkout({ fs, dir, ref });
                console.log('Checkout from remote successful');
                await this._afterPull();
                return true;
            }
            console.error('Pull failed:', err);
            throw err;
        }
    },

    async _afterPull() {
        await Store.loadBlocks();
        TimelineView.invalidateRawDataCache();
        TimelineView.invalidateCache();
    },

    async sync() {
        try {
            await this.pull();
            await this.push();
            return true;
        } catch (err) {
            console.error('Sync failed:', err);
            throw err;
        }
    },

    async getStatus() {
        if (!this.config) return { hasRemote: false };
        const { git, fs, dir } = GitStore;
        const ref = (window.SyncManager && SyncManager._config.branch) || 'main';

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

            // Simple count of commits ahead
            const commits = await git.log({ fs, dir, depth: 50 });
            let unpushed = 0;
            for (const commit of commits) {
                if (commit.oid === remoteHead) break;
                unpushed++;
            }

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
