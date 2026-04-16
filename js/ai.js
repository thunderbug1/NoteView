/**
 * AI Assistant Module
 * Integrates OpenAI-compatible LLM endpoints for note transformation.
 * Supports multiple model profiles, configurable presets, streaming, and diff-based apply.
 */
const AIAssistant = {
    // State
    enabled: false,
    profiles: [],      // {id, name, endpointUrl, model} — NO apiKey
    presets: [],
    _apiKeys: {},      // {profileId: apiKey} — loaded from keys.json
    _activeOverlay: null,
    _abortController: null,
    _streamingResponse: '',
    _currentBlockId: null,
    _lastProfileId: null,
    _diffEditorView: null,

    // --- Initialization ---

    async init() {
        const settings = await AppSettings.load();
        const ai = settings.ai || {};

        this.enabled = !!ai.enabled;
        this._lastProfileId = ai.lastProfileId || null;

        // Load profiles (without keys) from settings
        this.profiles = Array.isArray(ai.profiles)
            ? ai.profiles.map(p => ({ id: p.id, name: p.name, endpointUrl: p.endpointUrl, model: p.model }))
            : [];

        // Load API keys from separate file
        this._apiKeys = await AppSettings.loadKeys();

        if (Array.isArray(ai.presets) && ai.presets.length > 0) {
            this.presets = ai.presets;
        } else {
            this.presets = this._defaultPresets();
            await this._persist();
        }
    },

    _defaultPresets() {
        return [
            { id: 'preset-default-summarize', title: 'Summarize', instruction: 'Summarize this note concisely, preserving all key facts and action items.' },
            { id: 'preset-default-expand', title: 'Expand', instruction: 'Expand on the ideas in this note. Add more detail, examples, and structure while keeping the original intent.' },
            { id: 'preset-default-fix', title: 'Fix Grammar', instruction: 'Fix grammar, spelling, and punctuation in this note. Keep the original meaning and style.' },
            { id: 'preset-default-todo', title: 'Extract Tasks', instruction: 'Extract all action items and tasks from this note. Format them as a markdown task list with checkboxes.' }
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
            lastProfileId: this._lastProfileId
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
        // Save key separately
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

        // Handle apiKey separately
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

    // --- Overlay UI ---

    openOverlay(blockId) {
        if (!this.enabled) return;
        if (this.profiles.length === 0) {
            this._showToast('Add an AI model profile in Settings first');
            return;
        }

        this._currentBlockId = blockId;
        this._streamingResponse = '';

        const selectedId = this._lastProfileId && this.profiles.find(p => p.id === this._lastProfileId)
            ? this._lastProfileId
            : this.profiles[0].id;

        const filteredCount = Store.getFilteredBlocks().length;

        const profileOptions = this.profiles.map(p =>
            `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${this._escHtml(p.name)} (${this._escHtml(p.model)})</option>`
        ).join('');

        const presetChips = this.presets.map(p =>
            `<button class="ai-preset-chip" data-preset-id="${p.id}" title="${this._escHtml(p.instruction)}">${this._escHtml(p.title)}</button>`
        ).join('');

        const content = `
            <div class="ai-model-row">
                <select class="ai-model-select" id="aiModelSelect">${profileOptions}</select>
            </div>
            <div class="ai-scope-toggle">
                <button class="ai-scope-option active" data-scope="single">This note</button>
                <button class="ai-scope-option" data-scope="full">Full context (${filteredCount} notes)</button>
            </div>
            ${presetChips ? `<div class="ai-preset-chips">${presetChips}</div>` : ''}
            <textarea class="ai-instruction-input" id="aiInstruction" placeholder="Tell the AI what to do with this note..." rows="3"></textarea>
            <div class="ai-action-row">
                <button class="ai-send-btn" id="aiSendBtn">Send</button>
                <button class="ai-stop-btn" id="aiStopBtn">Stop</button>
            </div>
            <div class="ai-response-area" id="aiResponseArea">
                <div class="ai-streaming-indicator" id="aiStreamingIndicator">Generating...</div>
                <div class="ai-response-content" id="aiResponseContent"></div>
            </div>
            <div class="ai-error" id="aiError" style="display:none"></div>
            <div class="ai-diff-container" id="aiDiffContainer">
                <div class="ai-diff-editor" id="aiDiffEditor"></div>
                <div class="ai-diff-actions">
                    <button class="ai-reject-btn" id="aiRejectBtn">Reject</button>
                    <button class="ai-accept-btn" id="aiAcceptBtn">Accept Changes</button>
                </div>
            </div>
            <div class="ai-no-changes" id="aiNoChanges" style="display:none">No changes detected</div>
        `;

        const modal = Modal.create({
            title: 'AI Assistant',
            content,
            modalClass: 'tag-modal ai-modal',
            onClose: () => { this._cleanup(); }
        });

        this._activeOverlay = modal;
        this._wireOverlayEvents(modal, blockId);
    },

    _wireOverlayEvents(modal, blockId) {
        modal.querySelectorAll('.ai-scope-option').forEach(btn => {
            btn.addEventListener('click', () => {
                modal.querySelectorAll('.ai-scope-option').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        const instructionEl = modal.querySelector('#aiInstruction');
        modal.querySelectorAll('.ai-preset-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const isActive = chip.classList.contains('active');
                modal.querySelectorAll('.ai-preset-chip').forEach(c => c.classList.remove('active'));
                if (!isActive) {
                    chip.classList.add('active');
                    instructionEl.value = chip.dataset.presetId ? this.presets.find(p => p.id === chip.dataset.presetId)?.instruction || '' : '';
                } else {
                    instructionEl.value = '';
                }
            });
        });

        const sendBtn = modal.querySelector('#aiSendBtn');
        const stopBtn = modal.querySelector('#aiStopBtn');
        sendBtn.addEventListener('click', () => {
            const instruction = instructionEl.value.trim();
            if (!instruction) return;
            const profileId = modal.querySelector('#aiModelSelect').value;
            const scope = modal.querySelector('.ai-scope-option.active')?.dataset.scope || 'single';
            this._send(blockId, instruction, scope, profileId, modal);
        });

        stopBtn.addEventListener('click', () => {
            if (this._abortController) this._abortController.abort();
        });

        modal.querySelector('#aiAcceptBtn').addEventListener('click', () => {
            this._acceptChanges(blockId);
        });

        modal.querySelector('#aiRejectBtn').addEventListener('click', () => {
            this.closeOverlay();
        });
    },

    closeOverlay() {
        if (this._abortController) this._abortController.abort();
        this._cleanup();
        if (this._activeOverlay) {
            this._activeOverlay.close();
            this._activeOverlay = null;
        }
    },

    _cleanup() {
        if (this._abortController) {
            try { this._abortController.abort(); } catch {}
            this._abortController = null;
        }
        if (this._diffEditorView) {
            try { this._diffEditorView.destroy(); } catch {}
            this._diffEditorView = null;
        }
        this._streamingResponse = '';
    },

    // --- Core AI ---

    async _send(blockId, instruction, scope, profileId, modal) {
        const profile = this.profiles.find(p => p.id === profileId);
        if (!profile) return;

        const apiKey = this._apiKeys[profileId] || '';
        if (!apiKey) {
            const errorEl = modal.querySelector('#aiError');
            errorEl.style.display = '';
            errorEl.textContent = 'No API key configured for this profile. Edit the profile in Settings to add one.';
            return;
        }

        this._lastProfileId = profileId;
        this._persist(); // fire and forget

        modal.querySelector('#aiSendBtn').disabled = true;
        modal.querySelector('#aiStopBtn').classList.add('visible');
        modal.querySelector('#aiResponseArea').classList.add('visible');
        modal.querySelector('#aiResponseContent').textContent = '';
        modal.querySelector('#aiStreamingIndicator').style.display = '';
        modal.querySelector('#aiError').style.display = 'none';
        modal.querySelector('#aiDiffContainer').classList.remove('visible');
        modal.querySelector('#aiNoChanges').style.display = 'none';

        this._streamingResponse = '';
        this._abortController = new AbortController();

        const messages = this._buildMessages(blockId, instruction, scope);
        const url = profile.endpointUrl.replace(/\/+$/, '') + '/chat/completions';

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
                signal: this._abortController.signal
            });

            if (!response.ok) {
                let errMsg = `HTTP ${response.status}`;
                if (response.status === 401) errMsg = 'Authentication failed. Check your API key.';
                else if (response.status === 429) errMsg = 'Rate limited. Please wait and try again.';
                else if (response.status >= 500) errMsg = `Server error: ${response.status} ${response.statusText}`;
                throw new Error(errMsg);
            }

            await this._readStream(response, modal);

            modal.querySelector('#aiStreamingIndicator').style.display = 'none';
            modal.querySelector('#aiStopBtn').classList.remove('visible');
            modal.querySelector('#aiSendBtn').disabled = false;

            const block = Store.blocks.find(b => b.id === blockId);
            const original = block ? block.content || '' : '';
            let modified = this._stripCodeFences(this._streamingResponse);

            if (modified === original) {
                modal.querySelector('#aiNoChanges').style.display = '';
                modal.querySelector('#aiResponseArea').classList.remove('visible');
            } else {
                this._showDiff(modal, original, modified);
            }

        } catch (err) {
            if (err.name === 'AbortError') {
                modal.querySelector('#aiStreamingIndicator').style.display = 'none';
                modal.querySelector('#aiStopBtn').classList.remove('visible');
                modal.querySelector('#aiSendBtn').disabled = false;
                return;
            }
            const errorEl = modal.querySelector('#aiError');
            errorEl.style.display = '';
            errorEl.innerHTML = `${this._escHtml(err.message)}<br><button class="ai-retry-btn">Retry</button>`;
            errorEl.querySelector('.ai-retry-btn').addEventListener('click', () => {
                errorEl.style.display = 'none';
                modal.querySelector('#aiResponseArea').classList.remove('visible');
                this._send(blockId, instruction, scope, profileId, modal);
            });
            modal.querySelector('#aiStreamingIndicator').style.display = 'none';
            modal.querySelector('#aiStopBtn').classList.remove('visible');
            modal.querySelector('#aiSendBtn').disabled = false;
        }
    },

    async _readStream(response, modal) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const contentEl = modal.querySelector('#aiResponseContent');

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') return;
                try {
                    const parsed = JSON.parse(data);
                    const content = parsed.choices?.[0]?.delta?.content || '';
                    if (content) {
                        this._streamingResponse += content;
                        contentEl.textContent = this._streamingResponse;
                        contentEl.scrollTop = contentEl.scrollHeight;
                    }
                } catch { /* skip malformed chunks */ }
            }
        }
    },

    _buildMessages(blockId, instruction, scope) {
        const systemPrompt = `You are an AI assistant integrated into NoteView, a markdown note-taking app. The user will provide one or more markdown notes as context. Follow the user's instruction and return the COMPLETE modified content of the target note in markdown format. Do not wrap your response in code fences. Output only the final markdown content.`;

        const messages = [{ role: 'system', content: systemPrompt }];

        if (scope === 'full') {
            const blocks = Store.getFilteredBlocks();
            const contextParts = blocks.map((b, i) =>
                `--- Note ${i + 1} (ID: ${b.id}) ---\n${b.content || ''}`
            );
            messages.push({
                role: 'user',
                content: `Here are all the notes in the current view:\n\n${contextParts.join('\n\n')}\n\nNow, apply the following instruction to Note with ID "${blockId}":\n${instruction}`
            });
        } else {
            const block = Store.blocks.find(b => b.id === blockId);
            messages.push({
                role: 'user',
                content: `Here is the note:\n\n${block?.content || ''}\n\nApply the following instruction and return the complete modified note:\n${instruction}`
            });
        }

        return messages;
    },

    // --- Diff View ---

    _showDiff(modal, original, modified) {
        modal.querySelector('#aiResponseArea').classList.remove('visible');

        const container = modal.querySelector('#aiDiffEditor');
        container.innerHTML = '';

        const createDiff = () => {
            const { EditorView, EditorState, basicSetup, unifiedMergeView } = window.CodeMirror;
            this._diffEditorView = new EditorView({
                doc: modified,
                extensions: [
                    basicSetup,
                    unifiedMergeView({
                        original: original,
                        mergeControls: false
                    }),
                    EditorView.theme({
                        '&': { height: '100%', width: '100%', fontFamily: 'Inter, sans-serif' },
                        '.cm-merge-deleted': { backgroundColor: 'rgba(244, 63, 94, 0.2)", textDecoration: "line-through' },
                        '.cm-merge-inserted': { backgroundColor: 'rgba(16, 185, 129, 0.2)', outline: 'none' }
                    }),
                    EditorView.editable.of(false),
                    EditorState.readOnly.of(true)
                ],
                parent: container
            });
        };

        if (window.CodeMirror && window.CodeMirror.basicSetup) {
            createDiff();
        } else {
            window.addEventListener('CodeMirrorReady', createDiff, { once: true });
        }

        modal.querySelector('#aiDiffContainer').classList.add('visible');
    },

    // --- Accept / Reject ---

    async _acceptChanges(blockId) {
        const block = Store.blocks.find(b => b.id === blockId);
        if (!block) return;

        const newContent = this._stripCodeFences(this._streamingResponse);

        await Store.saveBlock(block, {
            content: newContent,
            commit: true,
            commitMessage: 'AI: modified note'
        });

        TimelineView.invalidateCache();
        SelectionManager.updateTagCounts();

        this.closeOverlay();

        if (typeof App !== 'undefined' && App.render) App.render();
    },

    // --- Utility ---

    _stripCodeFences(text) {
        return text.replace(/^```[\w]*\n([\s\S]*?)\n```\s*$/, '$1');
    },

    _escHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    _showToast(message) {
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);padding:0.75rem 1.5rem;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:0.85rem;z-index:10001;box-shadow:var(--shadow-lg);transition:opacity 0.3s;opacity:1;';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
    }
};

window.AIAssistant = AIAssistant;
