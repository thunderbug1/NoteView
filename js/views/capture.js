const CaptureView = {
    currentPage: null,
    _blocks: null,
    _recognition: null,
    _isStopping: false,
    _recognitionSession: 0,
    _transcript: '',
    _interimTranscript: '',
    _currentTags: [],
    _templateContent: '',
    _editor: null,
    _aiContent: '',

    render(blocks) {
        const container = document.getElementById('viewContainer');
        if (!container) return;
        this._blocks = blocks;

        switch (this.currentPage) {
            case 'write': this.renderWritePage(container); break;
            case 'dictate': this.renderDictatePage(container); break;
            case 'task': this.renderTaskPage(container); break;
            case 'template': this.renderTemplatePicker(container); break;
            default: this.renderGrid(container); break;
        }
    },

    _navigateTo(page) {
        this._cleanup();
        this.currentPage = page;
        this._currentTags = [...SelectionManager.getTagsForNewNote()];
        this.render(this._blocks);
    },

    _goToGrid() {
        this._cleanup();
        this.currentPage = null;
        this._currentTags = [];
        this.render(this._blocks);
    },

    _cleanup() {
        if (this._recognition) {
            this._isStopping = true;
            try { this._recognition.stop(); } catch (e) { /* ignore */ }
            this._recognition = null;
        }
        if (window.CodeMirror && window.CodeMirror.EditorView && this._editor) {
            this._editor.destroy();
            this._editor = null;
        }
        this._transcript = '';
        this._interimTranscript = '';
        this._isStopping = false;
    },

    async _saveNote(content, extraMeta = {}) {
        if (!content || !content.trim()) return;
        try {
            const tags = extraMeta.tags || this._currentTags;
            await Store.createBlock(content, { ...extraMeta, tags });
            SelectionManager.updateTagCounts();
            TimelineView.invalidateCache();
            Common.showToast('Note saved');
            this._goToGrid();
        } catch (err) {
            Common.showToast('Failed to save: ' + (err.message || 'Unknown error'));
        }
    },

    // ─── Shared chrome ────────────────────────────────

    _headerHtml(showTags = true) {
        const backIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
        const tagIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></svg>';
        const tagsPart = showTags
            ? `<button class="capture-header-tag" data-action="edit-tags">${tagIcon}${this._currentTags.length > 0 ? `<span class="capture-header-tag-count">${this._currentTags.length}</span>` : ''}</button>`
            : '';
        return `<div class="capture-header">
            <button class="capture-header-back" data-action="back">${backIcon}</button>
            ${tagsPart}
        </div>`;
    },

    _saveBarHtml(label = 'Save') {
        return `<div class="capture-save-bar"><button class="capture-save-btn" data-action="save" disabled>${Common.escapeHtml(label)}</button></div>`;
    },

    _wireHeader(container) {
        container.querySelector('[data-action="back"]')?.addEventListener('click', () => {
            const content = this._getPageContent(container);
            if (content && content.trim()) {
                if (!confirm('Discard this note?')) return;
            }
            this._goToGrid();
        });
        container.querySelector('[data-action="edit-tags"]')?.addEventListener('click', () => {
            this._openTagModal(container);
        });
    },

    _wireSave(container, getContent) {
        container.querySelector('[data-action="save"]')?.addEventListener('click', () => {
            const content = getContent();
            if (!content || !content.trim()) { Common.showToast('Write something first'); return; }
            this._saveNote(content);
        });
    },

    _setSaveEnabled(container, enabled) {
        const btn = container.querySelector('[data-action="save"]');
        if (btn) btn.disabled = !enabled;
    },

    _getPageContent(container) {
        // Best-effort: return whatever content exists
        if (this._editor) return this._editor.state.doc.toString();
        const ta = container.querySelector('.capture-dictate-edit');
        if (ta) return ta.value;
        const taskInput = container.querySelector('.capture-task-input');
        if (taskInput) return taskInput.value;
        return this._transcript || '';
    },

    _openTagModal(container) {
        const tempId = 'capture-temp';
        const existingIdx = Store.blocks.findIndex(b => b.id === tempId);
        const tempBlock = { id: tempId, tags: [...this._currentTags], content: '' };
        if (existingIdx === -1) Store.blocks.push(tempBlock);
        else Store.blocks[existingIdx] = tempBlock;
        DocumentView.pendingNewTags = [...this._currentTags];
        TagModal.show(tempId, {
            onClose: () => {
                if (DocumentView.pendingNewTags) {
                    this._currentTags = [...DocumentView.pendingNewTags];
                    DocumentView.pendingNewTags = null;
                }
                Store.blocks = Store.blocks.filter(b => b.id !== tempId);
                this._refreshTagBadge(container);
            }
        });
    },

    _refreshTagBadge(container) {
        const btn = container.querySelector('[data-action="edit-tags"]');
        if (!btn) return;
        const countEl = btn.querySelector('.capture-header-tag-count');
        if (this._currentTags.length > 0) {
            if (countEl) countEl.textContent = this._currentTags.length;
            else btn.insertAdjacentHTML('beforeend', `<span class="capture-header-tag-count">${this._currentTags.length}</span>`);
        } else {
            if (countEl) countEl.remove();
        }
    },

    // ─── Grid ──────────────────────────────────────────

    renderGrid(container) {
        const speechSupported = DocumentView.isSpeechRecognitionSupported();

        const typeIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
        const micIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>';
        const taskIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>';
        const templateIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>';
        const browseIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>';

        let methods = '';
        methods += `<button class="capture-card" data-method="write">${typeIcon}<span class="capture-card-label">Write</span></button>`;
        if (speechSupported) {
            methods += `<button class="capture-card" data-method="dictate">${micIcon}<span class="capture-card-label">Dictate</span></button>`;
        }
        methods += `<button class="capture-card" data-method="task">${taskIcon}<span class="capture-card-label">Task</span></button>`;
        methods += `<button class="capture-card" data-method="template">${templateIcon}<span class="capture-card-label">Template</span></button>`;

        const vaultName = Store.directoryHandle ? Store.directoryHandle.name : 'No vault';

        container.innerHTML = `
            <div class="capture-view">
                <button class="capture-vault-btn" data-action="switch-vault">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    <span>${Common.escapeHtml(vaultName)}</span>
                </button>
                <div class="capture-grid">${methods}</div>
                <button class="capture-browse-btn" data-action="browse">${browseIcon}<span>Browse notes</span></button>
            </div>`;

        container.querySelectorAll('.capture-card').forEach(card => {
            card.addEventListener('click', () => this._navigateTo(card.dataset.method));
        });
        const browseBtn = container.querySelector('.capture-browse-btn');
        if (browseBtn) browseBtn.addEventListener('click', () => App.setView('document'));

        const vaultBtn = container.querySelector('[data-action="switch-vault"]');
        if (vaultBtn) vaultBtn.addEventListener('click', () => VaultModal.showDropdown(vaultBtn));
    },

    // ─── Write Page ────────────────────────────────────

    renderWritePage(container) {
        const initialContent = this._templateContent || '';
        this._templateContent = '';

        container.innerHTML = `
            <div class="capture-page">
                ${this._headerHtml()}
                <div class="capture-write-body">
                    <div class="codemirror-container" data-id="capture-write"></div>
                </div>
                ${this._saveBarHtml()}
            </div>`;

        this._wireHeader(container);
        this._wireSave(container, () => this._getEditorContent());

        DocumentView.waitForCodeMirror().then(() => {
            const cmContainer = container.querySelector('.codemirror-container');
            if (!cmContainer) return;

            const { EditorView } = window.CodeMirror;
            const editor = DocumentView.createEditor(cmContainer, 'capture-write', initialContent, [
                EditorView.updateListener.of(update => {
                    if (update.docChanged) {
                        this._setSaveEnabled(container, update.state.doc.length > 0);
                    }
                })
            ]);
            this._editor = editor;
            if (editor) {
                if (initialContent.trim()) this._setSaveEnabled(container, true);
                requestAnimationFrame(() => requestAnimationFrame(() => editor.focus()));
            }
        });
    },

    _getEditorContent() {
        return this._editor ? this._editor.state.doc.toString() : '';
    },

    renderDictatePage(container) {
        const micIcon = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>';
        const aiConfigured = AIAssistant.isConfigured();

        const processBtnHtml = aiConfigured
            ? `<div class="capture-ai-btns" style="display:none">
                    <button class="capture-ai-process-btn" data-action="ai-format">Format with AI</button>
                    <button class="capture-ai-process-btn" data-action="ai-interpret">Interpret with AI</button>
               </div>`
            : '';

        container.innerHTML = `
            <div class="capture-page">
                ${this._headerHtml()}
                <div class="capture-dictate-body">
                    <button class="capture-mic-btn recording" data-action="mic">${micIcon}</button>
                    <span class="capture-mic-status" data-role="status">Listening...</span>
                    <textarea class="capture-dictate-edit" data-role="dictate-edit" placeholder="Your words will appear here..." rows="6"></textarea>
                    ${processBtnHtml}
                </div>
                ${this._saveBarHtml()}
            </div>`;

        this._wireHeader(container);
        this._wireSave(container, () => {
            const ta = container.querySelector('[data-role="dictate-edit"]');
            return ta ? ta.value : '';
        });

        const micBtn = container.querySelector('[data-action="mic"]');
        const statusEl = container.querySelector('[data-role="status"]');
        const editArea = container.querySelector('[data-role="dictate-edit"]');
        const aiBtns = container.querySelector('.capture-ai-btns');
        const formatBtn = container.querySelector('[data-action="ai-format"]');
        const interpretBtn = container.querySelector('[data-action="ai-interpret"]');
        let isRecording = true;

        const showAiBtns = () => {
            if (aiBtns && editArea.value.trim()) aiBtns.style.display = '';
        };

        const hideAiBtns = () => {
            if (aiBtns) aiBtns.style.display = 'none';
        };

        const updateSaveState = () => {
            this._setSaveEnabled(container, (editArea.value || '').trim().length > 0);
        };

        editArea.addEventListener('input', () => { updateSaveState(); showAiBtns(); });

        const startRecording = () => {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this._recognition = new SpeechRecognition();
            this._recognition.continuous = true;
            this._recognition.interimResults = true;
            this._recognitionSession++;
            let sessionId = this._recognitionSession;
            this._isStopping = false;
            this._insertedTranscript = '';
            this._interimTranscript = '';

            hideAiBtns();

            this._recognition.onresult = (event) => {
                if (this._recognitionSession !== sessionId) return;
                let currentTranscript = '';
                for (let i = 0; i < event.results.length; i++) {
                    if (event.results[i].isFinal) {
                        const chunk = event.results[i][0].transcript;
                        const normalizedPrev = currentTranscript.trim().toLowerCase();
                        const normalizedChunk = chunk.trim().toLowerCase();
                        if (normalizedPrev && normalizedChunk.startsWith(normalizedPrev)) {
                            currentTranscript = chunk;
                        } else {
                            currentTranscript += chunk;
                        }
                    }
                }
                if (currentTranscript.length > this._insertedTranscript.length) {
                    const newText = currentTranscript.substring(this._insertedTranscript.length);
                    this._insertedTranscript = currentTranscript;
                    if (newText.trim()) {
                        const existing = editArea.value;
                        editArea.value = existing + (existing && !existing.endsWith(' ') ? ' ' : '') + newText.trim();
                        updateSaveState();
                        showAiBtns();
                    }
                }
            };

            this._recognition.onerror = () => {
                if (this._recognitionSession !== sessionId) return;
                isRecording = false;
                micBtn.classList.remove('recording');
                statusEl.textContent = 'Stopped';
                showAiBtns();
            };

            this._recognition.onend = () => {
                if (this._recognitionSession !== sessionId) return;
                if (!this._isStopping) {
                    try {
                        this._insertedTranscript = '';
                        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
                        this._recognition = new SR();
                        this._recognition.continuous = true;
                        this._recognition.interimResults = true;
                        this._recognition.onresult = this._recognition.onresult;
                        this._recognition.onerror = this._recognition.onerror;
                        this._recognition.onend = this._recognition.onend;
                        this._recognitionSession++;
                        sessionId = this._recognitionSession;
                        this._recognition.start();
                    } catch (e) { /* ignore */ }
                }
            };

            this._recognition.start();
            isRecording = true;
            micBtn.classList.add('recording');
            statusEl.textContent = 'Listening...';
        };

        const stopRecording = () => {
            this._isStopping = true;
            if (this._recognition) {
                try { this._recognition.stop(); } catch (e) { /* ignore */ }
                this._recognition = null;
            }
            isRecording = false;
            micBtn.classList.remove('recording');
            statusEl.textContent = 'Paused';
            showAiBtns();
        };

        micBtn.addEventListener('click', () => {
            if (isRecording) stopRecording();
            else startRecording();
        });

        const handleAiAction = async (btn, mode) => {
            const raw = editArea.value.trim();
            if (!raw) return;
            if (isRecording) stopRecording();
            const label = btn.textContent;
            btn.textContent = 'Processing...';
            btn.disabled = true;
            try {
                const result = await this._processWithAI(raw, mode);
                editArea.value = result;
                statusEl.textContent = mode === 'format' ? 'AI formatted' : 'AI interpreted';
                updateSaveState();
                hideAiBtns();
            } catch (err) {
                const isNetwork = !err.message || /fetch|network|network_changed/i.test(err.message);
                Common.showToast(isNetwork ? 'Network error — check connection' : 'AI failed, keeping raw text');
                statusEl.textContent = 'AI failed — retry';
                btn.textContent = label;
                btn.disabled = false;
                showAiBtns();
            }
        };

        if (formatBtn) formatBtn.addEventListener('click', () => handleAiAction(formatBtn, 'format'));
        if (interpretBtn) interpretBtn.addEventListener('click', () => handleAiAction(interpretBtn, 'interpret'));

        startRecording();
    },

    async _processWithAI(transcript, mode = 'format') {
        const profile = AIAssistant.profiles[0];
        if (!profile) throw new Error('No AI profile');
        const apiKey = AIAssistant._apiKeys[profile.id];
        if (!apiKey) throw new Error('No API key');

        const prompts = {
            format: 'You are a note-taking assistant. Format the following spoken text into well-structured markdown. Use headings, lists, task checkboxes where appropriate. Preserve all the original meaning — do not add, remove, or reinterpret content. Output only the note content, no commentary or code fences.',
            interpret: 'You are a note-taking assistant. The following is raw spoken text that may be disorganized, incomplete, or rambling. Interpret what the speaker means, organize their thoughts into a clear and coherent note, and fill in implied context. Use headings, lists, task checkboxes where appropriate. Output only the note content, no commentary or code fences.'
        };

        const url = profile.endpointUrl.replace(/[\\/]+$/, '') + '/chat/completions';
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: profile.model,
                messages: [
                    { role: 'system', content: prompts[mode] || prompts.format },
                    { role: 'user', content: transcript }
                ],
                stream: false
            })
        });

        if (!response.ok) throw new Error('API failed');
        const data = await response.json();
        let content = data.choices?.[0]?.message?.content || '';
        content = content.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
        return content || transcript;
    },

    // ─── Task Page ─────────────────────────────────────

    renderTaskPage(container) {
        container.innerHTML = `
            <div class="capture-page">
                ${this._headerHtml()}
                <div class="capture-task-form">
                    <textarea class="capture-task-input" placeholder="What needs to be done?" rows="2" autofocus></textarea>
                    <div class="capture-task-field">
                        <label>Priority</label>
                        <div class="capture-task-priority">
                            <button class="capture-priority-btn" data-priority="">None</button>
                            <button class="capture-priority-btn" data-priority="low">Low</button>
                            <button class="capture-priority-btn" data-priority="medium">Medium</button>
                            <button class="capture-priority-btn" data-priority="high">High</button>
                        </div>
                    </div>
                    <div class="capture-task-field">
                        <label>Due date</label>
                        <input type="date" class="capture-task-date" data-role="due-date">
                    </div>
                    <div class="capture-task-field">
                        <label>Start date</label>
                        <input type="date" class="capture-task-date" data-role="start-date">
                    </div>
                    <div class="capture-task-field">
                        <label>Assignee</label>
                        <button class="capture-task-date" data-role="assignee">None</button>
                    </div>
                </div>
                ${this._saveBarHtml('Create')}
            </div>`;

        const input = container.querySelector('.capture-task-input');
        let selectedPriority = '';
        let selectedAssignee = '';

        this._wireHeader(container);

        const assigneeBtn = container.querySelector('[data-role="assignee"]');
        assigneeBtn.addEventListener('click', () => {
            AssigneeModal.show((contact) => {
                if (contact) {
                    selectedAssignee = contact;
                    assigneeBtn.textContent = '@' + contact;
                } else {
                    selectedAssignee = '';
                    assigneeBtn.textContent = 'None';
                }
            }, this._currentTags);
        });

        container.querySelectorAll('.capture-priority-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                container.querySelectorAll('.capture-priority-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedPriority = btn.dataset.priority;
            });
        });

        // Save
        container.querySelector('[data-action="save"]')?.addEventListener('click', () => {
            const desc = input.value.trim();
            if (!desc) { Common.showToast('Enter a task description'); return; }
            let content = `- [ ] ${desc}`;
            if (selectedPriority) content += `\n[priority:: ${selectedPriority}]`;
            const dueDate = container.querySelector('[data-role="due-date"]').value;
            if (dueDate) content += `\n[due:: ${dueDate}]`;
            const startDate = container.querySelector('[data-role="start-date"]').value;
            if (startDate) content += `\n[start:: ${startDate}]`;
            const assignee = container.querySelector('[data-role="assignee"]').value;
            if (assignee) content += `\n[assignee:: ${assignee}]`;
            this._saveNote(content, { tags: this._currentTags });
        });

        input.addEventListener('input', () => {
            this._setSaveEnabled(container, input.value.trim().length > 0);
        });

        requestAnimationFrame(() => input.focus());
    },

    // ─── Template Picker ───────────────────────────────

    renderTemplatePicker(container) {
        DocumentView.waitForCodeMirror().then(async () => {
            const templates = await AppSettings.getTemplates();

            if (templates.length === 0) {
                container.innerHTML = `
                    <div class="capture-page">
                        ${this._headerHtml(false)}
                        <div class="capture-template-empty">
                            <p>No templates yet.</p>
                            <button class="capture-template-empty-btn" data-action="go-settings">Create templates in Settings</button>
                        </div>
                    </div>`;
                container.querySelector('[data-action="back"]')?.addEventListener('click', () => this._goToGrid());
                container.querySelector('[data-action="go-settings"]')?.addEventListener('click', () => App.setView('settings'));
                return;
            }

            const cardsHtml = templates.map(t => {
                const preview = (t.content || '').split('\n').slice(0, 3).map(l => Common.escapeHtml(l)).join('\n');
                return `<button class="capture-template-card" data-template-id="${Common.escapeHtml(t.id)}">
                    <span class="capture-template-name">${Common.escapeHtml(t.name)}</span>
                    <span class="capture-template-preview">${preview}</span>
                </button>`;
            }).join('');

            container.innerHTML = `
                <div class="capture-page">
                    ${this._headerHtml()}
                    <div class="capture-template-list">${cardsHtml}</div>
                </div>`;

            container.querySelector('[data-action="back"]')?.addEventListener('click', () => this._goToGrid());
            container.querySelector('[data-action="edit-tags"]')?.addEventListener('click', () => this._openTagModal(container));

            container.querySelectorAll('.capture-template-card').forEach(card => {
                card.addEventListener('click', () => {
                    const template = templates.find(t => t.id === card.dataset.templateId);
                    this._templateContent = template?.content || '';
                    this._cleanup();
                    this.currentPage = 'write';
                    this.render(this._blocks);
                });
            });
        });
    }
};
