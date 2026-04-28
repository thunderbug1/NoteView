const CaptureView = {
    render(blocks) {
        const container = document.getElementById('viewContainer');
        if (!container) return;

        const speechSupported = DocumentView.isSpeechRecognitionSupported();
        const aiConfigured = AIAssistant.isConfigured();

        const typeIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
        const micIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>';
        const taskIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>';
        const templateIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>';
        const browseIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>';

        let methods = '';

        methods += `<button class="capture-card" data-method="type">
            ${typeIcon}
            <span class="capture-card-label">Write</span>
        </button>`;

        if (speechSupported) {
            methods += `<button class="capture-card" data-method="dictate">
                ${micIcon}
                <span class="capture-card-label">Dictate</span>
            </button>`;
            if (aiConfigured) {
                methods += `<button class="capture-card" data-method="ai-dictate">
                    ${micIcon}
                    <span class="capture-card-label">AI Dictate</span>
                </button>`;
            }
        }

        methods += `<button class="capture-card" data-method="task">
            ${taskIcon}
            <span class="capture-card-label">Task</span>
        </button>`;

        methods += `<button class="capture-card" data-method="template">
            ${templateIcon}
            <span class="capture-card-label">Template</span>
        </button>`;

        container.innerHTML = `
            <div class="capture-view">
                <div class="capture-grid">
                    ${methods}
                </div>
                <button class="capture-browse-btn" data-action="browse">
                    ${browseIcon}
                    <span>Browse notes</span>
                </button>
            </div>
        `;

        // Wire up creation method buttons
        container.querySelectorAll('.capture-card').forEach(card => {
            card.addEventListener('click', () => {
                App.showNewNoteModal(card.dataset.method);
            });
        });

        // Wire up browse button
        const browseBtn = container.querySelector('.capture-browse-btn');
        if (browseBtn) {
            browseBtn.addEventListener('click', () => {
                App.setView('document');
            });
        }
    }
};
