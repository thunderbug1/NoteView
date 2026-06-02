/**
 * Timeline View - Shows all changes from git history as a vertical timeline
 * Includes note-level events (created, edited, deleted) and task status changes.
 * Use Todo.* sidebar filters to show only task changes.
 */

const TimelineView = {
    collapsedDays: new Map(),
    BATCH_SIZE: 50,
    _allCommits: [],
    _hasMore: false,
    _startIdx: 0,
    _prevAllTasks: new Map(),
    _prevFileSet: new Map(),

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
        const contextSelection = SelectionManager.selections?.context
            ? Array.from(SelectionManager.selections.context).sort().join(',')
            : '';
        const contactSelection = SelectionManager.selections?.contact || '';
        const searchQuery = Store.searchQuery || '';
        return `${contextSelection}|${contactSelection}|${searchQuery}`;
    }),

    // Raw git data cache — persists to IndexedDB for fast reload.
    // Validated by HEAD OID inside buildTimeline(). Incremental rebuild when only new
    // commits are added; full rebuild when HEAD OID doesn't match or on first load.
    _rawDataCache: {
        headOid: null,
        events: [],
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
        this._rawDataCache.events = [];
        this._allCommits = [];
        this._hasMore = false;
        this._startIdx = 0;
        this._prevAllTasks = new Map();
        this._prevFileSet = new Map();
        const vaultName = Store.directoryHandle?.name;
        if (vaultName) Store.deleteTimelineCache(vaultName);
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
     * Extract a lightweight file set from all files at a commit.
     * Returns Map of filename -> { tags } for ALL markdown files.
     */
    extractFileSet(filesContent) {
        const result = new Map();
        for (const [filename, content] of Object.entries(filesContent)) {
            const parsed = parseFrontMatter(content);
            result.set(filename, { tags: parsed.tags || [] });
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
                        category: 'task',
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
                        category: 'task',
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
                        category: 'task',
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
                        category: 'task',
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
    async _processCommit(commit, prevAllTasks, prevFileSet, parentCommit) {
        let currAllTasks;
        let currFileSet;
        let changedFiles = null;

        if (!parentCommit) {
            // First commit in our window: read all files to establish baseline state
            const filesContent = await GitStore.getAllFilesAtCommit(commit.oid);
            currAllTasks = this.extractAllTasks(filesContent);
            currFileSet = this.extractFileSet(filesContent);

            // If this commit has parents (not the repo root), it's a window boundary.
            // We don't know the parent's state, so we can only establish the baseline
            // without emitting events — otherwise all existing files appear as "created"
            // on this single day.
            if (commit.parents && commit.parents.length > 0) {
                return { tasks: currAllTasks, fileSet: currFileSet, events: [] };
            }
        } else {
            // Diff-based: only read files that changed between parent and this commit
            changedFiles = await GitStore.getChangedFilesBetween(
                parentCommit.oid, commit.oid
            );

            if (changedFiles === null) {
                // walk() failed, fallback to reading all files
                const filesContent = await GitStore.getAllFilesAtCommit(commit.oid);
                currAllTasks = this.extractAllTasks(filesContent);
                currFileSet = this.extractFileSet(filesContent);
            } else if (Object.keys(changedFiles).length === 0) {
                // No file changes (e.g. merge commit) — carry forward previous state
                currAllTasks = prevAllTasks;
                currFileSet = prevFileSet;
            } else {
                // Start from previous snapshot, update only changed files
                currAllTasks = new Map(prevAllTasks);
                currFileSet = new Map(prevFileSet);
                for (const [filename, content] of Object.entries(changedFiles)) {
                    if (content === null || content === undefined) {
                        currAllTasks.delete(filename);
                        currFileSet.delete(filename);
                    } else if (typeof content === 'string') {
                        const parsed = parseFrontMatter(content);
                        const tasks = this.extractTasksFromContent(parsed.content);
                        if (tasks.size > 0) {
                            currAllTasks.set(filename, { tasks, tags: parsed.tags || [] });
                        } else {
                            currAllTasks.delete(filename);
                        }
                        currFileSet.set(filename, { tags: parsed.tags || [] });
                    }
                }
            }
        }

        const taskEvents = this.diffTasks(prevAllTasks, currAllTasks, commit);

        // Generate note events for files that changed but had no task events
        const taskEventFiles = new Set(taskEvents.map(e => e.filename));
        const noteEvents = this.generateNoteEvents(
            changedFiles, prevFileSet, currFileSet, commit, parentCommit === null, taskEventFiles
        );

        return { tasks: currAllTasks, fileSet: currFileSet, events: [...taskEvents, ...noteEvents] };
    },

    /**
     * Generate note-level events for file changes that don't have task events.
     * Deduplicates against files already covered by task events.
     */
    generateNoteEvents(changedFiles, prevFileSet, currFileSet, commit, isFirstCommit, taskEventFiles) {
        const events = [];

        if (isFirstCommit || changedFiles === null) {
            // First commit or fallback: all current files are "created"
            for (const [filename, data] of currFileSet) {
                if (taskEventFiles.has(filename)) continue;
                events.push({
                    category: 'note',
                    type: 'note-created',
                    blockId: filename.replace('.md', ''),
                    filename,
                    tags: data.tags || [],
                    timestamp: commit.timestamp,
                    commitMessage: commit.message,
                    oid: commit.oid,
                    parents: commit.parents
                });
            }
        } else {
            for (const [filename, content] of Object.entries(changedFiles)) {
                if (taskEventFiles.has(filename)) continue;
                if (content === null || content === undefined) {
                    // File deleted
                    const prevData = prevFileSet.get(filename);
                    events.push({
                        category: 'note',
                        type: 'note-deleted',
                        blockId: filename.replace('.md', ''),
                        filename,
                        tags: prevData ? prevData.tags : [],
                        timestamp: commit.timestamp,
                        commitMessage: commit.message,
                        oid: commit.oid,
                        parents: commit.parents
                    });
                } else if (prevFileSet.has(filename)) {
                    // File modified (existed before)
                    const parsed = parseFrontMatter(content);
                    events.push({
                        category: 'note',
                        type: 'note-modified',
                        blockId: filename.replace('.md', ''),
                        filename,
                        tags: parsed.tags || [],
                        timestamp: commit.timestamp,
                        commitMessage: commit.message,
                        oid: commit.oid,
                        parents: commit.parents
                    });
                } else {
                    // File created (new)
                    const parsed = parseFrontMatter(content);
                    events.push({
                        category: 'note',
                        type: 'note-created',
                        blockId: filename.replace('.md', ''),
                        filename,
                        tags: parsed.tags || [],
                        timestamp: commit.timestamp,
                        commitMessage: commit.message,
                        oid: commit.oid,
                        parents: commit.parents
                    });
                }
            }
        }

        return events;
    },

    // --- IndexedDB persistence helpers ---

    _serializeTasksMap(tasksMap) {
        return [...tasksMap.entries()].map(([filename, { tasks, tags }]) => [
            filename, { tasks: [...tasks.entries()], tags }
        ]);
    },

    _deserializeTasksMap(arr) {
        const map = new Map();
        for (const [filename, { tasks, tags }] of arr) {
            map.set(filename, { tasks: new Map(tasks), tags });
        }
        return map;
    },

    _serializeFileSet(fileSet) {
        return [...fileSet.entries()];
    },

    _deserializeFileSet(arr) {
        return new Map(arr);
    },

    async _persistToDB(events, frontierSnapshot, headOid) {
        const vaultName = Store.directoryHandle?.name;
        if (!vaultName) return;
        const data = {
            headOid,
            events,
            frontierSnapshot: {
                tasks: this._serializeTasksMap(frontierSnapshot.tasks),
                fileSet: this._serializeFileSet(frontierSnapshot.fileSet),
            },
            timestamp: Date.now(),
        };
        await Store.saveTimelineCache(vaultName, data);
    },

    async _restoreFromDB() {
        const vaultName = Store.directoryHandle?.name;
        if (!vaultName) return null;
        return Store.loadTimelineCache(vaultName);
    },

    /**
     * Build the full list of events from git history.
     * Uses diff-based file discovery and supports incremental rebuilds.
     */
    async buildTimeline() {
        if (this._buildPromise) return this._buildPromise;
        this._buildPromise = this._buildTimelineInternal();
        try {
            return await this._buildPromise;
        } finally {
            this._buildPromise = null;
        }
    },

    async _buildTimelineInternal() {
        // Quick HEAD check to potentially skip the full git log walk
        const cached = await this._restoreFromDB();
        const currentHeadOid = await this._resolveHead();

        if (cached && currentHeadOid && cached.headOid === currentHeadOid) {
            Logger.log('Timeline: cache hit (HEAD unchanged)');
            this._rawDataCache.headOid = currentHeadOid;
            this._rawDataCache.events = cached.events;
            this._hasMore = false; // Cached full history

            // Determine unpushed commits
            const commits = await GitStore.getFullHistory(500);
            if (commits.length > 0) {
                const unpushedOids = await this._getUnpushedOids(commits);
                for (const event of cached.events) {
                    event.unpushed = unpushedOids.has(event.oid);
                }
            }
            return cached.events;
        }

        // Fresh build: Get only the most recent batch of commits
        // We fetch BATCH_SIZE + 1 so the last one can serve as the baseline
        const recentCommits = await GitStore.getFullHistory(this.BATCH_SIZE + 1);
        if (recentCommits.length === 0) return [];

        this._rawDataCache.headOid = currentHeadOid;
        this._rawDataCache.events = [];
        this._hasMore = recentCommits.length > this.BATCH_SIZE;
        
        // chronological = [C_oldest_in_batch, ..., C_newest_in_batch]
        const chronological = [...recentCommits].reverse();
        
        this._prevAllTasks = new Map();
        this._prevFileSet = new Map();
        const allEvents = [];

        let startIdx = 0;
        if (this._hasMore) {
            // Use the oldest commit in our batch as the baseline (C_oldest_in_batch)
            // Establishing baseline state without emitting events for this commit.
            const baselineCommit = chronological[0];
            const { tasks, fileSet } = await this._processCommit(baselineCommit, new Map(), new Map(), null);
            this._prevAllTasks = tasks;
            this._prevFileSet = fileSet;
            startIdx = 1; // Start processing events from the next commit
        }

        Logger.log('Timeline: building first batch (newest first)');
        for (let i = startIdx; i < chronological.length; i++) {
            const commit = chronological[i];
            const parentCommit = i > 0 ? chronological[i - 1] : null;
            const { tasks, fileSet, events } = await this._processCommit(
                commit, this._prevAllTasks, this._prevFileSet, parentCommit
            );
            allEvents.push(...events);
            this._prevAllTasks = tasks;
            this._prevFileSet = fileSet;
        }

        // UI is newest-first
        const eventsReversed = [...allEvents].reverse();
        this._rawDataCache.events = eventsReversed;

        // Tag unpushed events
        const unpushedOids = await this._getUnpushedOids(recentCommits.slice(0, 500));
        for (const event of eventsReversed) {
            event.unpushed = unpushedOids.has(event.oid);
        }

        return eventsReversed;
    },

    /**
     * Load the next batch of commits and append to the timeline.
     */
    async loadMore() {
        if (!this._hasMore || this._rawDataCache.events.length === 0) return;
        
        // Find the oldest commit we have processed so far
        const oldestEvent = this._rawDataCache.events[this._rawDataCache.events.length - 1];
        const oldestOid = oldestEvent.oid;
        
        // Find the parent of that oldest commit to start our next batch
        const oldestCommitRaw = (await GitStore.getFullHistory(1, oldestOid))[0];
        if (!oldestCommitRaw || !oldestCommitRaw.parents || oldestCommitRaw.parents.length === 0) {
            this._hasMore = false;
            await this.render(Store.getFilteredBlocks());
            return;
        }

        const parentOid = oldestCommitRaw.parents[0];
        
        // Fetch next batch starting from that parent
        const nextBatch = await GitStore.getFullHistory(this.BATCH_SIZE + 1, parentOid);
        if (nextBatch.length === 0) {
            this._hasMore = false;
            await this.render(Store.getFilteredBlocks());
            return;
        }

        this._hasMore = nextBatch.length > this.BATCH_SIZE;
        const chronological = [...nextBatch].reverse();
        
        let batchPrevTasks = new Map();
        let batchPrevFileSet = new Map();
        const newEvents = [];

        let startIdx = 0;
        if (this._hasMore) {
            // Establish baseline at the end of this new batch
            const baselineCommit = chronological[0];
            const { tasks, fileSet } = await this._processCommit(baselineCommit, new Map(), new Map(), null);
            batchPrevTasks = tasks;
            batchPrevFileSet = fileSet;
            startIdx = 1;
        }

        Logger.log('Timeline: loading older batch');
        for (let i = startIdx; i < chronological.length; i++) {
            const commit = chronological[i];
            const parentCommit = i > 0 ? chronological[i - 1] : null;
            const { tasks, fileSet, events } = await this._processCommit(
                commit, batchPrevTasks, batchPrevFileSet, parentCommit
            );
            newEvents.push(...events);
            batchPrevTasks = tasks;
            batchPrevFileSet = fileSet;
        }

        // Prepend new events (older) to the end of our newest-first list
        const olderEvents = newEvents.reverse();
        this._rawDataCache.events.push(...olderEvents);
        
        // Update unpushed status
        const headCommits = await GitStore.getFullHistory(500);
        const unpushedOids = await this._getUnpushedOids(headCommits);
        for (const event of olderEvents) {
            event.unpushed = unpushedOids.has(event.oid);
        }

        // Invalidate filtered cache
        this.invalidateCache();

        // If finished, persist
        if (!this._hasMore) {
            const frontierSnapshot = { tasks: this._prevAllTasks, fileSet: this._prevFileSet };
            this._persistToDB(this._rawDataCache.events, frontierSnapshot, this._rawDataCache.headOid).catch(e =>
                console.warn('Timeline: failed to persist cache:', e)
            );
        }

        // Re-render
        const filteredBlocks = Store.getFilteredBlocks();
        const groupBy = window.GroupManager ? GroupManager.activeGrouping : undefined;
        await this.render(filteredBlocks, { groupBy });
    },

    async _getUnpushedOids(commits) {
        const unpushedOids = new Set();
        try {
            const { git, fs, dir } = GitStore;
            const ref = (window.SyncManager && SyncManager._config.branch) || 'main';
            const remoteName = GitRemote.config?.name || 'origin';
            const remoteHead = await git.resolveRef({ fs, dir, ref: `refs/remotes/${remoteName}/${ref}` }).catch(() => null);
            if (remoteHead) {
                let foundRemote = false;
                for (const c of commits) {
                    if (c.oid === remoteHead) { foundRemote = true; break; }
                    unpushedOids.add(c.oid);
                }
                if (!foundRemote) unpushedOids.clear();
            }
        } catch (e) { /* ignore */ }
        return unpushedOids;
    },

    async _resolveHead() {
        try {
            const { git, fs, dir } = GitStore;
            const ref = (window.SyncManager && SyncManager._config.branch) || 'main';
            return await git.resolveRef({ fs, dir, ref: `refs/heads/${ref}` });
        } catch (e) {
            return null;
        }
    },

    /**
     * Filter events based on current sidebar selections (context tags, search, contacts, time).
     */
    filterEvents(events) {
        const contextSelection = SelectionManager.selections.context;

        // Derive time selection from context
        const timeTag = TimeFilter.deriveTimeSelectionFromContext(contextSelection);
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
            if (timeTag && !TimeFilter.checkTimeFilter(event.timestamp, timeTag)) {
                return false;
            }
            
            // Context tag filter
            if (contextSelection.size > 0) {
                const requiredTags = [];
                let hasTodoGroup = false;

                for (const t of contextSelection) {
                    if (t.startsWith('path:')) {
                        const group = t.slice(5);
                        if (group === 'Todo') {
                            hasTodoGroup = true;
                            continue;
                        }
                    }
                    if (!SelectionManager.isComputedContextTag(t)) {
                        requiredTags.push(t);
                    }
                }

                if (requiredTags.length > 0) {
                    const hasAllTags = requiredTags.every(tag => event.tags?.includes(tag));
                    if (!hasAllTags) return false;
                }

                if (contextSelection.has('Status.untagged')) {
                    if (event.tags && event.tags.length > 0) return false;
                }

                // path:Todo shows all task events (any state)
                if (hasTodoGroup) {
                    if (event.category !== 'task') return false;
                }

                // Individual Todo.* filters only apply to task events
                const activeTodoFilter = contextSelection.has('Todo.open')
                    || contextSelection.has('Todo.inProgress')
                    || contextSelection.has('Todo.done')
                    || contextSelection.has('Todo.blocked')
                    || contextSelection.has('Todo.canceled')
                    || contextSelection.has('Todo.unblocked');

                if (activeTodoFilter) {
                    if (event.category !== 'task') return false;

                    if (contextSelection.has('Todo.open')) {
                        const eventTask = { state: event.newState ?? event.oldState, badges: event.badges || [] };
                        if (!TaskParser.isOpenTask(eventTask)) return false;
                    }
                    if (contextSelection.has('Todo.inProgress')) {
                        const eventTask = { state: event.newState ?? event.oldState, badges: event.badges || [] };
                        if (!TaskParser.isInProgressTask(eventTask)) return false;
                    }
                    if (contextSelection.has('Todo.done')) {
                        const eventTask = { state: event.newState ?? event.oldState, badges: event.badges || [] };
                        if (!TaskParser.isDoneTask(eventTask)) return false;
                    }
                    if (contextSelection.has('Todo.blocked')) {
                        const eventTask = { state: event.newState ?? event.oldState, badges: event.badges || [] };
                        if (!TaskParser.isBlockedTask(eventTask)) return false;
                    }
                    if (contextSelection.has('Todo.canceled')) {
                        const eventTask = { state: event.newState ?? event.oldState, badges: event.badges || [] };
                        if (!TaskParser.isCanceledTask(eventTask)) return false;
                    }
                    if (contextSelection.has('Todo.unblocked')) {
                        const eventTask = { state: event.newState ?? event.oldState, badges: event.badges || [] };
                        if (!TaskParser.isUnblockedTask(eventTask)) return false;
                    }
                }
                if (contextSelection.has('Todo.unassigned')) {
                    if (event.category !== 'task') return false;
                    const eventTask = { state: event.newState ?? event.oldState, badges: event.badges || [] };
                    if (!TaskParser.isUnassignedTask(eventTask)) return false;
                }
            }

            // Contact filter
            if (contactSelection) {
                if (event.category === 'task' && !ContactHelper.hasEventContact(event, contactSelection)) return false;
            }

            // Search filter
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                const textMatch = event.category === 'task'
                    ? event.taskText?.toLowerCase().includes(q)
                    : false;
                if (!textMatch &&
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
        if (event.category === 'note') {
            return this.renderNoteEvent(event);
        }

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
        const unpushedClass = event.unpushed ? ' tl-unpushed' : '';

        return `
            <div class="tl-event${unpushedClass}" data-block-id="${escapeHtml(event.blockId)}" data-oid="${escapeHtml(event.oid)}" data-filename="${escapeHtml(event.filename)}" data-parents="${escapeHtml((event.parents || []).join(','))}">
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
                        <button class="tl-open-note-btn" title="View changes" data-block-id="${escapeHtml(event.blockId)}" data-filename="${escapeHtml(event.filename)}" data-oid="${escapeHtml(event.oid)}" data-parents="${escapeHtml((event.parents || []).join(','))}">View Changes</button>
                        ${event.unpushed ? '<span class="tl-sync-pending" title="Not yet synced to remote">unpushed</span>' : ''}
                        <button class="tl-undo-btn" title="Undo this change" data-block-id="${escapeHtml(event.blockId)}" data-filename="${escapeHtml(event.filename)}" data-oid="${escapeHtml(event.oid)}" data-parents="${escapeHtml((event.parents || []).join(','))}">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M3 7v6h6"/>
                                <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
                            </svg>
                            Undo
                        </button>
                    </div>
                </div>
            </div>
        `;
    },

    renderNoteEvent(event) {
        const typeConfig = {
            'note-created':  { label: 'Note created', cls: 'tl-note-created' },
            'note-modified': { label: 'Note edited',  cls: 'tl-note-modified' },
            'note-deleted':  { label: 'Note deleted', cls: 'tl-note-deleted' }
        };
        const { label, cls } = typeConfig[event.type] || { label: 'Note changed', cls: '' };

        return `
            <div class="tl-event" data-block-id="${escapeHtml(event.blockId)}" data-oid="${escapeHtml(event.oid)}" data-filename="${escapeHtml(event.filename)}" data-parents="${escapeHtml((event.parents || []).join(','))}">
                <div class="tl-dot-wrapper">
                    <div class="tl-dot tl-dot-note ${cls}"></div>
                </div>
                <div class="tl-card tl-card-note">
                    <div class="tl-card-header">
                        <span class="tl-note-label ${cls}">${label}</span>
                        <span class="tl-time">${this.formatTime(event.timestamp)}</span>
                    </div>
                    <div class="tl-card-footer">
                        <button class="tl-open-note-btn" title="View changes" data-block-id="${escapeHtml(event.blockId)}" data-filename="${escapeHtml(event.filename)}" data-oid="${escapeHtml(event.oid)}" data-parents="${escapeHtml((event.parents || []).join(','))}">View Changes</button>
                        ${event.commitMessage ? `<span class="tl-commit-msg">${escapeHtml(event.commitMessage)}</span>` : ''}
                        <button class="tl-undo-btn" title="Undo this change" data-block-id="${escapeHtml(event.blockId)}" data-filename="${escapeHtml(event.filename)}" data-oid="${escapeHtml(event.oid)}" data-parents="${escapeHtml((event.parents || []).join(','))}">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M3 7v6h6"/>
                                <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
                            </svg>
                            Undo
                        </button>
                    </div>
                </div>
            </div>
        `;
    },

    handleCollapseClick(e) {
        const collapseBtn = e.target.closest('.tl-collapse-btn');
        if (!collapseBtn) return;
        e.preventDefault();
        const dateStr = collapseBtn.dataset.date;
        if (!dateStr) return;
        if (this.collapsedDays.has(dateStr)) {
            this.expandDay(dateStr);
        } else {
            this.collapseDay(dateStr);
        }
    },

    collapseDay(dateStr) {
        this.collapsedDays.set(dateStr, true);
        const group = document.querySelector(`.tl-date-group .tl-collapse-btn[data-date="${CSS.escape(dateStr)}"]`)?.closest('.tl-date-group');
        if (!group) return;

        const events = group.querySelector('.tl-date-events');
        if (events) events.style.display = 'none';

        const btn = group.querySelector('.tl-collapse-btn');
        if (btn) {
            btn.classList.add('collapsed');
            btn.title = 'Expand';
            const svg = btn.querySelector('polyline');
            if (svg) svg.setAttribute('points', '15 18 9 12 15 6');
        }

        group.classList.add('tl-date-collapsed');
    },

    collapseAll() {
        const groups = document.querySelectorAll('.tl-date-group');
        groups.forEach(group => {
            const collapseBtn = group.querySelector('.tl-collapse-btn');
            if (collapseBtn && !collapseBtn.classList.contains('collapsed')) {
                const dateStr = collapseBtn.dataset.date;
                if (dateStr) this.collapseDay(dateStr);
            }
        });
    },

    expandDay(dateStr) {
        this.collapsedDays.delete(dateStr);
        const group = document.querySelector(`.tl-date-group .tl-collapse-btn[data-date="${CSS.escape(dateStr)}"]`)?.closest('.tl-date-group');
        if (!group) return;

        const events = group.querySelector('.tl-date-events');
        if (events) events.style.display = '';

        const btn = group.querySelector('.tl-collapse-btn');
        if (btn) {
            btn.classList.remove('collapsed');
            btn.title = 'Collapse';
            const svg = btn.querySelector('polyline');
            if (svg) svg.setAttribute('points', '6 9 12 15 18 9');
        }

        group.classList.remove('tl-date-collapsed');
    },

    expandAll() {
        const groups = document.querySelectorAll('.tl-date-group');
        groups.forEach(group => {
            const collapseBtn = group.querySelector('.tl-collapse-btn');
            if (collapseBtn && collapseBtn.classList.contains('collapsed')) {
                const dateStr = collapseBtn.dataset.date;
                if (dateStr) this.expandDay(dateStr);
            }
        });
    },

    async render(blocks, options = {}) {
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
                    <p>No changes found in git history.</p>
                    <p style="font-size:0.8rem; margin-top:0.5rem; opacity:0.7;">Make changes to your notes and they will appear here.</p>
                </div>
            `;
            return;
        }

        const { groupBy } = options;

        let html = '<div class="tl-container"><div class="tl-line"></div>';

        for (const [dateStr, events] of grouped) {
            const isCollapsed = this.collapsedDays.has(dateStr);
            html += `<div class="tl-date-group ${isCollapsed ? 'tl-date-collapsed' : ''}">`;
            html += `<div class="tl-date-header">
                <button class="tl-collapse-btn ${isCollapsed ? 'collapsed' : ''}" data-date="${escapeHtml(dateStr)}" title="${isCollapsed ? 'Expand' : 'Collapse'}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="${isCollapsed ? '15 18 9 12 15 6' : '6 9 12 15 18 9'}"/></svg>
                </button>
                <span>${dateStr}</span>
                <span class="tl-date-count">${events.length}</span>
            </div>`;
            html += `<div class="tl-date-events" ${isCollapsed ? 'style="display:none"' : ''}>`;

            if (groupBy) {
                html += this.renderTagSubGroups(events, groupBy);
            } else {
                html += events.map(e => this.renderEvent(e)).join('');
            }

            html += `</div></div>`;
        }

        html += '</div>';

        // Add "Load More" button if there are more commits to process
        if (this._hasMore) {
            html += `
                <div class="tl-load-more-container">
                    <button class="tl-load-more-btn" id="tlLoadMoreBtn">
                        <span class="tl-btn-text">Load Older History</span>
                        <div class="tl-spinner-small" style="display:none"></div>
                    </button>
                </div>
            `;
        }

        // Add control buttons
        html += `<div class="tl-controls">
            <button class="tl-control-btn" id="tlCollapseAllBtn" title="Collapse all days">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                Collapse All
            </button>
            <button class="tl-control-btn" id="tlExpandAllBtn" title="Expand all days">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                Expand All
            </button>
            <button class="tl-refresh-btn" id="tlRefreshBtn" title="Refresh timeline">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                Refresh
            </button>
        </div>`;

        container.innerHTML = html;

        // Attach collapse handler via delegation
        if (this._collapseHandler) {
            container.removeEventListener('click', this._collapseHandler);
        }
        this._collapseHandler = this.handleCollapseClick.bind(this);
        container.addEventListener('click', this._collapseHandler);

        // Cleanup old event listeners
        if (this._openNoteHandlers) {
            this._openNoteHandlers.forEach(handler => handler());
            this._openNoteHandlers = [];
        }
        if (this._undoHandlers) {
            this._undoHandlers.forEach(handler => handler());
            this._undoHandlers = [];
        }
        this._openNoteHandlers = [];
        this._undoHandlers = [];

        // Attach event listeners for open note buttons
        container.querySelectorAll('.tl-open-note-btn').forEach(el => {
            const handler = () => {
                const card = el.closest('.tl-event');
                if (card) {
                    this.openDiffModal(
                        card.dataset.blockId,
                        card.dataset.filename,
                        card.dataset.oid,
                        card.dataset.parents
                    );
                }
            };
            el.addEventListener('click', handler);
            this._openNoteHandlers.push(() => el.removeEventListener('click', handler));
        });

        // Attach event listeners for undo buttons
        container.querySelectorAll('.tl-undo-btn').forEach(btn => {
            const handler = async (e) => {
                e.stopPropagation();
                const blockId = btn.dataset.blockId;
                const filename = btn.dataset.filename;
                const oid = btn.dataset.oid;
                const parentsRaw = btn.dataset.parents;

                if (confirm(`Are you sure you want to undo the changes made to ${blockId} in commit ${oid.substring(0, 7)}?`)) {
                    btn.disabled = true;
                    btn.innerHTML = `Undoing...`;
                    try {
                        await this.undoChange(blockId, filename, oid, parentsRaw);
                        showToast(`Successfully undid changes to ${blockId}.`);
                    } catch (err) {
                        btn.disabled = false;
                        btn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg> Undo`;
                        console.error('Failed to undo changes:', err);
                        alert(`Failed to undo changes: ${err.message}`);
                    }
                }
            };
            btn.addEventListener('click', handler);
            this._undoHandlers.push(() => btn.removeEventListener('click', handler));
        });

        document.getElementById('tlRefreshBtn')?.addEventListener('click', () => {
            this.invalidateRawDataCache();
            this.invalidateCache();
            this.render(blocks, options);
        });

        document.getElementById('tlCollapseAllBtn')?.addEventListener('click', () => {
            this.collapseAll();
        });

        document.getElementById('tlExpandAllBtn')?.addEventListener('click', () => {
            this.expandAll();
        });

        document.getElementById('tlLoadMoreBtn')?.addEventListener('click', async () => {
            const btn = document.getElementById('tlLoadMoreBtn');
            const text = btn.querySelector('.tl-btn-text');
            const spinner = btn.querySelector('.tl-spinner-small');
            
            btn.disabled = true;
            if (text) text.textContent = 'Loading...';
            if (spinner) spinner.style.display = 'block';
            
            try {
                await this.loadMore();
            } catch (err) {
                console.error('Failed to load more history:', err);
                if (text) text.textContent = 'Failed to load history';
                btn.disabled = false;
            }
        });
    },

    renderTagSubGroups(events, namespace) {
        const groupEvents = new Map();
        const ungroupedEvents = [];

        for (const event of events) {
            const tags = event.tags || [];
            let assigned = false;
            for (const tag of tags) {
                const { segments, leaf } = Common.parseHierarchicalTag(tag);
                if (segments.length > 0 && segments[0] === namespace) {
                    const key = leaf;
                    if (!groupEvents.has(key)) groupEvents.set(key, []);
                    groupEvents.get(key).push(event);
                    assigned = true;
                    break;
                }
            }
            if (!assigned) ungroupedEvents.push(event);
        }

        const sortedGroups = new Map([...groupEvents.entries()].sort((a, b) => a[0].localeCompare(b[0])));

        let html = '';
        for (const [key, groupEventList] of sortedGroups) {
            html += `<div class="tl-tag-group">`;
            html += `<div class="tl-tag-group-header">${escapeHtml(Common.capitalizeFirst(key))}</div>`;
            html += groupEventList.map(e => this.renderEvent(e)).join('');
            html += `</div>`;
        }

        if (ungroupedEvents.length > 0) {
            html += `<div class="tl-tag-group tl-tag-group-ungrouped">`;
            html += `<div class="tl-tag-group-header">Other</div>`;
            html += ungroupedEvents.map(e => this.renderEvent(e)).join('');
            html += `</div>`;
        }

        return html;
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
                let currContentRaw = null;
                try {
                    currContentRaw = await GitStore.getFileAtCommit(filename, oid);
                } catch (e) {
                    // File doesn't exist at this commit (e.g. deleted file)
                }
                const currParsed = parseFrontMatter(currContentRaw || '');

                const { EditorView, EditorState, basicSetup, unifiedMergeView, markdown, languages } = window.CodeMirror;

                await DocumentView.waitForCodeMirror();

                if (viewType === 'diff') {
                    let prevContent = '';
                    if (parentOid) {
                        try {
                            const prevContentRaw = await GitStore.getFileAtCommit(filename, parentOid);
                            prevContent = parseFrontMatter(prevContentRaw || '').content;
                        } catch (e) {
                            // File didn't exist at parent commit either
                        }
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
                container.innerHTML = `<div class="tl-error">Failed to load commit content: ${escapeHtml(err.message)}</div>`;
            }
        };
        
        await renderView('diff');
    },

    async undoChange(blockId, filename, oid, parentsRaw) {
        const parents = parentsRaw ? parentsRaw.split(',').filter(p => p) : [];
        const parentOid = parents.length > 0 ? parents[0] : null;

        if (!parentOid) {
            // No parent commit means this was the first commit (note creation).
            // To undo creation, we delete the block.
            await Store.deleteBlock(blockId);
        } else {
            // Get content from before this change (at parent commit)
            const prevContentRaw = await GitStore.getFileAtCommit(filename, parentOid);
            if (prevContentRaw === null || prevContentRaw === undefined) {
                // If it wasn't present, delete the block
                await Store.deleteBlock(blockId);
            } else {
                const parsed = parseFrontMatter(prevContentRaw);
                const block = Store.blocks.find(b => b.id === blockId);
                if (block) {
                    // Update existing block
                    await Store.saveBlock(block, {
                        content: parsed.content,
                        tags: parsed.tags || [],
                        commit: true,
                        commitMessage: `Revert changes to ${blockId} from commit ${oid.substring(0, 7)}`
                    });
                } else {
                    // Recreate deleted block
                    await Store.createBlock(parsed.content, {
                        id: blockId,
                        tags: parsed.tags || [],
                        ...parsed,
                        commitMessage: `Recreate note ${blockId} from commit ${oid.substring(0, 7)}`
                    });
                }
            }
        }

        // Invalidate only the filtered events cache — keep the raw data cache
        // warm so buildTimeline() uses the incremental path (processes just
        // the new revert commit instead of walking all 100 commits).
        this.invalidateCache();

        // Store.blocks is already updated in memory by the undo operation
        // (saveBlock/deleteBlock/createBlock), so no need for loadBlocks().

        // Re-render just the timeline view, not the entire app.
        const filteredBlocks = Store.getFilteredBlocks();
        const groupBy = window.GroupManager ? GroupManager.activeGrouping : undefined;
        await this.render(filteredBlocks, { groupBy });

        // Update sidebar panels that would normally be refreshed by App.render().
        if (window.SelectionManager) SelectionManager.updateTagCounts();
        if (window.App) {
            if (typeof App.updateFilterBar === 'function') App.updateFilterBar();
            if (typeof App.updateUndoRedoUI === 'function') App.updateUndoRedoUI();
        }
        if (window.DeadlinePanel) DeadlinePanel.render(Store.blocks);
        if (window.BacklinksPanel && typeof DocumentView !== 'undefined') {
            BacklinksPanel.render(Store.blocks, DocumentView.getFocusedBlockId());
        }
    }
};
