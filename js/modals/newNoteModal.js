/**
 * NewNoteModal — Note creation modal and AI dictation logic.
 * Extracted from App to reduce main.js size.
 */

const NewNoteModal = {
    _micSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>',

    // AI dictation state
    _aiRecognition: null,
    _aiDictationBtn: null,
    _aiDictationActive: false,
    _aiDictationBlockId: null,
    _aiTranscript: '',
    _aiIsProcessing: false,
    _aiIsStreaming: false,
    _isStoppingAIDictation: false,
    _createModalClose: null,
    _createModalPromote: null,

    handleAIMicClick(modalBlockId, btn) {
        if (!DocumentView.isSpeechRecognitionSupported()) return;

        if (this._aiDictationActive) {
            this.stopAIDictation(modalBlockId);
        } else {
            this.startAIDictation(modalBlockId, btn);
        }
    },

    _setAIButtonState(btn, state) {
        if (!btn) return;
        btn.classList.remove('ai-recording', 'ai-processing', 'ai-error');

        const micSvg = this._micSvg;

        switch (state) {
            case 'idle':
                btn.innerHTML = micSvg + ' AI <span class="ai-sparkle">✨</span>';
                btn.title = 'Dictate to AI';
                this._setAILockout(false);
                break;
            case 'recording':
                btn.classList.add('ai-recording');
                btn.innerHTML = micSvg + ' Listening...';
                btn.title = 'Stop AI Dictation';
                break;
            case 'processing':
                btn.classList.add('ai-processing');
                btn.innerHTML = '<span class="ai-thinking-dots"></span> Thinking...';
                btn.title = 'AI is processing your dictation';
                this._setAILockout(true);
                break;
            case 'error':
                btn.classList.add('ai-error');
                btn.innerHTML = micSvg + ' Error';
                btn.title = 'AI processing failed';
                this._setAILockout(false);
                setTimeout(() => this._setAIButtonState(btn, 'idle'), 2000);
                break;
        }
    },

    _setAILockout(locked) {
        const modal = this._aiDictationBtn && this._aiDictationBtn.closest('.tag-modal');
        if (!modal) return;
        const blockId = this._aiDictationBlockId;
        const buttons = modal.querySelectorAll('.creation-btn');
        buttons.forEach(b => { b.disabled = locked; });
        const view = DocumentView.editors.get(blockId);
        if (view && view.dom) {
            try {
                const { EditorView, EditorState } = window.CodeMirror;
                view.dispatch({ effects: [EditorView.editable.of(!locked), EditorState.readOnly.of(locked)] });
            } catch (e) {
                // Editor was destroyed during async AI processing
            }
        }
    },

    startAIDictation(modalBlockId, btn) {
        if (this._aiRecognition) {
            this.stopAIDictation();
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this._aiRecognition = new SpeechRecognition();
        this._aiRecognition.continuous = true;
        this._aiRecognition.interimResults = true;

        this._aiDictationBtn = btn;
        this._setAIButtonState(btn, 'recording');

        this._aiDictationActive = true;
        this._isStoppingAIDictation = false;
        this._aiTranscript = '';
        this._aiDictationBlockId = modalBlockId;

        const modal = btn.closest('.tag-modal');
        let preview = modal && modal.querySelector('.ai-transcript-preview');
        if (!preview && modal) {
            preview = document.createElement('div');
            preview.className = 'ai-transcript-preview';
            const editorContainer = modal.querySelector('.block-editor');
            if (editorContainer) {
                editorContainer.parentNode.insertBefore(preview, editorContainer);
            }
        }

        this._aiRecognition.onresult = (event) => {
            let finalTranscript = '';
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            if (finalTranscript) {
                this._aiTranscript += finalTranscript + ' ';
            }

            if (preview) {
                const displayText = this._aiTranscript + (interimTranscript ? interimTranscript + '...' : '');
                preview.textContent = displayText;
                preview.classList.toggle('has-content', !!displayText);
            }
        };

        this._aiRecognition.onerror = (event) => {
            console.error('AI Speech Recognition Error:', event.error);
            this.stopAIDictation(modalBlockId);
        };

        this._aiRecognition.onend = () => {
            if (this._aiDictationActive && !this._isStoppingAIDictation) {
                try { this._aiRecognition.start(); } catch(e) { console.warn('Speech recognition restart failed:', e); }
            }
        };

        this._aiRecognition.start();
        Common.showToast('AI Listening... Speak your command.');
    },

    async stopAIDictation(modalBlockId) {
        this._aiDictationActive = false;
        this._isStoppingAIDictation = true;

        if (this._aiRecognition) {
            this._aiRecognition.stop();
        }

        const transcript = (this._aiTranscript || '').trim();
        this._aiTranscript = '';
        this._aiRecognition = null;

        if (transcript) {
            Common.showToast('Processing dictation with AI...', 3000);
            await this.processDictationWithAI(transcript, modalBlockId || this._aiDictationBlockId);
        } else {
            this._cleanupAIDictation(modalBlockId);
            Common.showToast('No speech detected.');
        }
    },

    _cleanupAIDictation(modalBlockId) {
        this._aiRecognition = null;
        const preview = document.querySelector('.ai-transcript-preview');
        if (preview) preview.remove();
        if (this._aiDictationBtn) {
            this._setAIButtonState(this._aiDictationBtn, 'idle');
        }
    },

    async processDictationWithAI(transcript, targetBlockId) {
        if (this._aiIsProcessing) return;
        this._aiIsProcessing = true;

        if (!AIAssistant.isConfigured()) {
            Common.showToast('AI is not configured. Please set up an API key in Settings.');
            this._insertAIContent(transcript + '\n', targetBlockId);
            this._aiIsProcessing = false;
            return;
        }

        const blockId = await this._autoPromoteOrCreateNote(transcript, targetBlockId);
        if (!blockId) {
            this._aiIsProcessing = false;
            return;
        }

        this._closeCreateModal();

        const title = transcript.split('\n')[0].slice(0, 40);
        if (typeof AITaskPanel !== 'undefined') {
            AITaskPanel.startProcessing(blockId, title);
        }

        try {
            const profile = AIAssistant.profiles[0];
            const apiKey = AIAssistant._apiKeys[profile.id];

            const url = profile.endpointUrl.replace(/[\\/]+$/, '') + '/chat/completions';
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: profile.model,
                    messages: [
                        { role: 'system', content: 'You are a note-taking assistant. The user will speak a command — perform the command and write the resulting note in well-structured markdown. Use headings, lists, indentation where appropriate. If the user tells you to note a task, use task checkboxes (- [ ]). Output only the note content, no commentary or code fences.' },
                        { role: 'user', content: transcript }
                    ],
                    stream: true
                })
            });

            if (!response.ok) throw new Error('API failed');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let fullContent = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split('\n');
                buffer = lines.pop();

                let streamDone = false;
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') { streamDone = true; break; }
                    try {
                        const parsed = JSON.parse(data);
                        const chunk = parsed.choices?.[0]?.delta?.content || '';
                        if (chunk) fullContent += chunk;
                    } catch { /* skip malformed chunks */ }
                }
                if (streamDone) break;
            }

            let noteContent = fullContent.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
            if (!noteContent) noteContent = transcript;

            const block = Store.blocks.find(b => b.id === blockId);
            if (block) {
                await Store.saveBlock(block, {
                    content: noteContent,
                    commit: true,
                    commitMessage: 'AI: formatted note'
                });
                TimelineView.invalidateCache();
                SelectionManager.updateTagCounts();
                App.render();
            }

            if (typeof AITaskPanel !== 'undefined') {
                AITaskPanel.finishProcessing(blockId, title);
            }
        } catch (err) {
            console.error('AI dictation failed:', err);
            Common.showToast('AI formatting failed, keeping raw text.');
            if (typeof AITaskPanel !== 'undefined') {
                AITaskPanel.failProcessing(blockId);
            }
        } finally {
            this._aiIsProcessing = false;
            this._aiIsStreaming = false;
            this._cleanupAIDictation();
        }
    },

    async _autoPromoteOrCreateNote(transcript, targetBlockId) {
        if (this._createModalPromote) {
            await this._createModalPromote(transcript);
            return this._aiDictationBlockId;
        }
        return null;
    },

    _closeCreateModal() {
        if (this._createModalClose) {
            this._createModalClose();
            this._createModalClose = null;
            this._createModalPromote = null;
        }
    },

    _insertAIContent(content, modalBlockId) {
        if (!modalBlockId) return;

        let modal = this._aiDictationBtn && this._aiDictationBtn.closest('.tag-modal');
        if (!modal) {
            const fallbackView = DocumentView.editors.get(modalBlockId);
            if (fallbackView && fallbackView.dom) modal = fallbackView.dom.closest('.tag-modal');
        }
        const preview = modal && modal.querySelector('.ai-transcript-preview');
        if (preview) preview.remove();

        const view = DocumentView.editors.get(modalBlockId);
        if (view && view.dom) {
            const head = view.state.selection.main.head;
            const charBefore = head > 0 ? view.state.doc.sliceString(head - 1, head) : '';
            const prefix = (head > 0 && charBefore !== '\n') ? '\n' : '';
            view.dispatch({
                changes: { from: head, insert: prefix + content },
                selection: { anchor: head + prefix.length + content.length }
            });
            view.focus();
        }
    },

    showNewNoteModal(method = 'type') {
        const modalBlockId = 'new-modal';
        let modalTags = SelectionManager.getTagsForNewNote();
        let createdBlockId = null;
        let isCreating = false;

        const self = this;

        const renderModalTags = () => {
            const tagsDiv = modal.querySelector('.block-tags');
            if (!tagsDiv) return;
            const id = createdBlockId || modalBlockId;
            const badgesHtml = modalTags.map(tag => TagModal._renderBadge(tag)).join('');
            tagsDiv.innerHTML = `${badgesHtml}<button class="add-tag-btn" data-id="${id}">+ Tag</button>`;
            modal.querySelectorAll('.add-tag-btn').forEach(btn => {
                btn.addEventListener('click', () => openTagModal());
            });
        };

        const promoteModalBlock = async (initialContent) => {
            if (isCreating || createdBlockId) return;
            isCreating = true;

            try {
                const extraMeta = {};
                if (modalTags.length > 0) {
                    extraMeta.tags = modalTags;
                }
                const newBlock = await Store.createBlock(initialContent, extraMeta);
                createdBlockId = newBlock.id;

                const editor = DocumentView.editors.get(modalBlockId);
                if (editor) {
                    DocumentView.editors.delete(modalBlockId);
                    DocumentView.editors.set(createdBlockId, editor);
                }

                const cmContainer = modal.querySelector('.codemirror-container');
                if (cmContainer) {
                    cmContainer.dataset.id = createdBlockId;
                }

                modal.querySelectorAll('[data-id="' + modalBlockId + '"]').forEach(el => {
                    el.dataset.id = createdBlockId;
                });

                if (self._aiDictationBlockId === modalBlockId) {
                    self._aiDictationBlockId = createdBlockId;
                }

                if (editor) {
                    const currentContent = editor.state.doc.toString();
                    if (currentContent !== initialContent) {
                        DocumentView.scheduleSave(createdBlockId, currentContent);
                    }
                }

                DocumentView.pendingNewTags = null;
                SelectionManager.updateTagCounts();

                const reasons = Store.getBlockingFilters(newBlock);
                if (reasons.length > 0) {
                    const labels = reasons.map(r => r.label).join(', ');
                    Common.showToast('Note created but hidden by filter: ' + labels, {
                        actionLabel: 'Show all',
                        action: () => {
                            SelectionManager.clearAllFilters();
                            App.render();
                        }
                    });
                }
            } catch (err) {
                console.error('Failed to create note:', err);
                Common.showToast('Failed to create note: ' + (err.message || 'Unknown error'));
            } finally {
                isCreating = false;
            }
        };

        const openTagModal = () => {
            if (createdBlockId) {
                TagModal.show(createdBlockId, {
                    onClose: () => {
                        const block = Store.blocks.find(b => b.id === createdBlockId);
                        if (block) {
                            modalTags = [...(block.tags || [])];
                            renderModalTags();
                        }
                    }
                });
            } else {
                const tempId = 'new';
                const existingIdx = Store.blocks.findIndex(b => b.id === tempId);
                const tempBlock = { id: tempId, tags: [...modalTags], content: '' };
                if (existingIdx === -1) {
                    Store.blocks.push(tempBlock);
                } else {
                    Store.blocks[existingIdx] = tempBlock;
                }
                DocumentView.pendingNewTags = [...modalTags];
                TagModal.show(tempId, {
                    onClose: () => syncTagsFromPending()
                });
            }
        };

        const micSvg = this._micSvg;
        const speechSupported = DocumentView.isSpeechRecognitionSupported();
        const aiConfigured = AIAssistant.isConfigured();

        let methodToolbarHtml = '<div class="creation-method-toolbar">';
        methodToolbarHtml += `<button class="creation-method-btn${method === 'type' ? ' active' : ''}" data-method="type" title="Write"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>`;
        if (speechSupported) {
            methodToolbarHtml += `<button class="creation-method-btn${method === 'dictate' ? ' active' : ''}" data-method="dictate" title="Dictate"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg></button>`;
            if (aiConfigured) {
                methodToolbarHtml += `<button class="creation-method-btn${method === 'ai-dictate' ? ' active' : ''}" data-method="ai-dictate" title="AI Dictate"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg><span class="ai-sparkle" style="font-size:0.6rem">✨</span></button>`;
            }
        }
        methodToolbarHtml += `<button class="creation-method-btn${method === 'task' ? ' active' : ''}" data-method="task" title="Task"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg></button>`;
        methodToolbarHtml += `<button class="creation-method-btn${method === 'template' ? ' active' : ''}" data-method="template" title="Template"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg></button>`;
        methodToolbarHtml += '</div>';

        let actionBtnHtml = '';
        if (method === 'dictate') {
            actionBtnHtml = `<button class="creation-btn mic-btn active-method" data-action="dictate" data-id="${modalBlockId}" title="Stop dictation">${micSvg} Stop</button>`;
        } else if (method === 'ai-dictate') {
            actionBtnHtml = `<button class="creation-btn ai-mic-btn active-method" data-action="ai-dictate" data-id="${modalBlockId}" title="Stop AI Dictation">${micSvg} AI <span class="ai-sparkle">✨</span></button>`;
        }

        const content = `
            ${methodToolbarHtml}
            ${actionBtnHtml ? `<div class="block block-creation-actions" style="margin-bottom: 0.75rem;">${actionBtnHtml}</div>` : ''}
            <div class="block-metadata">
                <div class="block-tags">
                    ${modalTags.map(tag => TagModal._renderBadge(tag)).join('')}
                    <button class="add-tag-btn" data-id="${modalBlockId}">+ Tag</button>
                </div>
            </div>
            <div class="block block-editor">
                <div class="codemirror-container" data-id="${modalBlockId}"></div>
            </div>
        `;

        const modal = Modal.create({
            title: 'Create Note',
            content,
            modalClass: 'tag-modal content-modal active-recording-preventer',
            onClose: () => {
                DocumentView.stopSpeechRecognition();
                if (self._aiDictationActive && !self._aiIsProcessing) {
                    const rawTranscript = (self._aiTranscript || '').trim();
                    self._aiDictationActive = false;
                    self._isStoppingAIDictation = true;
                    if (self._aiRecognition) { self._aiRecognition.stop(); self._aiRecognition = null; }
                    self._aiTranscript = '';
                    if (rawTranscript) {
                        if (createdBlockId) {
                            // Append transcript to existing promoted block
                            const block = Store.blocks.find(b => b.id === createdBlockId);
                            if (block) {
                                await Store.saveBlock(block, {
                                    content: (block.content || '') + '\n' + rawTranscript,
                                    commit: true
                                });
                            }
                        } else {
                            promoteModalBlock(rawTranscript);
                        }
                    }
                    self._cleanupAIDictation();
                }
                const preview = modal.querySelector('.ai-transcript-preview');
                if (preview) preview.remove();

                self._createModalClose = null;
                self._createModalPromote = null;

                requestAnimationFrame(() => App.render());
            }
        });

        modal.querySelectorAll('.add-tag-btn').forEach(btn => {
            btn.addEventListener('click', () => openTagModal());
        });

        const syncTagsFromPending = () => {
            if (!createdBlockId && DocumentView.pendingNewTags) {
                const pending = DocumentView.pendingNewTags;
                if (JSON.stringify(pending) !== JSON.stringify(modalTags)) {
                    modalTags = [...pending];
                    renderModalTags();
                }
            }
        };

        const onEditorContentChanged = (content) => {
            if (!createdBlockId && content.trim()) {
                promoteModalBlock(content);
            }
        };

        const origClose = modal.close.bind(modal);
        modal.close = () => {
            Store.blocks = Store.blocks.filter(b => b.id !== 'new');
            const promotedId = createdBlockId;
            const promotedContent = promotedId ? Store.blocks.find(b => b.id === promotedId)?.content : null;

            if (promotedId) {
                const ed = DocumentView.editors.get(promotedId);
                if (ed) { ed.destroy(); DocumentView.editors.delete(promotedId); }
            } else {
                DocumentView.editors.delete(modalBlockId);
            }

            origClose();
            Store._filteredBlocksCache.invalidate();
            SelectionManager.updateTagCounts();
            TimelineView.invalidateCache();

            if (promotedId && promotedContent && Store.currentView === 'document') {
                const viewContainer = document.getElementById('viewContainer');
                const newBlockArticle = viewContainer.querySelector('[data-id="new"]');
                if (newBlockArticle) {
                    const block = Store.blocks.find(b => b.id === promotedId);
                    if (block) {
                        const article = document.createElement('article');
                        article.className = 'block';
                        article.dataset.id = promotedId;
                        article.innerHTML = `
                            ${DocumentView.renderCollapseButton(block)}
                            <div class="block-split-marker" data-id="${promotedId}" title="Split note here">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" x2="8.12" y1="4" y2="15.88"/><line x1="14.47" x2="20" y1="14.48" y2="20"/><line x1="8.12" x2="12" y1="8.12" y2="12"/></svg>
                            </div>
                            ${DocumentView.renderBlockMetadata(block)}
                            <div class="block-editor">
                                <div class="codemirror-container" data-id="${promotedId}">${Common.escapeHtml(block.content || '')}</div>
                                <span class="save-indicator" data-id="${promotedId}">saved</span>
                            </div>
                        `;
                        newBlockArticle.parentNode.insertBefore(article, newBlockArticle.nextSibling);
                        const cmContainer = article.querySelector('.codemirror-container');
                        if (cmContainer) {
                            DocumentView.createEditor(cmContainer, promotedId, block.content || '');
                        }
                    }
                }
            } else {
                App.render();
            }
        };

        self._createModalClose = modal.close.bind(modal);
        self._createModalPromote = promoteModalBlock;

        const actionsDiv = modal.querySelector('.block-creation-actions');
        if (actionsDiv) {
            actionsDiv.addEventListener('click', (e) => {
                const btn = e.target.closest('.creation-btn');
                if (!btn) return;
                e.preventDefault();
                const action = btn.dataset.action;
                if (action === 'dictate') {
                    DocumentView.stopSpeechRecognition();
                    actionsDiv.remove();
                } else if (action === 'ai-dictate') {
                    self.handleAIMicClick(modalBlockId, btn);
                    if (!self._aiDictationActive && !self._aiIsProcessing) actionsDiv.remove();
                }
            });
        }

        const methodToolbar = modal.querySelector('.creation-method-toolbar');
        if (methodToolbar) {
            methodToolbar.addEventListener('click', async (e) => {
                const btn = e.target.closest('.creation-method-btn');
                if (!btn) return;
                e.preventDefault();
                const newMethod = btn.dataset.method;
                if (newMethod === method) return;

                DocumentView.stopSpeechRecognition();
                if (self._aiDictationActive) {
                    self.stopAIDictation(createdBlockId || modalBlockId);
                }
                const preview = modal.querySelector('.ai-transcript-preview');
                if (preview) preview.remove();

                const origCloseFn = modal.close.bind(modal);
                modal.close = () => {
                    Store.blocks = Store.blocks.filter(b => b.id !== 'new');
                    if (createdBlockId) {
                        const ed = DocumentView.editors.get(createdBlockId);
                        if (ed) { ed.destroy(); DocumentView.editors.delete(createdBlockId); }
                    } else {
                        DocumentView.editors.delete(modalBlockId);
                    }
                    origCloseFn();
                };
                const editor = DocumentView.editors.get(createdBlockId || modalBlockId);
                const currentContent = editor ? editor.state.doc.toString() : '';
                if (!createdBlockId && currentContent.trim()) {
                    await Store.createBlock(currentContent.trim(), { tags: modalTags });
                }
                modal.close();

                self.showNewNoteModal(newMethod);
            });
        }

        const cmContainer = modal.querySelector('.codemirror-container');

        const initEditor = (initialContent = '') => {
            DocumentView.waitForCodeMirror().then(() => {
                const { EditorView } = window.CodeMirror;

                DocumentView.createEditor(cmContainer, modalBlockId, initialContent, [
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged && !self._aiIsStreaming) {
                            onEditorContentChanged(update.state.doc.toString());
                        }
                    })
                ]);

                const editor = DocumentView.editors.get(modalBlockId);
                if (!editor) return;

                if (method === 'task') {
                    const taskPrefix = '- [ ] ';
                    const docText = editor.state.doc.toString().trim();
                    if (docText.length === 0) {
                        editor.dispatch({
                            changes: { from: 0, to: editor.state.doc.length, insert: taskPrefix },
                            selection: { anchor: taskPrefix.length }
                        });
                    }
                    editor.focus();
                } else if (method === 'dictate') {
                    editor.focus();
                    const btn = modal.querySelector('[data-action="dictate"]');
                    if (btn) {
                        DocumentView.startSpeechRecognition(modalBlockId, btn);
                        Common.showToast('Listening... Tap mic to stop.');
                    }
                } else if (method === 'ai-dictate') {
                    editor.focus();
                    const btn = modal.querySelector('[data-action="ai-dictate"]');
                    if (btn) {
                        self.startAIDictation(modalBlockId, btn);
                    }
                } else {
                    editor.focus();
                }
            });
        };

        if (method === 'template') {
            DocumentView.waitForCodeMirror().then(async () => {
                const templates = await AppSettings.getTemplates();
                if (templates.length === 0) {
                    initEditor('');
                    return;
                }
                const pickerHtml = templates.map(t =>
                    `<button class="creation-btn template-select-btn" data-template-id="${t.id}">${escapeHtml(t.name)}</button>`
                ).join('');
                const pickerWrap = document.createElement('div');
                pickerWrap.className = 'template-picker-inline';
                pickerWrap.innerHTML = pickerHtml;
                const metadata = modal.querySelector('.block-metadata');
                metadata.before(pickerWrap);

                pickerWrap.addEventListener('click', async (e) => {
                    const btn = e.target.closest('.template-select-btn');
                    if (!btn) return;
                    const template = templates.find(t => t.id === btn.dataset.templateId);
                    pickerWrap.remove();
                    const content = template && template.content ? template.content : '';
                    initEditor(content);
                });
            });
        } else {
            initEditor('');
        }

        cmContainer.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                modal.close();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                modal.close();
            }
        });
    }
};

window.NewNoteModal = NewNoteModal;
