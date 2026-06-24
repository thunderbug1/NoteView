/**
 * Diagnostics - Persistent boot/recovery log for diagnosing vault data loss.
 *
 * The log is stored in localStorage (not IndexedDB) because IndexedDB itself is
 * the medium that gets wiped — localStorage is a separate bucket that tends to
 * survive partial clears, so the log outlives the event we want to inspect.
 */
const Diagnostics = {
    STORAGE_KEY: 'noteview-diagnostics-log',
    MAX_ENTRIES: 50,

    _read() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    },

    _write(entries) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(entries));
        } catch (e) {
            // Quota or serialization error — drop oldest half and retry once.
            try {
                localStorage.setItem(
                    this.STORAGE_KEY,
                    JSON.stringify(entries.slice(-Math.floor(this.MAX_ENTRIES / 2)))
                );
            } catch (e2) { /* give up silently */ }
        }
    },

    /**
     * Append a diagnostic event. Always succeeds (never throws).
     */
    log(event, data = {}) {
        const entry = {
            ts: Date.now(),
            iso: new Date().toISOString(),
            event,
            ...data
        };
        const entries = this._read();
        entries.push(entry);
        while (entries.length > this.MAX_ENTRIES) entries.shift();
        this._write(entries);
    },

    /**
     * Capture a consolidated snapshot of boot state. Call once near the end of
     * the init flow (after Store.init + any recovery attempt).
     */
    async captureBootSummary({ phase = 'end', recovered = null } = {}) {
        const summary = { phase, recovered };

        // Installed PWA?
        try {
            summary.installedPWA = window.matchMedia('(display-mode: standalone)').matches
                || window.navigator.standalone === true;
        } catch (e) { summary.installedPWA = null; }

        // Persistence state
        try {
            if (navigator.storage && navigator.storage.persisted) {
                summary.persisted = await navigator.storage.persisted();
            }
        } catch (e) { summary.persisted = `err:${e.name}`; }

        // Quota / usage (best effort)
        try {
            if (navigator.storage && navigator.storage.estimate) {
                const est = await navigator.storage.estimate();
                summary.usage = est.usage;
                summary.quota = est.quota;
            }
        } catch (e) { /* ignore */ }

        // IndexedDB version
        try {
            summary.dbVersion = window.Store?.db?.version ?? null;
        } catch (e) { summary.dbVersion = null; }

        // IndexedDB vaultList
        try {
            const list = (await window.Store?.getVaultList?.()) || [];
            summary.vaultListLen = list.length;
            summary.vaultNames = list.map(v => v.name);
        } catch (e) {
            summary.vaultListLen = `err:${e.name}`;
        }

        // localStorage backup
        try {
            const backup = this.getVaultBackup();
            summary.backupLen = backup ? backup.length : 0;
            summary.backupNames = backup ? backup.map(v => v.name) : [];
        } catch (e) { summary.backupLen = `err:${e.name}`; }

        this.log('boot_summary', summary);
    },

    /** Read the localStorage vault backup (array of {name,type,addedAt}), written by Store. */
    getVaultBackup() {
        try {
            const raw = localStorage.getItem('noteview-vault-backup');
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed?.vaults)) return parsed.vaults;
            if (Array.isArray(parsed)) return parsed; // legacy format
            return null;
        } catch (e) { return null; }
    },

    getAll() {
        return this._read();
    },

    clear() {
        try { localStorage.removeItem(this.STORAGE_KEY); } catch (e) { /* ignore */ }
    },

    /** Format the log for clipboard / sharing. */
    formatForCopy() {
        const entries = this.getAll();
        if (!entries.length) return '(no diagnostics recorded)';
        return entries.map(e => {
            const { ts, iso, event, ...rest } = e;
            const details = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : '';
            return `[${iso}] ${event}${details}`;
        }).join('\n');
    },

    async copyToClipboard() {
        const text = this.formatForCopy();
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            return false;
        }
    }
};

window.Diagnostics = Diagnostics;
