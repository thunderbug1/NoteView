/**
 * SpeechManager - Shared Web Speech API session manager.
 * Deduplicates the SpeechRecognition boilerplate (constructor, continuous/interim,
 * auto-restart with session tracking, transcript dedup) that was duplicated across
 * DocumentView (speechRecognition.js), capture.js, and newNoteModal.js.
 *
 * Uses full-transcript delta tracking to prevent Chrome's infamous continuous-mode
 * duplicate words bug. Instead of tracking per-result-index, we accumulate the
 * running full transcript and only emit the suffix on each result event. The
 * accumulator survives auto-restarts so Chrome can't re-emit buffered audio as "new".
 *
 * Continuous mode is deliberately OFF — Chrome handles discrete sessions more
 * reliably. We manually restart on each `end` event to maintain continuity.
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
     * @returns {boolean} Whether running on a mobile device.
     * Mobile browsers handle continuous recognition poorly, so we use discrete sessions.
     */
    isMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
            || window.innerWidth <= 768;
    },

    /**
     * Create a speech recognition session. Handles discrete recognition sessions
     * (non-continuous), interim results, full-transcript delta deduplication,
     * error handling, and automatic reconnection (up to maxRestarts).
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

        // Tracks the full concatenation of all final transcripts delivered so far.
        // Survives auto-restarts — only reset on explicit start(). This prevents
        // Chrome from re-emitting buffered audio as "new" text after a session ends.
        let accumulatedFullText = '';

        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        const useContinuousMode = !this.isMobile();

        function createRecognition() {
            const rec = new SR();
            rec.continuous = useContinuousMode;
            rec.interimResults = true;
            rec.lang = lang;
            console.log('[SpeechManager] Created recognition:', { continuous: useContinuousMode, lang, isMobile: this.isMobile() });
            return rec;
        }

        function buildOnResult(sessionId) {
            return (event) => {
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

                if (interimTranscript && onInterimTranscript) {
                    onInterimTranscript(interimTranscript);
                }

                if (!currentFullText) return;

                console.log('[SpeechManager] Final text:', currentFullText, 'Use continuous:', useContinuousMode);

                if (useContinuousMode) {
                    if (accumulatedFullText && currentFullText.startsWith(accumulatedFullText)) {
                        const delta = currentFullText.substring(accumulatedFullText.length);
                        accumulatedFullText = currentFullText;
                        console.log('[SpeechManager] Delta to insert:', delta);
                        if (delta && onResult) onResult(delta);
                    } else {
                        accumulatedFullText = currentFullText;
                        console.log('[SpeechManager] Full text to insert:', currentFullText);
                        if (onResult) onResult(currentFullText);
                    }
                } else {
                    console.log('[SpeechManager] Mobile mode - inserting text:', currentFullText);
                    if (onResult) onResult(currentFullText);
                }
            };
        }

        function buildOnEnd(sessionId) {
            return () => {
                console.log('[SpeechManager] onEnd called, sessionId:', sessionId, 'current:', sessionCounter, 'isStopping:', isStopping, 'useContinuousMode:', useContinuousMode);
                if (sessionCounter !== sessionId) return;
                if (!isStopping) {
                    if (useContinuousMode) {
                        console.log('[SpeechManager] Continuous mode - cleaning up');
                        cleanup();
                        return;
                    }
                    restartCount++;
                    if (restartCount > maxRestarts) {
                        console.warn('Speech recognition restart limit reached');
                        cleanup();
                        return;
                    }
                    sessionCounter++;
                    accumulatedFullText = '';
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
            console.log('[SpeechManager] start called, isMobile:', this.isMobile(), 'useContinuousMode:', useContinuousMode);
            if (recognition) {
                stop();
            }
            restartCount = 0;
            isStopping = false;
            accumulatedFullText = '';
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
