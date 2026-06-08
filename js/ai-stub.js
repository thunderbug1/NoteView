/**
 * AI Assistant Stub - Loads the full AI module lazily
 */
const AIAssistant = {
    enabled: false,
    profiles: [],
    presets: [],
    _apiKeys: {},
    _moduleLoaded: false,
    _moduleLoading: null,

    async _ensureLoaded() {
        if (this._moduleLoaded) {
            return;
        }

        if (this._moduleLoading) {
            return this._moduleLoading;
        }

        this._moduleLoading = (async () => {
            try {
                await this._loadScript('js/ai.js');
                if (window.AIAssistantReal && !this._moduleLoaded) {
                    Object.assign(this, window.AIAssistantReal);
                }
                this._moduleLoaded = true;
                this._moduleLoading = null;
                console.log('AI module loaded successfully');
            } catch (err) {
                console.error('Failed to load AI module:', err);
                this._moduleLoading = null;
                throw err;
            }
        })();

        return this._moduleLoading;
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

    // Proxy methods that load the module first
    async init() {
        await this._ensureLoaded();
        const result = await window.AIAssistantReal?.init();
        if (window.AIAssistantReal) {
            this._panelElement = window.AIAssistantReal._panelElement;
        }
        return result;
    },

    isConfigured() {
        if (!this._moduleLoaded) return false;
        return window.AIAssistantReal?.isConfigured() || false;
    },

    async toggleEnabled(bool) {
        await this._ensureLoaded();
        return window.AIAssistantReal?.toggleEnabled(bool);
    },

    openPanel(blockId) {
        if (!this._moduleLoaded) {
            this._ensureLoaded().then(() => {
                window.AIAssistantReal?.openPanel(blockId);
            });
            return;
        }
        window.AIAssistantReal?.openPanel(blockId);
    },

    closePanel() {
        if (!this._moduleLoaded) return;
        window.AIAssistantReal?.closePanel();
    },

    togglePanel(blockId) {
        if (!this._moduleLoaded) {
            this._ensureLoaded().then(() => {
                window.AIAssistantReal?.togglePanel(blockId);
            });
            return;
        }
        window.AIAssistantReal?.togglePanel(blockId);
    },

    createChat(options) {
        if (!this._moduleLoaded) return null;
        return window.AIAssistantReal?.createChat(options);
    },

    getActiveChat() {
        if (!this._moduleLoaded) return null;
        return window.AIAssistantReal?.getActiveChat();
    },

    switchChat(chatId) {
        if (!this._moduleLoaded) return;
        window.AIAssistantReal?.switchChat(chatId);
    },

    closeChat(chatId) {
        if (!this._moduleLoaded) return;
        window.AIAssistantReal?.closeChat(chatId);
    },

    saveChats() {
        if (!this._moduleLoaded) return;
        window.AIAssistantReal?.saveChats();
    },

    showInlineDiffs() {
        if (!this._moduleLoaded) return;
        window.AIAssistantReal?.showInlineDiffs();
    },

    getPendingDiffsForBlock(blockId) {
        if (!this._moduleLoaded) return [];
        return window.AIAssistantReal?.getPendingDiffsForBlock(blockId) || [];
    },

    getPendingDiffBlockIds() {
        if (!this._moduleLoaded) return [];
        return window.AIAssistantReal?.getPendingDiffBlockIds() || [];
    },

    async _acceptDiff(chat, msgId) {
        await this._ensureLoaded();
        return window.AIAssistantReal?._acceptDiff(chat, msgId);
    },

    async _rejectDiff(chat, msgId) {
        await this._ensureLoaded();
        return window.AIAssistantReal?._rejectDiff(chat, msgId);
    },

    async applyImport(data) {
        await this._ensureLoaded();
        return window.AIAssistantReal?.applyImport(data);
    }
};

// When the real module loads, it will assign itself to window.AIAssistantReal
// and replace this stub's methods
window.addEventListener('AIAssistantLoaded', () => {
    const realAI = window.AIAssistantReal;
    if (realAI) {
        // Replace stub with real implementation
        Object.assign(AIAssistant, realAI);
        AIAssistant._moduleLoaded = true;
    }
});