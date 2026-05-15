/**
 * RecentAccessTracker - Tracks last-accessed timestamps and recently deleted blocks
 * Per-vault, persisted in localStorage (separate from .md files / git)
 */

const RecentAccessTracker = {
    _accessMap: {},
    _trashLog: [],
    _vaultKey: null,
    _dirty: false,
    _saveTimer: null,
    MAX_TRASH: 50,

    init(vaultName) {
        this._flush();
        this._vaultKey = 'noteview-recent-access::' + vaultName;
        this._accessMap = {};
        this._trashLog = [];
        this._dirty = false;

        try {
            const raw = localStorage.getItem(this._vaultKey);
            if (raw) {
                const data = JSON.parse(raw);
                this._accessMap = data.access || {};
                this._trashLog = data.trash || [];
            }
        } catch (e) {
            console.warn('RecentAccessTracker: failed to load', e);
        }
    },

    touch(blockId) {
        if (!this._vaultKey || !blockId) return;
        this._accessMap[blockId] = Date.now();
        this._dirty = true;
        this._scheduleSave();
    },

    get(blockId) {
        return this._accessMap[blockId] || undefined;
    },

    getAll() {
        return { ...this._accessMap };
    },

    prune(existingIds) {
        const set = new Set(existingIds);
        let changed = false;
        for (const id of Object.keys(this._accessMap)) {
            if (!set.has(id)) {
                delete this._accessMap[id];
                changed = true;
            }
        }
        if (changed) {
            this._dirty = true;
            this._scheduleSave();
        }
    },

    recordDeletion(block) {
        if (!this._vaultKey || !block) return;
        this._trashLog.unshift({
            id: block.id,
            timestamp: Date.now(),
            blockData: { id: block.id, tags: block.tags, lastUpdated: block.lastUpdated, creationDate: block.creationDate }
        });
        if (this._trashLog.length > this.MAX_TRASH) {
            this._trashLog.length = this.MAX_TRASH;
        }
        this._dirty = true;
        this._scheduleSave();
    },

    getTrashLog() {
        return this._trashLog.filter(entry =>
            entry?.id && entry?.blockData && !Store.blocks.some(b => b.id === entry.id)
        );
    },

    removeFromTrash(blockId) {
        this._trashLog = this._trashLog.filter(e => e.id !== blockId);
        this._dirty = true;
        this._scheduleSave();
    },

    clearTrash() {
        this._trashLog = [];
        this._dirty = true;
        this._scheduleSave();
    },

    _scheduleSave() {
        if (this._saveTimer) return;
        this._saveTimer = setTimeout(() => {
            this._saveTimer = null;
            this._save();
        }, 2000);
    },

    _save() {
        if (!this._vaultKey || !this._dirty) return;
        try {
            localStorage.setItem(this._vaultKey, JSON.stringify({
                access: this._accessMap,
                trash: this._trashLog
            }));
            this._dirty = false;
        } catch (e) {
            console.warn('RecentAccessTracker: failed to save', e);
            // Reset dirty to prevent infinite retry loop on quota errors
            this._dirty = false;
        }
    },

    _flush() {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        this._save();
    }
};

// Flush on page close to prevent data loss from the debounce timer
window.addEventListener('beforeunload', () => RecentAccessTracker._flush());

window.RecentAccessTracker = RecentAccessTracker;
