const GitStore = {
    fs: null,
    git: null,
    dir: '/',
    author: {
        name: 'NoteView User',
        email: 'user@noteview.local'
    },
    _gitLoading: null,
    
    async _loadGitLibs() {
        if (window.git && window.GitHttp) {
            return;
        }

        if (this._gitLoading) {
            return this._gitLoading;
        }

        this._gitLoading = (async () => {
            try {
                await this._loadScript('vendor/isomorphic-git.js');
                await this._loadScript('vendor/isomorphic-git-http.js');
                this._gitLoading = null;
                console.log('Git libraries loaded successfully');
            } catch (err) {
                this._gitLoading = null;
                throw err;
            }
        })();

        return this._gitLoading;
    },

    async _loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            
            const timeout = setTimeout(() => {
                reject(new Error(`Timeout loading ${src}`));
            }, 10000);

            script.onload = () => {
                clearTimeout(timeout);
                resolve();
            };

            script.onerror = () => {
                clearTimeout(timeout);
                reject(new Error(`Failed to load ${src}`));
            };

            document.head.appendChild(script);
        });
    },
    
    async init(directoryHandle) {
        // Lazy load git libraries
        await this._loadGitLibs();
        
        if (!window.git) {
            console.error('isomorphic-git not loaded');
            return false;
        }
        
        this.git = window.git;
        
        // Initialize our FS wrapper
        const adapter = new window.GitFSAdapter(directoryHandle);
        this.fs = adapter.promises;
        
        try {
            await this.git.init({ fs: this.fs, dir: this.dir, defaultBranch: 'main' });
            Logger.log('Git initialized successfully');
            return true;
        } catch (err) {
            console.error('Failed to init Git:', err);
            return false;
        }
    },
    
    async commitAll(message = 'Full sync') {
        if (!this.git || !this.fs) return;
        try {
            const entries = await this.fs.readdir(this.dir);
            const errors = [];
            for (const name of entries) {
                if (name.endsWith('.md') || name === '.noteview') {
                    try {
                        const stat = await this.fs.stat(`${this.dir}/${name}`);
                        if (stat.isFile()) {
                            await this.git.add({ fs: this.fs, dir: this.dir, filepath: name });
                        } else if (stat.isDirectory() && name === '.noteview') {
                            const subEntries = await this.fs.readdir(`${this.dir}/${name}`);
                            for (const sub of subEntries) {
                                if (sub.endsWith('.json') && sub !== 'keys.json') {
                                    await this.git.add({ fs: this.fs, dir: this.dir, filepath: `${name}/${sub}` });
                                }
                            }
                        }
                    } catch (e) {
                        errors.push({ name, message: e.message });
                        console.warn('gitStore.commitAll: failed to stage', name, e.message);
                    }
                }
            }
            if (errors.length > 0) {
                console.warn('gitStore.commitAll: some files could not be staged, proceeding with commit:', errors.map(e => e.name));
            }
            const sha = await this.git.commit({
                fs: this.fs, dir: this.dir, author: this.author, message
            });
            Logger.log('Commit all as ' + sha);
            return sha;
        } catch (err) {
            console.error('Failed to commit all:', err);
            throw err;
        }
    },

    async commitBlock(filename, message = 'Update note') {
        if (!this.git || !this.fs || !filename) return;

        try {
            await this.git.add({ fs: this.fs, dir: this.dir, filepath: filename });
            const sha = await this.git.commit({
                fs: this.fs,
                dir: this.dir,
                author: this.author,
                message: message
            });
            Logger.log('Committed ' + filename + ' as ' + sha);
            return sha;
        } catch (err) {
            console.error(`Failed to commit ${filename}:`, err);
            return null;
        }
    },

    async commitDeletion(filename, message = 'Delete note') {
        if (!this.git || !this.fs || !filename) return;

        try {
            await this.git.remove({ fs: this.fs, dir: this.dir, filepath: filename });
            const sha = await this.git.commit({
                fs: this.fs,
                dir: this.dir,
                author: this.author,
                message: message
            });
            Logger.log('Committed deletion of ' + filename + ' as ' + sha);
            return sha;
        } catch (err) {
            console.error(`Failed to commit deletion of ${filename}:`, err);
            return null;
        }
    },
    
    async getHistory(filename) {
        if (!this.git || !this.fs || !filename) return [];
        
        try {
            const commits = await this.git.log({
                fs: this.fs,
                dir: this.dir,
                filepath: filename
            });
            
            return commits.map(c => ({
                oid: c.oid,
                message: c.commit.message,
                timestamp: c.commit.author.timestamp * 1000,
                author: c.commit.author.name
            }));
        } catch (err) {
            // Might not have history yet, that's fine
            return [];
        }
    },
    
    async getFileAtCommit(filename, oid) {
        if (!this.git || !this.fs) return null;
        
        try {
            const commit = await this.git.readCommit({
                fs: this.fs,
                dir: this.dir,
                oid: oid
            });
            
            const treeOid = commit.commit.tree;
            
            // Walk the tree
            const tree = await this.git.readTree({ fs: this.fs, dir: this.dir, oid: treeOid });
            const entry = tree.tree.find(e => e.path === filename);
            if (!entry) return null;
            
            const { blob } = await this.git.readBlob({
                fs: this.fs,
                dir: this.dir,
                oid: entry.oid
            });
            
            return new TextDecoder().decode(blob);
        } catch (err) {
            console.error('Failed to get file at commit:', err);
            return null;
        }
    },
    
    async getFullHistory(maxCount, ref) {
        if (!this.git || !this.fs) return [];

        try {
            const logOpts = { fs: this.fs, dir: this.dir };
            if (maxCount) logOpts.depth = maxCount;
            if (ref) logOpts.ref = ref;
            console.log('[gitStore] getFullHistory called', { maxCount, depth: logOpts.depth, ref: logOpts.ref, dir: this.dir });
            const commits = await this.git.log(logOpts);
            console.log('[gitStore] getFullHistory result', { requestedDepth: maxCount, returned: commits.length });

            // If depth was requested but we got fewer commits, and we're not using
            // a ref (i.e. walking from HEAD), try without depth to get the full count.
            // This works around potential issues with the depth parameter in some
            // versions of isomorphic-git.
            if (maxCount && maxCount > commits.length && !ref) {
                const allLogOpts = { fs: this.fs, dir: this.dir };
                const allCommits = await this.git.log(allLogOpts);
                console.log('[gitStore] getFullHistory unlimited fallback', { withDepth: commits.length, withoutDepth: allCommits.length });
                if (allCommits.length > commits.length) {
                    return allCommits.map(c => ({
                        oid: c.oid,
                        message: c.commit.message,
                        timestamp: c.commit.author.timestamp * 1000,
                        author: c.commit.author.name,
                        parents: c.commit.parent
                    }));
                }
            }
            
            return commits.map(c => ({
                oid: c.oid,
                message: c.commit.message,
                timestamp: c.commit.author.timestamp * 1000,
                author: c.commit.author.name,
                parents: c.commit.parent
            }));
        } catch (err) {
            console.warn('Failed to get full history:', err);
            return [];
        }
    },

    async getCommit(oid) {
        if (!this.git || !this.fs || !oid) return null;

        try {
            const commit = await this.git.readCommit({
                fs: this.fs,
                dir: this.dir,
                oid
            });
            
            return {
                oid: commit.oid,
                message: commit.commit.message,
                timestamp: commit.commit.author.timestamp * 1000,
                author: commit.commit.author.name,
                parents: commit.commit.parent
            };
        } catch (err) {
            console.warn(`Failed to get commit ${oid}:`, err);
            return null;
        }
    },
    
    /**
     * Get only the .md files that changed between two commits.
     * Uses git.walk() with two TREE walkers for efficient diffing.
     * Returns { filename: content } for changed/added files.
     */
    async getChangedFilesBetween(parentOid, childOid) {
        if (!this.git || !this.fs) return null;

        const { walk, TREE } = this.git;

        try {
            const changedFiles = await walk({
                fs: this.fs,
                dir: this.dir,
                trees: [
                    TREE({ ref: parentOid }),
                    TREE({ ref: childOid })
                ],
                map: async (filepath, [parentEntry, childEntry]) => {
                    if (!filepath.endsWith('.md')) return;
                    if (filepath.includes('/')) return;

                    const parentBlobOid = parentEntry ? await parentEntry.oid() : null;
                    const childBlobOid = childEntry ? await childEntry.oid() : null;

                    // Same OID means file unchanged — skip
                    if (parentBlobOid === childBlobOid) return;

                    // File added or modified — read content from child commit
                    if (childEntry) {
                        const type = await childEntry.type();
                        if (type === 'blob') {
                            const content = await childEntry.content();
                            return [filepath, new TextDecoder().decode(content)];
                        }
                    }

                    // File deleted — return null marker
                    if (parentEntry && !childEntry) {
                        return [filepath, null];
                    }
                },
                reduce: async (parent, children) => {
                    // Keep nulls (file deletions), only drop undefined (skipped entries)
                    return [parent, children].flat().filter(x => x !== undefined);
                }
            });

            const result = {};
            for (const entry of changedFiles || []) {
                if (!Array.isArray(entry) || entry.length < 2) continue;
                const [filepath, content] = entry;
                if (typeof filepath === 'string') {
                    result[filepath] = content;
                }
            }
            return result;
        } catch (err) {
            console.warn('walk-based diff failed, falling back to full read:', err);
            return null;
        }
    },

    async getMergeBase(localOid, remoteOid) {
        if (!this.git || !this.fs) return null;
        try {
            return await this.git.findMergeBase({
                fs: this.fs,
                dir: this.dir,
                oids: [localOid, remoteOid]
            });
        } catch (err) {
            console.warn('Failed to find merge base:', err);
            return null;
        }
    },

    async getAllFilesAtCommit(oid) {
        if (!this.git || !this.fs) return {};
        
        try {
            const commit = await this.git.readCommit({
                fs: this.fs,
                dir: this.dir,
                oid: oid
            });
            
            const treeOid = commit.commit.tree;
            const tree = await this.git.readTree({ fs: this.fs, dir: this.dir, oid: treeOid });
            
            const files = {};
            for (const entry of tree.tree) {
                if (entry.path.endsWith('.md') && entry.type === 'blob') {
                    try {
                        const { blob } = await this.git.readBlob({
                            fs: this.fs,
                            dir: this.dir,
                            oid: entry.oid
                        });
                        files[entry.path] = new TextDecoder().decode(blob);
                    } catch (e) {
                        // skip unreadable blobs
                    }
                }
            }
            return files;
        } catch (err) {
            console.error('Failed to get files at commit:', err);
            return {};
        }
    }
};

window.GitStore = GitStore;
