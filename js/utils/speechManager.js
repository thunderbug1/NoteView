/**
 * SpeechManager - Shared Web Speech API session manager.
 * Deduplicates the SpeechRecognition boilerplate (constructor, continuous/interim,
 * auto-restart with session tracking, transcript dedup) that was duplicated across
 * DocumentView (speechRecognition.js), capture.js, and newNoteModal.js.
 *
 * Usage:
 *   if (!SpeechManager.isSupported()) return;
 *   const session = SpeechManager.createSession({
 *       onResult: (textToInsert) => {
 *           // textToInsert is deduplicated transcript ready for insertion
 *       },
 *       onError: () => { /* handle error * / },
 *       onStop: () => { /* handle stop/cleanup UI * / }
 *   });
 *   session.start();
 *   // later...
 *   session.stop();
 */
const SpeechManager = {
    /**
     * @returns {boolean} Whether the Web Speech API is available.
     */
    isSupported() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    },

    /**
     * Create a speech recognition session. Handles continuous recognition,
     * interim results, transcript deduplication, error handling, and
     * automatic reconnection (up to maxRestarts).
     *
     * @param {Object} opts
     * @param {function(string): void} opts.onResult - Called with deduplicated transcript text ready to insert.
     *   The session handles stripping previously-inserted text so the caller only gets the new portion.
     * @param {function(): void} [opts.onError] - Called on recognition error.
     * @param {function(): void} [opts.onStop] - Called after stop/cleanup completes (DOM classes removed, etc.).
     * @param {function(): void} [opts.onStart] - Called after recognition starts successfully.
     * @param {number} [opts.maxRestarts=10] - Maximum auto-restart attempts before giving up.
     * @param {string} [opts.lang=''] - Language for recognition (empty = browser default).
     * @param {function(): void} [opts.onInterimTranscript] - Called with interim (non-final) transcript.
     * @returns {{ start: function, stop: function, cleanup: function }}
     */
    createSession(opts) {
        const { onResult, onError, onStop, onStart, onInterimTranscript } = opts;
        const maxRestarts = opts.maxRestarts || 10;
        const lang = opts.lang || '';

        let recognition = null;
        let isStopping = false;
        let restartCount = 0;
        let insertedTranscript = '';
        let sessionCounter = 0;

        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

        function createRecognition() {
            const rec = new SR();
            rec.continuous = true;
            rec.interimResults = true;
            rec.lang = lang;
            return rec;
        }

        let currentOnResult, currentOnError, currentOnEnd;

        function buildOnResult(sessionId) {
            return (event) => {
                if (sessionCounter !== sessionId) return;

                let interimTranscript = '';
                let newFinalText = '';
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    if (event.results[i].isFinal) {
                        newFinalText += event.results[i][0].transcript;
                    } else {
                        interimTranscript += event.results[i][0].transcript;
                    }
                }

                if (interimTranscript && onInterimTranscript) {
                    onInterimTranscript(interimTranscript);
                }

                if (!newFinalText) return;

                const normalizedPrev = insertedTranscript.trim().toLowerCase();
                const normalizedNew = newFinalText.trim().toLowerCase();

                let textToInsert;
                if (normalizedPrev && normalizedNew.startsWith(normalizedPrev)) {
                    textToInsert = newFinalText.substring(insertedTranscript.length);
                    insertedTranscript = newFinalText;
                } else {
                    textToInsert = newFinalText;
                    insertedTranscript += newFinalText;
                }

                if (textToInsert && onResult) {
                    onResult(textToInsert);
                }
            };
        }

        function buildOnEnd(sessionId) {
            return () => {
                if (sessionCounter !== sessionId) return;
                if (!isStopping) {
                    restartCount++;
                    if (restartCount > maxRestarts) {
                        console.warn('Speech recognition restart limit reached');
                        cleanup();
                        return;
                    }
                    sessionCounter++;
                    const newSessionId = sessionCounter;
                    try {
                        if (recognition) {
                            recognition.onend = null;
                            recognition.onerror = null;
                            recognition.onresult = null;
                            try { recognition.stop(); } catch (_) {}
                        }
                        const newRecognition = createRecognition();
                        newRecognition.onresult = buildOnResult(newSessionId);
                        newRecognition.onerror = currentOnError;
                        newRecognition.onend = buildOnEnd(newSessionId);
                        recognition = newRecognition;
                        try {
                            newRecognition.start();
                        } catch (startErr) {
                            console.error('[SpeechManager] Restart start failed:', startErr);
                            cleanup();
                        }
                    } catch (e) {
                        cleanup();
                    }
                } else {
                    cleanup();
                }
            };
        }

        function cleanup() {
            recognition = null;
            insertedTranscript = '';
            if (onStop) onStop();
        }

        function start() {
            if (recognition) {
                stop();
            }
            restartCount = 0;
            isStopping = false;
            insertedTranscript = '';
            sessionCounter++;
            const sessionId = sessionCounter;

            recognition = createRecognition();
            currentOnResult = buildOnResult(sessionId);
            currentOnError = (event) => {
                if (sessionCounter !== sessionId) return;
                console.warn('Speech recognition error:', event.error);
                if (onError) onError();
                stop();
            };
            currentOnEnd = buildOnEnd(sessionId);

            recognition.onresult = currentOnResult;
            recognition.onerror = currentOnError;
            recognition.onend = currentOnEnd;

            try {
                recognition.start();
                if (onStart) onStart();
            } catch (err) {
                console.error('[SpeechManager] Start failed:', err);
                cleanup();
            }
        }

        function stop() {
            isStopping = true;
            if (recognition) {
                try { recognition.stop(); } catch (_) {}
            } else {
                cleanup();
            }
        }

        return { start, stop, cleanup };
    }
};
