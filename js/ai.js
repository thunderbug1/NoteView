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
    _lastInstruction: '',
    _diffEditorView: null,

    // Batch state
    _batchOverlay: null,
    _batchResults: [],
    _batchAbort: false,
    _batchAbortController: null,

    // --- Initialization ---

    async init() {
        const settings = await AppSettings.load();
        const ai = settings.ai || {};

        this.enabled = !!ai.enabled;
        this._lastProfileId = ai.lastProfileId || null;
        this._lastInstruction = ai.lastInstruction || '';

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
            { id: 'preset-default-todo', title: 'Extract Tasks', instruction: 'Extract all action items and tasks from this note. Format them as a markdown task list with checkboxes.' },
            { id: 'preset-default-last', title: 'Last', instruction: '' }
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

    // --- Import from another vault ---

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
        } catch {
            return null;
        } finally {
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
                    const preset = chip.dataset.presetId ? this.presets.find(p => p.id === chip.dataset.presetId) : null;
                    if (preset?.id === 'preset-default-last') {
                        instructionEl.value = this._lastInstruction;
                    } else {
                        instructionEl.value = preset?.instruction || '';
                    }
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

        this._lastInstruction = instruction;
        this._persist();

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
            const raw = this._streamingResponse.trim();

            if (!raw) {
                modal.querySelector('#aiNoChanges').style.display = '';
                modal.querySelector('#aiResponseArea').classList.remove('visible');
                return;
            }

            let modified = this._stripCodeFences(raw);

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
        const systemPrompt = `Return only the modified markdown. No code fences, no commentary. If no changes are needed, return nothing.`;

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

    // --- Batch AI ---

    openBatchOverlay() {
        if (!this.isConfigured()) return;

        const blocks = Store.getFilteredBlocks();
        if (blocks.length === 0) {
            this._showToast('No notes in current view');
            return;
        }

        const selectedId = this._lastProfileId && this.profiles.find(p => p.id === this._lastProfileId)
            ? this._lastProfileId
            : this.profiles[0].id;

        const profileOptions = this.profiles.map(p =>
            `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${this._escHtml(p.name)} (${this._escHtml(p.model)})</option>`
        ).join('');

        const presetChips = this.presets.map(p =>
            `<button class="ai-preset-chip" data-preset-id="${p.id}" title="${this._escHtml(p.instruction)}">${this._escHtml(p.title)}</button>`
        ).join('');

        const noteItems = blocks.map(b => {
            const title = this._extractTitle(b);
            return `<div class="ai-batch-note-item">
                <input type="checkbox" checked data-block-id="${this._escHtml(b.id)}">
                <span class="ai-batch-note-title">${this._escHtml(title)}</span>
            </div>`;
        }).join('');

        const content = `
            <div class="ai-model-row">
                <select class="ai-model-select" id="batchModelSelect">${profileOptions}</select>
            </div>
            <div class="ai-batch-mode-toggle">
                <button class="ai-scope-option active" data-mode="sequential">Sequential</button>
                <button class="ai-scope-option" data-mode="parallel">Parallel</button>
            </div>
            ${presetChips ? `<div class="ai-preset-chips">${presetChips}</div>` : ''}
            <textarea class="ai-instruction-input" id="batchInstruction" placeholder="Tell the AI what to do with all selected notes..." rows="3"></textarea>
            <div class="ai-batch-note-list-header">
                <span class="ai-batch-note-count" id="batchNoteCount">${blocks.length} notes selected</span>
                <div class="ai-batch-select-actions">
                    <button class="ai-batch-select-action" id="batchSelectAll">Select All</button>
                    <button class="ai-batch-select-action" id="batchDeselectAll">Deselect All</button>
                </div>
            </div>
            <div class="ai-batch-note-list" id="batchNoteList">${noteItems}</div>
            <div class="ai-action-row">
                <button class="ai-send-btn" id="batchRunBtn">Run on ${blocks.length} notes</button>
                <button class="ai-stop-btn" id="batchStopBtn">Stop</button>
            </div>
            <div class="ai-batch-progress-area" id="batchProgressArea" style="display:none">
                <div class="ai-batch-progress-text" id="batchProgressText"></div>
                <div class="ai-batch-progress-bar"><div class="ai-batch-progress-fill" id="batchProgressFill"></div></div>
                <div class="ai-batch-completed-list" id="batchCompletedList"></div>
            </div>
            <div class="ai-batch-review-layout" id="batchReviewLayout" style="display:none">
                <div class="ai-batch-review-list" id="batchReviewList"></div>
                <div class="ai-batch-review-diff" id="batchReviewDiff"></div>
            </div>
            <div class="ai-batch-review-actions" id="batchReviewActions" style="display:none">
                <button class="ai-reject-btn" id="batchRejectOne">Reject This</button>
                <button class="ai-accept-btn" id="batchAcceptOne">Accept This</button>
                <span class="ai-batch-review-count" id="batchReviewCount"></span>
                <button class="ai-reject-btn" id="batchRejectAll">Reject All</button>
                <button class="ai-accept-btn" id="batchAcceptAll">Accept All</button>
            </div>
        `;

        const modal = Modal.create({
            title: 'Batch AI Assistant',
            content,
            modalClass: 'tag-modal ai-modal ai-batch-modal',
            onClose: () => { this._batchOverlay = null; }
        });

        this._batchOverlay = modal;
        this._batchResults = [];
        this._batchAbort = false;
        this._wireBatchEvents(modal, blocks);
    },

    _wireBatchEvents(modal, blocks) {
        // Mode toggle
        modal.querySelectorAll('.ai-batch-mode-toggle .ai-scope-option').forEach(btn => {
            btn.addEventListener('click', () => {
                modal.querySelectorAll('.ai-batch-mode-toggle .ai-scope-option').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // Preset chips
        const instructionEl = modal.querySelector('#batchInstruction');
        modal.querySelectorAll('.ai-preset-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const isActive = chip.classList.contains('active');
                modal.querySelectorAll('.ai-preset-chip').forEach(c => c.classList.remove('active'));
                if (!isActive) {
                    chip.classList.add('active');
                    const preset = chip.dataset.presetId ? this.presets.find(p => p.id === chip.dataset.presetId) : null;
                    if (preset?.id === 'preset-default-last') {
                        instructionEl.value = this._lastInstruction;
                    } else {
                        instructionEl.value = preset?.instruction || '';
                    }
                } else {
                    instructionEl.value = '';
                }
            });
        });

        // Note list checkbox changes
        const updateRunBtn = () => {
            const checked = modal.querySelectorAll('.ai-batch-note-item input:checked');
            const runBtn = modal.querySelector('#batchRunBtn');
            const countEl = modal.querySelector('#batchNoteCount');
            const count = checked.length;
            countEl.textContent = `${count} note${count !== 1 ? 's' : ''} selected`;
            runBtn.textContent = `Run on ${count} note${count !== 1 ? 's' : ''}`;
            runBtn.disabled = count === 0;
        };

        modal.querySelectorAll('.ai-batch-note-item input').forEach(cb => {
            cb.addEventListener('change', updateRunBtn);
        });

        modal.querySelectorAll('.ai-batch-note-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.tagName === 'INPUT') return;
                const cb = item.querySelector('input[type="checkbox"]');
                if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
            });
        });

        modal.querySelector('#batchSelectAll').addEventListener('click', () => {
            modal.querySelectorAll('.ai-batch-note-item input').forEach(cb => { cb.checked = true; });
            updateRunBtn();
        });

        modal.querySelector('#batchDeselectAll').addEventListener('click', () => {
            modal.querySelectorAll('.ai-batch-note-item input').forEach(cb => { cb.checked = false; });
            updateRunBtn();
        });

        // Run / Stop
        modal.querySelector('#batchRunBtn').addEventListener('click', () => {
            const instruction = instructionEl.value.trim();
            if (!instruction) return;
            const profileId = modal.querySelector('#batchModelSelect').value;
            const modeBtn = modal.querySelector('.ai-batch-mode-toggle .ai-scope-option.active');
            const mode = modeBtn?.dataset.mode || 'sequential';
            const selectedIds = [...modal.querySelectorAll('.ai-batch-note-item input:checked')].map(cb => cb.dataset.blockId);
            if (selectedIds.length === 0) return;
            this._runBatch(instruction, profileId, selectedIds, mode, modal);
        });

        modal.querySelector('#batchStopBtn').addEventListener('click', () => {
            this._batchAbort = true;
            if (this._batchAbortController) this._batchAbortController.abort();
        });

        // Review actions
        modal.querySelector('#batchAcceptOne').addEventListener('click', () => {
            const idx = this._getSelectedReviewIndex(modal);
            if (idx !== -1) this._acceptBatchNote(idx, modal);
        });

        modal.querySelector('#batchRejectOne').addEventListener('click', () => {
            const idx = this._getSelectedReviewIndex(modal);
            if (idx !== -1) this._rejectBatchNote(idx, modal);
        });

        modal.querySelector('#batchAcceptAll').addEventListener('click', () => {
            for (let i = 0; i < this._batchResults.length; i++) {
                if (this._batchResults[i].status === 'pending') this._acceptBatchNote(i, modal);
            }
            this._finalizeBatch();
            this._closeBatchOverlay();
        });

        modal.querySelector('#batchRejectAll').addEventListener('click', () => {
            for (let i = 0; i < this._batchResults.length; i++) {
                if (this._batchResults[i].status === 'pending') this._batchResults[i].status = 'rejected';
            }
            this._closeBatchOverlay();
        });
    },

    async _runBatch(instruction, profileId, selectedBlockIds, mode, modal) {
        const profile = this.profiles.find(p => p.id === profileId);
        if (!profile) return;

        const apiKey = this._apiKeys[profileId] || '';
        if (!apiKey) {
            this._showToast('No API key configured for this profile');
            return;
        }

        this._lastProfileId = profileId;
        this._persist();
        this._batchResults = [];
        this._batchAbort = false;

        const updateUI = !!modal;
        if (updateUI) {
            modal.querySelector('#batchRunBtn').disabled = true;
            modal.querySelector('#batchStopBtn').classList.add('visible');
            modal.querySelector('#batchProgressArea').style.display = '';
            modal.querySelector('#batchReviewLayout').style.display = 'none';
            modal.querySelector('#batchReviewActions').style.display = 'none';
        }

        const total = selectedBlockIds.length;

        if (mode === 'parallel') {
            await this._runBatchParallel(instruction, profile, apiKey, selectedBlockIds, modal, total);
        } else {
            await this._runBatchSequential(instruction, profile, apiKey, selectedBlockIds, modal, total);
        }

        if (this._batchAbort) return;

        // Modal was closed during processing — reopen for review
        if (!this._batchOverlay) {
            this._showBatchToast(`Batch complete: ${this._batchResults.filter(r => r.status === 'pending').length} notes to review`);
            modal = this._reopenBatchModal();
            if (!modal) return;
        }

        if (modal.querySelector('#batchStopBtn')) modal.querySelector('#batchStopBtn').classList.remove('visible');
        this._showBatchReview(modal);
    },

    // --- Chunked batch processing ---

    _chunkBlocks(blockIds, maxChars = 15000) {
        const chunks = [];
        let current = [];
        let currentLen = 0;

        for (const id of blockIds) {
            const block = Store.blocks.find(b => b.id === id);
            const len = (block?.content || '').length;
            if (current.length > 0 && (currentLen + len > maxChars || current.length >= 10)) {
                chunks.push(current);
                current = [];
                currentLen = 0;
            }
            current.push(id);
            currentLen += len;
        }
        if (current.length > 0) chunks.push(current);
        return chunks;
    },

    _buildChunkedMessages(blockIds, instruction) {
        const systemPrompt = `You are an AI assistant integrated into NoteView, a markdown note-taking app. The user provides markdown notes separated by <<<NOTE:id>>> markers. Apply the instruction to the notes. Return the modified notes using the same <<<NOTE:id>>> separator format. You may modify any note (keeping its ID), create new notes (use a descriptive new ID prefixed with "new-"), split a note into multiple notes (use new IDs), or omit notes to leave them unchanged. Output ONLY the note markers and content. No code fences, no commentary.`;

        const parts = blockIds.map(id => {
            const block = Store.blocks.find(b => b.id === id);
            return `<<<NOTE:${id}>>>\n${block?.content || ''}`;
        });

        return [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `${parts.join('\n')}\n\n${instruction}` }
        ];
    },

    _parseChunkedResponse(text, inputBlockIds) {
        const results = [];
        const inputSet = new Set(inputBlockIds);
        const regex = /<<<NOTE:(.+?)>>>\n([\s\S]*?)(?=<<<NOTE:|$)/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            const id = match[1].trim();
            const content = match[2].replace(/\n+$/, '');
            results.push({ blockId: id, content, isNew: !inputSet.has(id) });
        }
        return results;
    },

    async _processChunk(instruction, profile, apiKey, blockIds, externalSignal) {
        const messages = this._buildChunkedMessages(blockIds, instruction);
        const url = profile.endpointUrl.replace(/\/+$/, '') + '/chat/completions';
        const maxRetries = 3;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            if (externalSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const controller = new AbortController();
            let onExternalAbort;
            if (externalSignal) {
                if (externalSignal.aborted) { controller.abort(); }
                else {
                    onExternalAbort = () => controller.abort();
                    externalSignal.addEventListener('abort', onExternalAbort);
                }
            }
            this._batchAbortController = controller;

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
                    signal: controller.signal
                });

                if (!response.ok) {
                    if (response.status === 429 && attempt < maxRetries) {
                        const delay = Math.pow(2, attempt) * 2000;
                        await new Promise(r => setTimeout(r, delay));
                        continue;
                    }
                    let errMsg = `HTTP ${response.status}`;
                    if (response.status === 401) errMsg = 'Authentication failed';
                    else if (response.status === 429) errMsg = 'Rate limited';
                    throw new Error(errMsg);
                }

                const raw = await this._readChunkStream(response);
                return this._parseChunkedResponse(raw, blockIds);
            } finally {
                if (externalSignal && onExternalAbort) {
                    externalSignal.removeEventListener('abort', onExternalAbort);
                }
            }
        }
    },

    async _readChunkStream(response) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let result = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') return this._stripCodeFences(result);
                try {
                    const parsed = JSON.parse(data);
                    const content = parsed.choices?.[0]?.delta?.content || '';
                    if (content) result += content;
                } catch { /* skip malformed chunks */ }
            }
        }

        return this._stripCodeFences(result);
    },

    _addChunkResults(chunkResults, chunkBlockIds, startIndex) {
        const inputSet = new Set(chunkBlockIds);
        const returnedIds = new Set();

        for (const r of chunkResults) {
            returnedIds.add(r.blockId);
            const block = Store.blocks.find(b => b.id === r.blockId);
            if (r.isNew) {
                const title = r.content.match(/^#{1,6}\s+(.+)/m)?.[1] || r.content.split('\n')[0] || 'New note';
                this._batchResults.push({
                    blockId: r.blockId, title,
                    original: '', modified: r.content,
                    status: 'pending', isNew: true
                });
            } else {
                const original = block?.content || '';
                this._batchResults.push({
                    blockId: r.blockId, title: this._extractTitle(block || { id: r.blockId, content: original }),
                    original, modified: r.content,
                    status: r.content === original ? 'unchanged' : 'pending'
                });
            }
        }

        // Notes not returned by AI = unchanged
        for (const id of chunkBlockIds) {
            if (!returnedIds.has(id)) {
                const block = Store.blocks.find(b => b.id === id);
                this._batchResults.push({
                    blockId: id, title: this._extractTitle(block || { id }),
                    original: block?.content || '', modified: block?.content || '',
                    status: 'unchanged'
                });
            }
        }
    },

    async _runBatchSequential(instruction, profile, apiKey, selectedBlockIds, modal, total) {
        const chunks = this._chunkBlocks(selectedBlockIds);

        for (const chunk of chunks) {
            if (this._batchAbort) break;

            this._updateBatchProgress(modal, this._batchResults.length, total, chunk.join(', '));

            try {
                const chunkResults = await this._processChunk(instruction, profile, apiKey, chunk);
                this._addChunkResults(chunkResults, chunk);
            } catch (err) {
                if (err.name === 'AbortError') break;
                for (const blockId of chunk) {
                    const block = Store.blocks.find(b => b.id === blockId);
                    this._batchResults.push({
                        blockId, title: this._extractTitle(block || { id: blockId }),
                        original: block?.content || '', modified: block?.content || '',
                        status: 'error', error: err.message
                    });
                }
            }

            const done = this._batchResults.length;
            this._updateBatchProgress(modal, done, total, chunk[chunk.length - 1]);
            for (let i = done - chunk.length; i < done; i++) {
                this._updateBatchCompletedList(modal, i, total);
            }
        }
    },

    async _runBatchParallel(instruction, profile, apiKey, selectedBlockIds, modal, total) {
        this._batchAbortController = new AbortController();
        const signal = this._batchAbortController.signal;
        const chunks = this._chunkBlocks(selectedBlockIds);
        const concurrency = 3;

        let nextIndex = 0;
        const workers = Array.from({ length: Math.min(concurrency, chunks.length) }, async () => {
            while (nextIndex < chunks.length && !this._batchAbort) {
                const ci = nextIndex++;
                const chunk = chunks[ci];

                try {
                    const chunkResults = await this._processChunk(instruction, profile, apiKey, chunk, signal);
                    this._addChunkResults(chunkResults, chunk);
                } catch (err) {
                    for (const blockId of chunk) {
                        const block = Store.blocks.find(b => b.id === blockId);
                        this._batchResults.push({
                            blockId, title: this._extractTitle(block || { id: blockId }),
                            original: block?.content || '', modified: block?.content || '',
                            status: 'error', error: err.name === 'AbortError' ? 'Cancelled' : err.message
                        });
                    }
                }

                const done = this._batchResults.length;
                this._updateBatchProgress(modal, done, total, chunk[chunk.length - 1]);
                for (let i = done - chunk.length; i < done; i++) {
                    this._updateBatchCompletedList(modal, i, total);
                }
            }
        });

        await Promise.allSettled(workers);
    },

    _updateBatchProgress(modal, current, total, blockId) {
        if (!modal) return;
        const text = modal.querySelector('#batchProgressText');
        const fill = modal.querySelector('#batchProgressFill');
        if (text) text.textContent = `Processing note ${current + 1} of ${total}: ${blockId}`;
        if (fill) fill.style.width = `${((current + 1) / total) * 100}%`;
    },

    _updateBatchCompletedList(modal, index, total) {
        if (!modal) return;
        const list = modal.querySelector('#batchCompletedList');
        if (!list) return;
        const result = this._batchResults.filter(Boolean)[index] || this._batchResults[index];
        if (!result) return;
        const statusText = result.status === 'unchanged' ? 'No changes' :
                           result.status === 'error' ? `Error: ${result.error}` : 'Changes detected';
        const statusClass = result.status === 'unchanged' ? 'unchanged' :
                            result.status === 'error' ? 'error' : 'has-changes';
        const item = document.createElement('div');
        item.className = `ai-batch-completed-item ${statusClass}`;
        item.textContent = `${result.title} — ${statusText}`;
        list.appendChild(item);
    },

    _showBatchReview(modal) {
        const results = this._batchResults.filter(Boolean);
        if (results.length === 0) {
            this._showToast('No notes were processed');
            this._closeBatchOverlay();
            return;
        }

        modal.querySelector('#batchProgressArea').style.display = 'none';
        modal.querySelector('#batchReviewLayout').style.display = '';
        modal.querySelector('#batchReviewActions').style.display = '';

        const listEl = modal.querySelector('#batchReviewList');
        listEl.innerHTML = results.map((r, i) => {
            const statusIcon = r.isNew ? '+' :
                               r.status === 'unchanged' ? '—' :
                               r.status === 'error' ? '!' : '●';
            const statusClass = r.isNew ? 'new-note' :
                                r.status === 'unchanged' ? 'unchanged' :
                                r.status === 'error' ? 'error' :
                                r.status === 'accepted' ? 'accepted' :
                                r.status === 'rejected' ? 'rejected' : 'pending';
            const prefix = r.isNew ? '<span class="ai-batch-new-badge">new</span>' : '';
            return `<div class="ai-batch-review-item ${statusClass}" data-index="${i}">
                <span class="ai-batch-review-status">${statusIcon}</span>
                ${prefix}<span class="ai-batch-review-title">${this._escHtml(r.title)}</span>
            </div>`;
        }).join('');

        listEl.querySelectorAll('.ai-batch-review-item').forEach(item => {
            item.addEventListener('click', () => {
                listEl.querySelectorAll('.ai-batch-review-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                this._selectBatchReviewItem(parseInt(item.dataset.index), modal);
            });
        });

        // Select first actionable note
        const firstPending = results.findIndex(r => r.status === 'pending');
        const firstIdx = firstPending !== -1 ? firstPending : 0;
        const firstItem = listEl.querySelector(`[data-index="${firstIdx}"]`);
        if (firstItem) firstItem.click();

        this._updateReviewCount(modal);
    },

    _selectBatchReviewItem(index, modal) {
        const container = modal.querySelector('#batchReviewDiff');
        container.innerHTML = '';

        const result = this._batchResults.filter(Boolean)[index];
        if (!result || result.status === 'unchanged' || result.status === 'error') {
            container.innerHTML = `<div class="ai-no-changes">${result?.status === 'error' ? this._escHtml(result.error) : 'No changes detected'}</div>`;
            return;
        }

        // New notes: show content directly (no diff possible)
        if (result.isNew) {
            container.innerHTML = `<div class="ai-batch-new-preview"><pre>${this._escHtml(result.modified)}</pre></div>`;
            return;
        }

        const createDiff = () => {
            const { EditorView, EditorState, basicSetup, unifiedMergeView } = window.CodeMirror;
            if (this._diffEditorView) {
                try { this._diffEditorView.destroy(); } catch {}
                this._diffEditorView = null;
            }
            this._diffEditorView = new EditorView({
                doc: result.modified,
                extensions: [
                    basicSetup,
                    unifiedMergeView({
                        original: result.original,
                        mergeControls: false
                    }),
                    EditorView.theme({
                        '&': { height: '100%', width: '100%', fontFamily: 'Inter, sans-serif' },
                        '.cm-merge-deleted': { backgroundColor: 'rgba(244, 63, 94, 0.2)', textDecoration: 'line-through' },
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
    },

    _getSelectedReviewIndex(modal) {
        const active = modal.querySelector('.ai-batch-review-item.active');
        return active ? parseInt(active.dataset.index) : -1;
    },

    async _acceptBatchNote(index, modal) {
        const results = this._batchResults.filter(Boolean);
        const result = results[index];
        if (!result || result.status !== 'pending') return;

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

        result.status = 'accepted';

        // Update UI
        const item = modal.querySelector(`.ai-batch-review-item[data-index="${index}"]`);
        if (item) {
            item.classList.remove('pending');
            item.classList.add('accepted');
            item.querySelector('.ai-batch-review-status').textContent = '✓';
        }

        // Advance to next pending
        const nextPending = results.findIndex((r, i) => i > index && r.status === 'pending');
        if (nextPending !== -1) {
            const nextItem = modal.querySelector(`[data-index="${nextPending}"]`);
            if (nextItem) nextItem.click();
        } else {
            // Check if any remain
            const remaining = results.filter(r => r.status === 'pending');
            if (remaining.length === 0) {
                this._finalizeBatch();
                this._closeBatchOverlay();
                return;
            }
        }

        this._updateReviewCount(modal);
    },

    _rejectBatchNote(index, modal) {
        const results = this._batchResults.filter(Boolean);
        const result = results[index];
        if (!result) return;

        result.status = 'rejected';

        const item = modal.querySelector(`.ai-batch-review-item[data-index="${index}"]`);
        if (item) {
            item.classList.remove('pending');
            item.classList.add('rejected');
            item.querySelector('.ai-batch-review-status').textContent = '✗';
        }

        // Advance to next pending
        const nextPending = results.findIndex((r, i) => i > index && r.status === 'pending');
        if (nextPending !== -1) {
            const nextItem = modal.querySelector(`[data-index="${nextPending}"]`);
            if (nextItem) nextItem.click();
        }

        this._updateReviewCount(modal);
    },

    _updateReviewCount(modal) {
        const results = this._batchResults.filter(Boolean);
        const reviewed = results.filter(r => r.status !== 'pending').length;
        const countEl = modal.querySelector('#batchReviewCount');
        if (countEl) countEl.textContent = `${reviewed} of ${results.length} reviewed`;
    },

    async _finalizeBatch() {
        const results = this._batchResults.filter(Boolean);
        const commands = [];

        for (const result of results) {
            if (result.status === 'accepted') {
                if (result.isNew) {
                    commands.push({
                        type: 'create',
                        blockId: result.blockId,
                        after: { content: result.modified }
                    });
                } else {
                    commands.push({
                        type: 'update',
                        blockId: result.blockId,
                        before: { content: result.original },
                        after: { content: result.modified }
                    });
                }
            }
        }

        if (commands.length > 0) {
            await UndoRedoManager.executeCommand({
                type: 'batch',
                description: `Batch AI: ${commands.length} note${commands.length !== 1 ? 's' : ''}`,
                commands
            });
        }

        TimelineView.invalidateCache();
        SelectionManager.updateTagCounts();
        if (typeof App !== 'undefined' && App.render) App.render();
    },

    _closeBatchOverlay() {
        if (this._diffEditorView) {
            try { this._diffEditorView.destroy(); } catch {}
            this._diffEditorView = null;
        }
        if (this._batchOverlay) {
            const overlay = this._batchOverlay;
            this._batchOverlay = null;
            overlay.close();
        }
        this._batchResults = [];
    },

    _showBatchToast(message) {
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);padding:0.75rem 1.5rem;background:var(--accent);color:white;border-radius:var(--radius-sm);font-size:0.85rem;z-index:10001;box-shadow:var(--shadow-lg);cursor:pointer;transition:opacity 0.3s;opacity:1;';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 5000);
    },

    _reopenBatchModal() {
        const results = this._batchResults.filter(Boolean);
        const reviewContent = `
            <div class="ai-batch-review-layout" id="batchReviewLayout" style="">
                <div class="ai-batch-review-list" id="batchReviewList"></div>
                <div class="ai-batch-review-diff" id="batchReviewDiff"></div>
            </div>
            <div class="ai-batch-review-actions" id="batchReviewActions" style="">
                <button class="ai-reject-btn" id="batchRejectOne">Reject This</button>
                <button class="ai-accept-btn" id="batchAcceptOne">Accept This</button>
                <span class="ai-batch-review-count" id="batchReviewCount"></span>
                <button class="ai-reject-btn" id="batchRejectAll">Reject All</button>
                <button class="ai-accept-btn" id="batchAcceptAll">Accept All</button>
            </div>
        `;

        const modal = Modal.create({
            title: 'Batch AI — Review',
            content: reviewContent,
            modalClass: 'tag-modal ai-modal ai-batch-modal',
            onClose: () => { this._batchOverlay = null; }
        });

        this._batchOverlay = modal;

        modal.querySelector('#batchAcceptOne').addEventListener('click', () => {
            const idx = this._getSelectedReviewIndex(modal);
            if (idx !== -1) this._acceptBatchNote(idx, modal);
        });
        modal.querySelector('#batchRejectOne').addEventListener('click', () => {
            const idx = this._getSelectedReviewIndex(modal);
            if (idx !== -1) this._rejectBatchNote(idx, modal);
        });
        modal.querySelector('#batchAcceptAll').addEventListener('click', () => {
            for (let i = 0; i < this._batchResults.length; i++) {
                if (this._batchResults[i]?.status === 'pending') this._acceptBatchNote(i, modal);
            }
            this._finalizeBatch();
            this._closeBatchOverlay();
        });
        modal.querySelector('#batchRejectAll').addEventListener('click', () => {
            for (let i = 0; i < this._batchResults.length; i++) {
                if (this._batchResults[i]?.status === 'pending') this._batchResults[i].status = 'rejected';
            }
            this._closeBatchOverlay();
        });

        return modal;
    },

    _extractTitle(block) {
        const content = block.content || '';
        const headingMatch = content.match(/^#{1,6}\s+(.+)/m);
        if (headingMatch) return headingMatch[1].slice(0, 60);
        const firstLine = content.split('\n')[0] || block.id;
        return firstLine.slice(0, 60);
    },

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
