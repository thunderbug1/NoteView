/**
 * AI Assistant Module
 * Right-side chat panel with multiple concurrent chats, context management,
 * and Transform/Ask modes. Integrates OpenAI-compatible LLM endpoints.
 */
const AIAssistantReal = {
    // State
    enabled: false,
    profiles: [],
    presets: [],
    _apiKeys: {},
    _lastProfileId: null,
    _lastInstruction: '',

    // Multi-chat state
    _chats: [],
    _activeChatId: null,
    _chatIdCounter: 0,
    _msgIdCounter: 0,
    _panelOpen: false,
    _panelElement: null,

    // --- Initialization ---

    async init() {
        const settings = await AppSettings.load();
        const ai = settings.ai || {};

        this.enabled = !!ai.enabled;
        this._lastProfileId = ai.lastProfileId || null;
        this._lastInstruction = ai.lastInstruction || '';

        this.profiles = Array.isArray(ai.profiles)
            ? ai.profiles.map(p => ({ id: p.id, name: p.name, endpointUrl: p.endpointUrl, model: p.model }))
            : [];

        this._apiKeys = await AppSettings.loadKeys();

        if (Array.isArray(ai.presets) && ai.presets.length > 0) {
            this.presets = ai.presets;
        } else {
            this.presets = this._defaultPresets();
            await this._persist();
        }

        this._panelElement = document.getElementById('aiPanel');

        // Wire static header buttons once
        this._wirePanelHeader();

        // Handle viewport resize across mobile breakpoint
        if (!this._resizeHandler) {
            this._resizeHandler = () => {
                if (this._panelOpen) {
                    if (window.innerWidth <= 768) {
                        document.body.classList.add('ai-panel-open');
                    } else {
                        document.body.classList.remove('ai-panel-open');
                    }
                }
            };
            window.addEventListener('resize', this._resizeHandler);
        }

        // Load persisted chats for this vault
        const vaultName = Store.directoryHandle?.name;
        if (vaultName) {
            const saved = await Store.loadChatHistory(vaultName);
            if (saved && saved.length > 0) {
                this._chats = this._deserializeChats(saved);
                this._chatIdCounter = Math.max(...this._chats.map(c => {
                    const num = parseInt(c.id.replace('chat-', ''));
                    return isNaN(num) ? 0 : num;
                }), 0) + 1;
                // Recalculate _msgIdCounter to avoid ID collisions with persisted messages
                let maxMsgNum = 0;
                for (const c of this._chats) {
                    for (const m of c.messages) {
                        const match = m.id?.match(/^msg-(\d+)/);
                        if (match) maxMsgNum = Math.max(maxMsgNum, parseInt(match[1]));
                    }
                }
                this._msgIdCounter = maxMsgNum;
                this._activeChatId = this._chats[this._chats.length - 1].id;
            } else {
                this._chats = [];
            }
        } else {
            this._chats = [];
        }
        this._activeChatId = this._activeChatId || null;

        if (this._panelOpen) {
            this.closePanel();
        }
    },

    _defaultPresets() {
        return [
            { id: 'preset-default-summarize', title: 'Summarize', instruction: 'Summarize this note concisely, preserving all key facts and action items.' },
            { id: 'preset-default-expand', title: 'Expand', instruction: 'Expand on the ideas in this note. Add more detail, examples, and structure while keeping the original intent.' },
            { id: 'preset-default-fix', title: 'Fix Grammar', instruction: 'Fix grammar, spelling, and punctuation in this note. Keep the original meaning and style.' },
            { id: 'preset-default-todo', title: 'Extract Tasks', instruction: 'Extract all action items and tasks from this note. Format them as a markdown task list with checkboxes.' },
        ];
    },

    isConfigured() {
        return this.enabled && this.profiles.length > 0;
    },

    async _persist() {
        const settings = await AppSettings.load();
        settings.ai = {
            enabled: this.enabled,
            profiles: this.profiles,
            presets: this.presets,
            lastProfileId: this._lastProfileId,
            lastInstruction: this._lastInstruction
        };
        await AppSettings.save(settings);
    },

    // --- Master Toggle ---

    async toggleEnabled(bool) {
        this.enabled = bool;
        await this._persist();
        if (typeof App !== 'undefined' && App.render) App.render();
    },

    // --- Profile CRUD ---

    async createProfile({ name, endpointUrl, apiKey, model }) {
        const id = 'profile-' + Date.now();
        const profile = {
            id,
            name: name || 'Unnamed',
            endpointUrl: endpointUrl || '',
            model: model || 'gpt-4o'
        };
        this.profiles.push(profile);
        if (apiKey) {
            this._apiKeys[id] = apiKey;
            await AppSettings.saveKeys(this._apiKeys);
        }
        await this._persist();
        return profile;
    },

    async updateProfile(id, updates) {
        const idx = this.profiles.findIndex(p => p.id === id);
        if (idx === -1) return;

        if ('apiKey' in updates) {
            if (updates.apiKey) {
                this._apiKeys[id] = updates.apiKey;
            } else {
                delete this._apiKeys[id];
            }
            await AppSettings.saveKeys(this._apiKeys);
            delete updates.apiKey;
        }

        Object.assign(this.profiles[idx], updates);
        await this._persist();
    },

    async deleteProfile(id) {
        this.profiles = this.profiles.filter(p => p.id !== id);
        delete this._apiKeys[id];
        if (this._lastProfileId === id) this._lastProfileId = null;
        await AppSettings.deleteKey(id);
        await this._persist();
    },

    // --- Preset CRUD ---

    async createPreset(title, instruction) {
        const preset = {
            id: 'preset-' + Date.now(),
            title: title || 'Unnamed',
            instruction: instruction || ''
        };
        this.presets.push(preset);
        await this._persist();
        return preset;
    },

    async updatePreset(id, title, instruction) {
        const idx = this.presets.findIndex(p => p.id === id);
        if (idx === -1) return;
        this.presets[idx].title = title;
        this.presets[idx].instruction = instruction;
        await this._persist();
    },

    async deletePreset(id) {
        this.presets = this.presets.filter(p => p.id !== id);
        await this._persist();
    },

    // --- Import ---

    async importFromVault(vaultName) {
        const vaultHandle = await Store.getVaultHandle(vaultName);
        if (!vaultHandle) return null;

        const originalHandle = Store.directoryHandle;
        AppSettings.invalidate();
        Store.directoryHandle = vaultHandle;
        try {
            const settings = await AppSettings.load();
            const ai = settings.ai;
            if (!ai || (!ai.profiles?.length && !ai.presets?.length)) return null;
            const keys = await AppSettings.loadKeys();
            return {
                enabled: !!ai.enabled,
                profiles: ai.profiles || [],
                presets: ai.presets || [],
                keys: keys || {}
            };
        } catch { return null; }
        finally {
            Store.directoryHandle = originalHandle;
            AppSettings.invalidate();
        }
    },

    async applyImport(data) {
        this.profiles = data.profiles.map(p => ({ id: p.id, name: p.name, endpointUrl: p.endpointUrl, model: p.model }));
        this.presets = data.presets;
        this._apiKeys = { ...data.keys };
        this._lastProfileId = this.profiles.length > 0 ? this.profiles[0].id : null;
        this.enabled = data.enabled;
        await this._persist();
        await AppSettings.saveKeys(this._apiKeys);
    },

    // ==============================
    // Panel Lifecycle
    // ==============================

    openPanel(blockId) {
        if (!this.enabled) return;
        if (this.profiles.length === 0) {
            showToast('Add an AI model profile in Settings first');
            return;
        }

        if (blockId) {
            // Reuse existing chat with this block, or create a new one
            const existing = this._chats.find(c => c.contextBlockIds.has(blockId) && c.state === 'idle' && c.messages.length === 0);
            if (existing) {
                this._activeChatId = existing.id;
            } else {
                const chat = this.createChat({ contextBlockIds: [blockId], mode: 'transform' });
                const block = Store.blocks.find(b => b.id === blockId);
                chat.title = block ? this._extractTitle(block) : blockId;
            }
        } else if (this._chats.length === 0) {
            this.createChat();
        }

        this._previouslyFocused = document.activeElement;
        this._panelOpen = true;
        this._panelElement.classList.add('open');
        this._panelElement.setAttribute('aria-hidden', 'false');

        // Mobile-only: scroll lock and overlay
        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
            document.body.classList.add('ai-panel-open');
            const overlay = document.getElementById('aiPanelOverlay');
            if (overlay) overlay.classList.add('active');
            const fab = document.getElementById('fabNewNote');
            if (fab) fab.style.display = 'none';
        }

        this._renderTabs();
        this._renderActiveChat();
        this.showInlineDiffs();

        requestAnimationFrame(() => requestAnimationFrame(() => {
            const textarea = this._panelElement.querySelector('.ai-input-row textarea');
            if (textarea) textarea.focus();
        }));
    },

    closePanel() {
        this._panelOpen = false;
        this._panelElement.classList.remove('open');
        this._panelElement.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('ai-panel-open');

        const overlay = document.getElementById('aiPanelOverlay');
        if (overlay) overlay.classList.remove('active');

        if (window.innerWidth <= 768) {
            const fab = document.getElementById('fabNewNote');
            if (fab) fab.style.display = '';
        }

        if (this._previouslyFocused && typeof this._previouslyFocused.focus === 'function') {
            try { this._previouslyFocused.focus(); } catch { /* element may be gone */ }
            this._previouslyFocused = null;
        }
    },

    togglePanel(blockId) {
        if (this._panelOpen) {
            this.closePanel();
        } else {
            this.openPanel(blockId);
        }
    },

    // ==============================
    // Multi-Chat Data Model
    // ==============================

    createChat(options = {}) {
        const chat = {
            id: 'chat-' + (++this._chatIdCounter),
            title: options.title || 'New chat',
            mode: options.mode || 'transform',
            modelId: options.modelId || this._lastProfileId || this.profiles[0]?.id,
            contextBlockIds: new Set(options.contextBlockIds || []),
            messages: [],
            state: 'idle',
            perNote: options.perNote || false,
            abortController: null,
            streamingResponse: '',
            diffEditorView: null
        };
        this._chats.push(chat);
        this._activeChatId = chat.id;
        return chat;
    },

    getActiveChat() {
        return this._chats.find(c => c.id === this._activeChatId);
    },

    switchChat(chatId) {
        this._activeChatId = chatId;
        this._renderTabs();
        this._renderActiveChat();
        this.saveChats().catch(e => console.error('Failed to save chats:', e));
    },

    closeChat(chatId) {
        const chat = this._chats.find(c => c.id === chatId);
        if (chat) {
            if (chat.abortController) chat.abortController.abort();
            chat._abortRequested = true;
            if (chat.diffEditorView) {
                try { chat.diffEditorView.destroy(); } catch { /* cleanup */ }
            }
        }
        this._chats = this._chats.filter(c => c.id !== chatId);
        if (this._activeChatId === chatId) {
            this._activeChatId = this._chats[this._chats.length - 1]?.id || null;
        }
        if (this._chats.length === 0) {
            this.createChat();
        }
        this._renderTabs();
        this._renderActiveChat();
        this._updateBadge();
        this.saveChats().catch(e => console.error('Failed to save chats:', e));
    },

    _updateBadge() {
        const badge = document.getElementById('aiPanelBadge');
        if (!badge) return;
        const awaiting = this._chats.filter(c => c.state === 'awaiting_input').length;
        if (awaiting > 0) {
            badge.textContent = `${awaiting} awaiting review`;
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }
    },

    // ==============================
    // Rendering
    // ==============================

    _renderTabs() {
        const tabsEl = document.getElementById('aiChatTabs');
        if (!tabsEl) return;

        const tabs = this._chats.map(chat => {
            const stateClass = chat.state === 'awaiting_input' ? 'awaiting-input' :
                               chat.state === 'streaming' ? 'streaming' :
                               chat.state === 'error' ? 'error' : '';
            const activeClass = chat.id === this._activeChatId ? 'active' : '';
            return `<button class="ai-chat-tab ${stateClass} ${activeClass}" data-chat-id="${chat.id}">
                <span class="ai-chat-tab-status"></span>
                <span class="ai-chat-tab-title">${escapeHtml(chat.title)}</span>
                <span class="ai-chat-tab-close" data-close-chat="${chat.id}">&times;</span>
            </button>`;
        }).join('');

        tabsEl.innerHTML = tabs;

        // Render expand footer outside scrollable area
        const wrap = tabsEl.closest('.ai-session-list-wrap');
        const isExpanded = wrap?.classList.contains('expanded');
        const hiddenCount = Math.max(0, this._chats.length - 2);
        const label = isExpanded ? 'Show less' : (hiddenCount > 0 ? hiddenCount + ' more…' : this._chats.length + ' sessions');
        let expandEl = wrap?.querySelector('.ai-session-expand');
        if (wrap) {
            if (!expandEl) {
                expandEl = document.createElement('button');
                expandEl.className = 'ai-session-expand';
                wrap.appendChild(expandEl);
            }
            expandEl.textContent = label;
        }

        // Wire tab clicks
        tabsEl.querySelectorAll('.ai-chat-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                if (e.target.closest('.ai-chat-tab-close')) {
                    const closeId = e.target.dataset.closeChat;
                    if (closeId) this.closeChat(closeId);
                    return;
                }
                const chatId = tab.dataset.chatId;
                if (chatId) this.switchChat(chatId);
            });
        });

        const activeTab = tabsEl.querySelector('.ai-chat-tab.active');
        if (activeTab) activeTab.scrollIntoView({ block: 'nearest', behavior: 'instant' });

        if (expandEl) expandEl.onclick = () => {
            wrap?.classList.toggle('expanded');
            this._renderTabs();
        };

        this._updateBadge();
    },

    _renderActiveChat() {
        const container = document.getElementById('aiChatActive');
        if (!container) return;

        // Destroy any existing diff editors before DOM replacement
        const chat = this.getActiveChat();
        if (chat?.diffEditorView) {
            try { chat.diffEditorView.destroy(); } catch { /* cleanup */ }
            chat.diffEditorView = null;
        }
        // Also destroy per-container diff editors from diff cards
        const oldDiffContainers = container.querySelectorAll('[data-diff-viewer]');
        oldDiffContainers.forEach(el => {
            if (el._diffEditorView) {
                try { el._diffEditorView.destroy(); } catch { /* cleanup */ }
                el._diffEditorView = null;
            }
        });
        if (!chat) {
            container.innerHTML = '<div class="ai-empty-state"><p>No active chat</p></div>';
            return;
        }

        const profileOptions = this.profiles.map(p =>
            `<option value="${p.id}" ${p.id === chat.modelId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
        ).join('');

        const presetChips = this.presets.map(p =>
            `<button class="ai-preset-chip" data-preset-id="${p.id}" title="${escapeHtml(p.instruction)}">${escapeHtml(p.title)}</button>`
        ).join('');

        const isStreaming = chat.state === 'streaming';
        const placeholder = chat.mode === 'ask'
            ? 'Ask a question about your notes...'
            : 'Tell the AI what to do...';

        container.innerHTML = `
            <div class="ai-context-section">
                <button class="ai-context-toggle" id="aiContextToggle">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                    Context
                    <span class="ai-context-badge">${chat.contextBlockIds.size}</span>
                </button>
                <div class="ai-context-body" id="aiContextBody"></div>
            </div>
            <div class="ai-chat-messages" id="aiChatMessages"></div>
            <div class="ai-chat-footer">
                <div class="ai-preset-chips">${presetChips}</div>
                <div class="ai-input-row">
                    <textarea id="aiInstructionInput" placeholder="${placeholder}" rows="1" ${isStreaming ? 'disabled' : ''}></textarea>
                    <button class="ai-action-btn ${isStreaming ? 'streaming' : ''} ${chat.state === 'error' ? 'retry' : ''}" id="aiActionBtn" title="${isStreaming ? 'Stop' : chat.state === 'error' ? 'Retry' : 'Send'}">
                        ${isStreaming
                            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
                            : chat.state === 'error'
                                ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>'
                                : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'
                        }
                    </button>
                </div>
                <div class="ai-chat-toolbar">
                    <div class="ai-mode-toggle">
                        <button class="ai-mode-option ${chat.mode === 'transform' ? 'active' : ''}" data-mode="transform">Transform</button>
                        <button class="ai-mode-option ${chat.mode === 'ask' ? 'active' : ''}" data-mode="ask">Ask</button>
                    </div>
                    <label class="ai-pernote-toggle${chat.contextBlockIds.size <= 1 ? ' disabled' : ''}"><input type="checkbox" id="aiPerNoteToggle" ${chat.perNote ? 'checked' : ''}${chat.contextBlockIds.size <= 1 ? ' disabled' : ''}><span>Each note</span></label>
                    <select class="ai-model-select" id="aiModelSelect">${profileOptions}</select>
                    <button class="ai-toolbar-settings-btn" id="aiToolbarSettingsBtn" title="AI Settings">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                    </button>
                </div>
            </div>
        `;

        this._renderContext(chat);
        this._renderMessages(chat);
        this._wireChatEvents(chat);
    },

    _renderContext(chat) {
        const body = document.getElementById('aiContextBody');
        const toggle = document.getElementById('aiContextToggle');
        if (!body || !toggle) return;

        const noteItems = [...chat.contextBlockIds].map(id => {
            const block = Store.blocks.find(b => b.id === id);
            const title = block ? this._extractTitle(block) : id;
            return `<div class="ai-context-note" data-block-id="${escapeHtml(id)}">
                <span class="ai-context-note-title">${escapeHtml(title)}</span>
                <button class="ai-context-note-remove" data-remove-id="${escapeHtml(id)}">&times;</button>
            </div>`;
        }).join('');

        const largeWarning = chat.contextBlockIds.size > 20
            ? '<div class="ai-context-warning">Large context — may exceed model limits</div>'
            : '';

        body.innerHTML = `
            <div class="ai-context-actions">
                <button class="ai-context-action-btn" id="aiAddVisibleBtn">Add visible notes</button>
                <button class="ai-context-action-btn" id="aiSelectNotesBtn">Select notes...</button>
            </div>
            ${noteItems ? `<div class="ai-context-notes">${noteItems}</div>` : ''}
            ${largeWarning}
        `;

        // Toggle expand/collapse (use clone to remove old listeners)
        const newToggle = toggle.cloneNode(true);
        toggle.parentNode.replaceChild(newToggle, toggle);
        newToggle.addEventListener('click', () => {
            const expanded = newToggle.classList.toggle('expanded');
            body.classList.toggle('visible', expanded);
        });

        // Remove context note — event delegation on body
        body.onclick = (e) => {
            const removeBtn = e.target.closest('.ai-context-note-remove');
            if (removeBtn) {
                chat.contextBlockIds.delete(removeBtn.dataset.removeId);
                this._renderActiveChat();
                this._renderTabs();
                return;
            }
            const addVisibleBtn = e.target.closest('#aiAddVisibleBtn');
            if (addVisibleBtn) {
                const blocks = Store.getFilteredBlocks();
                for (const b of blocks) chat.contextBlockIds.add(b.id);
                this._renderActiveChat();
                return;
            }
            const selectBtn = e.target.closest('#aiSelectNotesBtn');
            if (selectBtn) {
                this._openSelectNotesModal(chat);
                return;
            }
        };
    },

    _renderMessages(chat) {
        const container = document.getElementById('aiChatMessages');
        if (!container) return;

        if (chat.messages.length === 0) {
            container.innerHTML = `<div class="ai-empty-state">
                <div class="ai-empty-state-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>
                </div>
                <h4>AI Assistant</h4>
                <p>Add notes to context and type an instruction to get started.</p>
            </div>`;
            return;
        }

        container.innerHTML = chat.messages.map(msg => this._renderMessage(msg)).join('');
        container.scrollTop = container.scrollHeight;
    },

    _renderMessage(msg) {
        switch (msg.role) {
            case 'user': {
                const contextChips = msg.contextCount
                    ? `<div class="ai-msg-context"><span class="ai-msg-context-chip">${msg.contextCount} note${msg.contextCount !== 1 ? 's' : ''} in context</span></div>`
                    : '';
                return `<div class="ai-msg ai-msg-user">
                    <div class="ai-msg-user-text">${escapeHtml(msg.content)}</div>
                    ${contextChips}
                </div>`;
            }
            case 'assistant': {
                if (msg.type === 'create') {
                    return this._renderCreateCardHTML(msg);
                }
                if (msg.type === 'diff') {
                    return this._renderDiffCardHTML(msg);
                }
                if (msg.type === 'batch') {
                    return this._renderBatchCardHTML(msg);
                }
                if (msg.type === 'markdown') {
                    const content = sanitizeHtml(marked.parse(msg.content || ''));
                    return `<div class="ai-msg ai-msg-assistant">
                        <div class="markdown-content">${content}</div>
                        ${msg.meta ? `<div class="ai-msg-meta">${escapeHtml(msg.meta)}</div>` : ''}
                    </div>`;
                }
                // Streaming or raw text
                return `<div class="ai-msg ai-msg-assistant streaming" data-streaming="${msg.id}">${msg.content ? escapeHtml(msg.content) : '<span class="ai-loading-dots"><span></span><span></span><span></span></span>'}</div>`;
            }
            case 'system': {
                if (msg.type === 'per-note-progress') {
                    const pct = msg.total > 0 ? Math.round((msg.current / msg.total) * 100) : 0;
                    return `<div class="ai-msg ai-msg-system info ai-pernote-progress">
                        <div class="ai-pernote-progress-text">${escapeHtml(msg.content)}</div>
                        <div class="ai-pernote-progress-bar"><div class="ai-pernote-progress-fill" style="width:${pct}%"></div></div>
                    </div>`;
                }
                const cls = msg.type === 'error' ? 'error' : 'info';
                const retry = msg.canRetry
                    ? `<button class="ai-retry-btn" data-retry-msg-id="${msg.id}">Retry</button>`
                    : '';
                return `<div class="ai-msg ai-msg-system ${cls}">${escapeHtml(msg.content)}${retry}</div>`;
            }
            default:
                return '';
        }
    },

    _renderDiffCardHTML(msg) {
        const status = msg.accepted === true ? 'accepted' : msg.accepted === false ? 'rejected' : 'pending';
        const statusBadge = status !== 'pending'
            ? `<span class="ai-diff-card-badge ${status}">${status}</span>`
            : '';
        const actions = status === 'pending'
            ? `<div class="ai-diff-card-actions">
                <button class="ai-reject-btn" data-reject-diff="${msg.id}">Reject</button>
                <button class="ai-accept-btn" data-accept-diff="${msg.id}">Accept</button>
            </div>`
            : '';

        const isPending = status === 'pending';
        return `<div class="ai-diff-card" data-diff-id="${msg.id}">
            <div class="ai-diff-card-header">
                <span class="ai-diff-card-title">${escapeHtml(msg.noteTitle || 'Note')}</span>
                ${statusBadge}
                <button class="ai-diff-card-toggle ${isPending ? 'expanded' : ''}" data-toggle-diff="${msg.id}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
            </div>
            <div class="ai-diff-card-body ${isPending ? 'visible' : ''}" id="diffBody-${msg.id}"></div>
            ${actions}
        </div>`;
    },

    _renderBatchCardHTML(msg) {
        const items = (msg.results || []).map(r => {
            const dotClass = r.isNew ? 'new-note' : r.status === 'unchanged' ? 'unchanged' : r.status === 'error' ? 'error' : 'has-changes';
            const badge = r.isNew ? '<span class="ai-batch-new-badge">new</span>' : '';
            return `<div class="ai-batch-card-item">
                <span class="ai-batch-card-dot ${dotClass}"></span>
                <span class="ai-batch-card-item-title">${escapeHtml(r.title)}</span>
                ${badge}
            </div>`;
        }).join('');

        const changed = (msg.results || []).filter(r => r.status !== 'unchanged' && r.status !== 'error').length;
        const unchanged = (msg.results || []).filter(r => r.status === 'unchanged').length;
        const errors = (msg.results || []).filter(r => r.status === 'error').length;

        return `<div class="ai-batch-card" data-batch-id="${msg.id}">
            <div class="ai-batch-card-header">
                <span class="ai-batch-card-summary">${changed} modified, ${unchanged} unchanged${errors ? `, ${errors} error${errors !== 1 ? 's' : ''}` : ''}</span>
                <button class="ai-batch-card-review-btn" data-review-batch="${msg.id}">Review all</button>
            </div>
            <div class="ai-batch-card-list">${items}</div>
        </div>`;
    },

    _renderCreateCardHTML(msg) {
        const status = msg.accepted === true ? 'created' : msg.accepted === false ? 'rejected' : 'pending';
        const statusBadge = status !== 'pending'
            ? `<span class="ai-diff-card-badge ${status === 'created' ? 'accepted' : 'rejected'}">${status}</span>`
            : '';
        const actions = status === 'pending'
            ? `<div class="ai-diff-card-actions">
                <button class="ai-reject-btn" data-reject-create="${msg.id}">Cancel</button>
                <button class="ai-accept-btn" data-accept-create="${msg.id}">Create note</button>
            </div>`
            : '';
        const isPending = status === 'pending';
        const preview = sanitizeHtml(marked.parse(msg.noteContent || ''));
        return `<div class="ai-create-card" data-create-id="${msg.id}">
            <div class="ai-create-card-header">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                <span class="ai-create-card-title">${escapeHtml(msg.noteTitle || 'New Note')}</span>
                ${statusBadge}
                <button class="ai-diff-card-toggle ${isPending ? 'expanded' : ''}" data-toggle-create="${msg.id}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
            </div>
            <div class="ai-create-card-body ${isPending ? 'visible' : ''}" id="createBody-${msg.id}">
                <div class="markdown-content">${preview}</div>
            </div>
            ${actions}
        </div>`;
    },

    // ==============================
    // Panel Header Wiring (once)
    // ==============================

    _wirePanelHeader() {
        if (this._headerWired) return;
        this._headerWired = true;
        const panel = this._panelElement;
        if (!panel) return;

        const closeBtn = panel.querySelector('#aiPanelCloseBtn');
        if (closeBtn) closeBtn.addEventListener('click', () => this.closePanel());

        const newChatBtn = panel.querySelector('#aiNewChatBtn');
        if (newChatBtn) newChatBtn.addEventListener('click', () => {
            this.createChat();
            this._renderTabs();
            this._renderActiveChat();
        });

        // Escape to close (wired once)
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !e.target.closest('textarea, input, select')) {
                const chat = this.getActiveChat();
                if (chat?.state === 'streaming') {
                    if (chat.abortController) chat.abortController.abort();
                    chat._abortRequested = true;
                } else {
                    this.closePanel();
                }
            }
        });
    },

    // ==============================
    // Chat Event Wiring
    // ==============================

    _wireChatEvents(chat) {
        const panel = this._panelElement;

        // Settings button (in toolbar below input)
        const settingsBtn = panel.querySelector('#aiToolbarSettingsBtn');
        if (settingsBtn) settingsBtn.addEventListener('click', () => this.openSettingsModal());

        // Model selector
        const modelSelect = panel.querySelector('#aiModelSelect');
        if (modelSelect) modelSelect.addEventListener('change', () => {
            chat.modelId = modelSelect.value;
            this._lastProfileId = modelSelect.value;
            this._persist();
        });

        // Mode toggle
        panel.querySelectorAll('.ai-mode-option').forEach(btn => {
            btn.addEventListener('click', () => {
                panel.querySelectorAll('.ai-mode-option').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                chat.mode = btn.dataset.mode;
                const input = panel.querySelector('#aiInstructionInput');
                if (input) input.placeholder = chat.mode === 'ask' ? 'Ask a question about your notes...' : 'Tell the AI what to do...';
            });
        });

        // Per-note toggle
        const perNoteToggle = panel.querySelector('#aiPerNoteToggle');
        if (perNoteToggle) perNoteToggle.addEventListener('change', () => {
            chat.perNote = perNoteToggle.checked;
        });

        // Preset chips
        const input = panel.querySelector('#aiInstructionInput');
        panel.querySelectorAll('.ai-preset-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const isActive = chip.classList.contains('active');
                panel.querySelectorAll('.ai-preset-chip').forEach(c => c.classList.remove('active'));
                if (!isActive && input) {
                    chip.classList.add('active');
                    const preset = this.presets.find(p => p.id === chip.dataset.presetId);
                    input.value = preset?.instruction || '';
                } else if (input) {
                    input.value = '';
                }
            });
        });

        // Send / Stop / Retry action button
        const actionBtn = panel.querySelector('#aiActionBtn');
        if (actionBtn) actionBtn.addEventListener('click', () => {
            if (chat.state === 'streaming') {
                if (chat.abortController) chat.abortController.abort();
                chat._abortRequested = true;
                return;
            }
            if (chat.state === 'error') {
                const errMsg = chat.messages.findLast(m => m.canRetry && m.retryInstruction);
                if (errMsg) {
                    const errIdx = chat.messages.indexOf(errMsg);
                    if (errIdx > 0 && chat.messages[errIdx - 1].role === 'user' && chat.messages[errIdx - 1].content === errMsg.retryInstruction) {
                        chat.messages.splice(errIdx - 1, 2);
                    } else {
                        chat.messages.splice(errIdx, 1);
                    }
                    this._sendToChat(chat, errMsg.retryInstruction);
                    return;
                }
            }
            const textarea = panel.querySelector('#aiInstructionInput');
            const instruction = textarea?.value?.trim();
            if (!instruction) return;
            this._sendToChat(chat, instruction);
            if (textarea) textarea.value = '';
        });

        // Enter to send
        if (input) input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                if (chat.state !== 'idle') return;
                const instruction = input.value.trim();
                if (!instruction) return;
                this._sendToChat(chat, instruction);
                input.value = '';
            }
        });

        // Retry buttons (event delegation on messages container)
        const messagesEl = panel.querySelector('#aiChatMessages');
        if (messagesEl) messagesEl.addEventListener('click', (e) => {
            const retryBtn = e.target.closest('.ai-retry-btn');
            if (!retryBtn) return;
            const msgId = retryBtn.dataset.retryMsgId;
            const errIdx = chat.messages.findIndex(m => m.id === msgId);
            if (errIdx === -1) return;
            const errMsg = chat.messages[errIdx];
            const instruction = errMsg.retryInstruction;
            if (!instruction) return;
            // Remove the error message and the user message that preceded it
            chat.messages.splice(errIdx, 1);
            if (errIdx > 0 && chat.messages[errIdx - 1].role === 'user' && chat.messages[errIdx - 1].content === instruction) {
                chat.messages.splice(errIdx - 1, 1);
            }
            this._sendToChat(chat, instruction);
        });

        // Diff card interactions
        this._wireDiffCardEvents(chat);
        this._wireBatchCardEvents(chat);
        this._wireCreateCardEvents(chat);
    },

    _wireDiffCardEvents(chat) {
        const panel = this._panelElement;

        // Auto-create diff editors for pending (expanded-by-default) cards
        panel.querySelectorAll('.ai-diff-card-body.visible').forEach(body => {
            if (body.dataset.initialized) return;
            const msgId = body.id.replace('diffBody-', '');
            const msg = chat.messages.find(m => m.id === msgId);
            if (msg) {
                body.dataset.initialized = 'true';
                this._createDiffEditor(body, msg.original, msg.modified);
            }
        });

        // Toggle diff body
        panel.querySelectorAll('.ai-diff-card-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const msgId = btn.dataset.toggleDiff;
                btn.classList.toggle('expanded');
                const body = panel.querySelector(`#diffBody-${msgId}`);
                if (body) body.classList.toggle('visible');
                const msg = chat.messages.find(m => m.id === msgId);
                if (msg && !body.dataset.initialized) {
                    body.dataset.initialized = 'true';
                    this._createDiffEditor(body, msg.original, msg.modified);
                }
            });
        });

        // Accept diff
        panel.querySelectorAll('[data-accept-diff]').forEach(btn => {
            btn.addEventListener('click', () => {
                const msgId = btn.dataset.acceptDiff;
                this._acceptDiff(chat, msgId);
            });
        });

        // Reject diff
        panel.querySelectorAll('[data-reject-diff]').forEach(btn => {
            btn.addEventListener('click', () => {
                const msgId = btn.dataset.rejectDiff;
                this._rejectDiff(chat, msgId);
            });
        });
    },

    _wireBatchCardEvents(chat) {
        const panel = this._panelElement;

        panel.querySelectorAll('[data-review-batch]').forEach(btn => {
            btn.addEventListener('click', () => {
                const msgId = btn.dataset.reviewBatch;
                const msg = chat.messages.find(m => m.id === msgId);
                if (msg) this._openBatchReviewModal(chat, msg);
            });
        });
    },

    _wireCreateCardEvents(chat) {
        const panel = this._panelElement;

        panel.querySelectorAll('[data-accept-create]').forEach(btn => {
            btn.addEventListener('click', () => {
                this._acceptCreateNote(chat, btn.dataset.acceptCreate);
            });
        });

        panel.querySelectorAll('[data-reject-create]').forEach(btn => {
            btn.addEventListener('click', () => {
                this._rejectCreateNote(chat, btn.dataset.rejectCreate);
            });
        });

        panel.querySelectorAll('[data-toggle-create]').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.classList.toggle('expanded');
                const msgId = btn.dataset.toggleCreate;
                const body = panel.querySelector(`#createBody-${msgId}`);
                if (body) body.classList.toggle('visible');
            });
        });
    },

    // ==============================
    // Send & Stream
    // ==============================

    async _sendToChat(chat, instruction) {
        if (chat.state === 'streaming') return;
        chat.state = 'streaming';

        const profile = this.profiles.find(p => p.id === chat.modelId);
        if (!profile) {
            chat.messages.push({ id: 'msg-' + (++this._msgIdCounter), role: 'system', type: 'error', content: 'Model profile not found. It may have been deleted.' });
            chat.state = 'idle';
            this._renderMessages(chat);
            return;
        }

        const apiKey = this._apiKeys[chat.modelId] || '';
        if (!apiKey) {
            chat.messages.push({ id: 'msg-' + (++this._msgIdCounter), role: 'system', type: 'error', content: 'No API key configured. Edit the profile in Settings.' });
            chat.state = 'idle';
            this._renderMessages(chat);
            return;
        }

        this._lastInstruction = instruction;
        this._lastProfileId = chat.modelId;
        await this._persist();

        if (chat.mode === 'transform' && chat.perNote && chat.contextBlockIds.size > 1) {
            return this._sendPerNote(chat, instruction, profile, apiKey);
        }

        // Add user message
        chat.messages.push({
            id: 'msg-' + (++this._msgIdCounter),
            role: 'user',
            content: instruction,
            contextCount: chat.contextBlockIds.size
        });

        // Set chat title from first user message
        if (chat.messages.filter(m => m.role === 'user').length === 1) {
            chat.title = instruction.slice(0, 30) + (instruction.length > 30 ? '...' : '');
            this._renderTabs();
        }

        // Add placeholder assistant message
        const assistantMsgId = 'msg-' + (++this._msgIdCounter) + '-resp';
        chat.messages.push({
            id: assistantMsgId,
            role: 'assistant',
            content: '',
            type: 'streaming'
        });

        chat.state = 'streaming';
        chat.streamingResponse = '';
        chat.abortController = new AbortController();

        this._renderActiveChat();

        const messages = this._buildChatMessages(chat, instruction);
        const url = profile.endpointUrl.replace(/\/+$/, '') + '/chat/completions';
        const startTime = Date.now();

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: profile.model,
                    messages,
                    stream: true
                }),
                signal: chat.abortController.signal
            });

            if (!response.ok) {
                let errMsg = `HTTP ${response.status}`;
                if (response.status === 401) errMsg = 'Authentication failed. Check your API key.';
                else if (response.status === 429) errMsg = 'Rate limited. Please wait and try again.';
                else if (response.status >= 500) errMsg = `Server error: ${response.status}`;
                throw new Error(errMsg);
            }

            // Handle non-streaming responses (e.g., some proxies buffer)
            if (!response.body) {
                const data = await response.json();
                chat.streamingResponse = data.choices?.[0]?.message?.content || '';
            } else {
                await this._readChatStream(response, chat, assistantMsgId);
            }

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const raw = chat.streamingResponse.trim();

            // Remove streaming message
            chat.messages = chat.messages.filter(m => m.id !== assistantMsgId);

            if (!raw) {
                chat.messages.push({ id: 'msg-' + (++this._msgIdCounter), role: 'system', type: 'info', content: 'No changes detected' });
                chat.state = 'idle';
            } else if (chat.mode === 'ask') {
                const createNotes = this._parseCreateNoteResponse(raw);
                if (createNotes.length > 0) {
                    const textContent = raw.replace(/<<<CREATE_NOTE>>>([\s\S]*?)<<<END_CREATE>>>/g, '').trim();
                    if (textContent) {
                        chat.messages.push({
                            id: 'msg-' + (++this._msgIdCounter),
                            role: 'assistant',
                            content: textContent,
                            type: 'markdown',
                            meta: `${profile.model} · ${elapsed}s`
                        });
                    }
                    for (const note of createNotes) {
                        chat.messages.push({
                            id: 'msg-' + (++this._msgIdCounter) + '-create',
                            role: 'assistant',
                            type: 'create',
                            noteContent: note.content,
                            noteTitle: note.title.slice(0, 60),
                            accepted: null,
                            meta: `${profile.model} · ${elapsed}s`
                        });
                    }
                    chat.state = 'awaiting_input';
                } else {
                    chat.messages.push({
                        id: 'msg-' + (++this._msgIdCounter),
                        role: 'assistant',
                        content: raw,
                        type: 'markdown',
                        meta: `${profile.model} · ${elapsed}s`
                    });
                    chat.state = 'idle';
                }
            } else {
                const modified = this._stripCodeFences(raw);
                const contextIds = [...chat.contextBlockIds];

                if (contextIds.length === 0) {
                    const noteTitle = modified.match(/^#{1,6}\s+(.+)/m)?.[1] || modified.split('\n')[0] || 'New Note';
                    chat.messages.push({
                        id: 'msg-' + (++this._msgIdCounter),
                        role: 'assistant',
                        type: 'create',
                        noteContent: modified,
                        noteTitle: noteTitle.slice(0, 60),
                        accepted: null,
                        meta: `${profile.model} · ${elapsed}s`
                    });
                    chat.state = 'awaiting_input';
                } else if (contextIds.length === 1) {
                    // Single-note transform
                    const block = Store.blocks.find(b => b.id === contextIds[0]);
                    const original = block?.content || '';

                    // Check for new-note creation markers
                    const createNotes = this._parseCreateNoteResponse(modified);
                    const textWithoutMarkers = createNotes.length > 0
                        ? this._stripCodeFences(modified.replace(/<<<CREATE_NOTE>>>([\s\S]*?)<<<END_CREATE>>>/g, '').trim())
                        : modified;

                    let hasChanges = false;

                    // Show diff card if the original note was modified
                    if (textWithoutMarkers && textWithoutMarkers !== original) {
                        chat.messages.push({
                            id: 'msg-' + (++this._msgIdCounter),
                            role: 'assistant',
                            type: 'diff',
                            blockId: contextIds[0],
                            noteTitle: block ? this._extractTitle(block) : contextIds[0],
                            original,
                            modified: textWithoutMarkers,
                            accepted: null,
                            meta: `${profile.model} · ${elapsed}s`
                        });
                        hasChanges = true;
                    }

                    // Show create cards for new notes
                    for (const note of createNotes) {
                        chat.messages.push({
                            id: 'msg-' + (++this._msgIdCounter) + '-create',
                            role: 'assistant',
                            type: 'create',
                            noteContent: note.content,
                            noteTitle: note.title.slice(0, 60),
                            accepted: null,
                            meta: `${profile.model} · ${elapsed}s`
                        });
                        hasChanges = true;
                    }

                    if (!hasChanges) {
                        chat.messages.push({ id: 'msg-' + (++this._msgIdCounter), role: 'system', type: 'info', content: 'No changes detected' });
                        chat.state = 'idle';
                    } else {
                        chat.state = 'awaiting_input';
                    }
                } else {
                    // Multi-note transform — run batch processing
                    await this._processBatchInChat(chat, contextIds, raw, profile, apiKey, elapsed);
                }
            }

        } catch (err) {
            chat.messages = chat.messages.filter(m => m.id !== assistantMsgId);
            if (err.name === 'AbortError') {
                chat.state = 'idle';
            } else {
                const isNetwork = err.message.includes('Failed to fetch') || err.message.includes('NetworkError') || err.message.includes('ERR_') || err.name === 'TypeError';
                chat.messages.push({
                    id: 'msg-' + (++this._msgIdCounter),
                    role: 'system',
                    type: 'error',
                    content: isNetwork ? 'Network error — check your connection and retry.' : err.message,
                    canRetry: true,
                    retryInstruction: instruction
                });
                chat.state = 'error';
            }
        }

        chat.abortController = null;
        chat.state = chat.state === 'streaming' ? 'idle' : chat.state;
        this._renderActiveChat();
        this._renderTabs();
        this.showInlineDiffs();
        this.saveChats().catch(e => console.error('Failed to save chats:', e));
    },

    async _readChatStream(response, chat, msgId) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const processLines = (lines) => {
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') return true;
                try {
                    const parsed = JSON.parse(data);
                    const content = parsed.choices?.[0]?.delta?.content || '';
                    if (content) {
                        chat.streamingResponse += content;
                        // Update streaming message in-place
                        const msgEl = this._panelElement?.querySelector(`[data-streaming="${msgId}"]`);
                        if (msgEl) {
                            msgEl.textContent = chat.streamingResponse;
                            const messagesContainer = msgEl.closest('.ai-chat-messages');
                            if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
                        }
                    }
                } catch { /* skip malformed SSE data */ }
            }
            return false;
        };

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split('\n');
                buffer = lines.pop();

                if (processLines(lines)) return;
            }

            // Process any remaining data in the buffer after stream ends
            if (buffer.trim()) {
                buffer = buffer.trim();
                processLines([buffer]);
            }
        } finally {
            reader.cancel().catch(() => {});
        }
    },

    _buildChatMessages(chat, instruction) {
        const messages = [];

        if (chat.mode === 'ask') {
            messages.push({ role: 'system', content: 'Answer the user\'s question based on the provided notes. Be concise and helpful. If the notes don\'t contain relevant information, say so.\n\nYou can also create new notes. When the user asks you to create a note, wrap the markdown content between <<<CREATE_NOTE>>> and <<<END_CREATE>>> markers. You may include explanatory text outside the markers. Example:\n\nSure! Here is the note:\n\n<<<CREATE_NOTE>>>\n# Note Title\nNote content...\n<<<END_CREATE>>>\n\nThe note is ready for you to review.' });

            // Include conversation history (exclude current message — it's in the context payload below)
            const history = chat.messages.filter(m => m.role === 'user' || (m.role === 'assistant' && m.type === 'markdown'));
            const recent = history.slice(0, -1).slice(-20);
            for (const msg of recent) {
                const lastMsg = messages[messages.length - 1];
                if (lastMsg && lastMsg.role === msg.role) {
                    lastMsg.content += '\n' + msg.content;
                } else {
                    messages.push({ role: msg.role, content: msg.content });
                }
            }

            // Include context notes with the latest instruction
            const blocks = [...chat.contextBlockIds].map(id => Store.blocks.find(b => b.id === id)).filter(Boolean);
            const contextParts = blocks.map((b, i) => `--- Note ${i + 1} (ID: ${b.id}) ---\n${b.content || ''}`);
            if (contextParts.length > 0) {
                messages.push({ role: 'user', content: `Context notes:\n\n${contextParts.join('\n\n')}\n\n${instruction}` });
            } else {
                messages.push({ role: 'user', content: instruction });
            }
        } else if (chat.contextBlockIds.size === 0) {
            messages.push({ role: 'system', content: 'Create a new markdown note based on the user\'s instruction. Return only the markdown content. No code fences, no commentary. Start with a heading.' });
            messages.push({ role: 'user', content: instruction });
        } else if (chat.contextBlockIds.size === 1) {
            messages.push({ role: 'system', content: 'Return only the modified markdown. No code fences, no commentary. If no changes are needed, return nothing.\n\nYou can also create new notes alongside any modifications. To create a new note, wrap the content in <<<CREATE_NOTE>>> and <<<END_CREATE>>> markers. The original note outside the markers will be treated as a modification.' });
            const blockId = [...chat.contextBlockIds][0];
            const block = Store.blocks.find(b => b.id === blockId);
            messages.push({
                role: 'user',
                content: `Here is the note:\n\n${block?.content || ''}\n\nApply the following instruction and return the complete modified note:\n${instruction}`
            });
        } else {
            messages.push({ role: 'system', content: 'You are an AI assistant integrated into NoteView, a markdown note-taking app. The user provides markdown notes separated by <<<NOTE:id>>> markers. Apply the instruction to the notes. Return the modified notes using the same <<<NOTE:id>>> separator format. You may modify any note (keeping its ID), create new notes (use a descriptive new ID prefixed with "new-"), split a note into multiple notes (use new IDs), or omit notes to leave them unchanged. Output ONLY the note markers and content. No code fences, no commentary.' });
            const parts = [...chat.contextBlockIds].map(id => {
                const block = Store.blocks.find(b => b.id === id);
                return `<<<NOTE:${id}>>>\n${block?.content || ''}`;
            });
            messages.push({ role: 'user', content: `${parts.join('\n')}\n\n${instruction}` });
        }

        return messages;
    },

    _buildSingleNoteMessages(content, instruction) {
        return [
            { role: 'system', content: 'Return only the modified markdown. No code fences, no commentary. If no changes are needed, return nothing.\n\nYou can also create new notes alongside any modifications. To create a new note, wrap the content in <<<CREATE_NOTE>>> and <<<END_CREATE>>> markers.' },
            { role: 'user', content: `Here is the note:\n\n${content}\n\nApply the following instruction and return the complete modified note:\n${instruction}` }
        ];
    },

    // ==============================
    // Diff Handling
    // ==============================

    _createDiffEditor(container, original, modified) {
        DiffEditor.createMergeViewWhenReady(container, original, modified);
    },

    async _acceptDiff(chat, msgId) {
        const msg = chat.messages.find(m => m.id === msgId);
        if (!msg || msg.accepted !== null) return;

        const block = Store.blocks.find(b => b.id === msg.blockId);
        if (!block) {
            msg.accepted = false;
            showToast('Note was deleted — cannot apply changes');
            this._renderMessages(chat);
            return;
        }

        try {
            await Store.saveBlock(block, {
                content: msg.modified,
                commit: true,
                commitMessage: 'AI: modified note'
            });
        } catch (err) {
            showToast('Failed to save: ' + err.message);
            return;
        }

        msg.accepted = true;
        TimelineView.invalidateCache();
        SelectionManager.updateTagCounts();
        if (typeof App !== 'undefined' && App.render) App.render();

        // Check if all diffs resolved
        const pending = chat.messages.filter(m => (m.type === 'diff' || m.type === 'create') && m.accepted === null);
        if (pending.length === 0) chat.state = 'idle';

        this._renderMessages(chat);
        this._renderTabs();
        this.saveChats().catch(e => console.error('Failed to save chats:', e));
    },
    
    _rejectDiff(chat, msgId) {
        const msg = chat.messages.find(m => m.id === msgId);
        if (!msg || msg.accepted !== null) return;

        msg.accepted = false;

        const pending = chat.messages.filter(m => (m.type === 'diff' || m.type === 'create') && m.accepted === null);
        if (pending.length === 0) chat.state = 'idle';

        this._renderMessages(chat);
        this._renderTabs();
        this._updateBadge();
        this.showInlineDiffs();
        this.saveChats().catch(e => console.error('Failed to save chats:', e));
    },

    async _acceptCreateNote(chat, msgId) {
        const msg = chat.messages.find(m => m.id === msgId);
        if (!msg || msg.accepted !== null) return;

        try {
            const block = await Store.createBlock(msg.noteContent);
            msg.accepted = true;
            msg.createdBlockId = block.id;
            showToast('Note created: ' + this._extractTitle(block));
        } catch (err) {
            showToast('Failed to create note: ' + err.message);
            return;
        }

        TimelineView.invalidateCache();
        SelectionManager.updateTagCounts();
        if (typeof App !== 'undefined' && App.render) App.render();

        const pending = chat.messages.filter(m => (m.type === 'diff' || m.type === 'create') && m.accepted === null);
        if (pending.length === 0) chat.state = 'idle';

        this._renderMessages(chat);
        this._renderTabs();
        this.saveChats().catch(e => console.error('Failed to save chats:', e));
    },

    _rejectCreateNote(chat, msgId) {
        const msg = chat.messages.find(m => m.id === msgId);
        if (!msg || msg.accepted !== null) return;

        msg.accepted = false;

        const pending = chat.messages.filter(m => (m.type === 'diff' || m.type === 'create') && m.accepted === null);
        if (pending.length === 0) chat.state = 'idle';

        this._renderMessages(chat);
        this._renderTabs();
        this._updateBadge();
        this.saveChats().catch(e => console.error('Failed to save chats:', e));
    },

    // ==============================
    // Chat Persistence
    // ==============================

    _serializeChats() {
        return this._chats.map(chat => ({
            ...chat,
            contextBlockIds: [...chat.contextBlockIds],
            // Remove streaming placeholder messages before persisting
            messages: chat.messages.filter(m => m.type !== 'streaming'),
            abortController: undefined,
            diffEditorView: undefined,
            streamingResponse: '',
            state: chat.state === 'streaming' ? 'idle' : chat.state
        }));
    },

    _deserializeChats(data) {
        return data.map(chat => ({
            ...chat,
            contextBlockIds: new Set(chat.contextBlockIds || []),
            abortController: null,
            diffEditorView: null,
            streamingResponse: '',
            state: (chat.state && chat.state !== 'streaming') ? chat.state : 'idle'
        }));
    },

    async saveChats() {
        const vaultName = Store.directoryHandle?.name;
        if (!vaultName) return;
        try {
            await Store.saveChatHistory(vaultName, this._serializeChats());
            this._saveChatFailures = 0;
        } catch (e) {
            console.warn('[AI] Failed to save chat history:', e);
            this._saveChatFailures = (this._saveChatFailures || 0) + 1;
            if (this._saveChatFailures === 1 || this._saveChatFailures % 5 === 0) {
                if (typeof Common !== 'undefined' && Common.showToast) {
                    Common.showToast('Chat history changes may not be saved.', { duration: 3000 });
                }
            }
        }
    },

    // ==============================
    // Pending Diff Registry (used by DocumentView for inline diffs)
    // ==============================

    getPendingDiffsForBlock(blockId) {
        const results = [];
        for (const chat of this._chats) {
            for (const msg of chat.messages) {
                if (msg.type === 'diff' && msg.accepted === null && msg.blockId === blockId) {
                    results.push({ chatId: chat.id, msg });
                }
            }
        }
        return results;
    },

    getPendingDiffBlockIds() {
        const ids = new Set();
        for (const chat of this._chats) {
            for (const msg of chat.messages) {
                if (msg.type === 'diff' && msg.accepted === null && msg.blockId) {
                    ids.add(msg.blockId);
                }
            }
        }
        return ids;
    },

    showInlineDiffs() {
        if (typeof DocumentView !== 'undefined' && DocumentView.showPendingInlineDiffs) {
            DocumentView.showPendingInlineDiffs();
        }
    },

    // ==============================
    // Per-Note Processing
    // ==============================

    async _sendPerNote(chat, instruction, profile, apiKey) {
        // Reset abort flag at start to prevent stale flag from a previous run
        chat._abortRequested = false;
        const contextIds = [...chat.contextBlockIds];
        const total = contextIds.length;

        try {

        // Add user message
        chat.messages.push({
            id: 'msg-' + (++this._msgIdCounter),
            role: 'user',
            content: instruction,
            contextCount: total
        });

        // Set chat title from first user message
        if (chat.messages.filter(m => m.role === 'user').length === 1) {
            chat.title = instruction.slice(0, 30) + (instruction.length > 30 ? '...' : '');
            this._renderTabs();
        }

        // Add progress message
        const progressMsgId = 'msg-pernote-progress-' + Date.now();
        chat.messages.push({
            id: progressMsgId,
            role: 'system',
            type: 'per-note-progress',
            content: `Processing note 1 of ${total}...`,
            current: 0,
            total
        });

        chat.state = 'streaming';
        this._renderActiveChat();

        for (let i = 0; i < contextIds.length; i++) {
            // Check if a previous abort left the signal in aborted state
            if (chat._abortRequested) {
                chat._abortRequested = false;
                chat.messages.push({
                    id: 'msg-' + (++this._msgIdCounter),
                    role: 'system', type: 'info',
                    content: `Stopped after ${i} of ${total} notes`
                });
                break;
            }

            const blockId = contextIds[i];
            const block = Store.blocks.find(b => b.id === blockId);

            // Update progress
            const progressMsg = chat.messages.find(m => m.id === progressMsgId);
            if (progressMsg) {
                progressMsg.content = `Processing note ${i + 1} of ${total}...`;
                progressMsg.current = i;
            }

            if (!block) {
                chat.messages.push({
                    id: 'msg-' + (++this._msgIdCounter) + '-' + i,
                    role: 'system', type: 'info',
                    content: `Skipped deleted note: ${blockId}`
                });
                this._renderMessages(chat);
                continue;
            }

            // Add streaming placeholder
            const streamMsgId = 'msg-pernote-stream-' + i + '-' + Date.now();
            chat.messages.push({
                id: streamMsgId,
                role: 'assistant',
                content: '',
                type: 'streaming'
            });
            this._renderMessages(chat);

            try {
                const messages = this._buildSingleNoteMessages(block.content, instruction);
                const url = profile.endpointUrl.replace(/\/+$/, '') + '/chat/completions';
                const startTime = Date.now();

                chat.abortController = new AbortController();

                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: profile.model,
                        messages,
                        stream: true
                    }),
                    signal: chat.abortController.signal
                });

                if (!response.ok) {
                    let errMsg = `HTTP ${response.status}`;
                    if (response.status === 401) errMsg = 'Authentication failed';
                    else if (response.status === 429) errMsg = 'Rate limited';
                    else if (response.status >= 500) errMsg = `Server error: ${response.status}`;
                    throw new Error(errMsg);
                }

                chat.streamingResponse = '';

                if (!response.body) {
                    const data = await response.json();
                    chat.streamingResponse = data.choices?.[0]?.message?.content || '';
                } else {
                    await this._readChatStream(response, chat, streamMsgId);
                }

                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                const raw = chat.streamingResponse.trim();

                // Remove streaming placeholder
                chat.messages = chat.messages.filter(m => m.id !== streamMsgId);

                if (!raw) {
                    chat.messages.push({
                        id: 'msg-' + (++this._msgIdCounter) + '-' + i,
                        role: 'system', type: 'info',
                        content: `No changes: ${this._extractTitle(block)}`
                    });
                } else {
                    const modified = this._stripCodeFences(raw);
                    const createNotes = this._parseCreateNoteResponse(modified);
                    const textWithoutMarkers = createNotes.length > 0
                        ? this._stripCodeFences(modified.replace(/<<<CREATE_NOTE>>>([\s\S]*?)<<<END_CREATE>>>/g, '').trim())
                        : modified;

                    let hasChanges = false;

                    if (textWithoutMarkers && textWithoutMarkers !== block.content) {
                        chat.messages.push({
                            id: 'msg-' + (++this._msgIdCounter) + '-' + i,
                            role: 'assistant',
                            type: 'diff',
                            blockId,
                            noteTitle: this._extractTitle(block),
                            original: block.content,
                            modified: textWithoutMarkers,
                            accepted: null,
                            meta: `${profile.model} · ${elapsed}s · note ${i + 1}/${total}`
                        });
                        hasChanges = true;
                    }

                    for (const note of createNotes) {
                        chat.messages.push({
                            id: 'msg-' + (++this._msgIdCounter) + '-' + i + '-create',
                            role: 'assistant',
                            type: 'create',
                            noteContent: note.content,
                            noteTitle: note.title.slice(0, 60),
                            accepted: null,
                            meta: `${profile.model} · ${elapsed}s · note ${i + 1}/${total}`
                        });
                        hasChanges = true;
                    }

                    if (!hasChanges) {
                        chat.messages.push({
                            id: 'msg-' + (++this._msgIdCounter) + '-' + i,
                            role: 'system', type: 'info',
                            content: `No changes: ${this._extractTitle(block)}`
                        });
                    }
                }
            } catch (err) {
                chat.messages = chat.messages.filter(m => m.id !== streamMsgId);

                if (err.name === 'AbortError') {
                    chat.messages.push({
                        id: 'msg-' + (++this._msgIdCounter),
                        role: 'system', type: 'info',
                        content: `Stopped after ${i} of ${total} notes`
                    });
                    chat._abortRequested = false;
                    chat.abortController = null;
                    break;
                }
                chat.messages.push({
                    id: 'msg-' + (++this._msgIdCounter) + '-' + i,
                    role: 'system', type: 'error',
                    content: `Error on "${this._extractTitle(block)}": ${err.message}`
                });
            }

            chat.abortController = null;
            this._renderMessages(chat);
        }

        // Remove progress message
        chat.messages = chat.messages.filter(m => m.id !== progressMsgId);

        const hasPendingDiffs = chat.messages.some(m => m.type === 'diff' && m.accepted === null);
        chat.state = hasPendingDiffs ? 'awaiting_input' : 'idle';

        this._renderActiveChat();
        this._renderTabs();
        this.showInlineDiffs();
        this.saveChats().catch(e => console.error('Failed to save chats:', e));

        } catch (err) {
            console.error('[AI] _sendPerNote unexpected error:', err);
            chat.state = 'error';
            chat.messages.push({
                id: 'msg-' + (++this._msgIdCounter),
                role: 'system', type: 'error',
                content: 'Unexpected error: ' + (err.message || 'Unknown error'),
                canRetry: true,
                retryInstruction: instruction
            });
            this._renderActiveChat();
            this._renderTabs();
            this.saveChats().catch(e => console.error('Failed to save chats:', e));
        }
    },

    // ==============================
    // Batch Processing in Chat
    // ==============================

    async _processBatchInChat(chat, contextIds, raw, profile, apiKey, elapsed) {
        const modified = this._stripCodeFences(raw);

        // Parse as chunked response
        const results = this._parseChunkedResponse(modified, contextIds);

        // Add results for notes not returned by AI (unchanged)
        const returnedIds = new Set(results.map(r => r.blockId));
        for (const id of contextIds) {
            if (!returnedIds.has(id)) {
                const block = Store.blocks.find(b => b.id === id);
                results.push({
                    blockId: id,
                    content: block?.content || '',
                    isNew: false,
                    title: block ? this._extractTitle(block) : id
                });
            }
        }

        // Build batch result items
        const batchItems = results.map(r => {
            if (r.isNew) {
                const title = r.content.match(/^#{1,6}\s+(.+)/m)?.[1] || r.content.split('\n')[0] || 'New note';
                return { blockId: r.blockId, title, original: '', modified: r.content, status: 'pending', isNew: true };
            }
            const block = Store.blocks.find(b => b.id === r.blockId);
            const original = block?.content || '';
            return {
                blockId: r.blockId,
                title: block ? this._extractTitle(block) : r.blockId,
                original,
                modified: r.content,
                status: r.content === original ? 'unchanged' : 'pending'
            };
        });

        chat.messages.push({
            id: 'msg-' + (++this._msgIdCounter),
            role: 'assistant',
            type: 'batch',
            results: batchItems,
            meta: `${profile.model} · ${elapsed}s`
        });

        const hasPending = batchItems.some(r => r.status === 'pending');
        chat.state = hasPending ? 'awaiting_input' : 'idle';
    },

    _openBatchReviewModal(chat, batchMsg) {
        const batchResults = batchMsg.results;
        const results = batchResults.filter(r => r.status !== 'unchanged');
        if (results.length === 0) {
            showToast('No changes to review');
            return;
        }

        const self = this;
        let diffEditorView = null;

        function selectBatchItem(index) {
            const container = modal.querySelector('#batchReviewDiff');
            container.innerHTML = '';
            const result = batchResults[index];
            if (!result) return;

            if (result.status !== 'pending') {
                container.innerHTML = `<div class="ai-msg-system info">${result.status === 'accepted' ? 'Accepted' : result.status === 'rejected' ? 'Rejected' : 'No changes'}</div>`;
                return;
            }

            if (result.isNew) {
                container.innerHTML = `<div class="ai-batch-new-preview"><pre>${escapeHtml(result.modified)}</pre></div>`;
                return;
            }

            diffEditorView = DiffEditor.createMergeView(container, result.original, result.modified);
        }

        async function acceptBatchItem(index) {
            const result = batchResults[index];
            if (!result || result.status !== 'pending') return;

            try {
                if (result.isNew) {
                    const newBlock = await Store.createBlock(result.modified);
                    result.blockId = newBlock.id;
                    result.status = 'accepted';
                } else {
                    const block = Store.blocks.find(b => b.id === result.blockId);
                    if (!block) { result.status = 'rejected'; return; }
                    await Store.saveBlock(block, {
                        content: result.modified,
                        commit: true,
                        commitMessage: 'AI: batch modified note',
                        skipUndo: true
                    });
                    result.status = 'accepted';
                }
            } catch (err) {
                result.status = 'error';
                const item = modal.querySelector(`.ai-batch-review-item[data-index="${index}"]`);
                if (item) {
                    item.className = 'ai-batch-review-item error';
                    item.querySelector('.ai-batch-review-status').textContent = '!';
                }
                showToast('Failed: ' + err.message);
                advanceBatchReview(index);
                updateReviewCount();
                return;
            }

            const item = modal.querySelector(`.ai-batch-review-item[data-index="${index}"]`);
            if (item) {
                item.className = 'ai-batch-review-item accepted';
                item.querySelector('.ai-batch-review-status').textContent = '✓';
            }

            advanceBatchReview(index);
            updateReviewCount();
        }

        function rejectBatchItem(index) {
            const result = batchResults[index];
            if (!result) return;
            result.status = 'rejected';

            const item = modal.querySelector(`.ai-batch-review-item[data-index="${index}"]`);
            if (item) {
                item.className = 'ai-batch-review-item rejected';
                item.querySelector('.ai-batch-review-status').textContent = '✗';
            }

            advanceBatchReview(index);
            updateReviewCount();
        }

        function advanceBatchReview(currentIndex) {
            const nextPending = batchResults.findIndex((r, i) => i > currentIndex && r.status === 'pending');
            if (nextPending !== -1) {
                const nextItem = modal.querySelector(`[data-index="${nextPending}"]`);
                if (nextItem) nextItem.click();
            } else {
                const remaining = batchResults.filter(r => r.status === 'pending');
                if (remaining.length === 0) {
                    self._finalizeBatchInChat(chat, batchMsg);
                    modal.close();
                }
            }
        }

        function getSelectedReviewIndex() {
            const active = modal.querySelector('.ai-batch-review-item.active');
            return active ? parseInt(active.dataset.index) : -1;
        }

        function updateReviewCount() {
            const reviewed = batchResults.filter(r => r.status !== 'pending').length;
            const countEl = modal.querySelector('#batchReviewCount');
            if (countEl) countEl.textContent = `${reviewed} of ${batchResults.length} reviewed`;
        }

        const listHtml = results.map((r) => {
            const idx = batchResults.indexOf(r);
            const statusIcon = r.isNew ? '+' :
                               r.status === 'error' ? '!' : '●';
            const statusClass = r.isNew ? 'new-note' :
                                r.status === 'error' ? 'error' :
                                r.status === 'accepted' ? 'accepted' :
                                r.status === 'rejected' ? 'rejected' : 'pending';
            const prefix = r.isNew ? '<span class="ai-batch-new-badge">new</span>' : '';
            return `<div class="ai-batch-review-item ${statusClass}" data-index="${idx}">
                <span class="ai-batch-review-status">${statusIcon}</span>
                ${prefix}<span class="ai-batch-review-title">${escapeHtml(r.title)}</span>
            </div>`;
        }).join('');

        const content = `
            <div class="ai-batch-review-layout">
                <div class="ai-batch-review-list" id="batchReviewList">${listHtml}</div>
                <div class="ai-batch-review-diff" id="batchReviewDiff"></div>
            </div>
            <div class="ai-batch-review-actions">
                <button class="ai-reject-btn" id="batchRejectOne">Reject This</button>
                <button class="ai-accept-btn" id="batchAcceptOne">Accept This</button>
                <span class="ai-batch-review-count" id="batchReviewCount"></span>
                <button class="ai-reject-btn" id="batchRejectAll">Reject All</button>
                <button class="ai-accept-btn" id="batchAcceptAll">Accept All</button>
            </div>
        `;

        const modal = Modal.create({
            title: 'Batch AI — Review',
            content,
            modalClass: 'tag-modal ai-modal ai-batch-modal',
            onClose: () => {
                if (diffEditorView) {
                    try { diffEditorView.destroy(); } catch { /* cleanup */ }
                    diffEditorView = null;
                }
            }
        });

        modal.querySelectorAll('.ai-batch-review-item').forEach(item => {
            item.addEventListener('click', () => {
                modal.querySelectorAll('.ai-batch-review-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                selectBatchItem(parseInt(item.dataset.index));
            });
        });

        const firstPending = results.findIndex(r => r.status === 'pending');
        const firstIdx = firstPending !== -1 ? batchResults.indexOf(results[firstPending]) : 0;
        const firstItem = modal.querySelector(`[data-index="${firstIdx}"]`);
        if (firstItem) firstItem.click();

        modal.querySelector('#batchAcceptOne').addEventListener('click', () => {
            const idx = getSelectedReviewIndex();
            if (idx !== -1) acceptBatchItem(idx);
        });

        modal.querySelector('#batchRejectOne').addEventListener('click', () => {
            const idx = getSelectedReviewIndex();
            if (idx !== -1) rejectBatchItem(idx);
        });

        modal.querySelector('#batchAcceptAll').addEventListener('click', async () => {
            for (const r of batchResults) {
                if (r.status === 'pending') await acceptBatchItem(batchResults.indexOf(r));
            }
            self._finalizeBatchInChat(chat, batchMsg);
            modal.close();
        });

        modal.querySelector('#batchRejectAll').addEventListener('click', () => {
            for (const r of batchResults) {
                if (r.status === 'pending') r.status = 'rejected';
            }
            self._finalizeBatchInChat(chat, batchMsg);
            modal.close();
        });

        updateReviewCount();
    },

    _finalizeBatchInChat(chat, batchMsg) {
        const accepted = batchMsg.results.filter(r => r.status === 'accepted');
        if (accepted.length > 0) {
            const commands = accepted.map(r => {
                if (r.isNew) {
                    return { type: 'create', blockId: r.blockId, after: { content: r.modified } };
                }
                return { type: 'update', blockId: r.blockId, before: { content: r.original }, after: { content: r.modified } };
            });

            if (commands.length > 0) {
                UndoRedoManager.executeCommand({
                    type: 'batch',
                    description: `Batch AI: ${commands.length} note${commands.length !== 1 ? 's' : ''}`,
                    commands
                });
            }

            TimelineView.invalidateCache();
            SelectionManager.updateTagCounts();
            if (typeof App !== 'undefined' && App.render) App.render();
        }

        const hasPendingBatch = chat.messages.some(m => m.type === 'batch' && m.results.some(r => r.status === 'pending'));
        const hasPendingOther = chat.messages.some(m => (m.type === 'diff' || m.type === 'create') && m.accepted === null);
        chat.state = (hasPendingBatch || hasPendingOther) ? 'awaiting_input' : 'idle';
        this._renderTabs();
        this.saveChats().catch(e => console.error('Failed to save chats:', e));
    },

    // ==============================
    // Select Notes Modal
    // ==============================

    _openSelectNotesModal(chat) {
        const blocks = Store.getFilteredBlocks();
        if (blocks.length === 0) {
            showToast('No notes available');
            return;
        }

        const items = blocks.map(b => {
            const title = this._extractTitle(b);
            const checked = chat.contextBlockIds.has(b.id);
            return `<div class="ai-batch-note-item">
                <input type="checkbox" ${checked ? 'checked' : ''} data-block-id="${escapeHtml(b.id)}">
                <span class="ai-batch-note-title">${escapeHtml(title)}</span>
            </div>`;
        }).join('');

        const modal = Modal.create({
            title: 'Select Notes for Context',
            content: `
                <div class="ai-batch-note-list-header">
                    <span class="ai-batch-note-count" id="selectNoteCount">${blocks.length} notes</span>
                    <div class="ai-batch-select-actions">
                        <button class="ai-batch-select-action" id="selectAllNotes">Select All</button>
                        <button class="ai-batch-select-action" id="deselectAllNotes">Deselect All</button>
                    </div>
                </div>
                <div class="ai-batch-note-list" id="selectNoteList">${items}</div>
                <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.75rem">
                    <button class="ai-form-cancel" id="selectNotesCancel">Cancel</button>
                    <button class="ai-form-save" id="selectNotesApply">Apply</button>
                </div>
            `,
            modalClass: 'tag-modal ai-modal'
        });

        const updateCount = () => {
            const checked = modal.querySelectorAll('.ai-batch-note-item input:checked');
            modal.querySelector('#selectNoteCount').textContent = `${checked.length} selected`;
        };

        modal.querySelectorAll('.ai-batch-note-item input').forEach(cb => {
            cb.addEventListener('change', updateCount);
        });

        modal.querySelectorAll('.ai-batch-note-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.tagName === 'INPUT') return;
                const cb = item.querySelector('input');
                if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
            });
        });

        modal.querySelector('#selectAllNotes').addEventListener('click', () => {
            modal.querySelectorAll('.ai-batch-note-item input').forEach(cb => { cb.checked = true; });
            updateCount();
        });

        modal.querySelector('#deselectAllNotes').addEventListener('click', () => {
            modal.querySelectorAll('.ai-batch-note-item input').forEach(cb => { cb.checked = false; });
            updateCount();
        });

        modal.querySelector('#selectNotesApply').addEventListener('click', () => {
            chat.contextBlockIds = new Set();
            modal.querySelectorAll('.ai-batch-note-item input:checked').forEach(cb => {
                chat.contextBlockIds.add(cb.dataset.blockId);
            });
            this._renderActiveChat();
            this._renderTabs();
            modal.close();
        });

        modal.querySelector('#selectNotesCancel').addEventListener('click', () => {
            modal.close();
        });
    },

    // ==============================
    // Settings Modal
    // ==============================

    openSettingsModal() {
        // Delegate to settings view's AI section rendering
        if (typeof SettingsView !== 'undefined' && SettingsView.openAISettingsModal) {
            SettingsView.openAISettingsModal();
        }
    },

    // ==============================
    // Utilities
    // ==============================

    _extractTitle(block) {
        const content = block.content || '';
        const headingMatch = content.match(/^#{1,6}\s+(.+)/m);
        if (headingMatch) return headingMatch[1].slice(0, 60);
        const firstLine = content.split('\n')[0] || block.id;
        return firstLine.slice(0, 60);
    },

    _stripCodeFences(text) {
        // Try single surrounding fence first
        const single = text.match(/^```[\w]*\n([\s\S]*?)\n```\s*$/);
        if (single) return single[1];
        // Strip all code fences
        return text.replace(/^```[\w]*\n?/gm, '').replace(/\n?```\s*$/gm, '');
    },

    _parseChunkedResponse(text, inputBlockIds) {
        const results = [];
        const inputSet = new Set(inputBlockIds);
        const regex = /<<<NOTE:(.+?)>>>[ \t]*\r?\n([\s\S]*?)(?=<<<NOTE:|$)/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            const id = match[1].trim();
            const content = match[2].replace(/\n+$/, '');
            results.push({ blockId: id, content, isNew: !inputSet.has(id) });
        }
        return results;
    },

    _parseCreateNoteResponse(text) {
        const results = [];
        const regex = /<<<CREATE_NOTE>>>([\s\S]*?)<<<END_CREATE>>>/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            const content = match[1].trim();
            if (!content) continue;
            const title = content.match(/^#{1,6}\s+(.+)/m)?.[1] || content.split('\n')[0] || 'New Note';
            results.push({ content, title });
        }
        return results;
    }
};

window.AIAssistantReal = AIAssistantReal;

// Dispatch event to notify stub that the real module is loaded
window.dispatchEvent(new Event('AIAssistantLoaded'));
