const GitStore = {
    fs: null,
    git: null,
    dir: '/',
    author: {
        name: 'NoteView User',
        email: 'user@noteview.local'
    },
    
    async init(directoryHandle) {
        if (!window.git) {
            console.error('isomorphic-git not loaded');
            return false;
        }
        
        this.git = window.git;
        
        // Initialize our FS wrapper
        const adapter = new window.GitFSAdapter(directoryHandle);
        this.fs = adapter.promises;
        
        try {
            await this.git.init({ fs: this.fs, dir: this.dir });
            console.log('Git initialized successfully');
            return true;
        } catch (err) {
            console.error('Failed to init Git:', err);
            return false;
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
            console.log(`Committed ${filename} as ${sha}`);
            return sha;
        } catch (err) {
            console.error(`Failed to commit ${filename}:`, err);
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
    
    async getFullHistory(maxCount = 200) {
        if (!this.git || !this.fs) return [];
        
        try {
            const commits = await this.git.log({
                fs: this.fs,
                dir: this.dir,
                depth: maxCount
            });
            
            return commits.map(c => ({
                oid: c.oid,
                message: c.commit.message,
                timestamp: c.commit.author.timestamp * 1000,
                author: c.commit.author.name,
                parents: c.commit.parent
            }));
        } catch (err) {
            console.error('Failed to get full history:', err);
            return [];
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
