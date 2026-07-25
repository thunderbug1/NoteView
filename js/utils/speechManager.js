/**
 * SpeechManager - Shared Web Speech API session manager.
 * Deduplicates the SpeechRecognition boilerplate (constructor, interim results,
 * auto-restart with session tracking) that was duplicated across
 * DocumentView (speechRecognition.js), capture.js, and newNoteModal.js.
 *
 * Uses discrete recognition sessions on all platforms — Chrome's continuous
 * mode often delays or never emits final results (only interim), causing
 * `onResult` to never fire and dictation to appear broken. Discrete sessions
 * trigger final results promptly and we auto-restart for continuity.
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
     *
     * Verified working in Capacitor Android WebView on Pixel 6 / Android 17 /
     * Chrome 150 WebView via OPFS probe. Other devices may vary — if a user
     * reports dictation failures on a specific OEM ROM, we can add an opt-out
     * or platform-specific guard here.
     */
    isSupported() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    },

    /**
     * @returns {boolean} Whether running on a mobile device.
     */
    isMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
            || window.innerWidth <= 768;
    },

    /**
     * Create a speech recognition session. Uses discrete (non-continuous) sessions
     * with automatic restart on `end` for continuity across all platforms.
     *
     * @param {Object} opts
     * @param {function(string): void} opts.onResult - Called with deduplicated transcript text ready to insert.
     *   The session tracks the full running transcript and only emits the new portion.
     * @param {function(): void} [opts.onError] - Called on recognition error.
     * @param {function(): void} [opts.onStop] - Called after stop/cleanup completes (DOM classes removed, etc.).
     * @param {function(): void} [opts.onStart] - Called after recognition starts successfully.
     * @param {number} [opts.maxRestarts=10] - Maximum auto-restart attempts before giving up.
     * @param {string} [opts.lang=''] - Language for recognition (empty = browser default).
     * @param {function(string): void} [opts.onInterimTranscript] - Called with interim (non-final) transcript.
     * @returns {{ start: function, stop: function, cleanup: function }}
     */
    createSession(opts) {
        const { onResult, onError, onStop, onStart, onInterimTranscript } = opts;
        const maxRestarts = opts.maxRestarts || 10;
        const lang = opts.lang || '';

        let recognition = null;
        let isStopping = false;
        let restartCount = 0;
        let sessionCounter = 0;

        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        // Discrete sessions produce final results promptly across all Chrome versions.
        // Continuous mode often delays/never emits final results, breaking dictation.
        const useContinuousMode = false;

        function createRecognition() {
            const rec = new SR();
            rec.continuous = useContinuousMode;
            rec.interimResults = true;
            rec.lang = lang;
            console.log('[SpeechManager] Created recognition:', { continuous: useContinuousMode, lang, isMobile: SpeechManager.isMobile() });
            return rec;
        }

        function buildOnResult(sessionId) {
            return (event) => {
                console.log('[SpeechManager] onResult called, sessionId:', sessionId, 'current:', sessionCounter, 'results.length:', event.results.length);
                if (sessionCounter !== sessionId) return;

                let interimTranscript = '';
                let currentFullText = '';

                for (let i = 0; i < event.results.length; i++) {
                    const result = event.results[i];
                    if (result.isFinal) {
                        currentFullText += result[0].transcript;
                    } else {
                        interimTranscript += result[0].transcript;
                    }
                }

                console.log('[SpeechManager] Transcripts - interim:', interimTranscript, 'final:', currentFullText);

                if (interimTranscript && onInterimTranscript) {
                    onInterimTranscript(interimTranscript);
                }

                if (!currentFullText) return;

                console.log('[SpeechManager] Final text:', currentFullText);

                if (onResult) onResult(currentFullText);
            };
        }

        function buildOnEnd(sessionId) {
            return () => {
                console.log('[SpeechManager] onEnd called, sessionId:', sessionId, 'current:', sessionCounter, 'isStopping:', isStopping, 'useContinuousMode:', useContinuousMode);
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
                        newRecognition.onerror = (event) => {
                            if (sessionCounter !== newSessionId) return;
                            console.warn('Speech recognition error:', event.error);
                            if (onError) onError();
                            stop();
                        };
                        newRecognition.onend = buildOnEnd(newSessionId);
                        recognition = newRecognition;
                        try {
                            console.log('[SpeechManager] Restarting speech session, attempt:', restartCount);
                            newRecognition.start();
                        } catch (startErr) {
                            console.error('[SpeechManager] Restart start failed:', startErr);
                            cleanup();
                        }
                    } catch (e) {
                        console.error('[SpeechManager] Restart failed:', e);
                        cleanup();
                    }
                } else {
                    console.log('[SpeechManager] Stopping - cleaning up');
                    cleanup();
                }
            };
        }

        function cleanup() {
            recognition = null;
            if (onStop) onStop();
        }

        function start() {
            console.log('[SpeechManager] start called, isMobile:', SpeechManager.isMobile(), 'useContinuousMode:', useContinuousMode);
            if (recognition) {
                stop();
            }
            restartCount = 0;
            isStopping = false;
            sessionCounter++;
            const sessionId = sessionCounter;

            recognition = createRecognition();

            recognition.onresult = buildOnResult(sessionId);
            recognition.onerror = (event) => {
                console.error('[SpeechManager] onerror:', event.error, 'sessionId:', sessionId, 'current:', sessionCounter);
                if (sessionCounter !== sessionId) return;
                console.warn('Speech recognition error:', event.error);
                if (onError) onError();
                stop();
            };
            recognition.onend = buildOnEnd(sessionId);

            try {
                recognition.start();
                if (onStart) onStart();
                console.log('[SpeechManager] Speech session started successfully');
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
