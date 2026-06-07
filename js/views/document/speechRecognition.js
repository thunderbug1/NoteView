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

    /** @public Start dictation for a block */
    startSpeechRecognition(blockId, btnElement) {
        if (this._speechSession) {
            this._speechSession.stop();
        }

        const view = this.editors.get(blockId);
        if (!view) return;

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
                const currentView = self.editors.get(blockId);
                if (currentView) {
                    self.insertTextAtSelection(currentView, textToInsert, groupAnnotation);
                }
            },
            onError: () => {
                self.stopSpeechRecognition();
            },
            onStop: () => {
                self.cleanupRecognition();
            },
            maxRestarts: this._maxRecognitionRestarts
        });

        this._speechSession.start();
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
        const blockId = this._recordingBlockId;
        const btn = this._recordingBtn;
        this._speechSession = null;
        this._recordingBlockId = null;
        this._recordingBtn = null;

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
