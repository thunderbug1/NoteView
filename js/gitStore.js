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
