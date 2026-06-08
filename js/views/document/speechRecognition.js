/**
 * DocumentView Speech Recognition module - wraps SpeechManager for CodeMirror insertion.
 * Manages DOM state (recording button, block-recording class) and delegates
 * speech recognition lifecycle to the shared SpeechManager utility.
 *
 * @public methods: isSpeechRecognitionSupported, handleMicClick, startSpeechRecognition,
 *   stopSpeechRecognition, cleanupRecognition
 */
const DocumentSpeechRecognition = {
    /** @public Check if Web Speech API is available */
    isSpeechRecognitionSupported() {
        return SpeechManager.isSupported();
    },

    /** @public Handle mic button click — toggle recording for a block */
    handleMicClick(e) {
        const micBtn = e.target.closest('.mic-btn');
        if (!micBtn) return;
        if (micBtn.closest('.content-modal, .tag-modal')) return;
        if (this._micDebounce) return;
        this._micDebounce = true;
        setTimeout(() => { this._micDebounce = false; }, 300);

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

    /** @public Start dictation for a block */
    startSpeechRecognition(blockId, btnElement) {
        console.log('[SpeechRecognition] Starting dictation for block:', blockId);
        
        if (this._speechSession) {
            console.log('[SpeechRecognition] Stopping existing session');
            this._speechSession.stop();
        }

        const view = DocumentView.editors.get(blockId);
        console.log('[SpeechRecognition] Editor view found:', !!view, 'Block ID:', blockId);
        console.log('[SpeechRecognition] All editor IDs:', Array.from(DocumentView.editors.keys()));
        
        if (!view) {
            console.error('[SpeechRecognition] No editor found for block:', blockId);
            return;
        }

        const { Annotation } = window.CodeMirror;
        const dictationGroup = Annotation.define();
        const groupAnnotation = dictationGroup.of(Date.now());

        this._recordingBlockId = blockId;
        this._recordingBtn = btnElement;

        btnElement.classList.add('recording');
        btnElement.title = 'Stop dictation';

        const block = btnElement.closest('.block');
        if (block) {
            block.classList.add('block-recording');
        }

        view.focus();

        const self = this;
        this._speechSession = SpeechManager.createSession({
            onResult: (textToInsert) => {
                console.log('[SpeechRecognition] onResult called with text:', textToInsert);
                const currentView = DocumentView.editors.get(blockId);
                console.log('[SpeechRecognition] Current view found:', !!currentView);
                if (currentView) {
                    console.log('[SpeechRecognition] Calling insertTextAtSelection');
                    DocumentView.insertTextAtSelection(currentView, textToInsert, groupAnnotation);
                } else {
                    console.error('[SpeechRecognition] No view found for block:', blockId);
                }
            },
            onInterimTranscript: (interimText) => {
                if (btnElement) {
                    btnElement.title = `Dictating... "${interimText}"`;
                }
            },
            onError: (error) => {
                console.error('[SpeechRecognition] Error:', error);
                self.stopSpeechRecognition();
            },
            onStop: () => {
                console.log('[SpeechRecognition] onStop called');
                self.cleanupRecognition();
            },
            maxRestarts: this._maxRecognitionRestarts
        });

        console.log('[SpeechRecognition] Starting speech session');
        this._speechSession.start();
        console.log('[SpeechRecognition] Speech session start() called');
    },

    /** @public Stop dictation */
    stopSpeechRecognition() {
        if (this._speechSession) {
            this._speechSession.stop();
        } else {
            this.cleanupRecognition();
        }
    },

    /** @public Clean up speech recognition DOM state */
    cleanupRecognition() {
        console.log('[SpeechRecognition] cleanupRecognition called');
        const blockId = this._recordingBlockId;
        const btn = this._recordingBtn;
        this._speechSession = null;
        this._recordingBlockId = null;
        this._recordingBtn = null;

        if (btn) {
            console.log('[SpeechRecognition] Removing recording class from button');
            btn.classList.remove('recording');
            btn.title = 'Dictate text';
        }
        if (blockId) {
            const block = document.querySelector(`.block[data-id="${CSS.escape(blockId)}"]`);
            if (block) {
                console.log('[SpeechRecognition] Removing block-recording class');
                block.classList.remove('block-recording');
            }
        }
        console.log('[SpeechRecognition] cleanupRecognition complete');
    },
};
