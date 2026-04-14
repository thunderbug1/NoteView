/**
 * Timeline View - Shows task status changes from git history as a vertical timeline
 */

const TimelineView = {
    stateLabels: {
        ' ': 'Todo',
        '/': 'In Progress',
        'x': 'Done',
        'b': 'Blocked',
        '-': 'Canceled'
    },

    stateIcons: {
        ' ': '☐',
        '/': '◐',
        'x': '✓',
        'b': '⊘',
        '-': '✕'
    },

    // Filtered events cache (keyed by sidebar selections)
    _cache: CacheManager.createCache(() => {
        const timeSelection = SelectionManager.selections?.time || '';
        const contextSelection = SelectionManager.selections?.context
            ? Array.from(SelectionManager.selections.context).sort().join(',')
            : '';
        const contactSelection = SelectionManager.selections?.contact || '';
        const searchQuery = Store.searchQuery || '';
        return `${timeSelection}|${contextSelection}|${contactSelection}|${searchQuery}`;
    }),

    // Raw git data cache — stores task snapshots per commit, survives filter changes.
    // Validated by HEAD OID inside buildTimeline(). Incremental rebuild when only new
    // commits are added; full rebuild when HEAD OID doesn't match or on first load.
    _rawDataCache: {
        headOid: null,
        commitCount: 0,
        commitSnapshots: [],
    },

    /**
     * Check if cache is still valid
     */
    isCacheValid() {
        return this._cache.isValid();
    },

    /**
     * Invalidate the filtered events cache.
     * The raw data cache is preserved for incremental rebuilds.
     */
    invalidateCache() {
        this._cache.invalidate();
    },

    /**
     * Force full rebuild on next buildTimeline() call.
     * Called after operations that fundamentally change git history
     * (pull, directory change, etc.)
     */
    invalidateRawDataCache() {
        this._rawDataCache.headOid = null;
        this._rawDataCache.commitCount = 0;
        this._rawDataCache.commitSnapshots = [];
    },

    /**
     * Extract tasks from raw markdown content (mirrors KanbanView logic).
     * Returns a Map of taskKey -> { state, text, badges }
     */
    extractTasksFromContent(content) {
        return TaskParser.parseTasksFromContent(content);
    },

    /**
     * Extract tasks from all files at a commit, grouped by filename.
     * Returns Map of filename -> Map of taskKey -> { state, text }
     */
    extractAllTasks(filesContent) {
        const result = new Map();
        for (const [filename, content] of Object.entries(filesContent)) {
            // Parse frontmatter to get the content body and tags
            const parsed = parseFrontMatter(content);
            const tasks = this.extractTasksFromContent(parsed.content);
            if (tasks.size > 0) {
                result.set(filename, { tasks, tags: parsed.tags || [] });
            }
        }
        return result;
    },

    /**
     * Diff tasks between two commits and return status change events.
     */
    diffTasks(prevAllTasks, currAllTasks, commit) {
        const events = [];
        
        // Check all files in current commit
        for (const [filename, { tasks: currTasks, tags }] of currAllTasks) {
            const prevData = prevAllTasks.get(filename);
            const prevTasks = prevData ? prevData.tasks : new Map();
            const blockId = filename.replace('.md', '');
            
            for (const [key, currTask] of currTasks) {
                const prevTask = prevTasks.get(key);
                
                if (!prevTask) {
                    // New task created
                    events.push({
                        type: 'created',
                        taskText: currTask.text,
                        badges: currTask.badges || [],
                        newState: currTask.state,
                        oldState: null,
                        timestamp: commit.timestamp,
                        commitMessage: commit.message,
                        blockId: blockId,
                        filename: filename,
                        tags: tags,
                        oid: commit.oid,
                        parents: commit.parents
                    });
                } else if (prevTask.state !== currTask.state) {
                    // State changed
                    events.push({
                        type: 'changed',
                        taskText: currTask.text,
                        badges: currTask.badges || [],
                        oldState: prevTask.state,
                        newState: currTask.state,
                        timestamp: commit.timestamp,
                        commitMessage: commit.message,
                        blockId: blockId,
                        filename: filename,
                        tags: tags,
                        oid: commit.oid,
                        parents: commit.parents
                    });
                }
            }
            
            // Check for removed tasks
            for (const [key, prevTask] of prevTasks) {
                if (!currTasks.has(key)) {
                    events.push({
                        type: 'removed',
                        taskText: prevTask.text,
                        badges: prevTask.badges || [],
                        oldState: prevTask.state,
                        newState: null,
                        timestamp: commit.timestamp,
                        commitMessage: commit.message,
                        blockId: blockId,
                        filename: filename,
                        tags: prevData ? prevData.tags : [],
                        oid: commit.oid,
                        parents: commit.parents
                    });
                }
            }
        }
        
        // Check files that existed before but are gone now
        for (const [filename, { tasks: prevTasks, tags }] of prevAllTasks) {
            if (!currAllTasks.has(filename)) {
                for (const [key, prevTask] of prevTasks) {
                    events.push({
                        type: 'removed',
                        taskText: prevTask.text,
                        badges: prevTask.badges || [],
                        oldState: prevTask.state,
                        newState: null,
                        timestamp: commit.timestamp,
                        commitMessage: commit.message,
                        blockId: filename.replace('.md', ''),
                        filename: filename,
                        tags: tags,
                        parents: commit.parents
                    });
                }
            }
        }
        
        return events;
    },

    /**
     * Process a single commit: determine changed files, extract tasks, diff.
     * Uses diff-based approach for commits after the first one.
     */
    async _processCommit(commit, prevAllTasks, parentCommit) {
        let currAllTasks;

        if (!parentCommit) {
            // First commit: must read all files
            const filesContent = await GitStore.getAllFilesAtCommit(commit.oid);
            currAllTasks = this.extractAllTasks(filesContent);
        } else {
            // Diff-based: only read files that changed between parent and this commit
            const changedFiles = await GitStore.getChangedFilesBetween(
                parentCommit.oid, commit.oid
            );

            if (changedFiles === null) {
                // walk() failed, fallback to reading all files
                const filesContent = await GitStore.getAllFilesAtCommit(commit.oid);
                currAllTasks = this.extractAllTasks(filesContent);
            } else if (Object.keys(changedFiles).length === 0) {
                // No file changes (e.g. merge commit) — carry forward previous tasks
                currAllTasks = prevAllTasks;
            } else {
                // Start from previous snapshot, update only changed files
                currAllTasks = new Map(prevAllTasks);
                for (const [filename, content] of Object.entries(changedFiles)) {
                    if (content === null || content === undefined) {
                        // File was deleted or content unavailable
                        currAllTasks.delete(filename);
                    } else if (typeof content === 'string') {
                        const parsed = parseFrontMatter(content);
                        const tasks = this.extractTasksFromContent(parsed.content);
                        if (tasks.size > 0) {
                            currAllTasks.set(filename, { tasks, tags: parsed.tags || [] });
                        } else {
                            currAllTasks.delete(filename);
                        }
                    }
                }
            }
        }

        const events = this.diffTasks(prevAllTasks, currAllTasks, commit);
        return { tasks: currAllTasks, events };
    },

    /**
     * Build the full list of events from git history.
     * Uses diff-based file discovery and supports incremental rebuilds.
     */
    async buildTimeline() {
        const commits = await GitStore.getFullHistory(100);
        if (commits.length === 0) return [];

        // Process from oldest to newest for correct diffing
        const chronological = [...commits].reverse();
        const currentHeadOid = commits[0].oid;

        // Check if we can do an incremental rebuild (new commits appended to existing history)
        const rawCache = this._rawDataCache;
        const canIncrement = rawCache.headOid !== null
            && rawCache.commitCount > 0
            && rawCache.commitSnapshots.length === rawCache.commitCount
            && chronological.length > rawCache.commitCount
            && chronological[rawCache.commitCount - 1].oid
                === rawCache.commitSnapshots[rawCache.commitCount - 1].oid;

        let allEvents = [];
        let commitSnapshots;
        let prevAllTasks;

        if (canIncrement) {
            // Incremental: reuse existing snapshots, process only new commits
            commitSnapshots = [...rawCache.commitSnapshots];
            prevAllTasks = commitSnapshots[commitSnapshots.length - 1].tasks;

            for (let i = rawCache.commitCount; i < chronological.length; i++) {
                const commit = chronological[i];
                const { tasks, events } = await this._processCommit(
                    commit, prevAllTasks, chronological[i - 1]
                );
                commitSnapshots.push({ oid: commit.oid, tasks });
                allEvents.push(...events);
                prevAllTasks = tasks;
            }
        } else {
            // Full rebuild with diff-based optimization
            commitSnapshots = [];
            prevAllTasks = new Map();

            for (let i = 0; i < chronological.length; i++) {
                const commit = chronological[i];
                const parentCommit = i > 0 ? chronological[i - 1] : null;
                const { tasks, events } = await this._processCommit(
                    commit, prevAllTasks, parentCommit
                );
                commitSnapshots.push({ oid: commit.oid, tasks });
                allEvents.push(...events);
                prevAllTasks = tasks;
            }
        }

        // Update raw data cache
        this._rawDataCache.headOid = currentHeadOid;
        this._rawDataCache.commitCount = chronological.length;
        this._rawDataCache.commitSnapshots = commitSnapshots;

        // Return newest first
        allEvents.reverse();
        return allEvents;
    },

    /**
     * Filter events based on current sidebar selections (context tags, search, contacts, time).
     */
    filterEvents(events) {
        const timeSelection = SelectionManager.selections.time || '';
        const contextSelection = SelectionManager.selections.context;
        const contactSelection = SelectionManager.selections.contact;
        const searchQuery = Store.searchQuery;

        // Build set of pinned block IDs for O(1) lookup
        const pinnedBlockIds = new Set(
            Store.blocks.filter(b => b.pinned).map(b => b.id)
        );

        return events.filter(event => {
            // Events from currently-pinned blocks always pass through
            if (pinnedBlockIds.has(event.blockId)) return true;
            // Time filter
            if (timeSelection && !TimeFilter.checkTimeFilter(event.timestamp, timeSelection)) {
                return false;
            }
            
            // Context tag filter
            if (contextSelection.size > 0) {
                const requiredTags = Array.from(contextSelection).filter(t => !SelectionManager.isComputedContextTag(t));
                
                if (requiredTags.length > 0) {
                    const hasAllTags = requiredTags.every(tag => event.tags?.includes(tag));
                    if (!hasAllTags) return false;
                }
                
                if (contextSelection.has('Status.untagged')) {
                    if (event.tags && event.tags.length > 0) return false;
                }
                if (contextSelection.has('Todo.all')) {
                        // Timeline events are always task events.
                }
                if (contextSelection.has('Todo.open')) {
                        const eventTask = { state: event.newState ?? event.oldState, badges: event.badges || [] };
                        if (!TaskParser.isOpenTask(eventTask)) return false;
                }
                if (contextSelection.has('Todo.blocked')) {
                        const eventTask = { state: event.newState ?? event.oldState, badges: event.badges || [] };
                        if (!TaskParser.isBlockedTask(eventTask)) return false;
                }
                if (contextSelection.has('Todo.unblocked')) {
                        const eventTask = { state: event.newState ?? event.oldState, badges: event.badges || [] };
                        if (!TaskParser.isUnblockedTask(eventTask)) return false;
                }
                if (contextSelection.has('Status.unassigned')) {
                        const eventTask = { state: event.newState ?? event.oldState, badges: event.badges || [] };
                    if (!TaskParser.isUnassignedTask(eventTask)) return false;
                }
            }
            
            // Contact filter
            if (contactSelection) {
                if (!ContactHelper.hasEventContact(event, contactSelection)) return false;
            }
            
            // Search filter
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                if (!event.taskText.toLowerCase().includes(q) && 
                    !event.blockId.toLowerCase().includes(q) &&
                    !event.commitMessage.toLowerCase().includes(q)) return false;
            }
            
            return true;
        });
    },

    /**
     * Group events by date string.
     */
    groupByDate(events) {
        const groups = new Map();
        for (const event of events) {
            const d = new Date(event.timestamp);
            const key = d.toLocaleDateString('en-US', { 
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
            });
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(event);
        }
        return groups;
    },

    formatTime(timestamp) {
        return new Date(timestamp).toLocaleTimeString('en-US', { 
            hour: '2-digit', minute: '2-digit' 
        });
    },

    renderEvent(event) {
        const stateClass = `state-${event.newState === null ? 'removed' : event.newState.trim() || 'todo'}`;
        
        let transitionHtml = '';
        if (event.type === 'created') {
            transitionHtml = `<span class="tl-state-badge tl-${stateClass}">Created as ${this.stateLabels[event.newState] || 'Todo'}</span>`;
        } else if (event.type === 'removed') {
            transitionHtml = `<span class="tl-state-badge tl-state-removed">Removed</span>`;
        } else {
            const oldLabel = this.stateLabels[event.oldState] || 'Unknown';
            const newLabel = this.stateLabels[event.newState] || 'Unknown';
            const oldIcon = this.stateIcons[event.oldState] || '?';
            const newIcon = this.stateIcons[event.newState] || '?';
            transitionHtml = `
                <span class="tl-transition">
                    <span class="tl-state-badge tl-state-${event.oldState.trim() || 'todo'}">${oldIcon} ${oldLabel}</span>
                    <svg class="tl-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    <span class="tl-state-badge tl-${stateClass}">${newIcon} ${newLabel}</span>
                </span>`;
        }

        const noteName = event.blockId;
        
        return `
            <div class="tl-event" data-block-id="${event.blockId}" data-oid="${event.oid}" data-filename="${event.filename}" data-parents="${(event.parents || []).join(',')}">
                <div class="tl-dot-wrapper">
                    <div class="tl-dot tl-${stateClass}"></div>
                </div>
                <div class="tl-card">
                    <div class="tl-card-header">
                        <span class="tl-task-text">${escapeHtml(event.taskText)}</span>
                        <span class="tl-time">${this.formatTime(event.timestamp)}</span>
                    </div>
                    ${transitionHtml}
                    <div class="tl-card-footer">
                        <span class="tl-note-name" title="Open note">${escapeHtml(noteName)}</span>
                    </div>
                </div>
            </div>
        `;
    },

    async render(blocks) {
        const container = document.getElementById('viewContainer');
        container.className = 'timeline-view';
        container.innerHTML = `
            <div class="tl-loading">
                <div class="tl-spinner"></div>
                <p>${this._rawDataCache.headOid ? 'Updating timeline...' : 'Building timeline from git history...'}</p>
            </div>
        `;

        // Build timeline if cache is invalid
        if (!this.isCacheValid()) {
            const timeline = await this.buildTimeline();
            this._cache.set(timeline);
        }

        const filtered = this.filterEvents(this._cache.get());
        const grouped = this.groupByDate(filtered);

        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>No task status changes found in git history.</p>
                    <p style="font-size:0.8rem; margin-top:0.5rem; opacity:0.7;">Make some changes to your tasks and they'll appear here.</p>
                </div>
            `;
            return;
        }

        let html = '<div class="tl-container"><div class="tl-line"></div>';

        for (const [dateStr, events] of grouped) {
            html += `<div class="tl-date-group">`;
            html += `<div class="tl-date-header"><span>${dateStr}</span></div>`;
            html += events.map(e => this.renderEvent(e)).join('');
            html += `</div>`;
        }

        html += '</div>';

        // Add refresh button
        html += `<button class="tl-refresh-btn" id="tlRefreshBtn" title="Refresh timeline">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh
        </button>`;

        container.innerHTML = html;
        
        // Attach event listeners
        container.querySelectorAll('.tl-note-name').forEach(el => {
            el.addEventListener('click', () => {
                const card = el.closest('.tl-event');
                if (card) {
                    this.openDiffModal(
                        card.dataset.blockId,
                        card.dataset.filename,
                        card.dataset.oid,
                        card.dataset.parents
                    );
                }
            });
        });

        document.getElementById('tlRefreshBtn')?.addEventListener('click', () => {
            this.invalidateRawDataCache();
            this.invalidateCache();
            this.render(blocks);
        });
    },

    async openDiffModal(blockId, filename, oid, parentsRaw) {
        const parents = parentsRaw ? parentsRaw.split(',').filter(p => p) : [];
        const parentOid = parents.length > 0 ? parents[0] : null;

        // Custom header with title, subtitle, and toggle buttons
        const headerContent = `
            <div class="tl-modal-header">
                <div class="tl-modal-title">
                    <h3>Note Change</h3>
                    <span class="tl-modal-subtitle">${escapeHtml(blockId)} @ ${oid.substring(0, 7)}</span>
                </div>
                <div class="tl-modal-toggle">
                    <button class="tl-toggle-btn active" data-view="diff">Diff</button>
                    <button class="tl-toggle-btn" data-view="current">This Version</button>
                </div>
                <button class="tl-modal-close">&times;</button>
            </div>
        `;

        const modal = Modal.create({
            headerContent,
            content: `<div id="tlDiffContainer" class="tl-diff-container"></div>`,
            overlayClass: 'tl-modal-overlay',
            modalClass: 'tl-modal',
            onClose: () => {
                if (this.currentDiffEditor) {
                    this.currentDiffEditor.destroy();
                    this.currentDiffEditor = null;
                }
            }
        });

        // Setup toggle buttons
        const toggleBtns = modal.querySelectorAll('.tl-toggle-btn');
        toggleBtns.forEach(btn => {
            btn.addEventListener('click', async () => {
                if (btn.classList.contains('active')) return;
                toggleBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                await renderView(btn.dataset.view);
            });
        });

        const renderView = async (viewType) => {
            const container = document.getElementById('tlDiffContainer');
            container.innerHTML = '<div class="tl-loading-small"><div class="tl-spinner-small"></div> Loading content...</div>';

            if (this.currentDiffEditor) {
                this.currentDiffEditor.destroy();
                this.currentDiffEditor = null;
            }

            try {
                const currContentRaw = await GitStore.getFileAtCommit(filename, oid);
                const currParsed = parseFrontMatter(currContentRaw || '');

                const { EditorView, EditorState, basicSetup, unifiedMergeView, markdown, languages } = window.CodeMirror;

                await DocumentView.waitForCodeMirror();

                if (viewType === 'diff') {
                    let prevContent = '';
                    if (parentOid) {
                        const prevContentRaw = await GitStore.getFileAtCommit(filename, parentOid);
                        prevContent = parseFrontMatter(prevContentRaw || '').content;
                    }

                    container.innerHTML = '';
                    this.currentDiffEditor = new EditorView({
                        doc: currParsed.content,
                        extensions: [
                            basicSetup,
                            markdown({ codeLanguages: languages }),
                            unifiedMergeView({
                                original: prevContent,
                                mergeControls: false
                            }),
                            EditorView.theme({
                                "&": { height: "100%", fontSize: "14px" },
                                ".cm-merge-deleted": { backgroundColor: "rgba(239, 68, 68, 0.15)", textDecoration: "line-through" },
                                ".cm-merge-inserted": { backgroundColor: "rgba(34, 197, 94, 0.15)", outline: "none" },
                                ".cm-scroller": { overflow: "auto" }
                            }),
                            EditorView.editable.of(false),
                            EditorState.readOnly.of(true)
                        ],
                        parent: container
                    });
                } else {
                    container.innerHTML = '';
                    this.currentDiffEditor = new EditorView({
                        doc: currParsed.content,
                        extensions: [
                            basicSetup,
                            markdown({ codeLanguages: languages }),
                            EditorView.theme({ 
                                "&": { height: "100%", fontSize: "14px" },
                                ".cm-scroller": { overflow: "auto" }
                            }),
                            EditorView.editable.of(false),
                            EditorState.readOnly.of(true)
                        ],
                        parent: container
                    });
                }
            } catch (err) {
                console.error('Failed to render diff:', err);
                container.innerHTML = `<div class="tl-error">Failed to load commit content: ${err.message}</div>`;
            }
        };
        
        await renderView('diff');
    }
};
