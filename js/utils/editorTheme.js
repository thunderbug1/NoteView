/**
 * EditorTheme — CodeMirror 6 theme configuration for DocumentView.
 * Extracted from document.js to reduce file size.
 */
window.EditorTheme = {
    _cached: null,

    get() {
        if (this._cached) return this._cached;
        if (!window.CodeMirror?.EditorView) return null;
        const { EditorView } = window.CodeMirror;
        this._cached = EditorView.theme({
            "&": {
                fontFamily: 'Inter, -apple-system, sans-serif',
                fontSize: '15px',
                lineHeight: '1.6'
            },
            ".cm-content": {
                padding: '0',
                minHeight: '0'
            },
            ".cm-editor": {
                minHeight: '0'
            },
            ".cm-focused": {
                outline: '2px solid var(--accent, #3b82f6)',
                outlineOffset: '2px'
            },
            ".cm-tooltip.cm-tooltip-autocomplete": {
                border: '1px solid var(--border)',
                backgroundColor: 'var(--bg-primary, #ffffff)',
                borderRadius: '10px',
                boxShadow: '0 12px 30px rgba(15, 23, 42, 0.12)',
                overflow: 'hidden'
            },
            ".cm-tooltip-autocomplete ul": {
                fontFamily: 'inherit',
                padding: '4px'
            },
            ".cm-tooltip-autocomplete li": {
                borderRadius: '8px',
                padding: '6px 10px'
            },
            ".cm-tooltip-autocomplete li[aria-selected]": {
                backgroundColor: 'var(--bg-hover, #f1f5f9)',
                color: 'var(--text-primary, #0f172a)'
            },
            ".cm-completionLabel": {
                color: 'var(--text-primary, #0f172a)'
            },
            ".cm-foldGutter": {
                width: '15px'
            },
            ".cm-foldGutter .cm-gutterElement": {
                color: 'var(--text-muted, #94a3b8)',
                cursor: 'pointer'
            },
            ".cm-foldGutter .cm-gutterElement:hover": {
                color: 'var(--text-primary, #0f172a)'
            },
            ".md-header": {
                fontWeight: '700',
                color: 'var(--text-primary)',
                display: 'inline-block'
            },
            ".md-header-1": { fontSize: '1.8em', padding: '0.1em 0' },
            ".md-header-2": { fontSize: '1.5em', padding: '0.1em 0' },
            ".md-header-3": { fontSize: '1.3em', padding: '0.1em 0' },
            ".md-header-4": { fontSize: '1.1em', padding: '0.1em 0' },
            ".md-header-5": { fontSize: '1.0em', padding: '0.1em 0' },
            ".md-header-6": { fontSize: '0.9em', padding: '0.1em 0' },
            ".md-strong": {
                fontWeight: '700',
                color: 'var(--text-primary)'
            },
            ".md-emphasis": {
                fontStyle: 'italic'
            },
            ".md-code": {
                backgroundColor: 'var(--code-bg, #f1f5f9)',
                color: 'var(--code-color, #0f172a)',
                borderRadius: '3px',
                padding: '2px 4px',
                fontFamily: 'monospace',
                fontSize: '0.9em'
            },
            ".md-link-text": {
                color: 'var(--accent)',
                textDecoration: 'underline'
            },
            ".md-wikilink": {
                color: 'var(--accent)',
                backgroundColor: 'rgba(59, 130, 246, 0.08)',
                padding: '1px 5px',
                borderRadius: '4px',
                cursor: 'pointer',
                textDecoration: 'none',
                border: '1px solid rgba(59, 130, 246, 0.2)',
                whiteSpace: 'nowrap'
            },
            ".md-wikilink:hover": {
                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                borderColor: 'var(--accent)'
            },
            ".md-wikilink-broken": {
                color: 'var(--text-muted, #94a3b8)',
                backgroundColor: 'rgba(148, 163, 184, 0.08)',
                borderColor: 'rgba(148, 163, 184, 0.2)',
                textDecoration: 'line-through',
                textDecorationStyle: 'dotted'
            },
            ".md-wikilink-broken:hover": {
                backgroundColor: 'rgba(148, 163, 184, 0.15)'
            },
            ".md-wikilink-source": {
                color: 'var(--accent)',
                backgroundColor: 'rgba(59, 130, 246, 0.06)',
                borderRadius: '3px'
            },
            ".md-strikethrough": {
                textDecoration: 'line-through'
            },
            ".md-task-checkbox": {
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '18px',
                height: '18px',
                border: '1.5px solid var(--border-light)',
                borderRadius: '4px',
                marginRight: '8px',
                verticalAlign: 'text-bottom',
                cursor: 'pointer',
                color: 'transparent',
                transition: 'all 0.15s ease'
            },
            ".md-task-checkbox:hover": {
                borderColor: 'var(--accent)'
            },
            ".state-done": {
                backgroundColor: 'var(--accent)',
                borderColor: 'var(--accent)',
                color: 'white'
            },
            ".state-progress": {
                borderColor: 'var(--warning-color, #f59e0b)'
            },
            ".state-progress .half-fill": {
                width: '10px',
                height: '10px',
                backgroundColor: 'var(--warning-color, #f59e0b)',
                borderRadius: '2px'
            },
            ".state-blocked": {
                backgroundColor: 'var(--danger-color, #ef4444)',
                borderColor: 'var(--danger-color, #ef4444)',
                color: 'white'
            },
            ".state-canceled": {
                backgroundColor: 'var(--bg-tertiary, #f1f5f9)',
                borderColor: 'var(--border-light)',
                color: 'var(--text-muted, #94a3b8)'
            },
            ".md-task-done": {
                textDecoration: 'line-through',
                color: 'var(--text-muted, #94a3b8)'
            },
            ".md-task-badge": {
                display: 'inline-flex',
                alignItems: 'center',
                fontSize: '0.85em',
                padding: '2px 6px',
                borderRadius: '12px',
                backgroundColor: 'var(--bg-secondary, #f8fafc)',
                color: 'var(--text-secondary, #64748b)',
                border: '1px solid var(--border)',
                margin: '0 4px',
                verticalAlign: 'text-bottom',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
            },
            ".badge-due": {
                borderColor: 'var(--badge-work-border, #bae6fd)',
                backgroundColor: 'var(--badge-work-bg, #f0f9ff)',
                color: 'var(--badge-work-text, #075985)'
            },
            ".badge-due[data-urgency='overdue']": {
                borderColor: 'rgba(239, 68, 68, 0.3)',
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                color: '#ef4444',
                fontWeight: '600'
            },
            ".badge-due[data-urgency='upcoming-soon']": {
                borderColor: 'rgba(245, 158, 11, 0.3)',
                backgroundColor: 'rgba(245, 158, 11, 0.08)',
                color: '#f59e0b',
                fontWeight: '600'
            },
            ".badge-due[data-urgency='upcoming']": {
                borderColor: 'rgba(59, 130, 246, 0.25)',
                backgroundColor: 'rgba(59, 130, 246, 0.05)',
                color: 'var(--accent)'
            },
            ".badge-start": {
                borderColor: 'rgba(34, 197, 94, 0.3)',
                backgroundColor: 'rgba(34, 197, 94, 0.05)',
                color: '#16a34a'
            },
            ".badge-assignee": {
                borderColor: 'var(--badge-time-border, #d8b4fe)',
                backgroundColor: 'var(--badge-time-bg, #faf5ff)',
                color: 'var(--badge-time-text, #6b21a8)'
            },
            ".badge-priority": {
                borderColor: 'var(--border)',
                backgroundColor: 'var(--bg-secondary, #f8fafc)',
                color: 'var(--text-secondary, #64748b)'
            },
            ".badge-priority[data-priority='urgent']": {
                borderColor: 'rgba(239, 68, 68, 0.3)',
                backgroundColor: 'rgba(239, 68, 68, 0.05)',
                color: '#ef4444',
                fontWeight: '700'
            },
            ".badge-priority[data-priority='high']": {
                borderColor: 'rgba(249, 115, 22, 0.3)',
                backgroundColor: 'rgba(249, 115, 22, 0.05)',
                color: '#f97316',
                fontWeight: '600'
            },
            ".badge-priority[data-priority='medium']": {
                borderColor: 'rgba(59, 130, 246, 0.3)',
                backgroundColor: 'rgba(59, 130, 246, 0.05)',
                color: '#3b82f6'
            },
            ".badge-priority[data-priority='low']": {
                borderColor: 'rgba(148, 163, 184, 0.3)',
                backgroundColor: 'rgba(148, 163, 184, 0.05)',
                color: '#94a3b8'
            },
            ".badge-id": {
                opacity: '0.7',
                fontFamily: 'monospace',
                fontSize: '0.8em'
            },
            ".md-task-badge:hover": {
                backgroundColor: 'var(--bg-hover, #f1f5f9)'
            },
            ".md-add-deadline, .md-add-action": {
                display: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted, #94a3b8)',
                marginLeft: '8px',
                verticalAlign: 'text-bottom',
                padding: '2px 4px',
                borderRadius: '4px'
            },
            ".md-add-deadline:hover, .md-add-action:hover": {
                color: 'var(--accent)',
                backgroundColor: 'var(--bg-hover, #f1f5f9)'
            },
        });
        return this._cached;
    }
};
