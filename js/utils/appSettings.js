/**
 * AppSettings - File-based settings persistence in the vault directory.
 *
 * Two files:
 *   .noteview/settings.json  — shareable config (safe to commit to git)
 *   .noteview/keys.json      — API keys only (auto-excluded from git)
 *
 * A .noteview/.gitignore is auto-managed to exclude keys.json.
 */
const AppSettings = {
    _cache: null,
    _DIR: '.noteview',
    _SETTINGS: 'settings.json',
    _KEYS: 'keys.json',

    // --- Settings (shareable) ---

    async load() {
        if (this._cache) return this._cache;
        if (!Store.directoryHandle) return {};

        try {
            const dir = await Store.directoryHandle.getDirectoryHandle(this._DIR);
            const handle = await dir.getFileHandle(this._SETTINGS);
            const file = await handle.getFile();
            const text = await file.text();
            this._cache = JSON.parse(text);
            return this._cache;
        } catch {
            this._cache = {};
            return this._cache;
        }
    },

    async save(settings) {
        if (!Store.directoryHandle) {
            console.warn('AppSettings: no vault directory, cannot save');
            return;
        }

        try {
            const dir = await Store.directoryHandle.getDirectoryHandle(this._DIR, { create: true });
            const handle = await dir.getFileHandle(this._SETTINGS, { create: true });
            const writable = await handle.createWritable();
            await writable.write(JSON.stringify(settings, null, 2));
            await writable.close();
            this._cache = settings;
        } catch (e) {
            console.warn('AppSettings: failed to save', e);
        }
    },

    invalidate() {
        this._cache = null;
    },

    // --- API Keys (secrets, gitignored) ---

    async loadKeys() {
        if (!Store.directoryHandle) return {};

        try {
            const dir = await Store.directoryHandle.getDirectoryHandle(this._DIR);
            const handle = await dir.getFileHandle(this._KEYS);
            const file = await handle.getFile();
            const text = await file.text();
            return JSON.parse(text);
        } catch {
            return {};
        }
    },

    async saveKeys(keyMap) {
        if (!Store.directoryHandle) {
            console.warn('AppSettings: no vault directory, cannot save keys');
            return;
        }

        try {
            const dir = await Store.directoryHandle.getDirectoryHandle(this._DIR, { create: true });
            const handle = await dir.getFileHandle(this._KEYS, { create: true });
            const writable = await handle.createWritable();
            await writable.write(JSON.stringify(keyMap, null, 2));
            await writable.close();
            await this._ensureGitignore(dir);
        } catch (e) {
            console.warn('AppSettings: failed to save keys', e);
        }
    },

    async deleteKey(profileId) {
        const keyMap = await this.loadKeys();
        if (!(profileId in keyMap)) return;
        delete keyMap[profileId];
        await this.saveKeys(keyMap);
    },

    // --- Note Templates ---

    _defaultTemplates: [
        { id: 'meeting', name: 'Meeting Notes', content: '# ${1:Meeting Title}\n\n**Attendees:** ${2:Attendees}\n\n## Agenda\n\n## Notes\n\n## Action Items\n- [ ] ' },
        { id: 'daily', name: 'Daily Note', content: '# ${1:Daily Note}\n\n## Tasks\n- [ ] \n\n## Notes\n' }
    ],

    async getTemplates() {
        const settings = await this.load();
        if (settings.templates && settings.templates.length > 0) {
            return settings.templates;
        }
        return [...this._defaultTemplates];
    },

    async saveTemplates(templates) {
        const settings = await this.load();
        settings.templates = templates;
        await this.save(settings);
    },

    async _ensureGitignore(dir) {
        try {
            const handle = await dir.getFileHandle('.gitignore', { create: true });
            const file = await handle.getFile();
            const existing = await file.text();
            if (existing.includes(this._KEYS)) return;

            const writable = await handle.createWritable();
            const content = existing.trim() + (existing.trim() ? '\n' : '') + this._KEYS + '\n';
            await writable.write(content);
            await writable.close();
        } catch (e) {
            console.warn('AppSettings: failed to update .gitignore', e);
        }
    }
};

window.AppSettings = AppSettings;
