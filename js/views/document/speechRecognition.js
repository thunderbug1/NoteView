/**
 * Speech Recognition module - Web Speech API integration
 * State stored on DocumentView (this._recognition, this._recordingBlockId, etc.)
 */
const DocumentSpeechRecognition = {
    isSpeechRecognitionSupported() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    },

    handleMicClick(e) {
        if (this._micDebounce) return;
        this._micDebounce = true;
        setTimeout(() => { this._micDebounce = false; }, 300);

        const micBtn = e.target.closest('.mic-btn');
        if (!micBtn) return;
        e.preventDefault();
        e.stopPropagation();
        const blockId = micBtn.dataset.id;
        if (!blockId) return;

        if (this._recordingBlockId === blockId) {
            this.stopSpeechRecognition();
        } else {
            this.startSpeechRecognition(blockId, micBtn);
        }
    },

    startSpeechRecognition(blockId, btnElement) {
        if (this._recognition) {
            this.stopSpeechRecognition();
        }

        this._recognitionRestartCount = 0;

        const view = this.editors.get(blockId);
        if (!view) return;

        const { Annotation } = window.CodeMirror;
        const dictationGroup = Annotation.define();
        const groupAnnotation = dictationGroup.of(Date.now());

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = '';

        this._recognition = recognition;
        this._recordingBlockId = blockId;
        this._recordingBtn = btnElement;
        this._isStopping = false;
        this._insertedTranscript = '';
        this._recognitionSession = (this._recognitionSession || 0) + 1;
        let sessionId = this._recognitionSession;

        btnElement.classList.add('recording');
        btnElement.title = 'Stop dictation';

        const block = btnElement.closest('.block');
        if (block) {
            block.classList.add('block-recording');
        }

        view.focus();

        const onresult = (event) => {
            if (this._recognitionSession !== sessionId) return;
            let newFinalText = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    newFinalText += event.results[i][0].transcript;
                }
            }

            if (!newFinalText) return;

            const normalizedPrev = this._insertedTranscript.trim().toLowerCase();
            const normalizedNew = newFinalText.trim().toLowerCase();

            let textToInsert;
            if (normalizedPrev && normalizedNew.startsWith(normalizedPrev)) {
                textToInsert = newFinalText.substring(this._insertedTranscript.length);
                this._insertedTranscript = newFinalText;
            } else {
                textToInsert = newFinalText;
                this._insertedTranscript += newFinalText;
            }

            if (textToInsert) {
                const currentView = this.editors.get(blockId);
                if (currentView) {
                    this.insertTextAtSelection(currentView, textToInsert, groupAnnotation);
                }
            }
        };

        const onerror = (event) => {
            if (this._recognitionSession !== sessionId) return;
            console.warn('Speech recognition error:', event.error);
            this.stopSpeechRecognition();
        };

        const onend = () => {
            if (this._recognitionSession !== sessionId) return;
            if (!this._isStopping && this._recordingBlockId === blockId) {
                this._recognitionRestartCount++;
                if (this._recognitionRestartCount > this._maxRecognitionRestarts) {
                    console.warn('Speech recognition restart limit reached');
                    this.stopSpeechRecognition();
                    return;
                }
                this._recognitionSession++;
                sessionId = this._recognitionSession;
                try {
                    if (this._recognition) {
                        this._recognition.onend = null;
                        this._recognition.onerror = null;
                        this._recognition.onresult = null;
                        try { this._recognition.stop(); } catch (_) {}
                    }
                    const NewRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                    const newRecognition = new NewRecognition();
                    newRecognition.continuous = true;
                    newRecognition.interimResults = true;
                    newRecognition.lang = '';
                    newRecognition.onresult = onresult;
                    newRecognition.onerror = onerror;
                    newRecognition.onend = onend;
                    this._recognition = newRecognition;
                    try {
                        newRecognition.start();
                    } catch (startErr) {
                        console.error('[DocumentView] Speech recognition start failed:', startErr);
                        this.cleanupRecognition();
                    }
                } catch (e) {
                    this.cleanupRecognition();
                }
            } else {
                this.cleanupRecognition();
            }
        };

        recognition.onresult = onresult;
        recognition.onerror = onerror;
        recognition.onend = onend;

        recognition.start();
    },

    stopSpeechRecognition() {
        this._isStopping = true;
        if (this._recognition) {
            this._recognition.stop();
        } else {
            this.cleanupRecognition();
        }
    },

    cleanupRecognition() {
        const blockId = this._recordingBlockId;
        const btn = this._recordingBtn;
        this._recognition = null;
        this._recordingBlockId = null;
        this._recordingBtn = null;
        this._insertedTranscript = '';

        if (btn) {
            btn.classList.remove('recording');
            btn.title = 'Dictate text';
        }
        if (blockId) {
            const block = document.querySelector(`.block[data-id="${CSS.escape(blockId)}"]`);
            if (block) {
                block.classList.remove('block-recording');
            }
        }
    },
};
