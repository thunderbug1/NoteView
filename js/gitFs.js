/**
 * A partial fs-promises implementation over the File System Access API
 * tailored specifically for isomorphic-git.
 */
class GitFSAdapter {
    constructor(rootHandle) {
        this.rootHandle = rootHandle;
    }

    // Resolves a path like "dir/file.txt" to a FileSystemHandle
    async _resolvePath(path, create = false, isFile = true) {
        if (!path || path === '/' || path === '.') return this.rootHandle;

        const parts = path.split('/').filter(p => p);
        let currentHandle = this.rootHandle;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isLast = i === parts.length - 1;

            if (isLast && isFile) {
                try {
                    return await currentHandle.getFileHandle(part, { create });
                } catch (e) {
                    if (e.name === 'NotFoundError' || e.name === 'TypeMismatchError') {
                        throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' });
                    }
                    throw e;
                }
            } else {
                try {
                    currentHandle = await currentHandle.getDirectoryHandle(part, { create });
                } catch (e) {
                    if (e.name === 'NotFoundError' || e.name === 'TypeMismatchError') {
                        throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' });
                    }
                    throw e;
                }
            }
        }
        return currentHandle;
    }

    get promises() {
        const self = this;
        return {
            async read(path, options) {
                const handle = await self._resolvePath(path, false, true);
                const file = await handle.getFile();
                // Support byte-range reads for pack file slicing
                if (options && (options.offset !== undefined || options.length !== undefined)) {
                    const start = options.offset || 0;
                    const end = options.length ? start + options.length : undefined;
                    const slice = file.slice(start, end);
                    const buffer = await slice.arrayBuffer();
                    console.log('[GitFS] read range', { path, offset: start, length: options.length, size: buffer.byteLength });
                    return new Uint8Array(buffer);
                }
                // Full file read
                const buffer = await file.arrayBuffer();
                const uint8 = new Uint8Array(buffer);
                if (typeof options === 'string') options = { encoding: options };
                if (options?.encoding === 'utf8') {
                    return new TextDecoder().decode(uint8);
                }
                if (path.includes('/pack/') || path.includes('/objects/')) {
                    console.log('[GitFS] readFile (git object)', { path, size: buffer.byteLength });
                }
                return uint8;
            },

            async readFile(path, options) {
                const handle = await self._resolvePath(path, false, true);
                const file = await handle.getFile();
                const buffer = await file.arrayBuffer();
                const uint8 = new Uint8Array(buffer);
                
                if (typeof options === 'string') options = { encoding: options };
                if (options?.encoding === 'utf8') {
                    return new TextDecoder().decode(uint8);
                }
                if (path.includes('/objects/')) {
                    console.log('[GitFS] readFile object', { path, size: buffer.byteLength });
                }
                return uint8;
            },

            async writeFile(path, data, options) {
                let writable;
                try {
                    const handle = await self._resolvePath(path, true, true);
                    writable = await handle.createWritable();
                    await writable.write(data);
                    await writable.close();
                } catch (e) {
                    if (writable) {
                        try { await writable.abort(); } catch (abortErr) { /* ignore */ }
                    }
                    if (e.name === 'NotFoundError') {
                        throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' });
                    }
                    throw e;
                }
            },

            async stat(path) {
                if (!path || path === '/' || path === '.') {
                    const now = new Date();
                    return {
                        ctime: now,
                        mtime: now,
                        ctimeSeconds: Math.floor(now.valueOf() / 1000),
                        mtimeSeconds: Math.floor(now.valueOf() / 1000),
                        dev: 0, ino: 0, mode: 0o40777, nlink: 1,
                        uid: 0, gid: 0, rdev: 0, size: 0,
                        blksize: 4096, blocks: 0,
                        isDirectory: () => true,
                        isFile: () => false,
                        isSymbolicLink: () => false
                    };
                }

                let handle;
                let isDir = false;
                try {
                    handle = await self._resolvePath(path, false, true);
                } catch (e) {
                    if (e.code === 'ENOENT') {
                        try {
                            handle = await self._resolvePath(path, false, false);
                            isDir = true;
                        } catch (e2) {
                            throw e; // original file error
                        }
                    } else {
                        throw e;
                    }
                }

                let size = 0;
                let mtime = Date.now();
                if (!isDir) {
                    try {
                        const file = await handle.getFile();
                        size = file.size;
                        mtime = file.lastModified;
                    } catch (e) {
                        if (e.name === 'NotFoundError') {
                            throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${path}'`), { code: 'ENOENT' });
                        }
                        throw e;
                    }
                }

                return {
                    ctime: new Date(mtime),
                    mtime: new Date(mtime),
                    ctimeSeconds: Math.floor(mtime / 1000),
                    mtimeSeconds: Math.floor(mtime / 1000),
                    dev: 0, ino: 0,
                    mode: isDir ? 0o40777 : 0o100666,
                    nlink: 1, uid: 0, gid: 0, rdev: 0,
                    size, blksize: 4096, blocks: Math.ceil(size / 512),
                    isDirectory: () => isDir,
                    isFile: () => !isDir,
                    isSymbolicLink: () => false
                };
            },

            async lstat(path) {
                return this.stat(path);
            },

            async readdir(path) {
                try {
                    const handle = await self._resolvePath(path, false, false);
                    const entries = [];
                    for await (const name of handle.keys()) {
                        entries.push(name);
                    }
                    if (path.includes('/objects/pack')) {
                        console.log('[GitFS] readdir pack', { path, entries, count: entries.length });
                    }
                    return entries;
                } catch (e) {
                    if (e.code === 'ENOENT' || e.name === 'NotFoundError') {
                        throw Object.assign(new Error(`ENOENT: no such file or directory, scandir '${path}'`), { code: 'ENOENT' });
                    }
                    throw e;
                }
            },

            async mkdir(path) {
                await self._resolvePath(path, true, false);
            },

            async rmdir(path) {
                const parts = path.split('/').filter(p => p);
                if (parts.length === 0) return;
                const dirName = parts.pop();
                const parentPath = parts.join('/');
                try {
                    const parentHandle = await self._resolvePath(parentPath, false, false);
                    await parentHandle.removeEntry(dirName, { recursive: true });
                } catch (e) {
                    if (e.name !== 'NotFoundError' && e.name !== 'TypeMismatchError') throw e;
                }
            },

            async unlink(path) {
                const parts = path.split('/').filter(p => p);
                if (parts.length === 0) throw new Error(`Cannot unlink root path: '${path}'`);
                const fileName = parts.pop();
                const parentPath = parts.join('/');
                try {
                    const parentHandle = await self._resolvePath(parentPath, false, false);
                    await parentHandle.removeEntry(fileName);
                } catch (e) {
                    if (e.name !== 'NotFoundError' && e.name !== 'TypeMismatchError') throw e;
                }
            },

            // Stubs for isomorphic-git
            async readlink() { throw new Error('Not implemented'); },
            async symlink() { throw new Error('Not implemented'); },
            async chmod() { return; }
        };
    }
}
window.GitFSAdapter = GitFSAdapter;
