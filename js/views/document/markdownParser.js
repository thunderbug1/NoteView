/**
 * Markdown Parser - Pure parsing utilities for DocumentView
 * No dependency on DocumentView internal state.
 * Assigned to DocumentView via Object.assign after shell initialization.
 */
const DocumentMarkdownParser = {
    detectMediaUrl(text) {
        if (!text || typeof text !== 'string') return null;
        const trimmed = text.trim();
        if (trimmed.includes('\n') || /\s/.test(trimmed)) return null;
        if (!/^https?:\/\//i.test(trimmed)) return null;

        const url = trimmed;

        if (/\.(jpe?g|png|gif|webp|svg|bmp|ico|avif)(\?.*)?$/i.test(url)) {
            return { type: 'image', url, label: 'Image' };
        }
        if (/\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url)) {
            return { type: 'video', url, label: 'Video' };
        }
        if (/^https?:\/\/(www\.)?(youtube\.com\/(watch\?.*v=|embed\/|shorts\/)|youtu\.be\/)[\w-]+/i.test(url)) {
            return { type: 'youtube', url, label: 'YouTube Video' };
        }
        if (/^https?:\/\/(www\.)?vimeo\.com\/\d+/i.test(url)) {
            return { type: 'vimeo', url, label: 'Vimeo Video' };
        }
        if (/^https?:\/\/store\.steampowered\.com\/app\/(\d+)/i.test(url)) {
            return { type: 'steam', url, label: 'Steam Game' };
        }

        return null;
    },

    isFencedContent(text) {
        return /^```[^\n`]*\n[\s\S]*\n```$/.test(text.trim());
    },

    summarizePastedText(text) {
        const normalized = text.replace(/\r\n/g, '\n');
        const lines = normalized.split('\n');

        return {
            chars: normalized.length,
            lines: lines.length,
            preview: lines.slice(0, 4).join('\n').trim()
        };
    },

    normalizePastedText(text) {
        return text.replace(/\r\n/g, '\n').replace(/\u0000/g, '');
    },

    getFencedBlocks(text, thresholds) {
        const fencedBlocks = [];
        const regex = /(^|\r?\n)```([^\r\n`]*)\r?\n([\s\S]*?)\r?\n```(?=\r?\n|$)/g;
        let match;
        const t = thresholds || DocumentView.fencedBlockThresholds;

        while ((match = regex.exec(text)) !== null) {
            const prefixLength = match[1].length;
            const blockText = match[0].slice(prefixLength);
            const from = match.index + prefixLength;
            const to = from + blockText.length;
            const info = (match[2] || '').trim();
            const body = (match[3] || '').replace(/\r\n/g, '\n');
            const lines = body ? body.split('\n') : [];
            const isLogLike = /^(log|text|console|output|json)$/i.test(info);
            const isCollapsible = lines.length >= t.lines
                || body.length >= t.chars
                || (isLogLike && lines.length >= 6);

            fencedBlocks.push({
                from,
                to,
                info,
                body,
                preview: lines.slice(0, t.previewLines).join('\n'),
                lineCount: lines.length,
                charCount: body.length,
                isCollapsible,
                kind: isLogLike ? 'log' : 'code'
            });
        }

        return fencedBlocks;
    },

    getTables(text, fencedBlocks) {
        const tables = [];
        const lines = text.split('\n');

        const fencedRanges = [];
        if (fencedBlocks) {
            let offset = 0;
            for (let i = 0; i < lines.length; i++) {
                for (const fb of fencedBlocks) {
                    if (offset >= fb.from && offset < fb.to) {
                        fencedRanges.push(i);
                        break;
                    }
                }
                offset += lines[i].length + 1;
            }
        }
        const fencedLineSet = new Set(fencedRanges);

        const isTableRow = (line) => line.trim().length > 0 && line.includes('|');
        const isTableHeaderRow = (line) => line.trim().length > 0 && line.split('|').length >= 3;
        const parseRow = (line) => {
            let trimmed = line.trim();
            if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
            if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
            return trimmed.split('|').map(cell => cell.trim());
        };
        const isSeparator = (line) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('|')) {
                if (!trimmed.endsWith('|')) return false;
                const inner = trimmed.slice(1, -1).trim();
                return inner.split('|').every(cell => /^:?-+:?$/.test(cell.trim()));
            }
            return /^\s*:?-+:?\s*(\|\s*:?-+:?\s*)+$/.test(trimmed) || /^:?-+:?$/.test(trimmed.trim());
        };
        const parseAlignments = (line) => {
            let trimmed = line.trim();
            if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
            if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
            return trimmed.split('|').map(cell => {
                const c = cell.trim();
                if (c.startsWith(':') && c.endsWith(':')) return 'center';
                if (c.endsWith(':')) return 'right';
                return 'left';
            });
        };

        let i = 0;
        while (i < lines.length - 1) {
            if (fencedLineSet.has(i)) { i++; continue; }

            if (isTableHeaderRow(lines[i]) && isSeparator(lines[i + 1])) {
                const headers = parseRow(lines[i]);
                const alignments = parseAlignments(lines[i + 1]);
                const colCount = headers.length;
                const bodyRows = [];
                let j = i + 2;

                while (j < lines.length && isTableRow(lines[j]) && !fencedLineSet.has(j)) {
                    const row = parseRow(lines[j]);
                    while (row.length < colCount) row.push('');
                    if (row.length > colCount) row.length = colCount;
                    bodyRows.push(row);
                    j++;
                }

                let from = 0;
                for (let k = 0; k < i; k++) from += lines[k].length + 1;
                let to = from;
                for (let k = i; k < j; k++) to += lines[k].length + 1;

                if (to > 0 && text[to - 1] === '\n') to--;

                tables.push({
                    from,
                    to: Math.min(to, text.length),
                    headers,
                    alignments,
                    rows: bodyRows,
                    rawText: lines.slice(i, j).join('\n')
                });

                i = j;
            } else {
                i++;
            }
        }

        return tables;
    },

    parseMediaItem(lineText) {
        const trimmed = lineText.trim();
        if (!trimmed) return null;

        const youtubePattern = /https?:\/\/(www\.)?(youtube\.com\/(watch\?.*v=|embed\/|shorts\/)|youtu\.be\/)([\w-]+)/i;
        const vimeoPattern = /https?:\/\/(www\.)?vimeo\.com\/(\d+)/i;
        const steamPattern = /https?:\/\/store\.steampowered\.com\/app\/(\d+)/i;
        const shadertoyPattern = /https?:\/\/(?:www\.)?shadertoy\.com\/view\/([\w-]+)/i;
        const videoFilePattern = /https?:\/\/\S+\.(mp4|webm|ogg|mov)(\?\S*)?(?=\s|$)/i;
        const imageMdPattern = /!\[([^\]]*)\]\(([^)]+)\)/;

        let match, url, type, videoId;

        match = trimmed.match(imageMdPattern);
        if (match) {
            url = match[2];
            type = 'image';
            videoId = null;
        }

        if (!match) {
            match = trimmed.match(youtubePattern);
            if (match) {
                url = match[0];
                type = 'youtube';
                if (match[4]) videoId = match[4];
                else {
                    try { videoId = new URL(url).searchParams.get('v'); } catch { videoId = null; }
                }
            }
        }

        if (!match) {
            match = trimmed.match(vimeoPattern);
            if (match) {
                url = match[0];
                type = 'vimeo';
                videoId = match[2];
            }
        }

        if (!match) {
            match = trimmed.match(videoFilePattern);
            if (match) {
                url = match[0];
                type = 'video';
                videoId = null;
            }
        }

        if (!match) {
            match = trimmed.match(steamPattern);
            if (match) {
                url = match[0];
                type = 'steam';
                videoId = match[1];
            }
        }

        if (!match) {
            match = trimmed.match(shadertoyPattern);
            if (match) {
                url = match[0];
                type = 'shadertoy';
                videoId = match[1];
            }
        }

        if (!match) {
            const genericUrlPattern = /https?:\/\/\S+/i;
            const urlMatch = trimmed.match(genericUrlPattern);
            if (urlMatch) {
                const potentialCaption = trimmed.replace(urlMatch[0], '').replace(/\s{2,}/g, ' ').trim().replace(/^[:(]\s*/, '').replace(/\s*[):]$/, '').trim();
                if (potentialCaption) {
                    url = urlMatch[0];
                    type = 'link';
                    videoId = null;
                    match = urlMatch;
                }
            }
        }

        if (!match) return null;

        const caption = trimmed.replace(match[0], '').replace(/\s{2,}/g, ' ').trim().replace(/^[:(]\s*/, '').replace(/\s*[):]$/, '').trim();

        return {
            caption: caption || null,
            url,
            type,
            videoId: videoId || null
        };
    },

    parseNoteLine(lineText) {
        if (!lineText.length) return null;
        if (lineText[0] !== ' ' && lineText[0] !== '\t') return null;
        const trimmed = lineText.trim();
        if (!trimmed) return null;

        const imgRegex = /^!\[([^\]]*)\]\(([^)]+)\)/;
        const imgMatch = trimmed.match(imgRegex);
        if (imgMatch) {
            return { type: 'image', url: imgMatch[2], alt: imgMatch[1] || '', text: imgMatch[1] || '' };
        }

        const tsRegex = /^@\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(.*)$/;
        const tsMatch = trimmed.match(tsRegex);

        if (tsMatch) {
            const hours = tsMatch[3] ? parseInt(tsMatch[1], 10) : 0;
            const minutes = tsMatch[3] ? parseInt(tsMatch[2], 10) : parseInt(tsMatch[1], 10);
            const seconds = tsMatch[3] ? parseInt(tsMatch[3], 10) : parseInt(tsMatch[2], 10);
            const totalSeconds = hours * 3600 + minutes * 60 + seconds;
            const label = tsMatch[3]
                ? `${tsMatch[1]}:${tsMatch[2]}:${tsMatch[3]}`
                : `${tsMatch[1]}:${tsMatch[2]}`;
            return {
                type: 'timestamp',
                seconds: totalSeconds,
                label,
                text: tsMatch[4] || ''
            };
        }

        return { type: 'note', text: trimmed };
    },

    getMediaGalleries(text, fencedBlocks, tables) {
        const galleries = [];
        const lines = text.split('\n');

        const lineOffsets = [];
        const skipSet = new Set();
        let offset = 0;
        for (let i = 0; i < lines.length; i++) {
            lineOffsets.push(offset);
            for (const fb of fencedBlocks) {
                if (offset >= fb.from && offset < fb.to) { skipSet.add(i); break; }
            }
            if (!skipSet.has(i)) {
                for (const t of tables) {
                    if (offset >= t.from && offset < t.to) { skipSet.add(i); break; }
                }
            }
            offset += lines[i].length + 1;
        }

        let currentItems = [];
        let currentStartIdx = -1;

        const flushGroup = (endIdx) => {
            if (currentItems.length === 0) return;
            const from = lineOffsets[currentStartIdx];
            let to = from;
            for (let k = currentStartIdx; k <= endIdx; k++) to += lines[k].length + 1;
            if (to > 0 && text[to - 1] === '\n') to--;

            galleries.push({
                from,
                to: Math.min(to, text.length),
                items: currentItems
            });
            currentItems = [];
            currentStartIdx = -1;
        };

        for (let i = 0; i < lines.length; i++) {
            if (skipSet.has(i)) { flushGroup(i - 1); continue; }

            const lineText = lines[i];
            const isIndented = lineText.length > 0 && (lineText[0] === ' ' || lineText[0] === '\t');

            if (isIndented && currentItems.length > 0) {
                const note = DocumentView.parseNoteLine(lineText);
                if (note) {
                    note.from = lineOffsets[i];
                    currentItems[currentItems.length - 1].notes.push(note);
                    continue;
                }
            }

            const item = DocumentView.parseMediaItem(lineText);
            if (item) {
                if (currentItems.length === 0) currentStartIdx = i;
                item.from = lineOffsets[i];
                item.notes = [];
                currentItems.push(item);
            } else {
                const note = DocumentView.parseNoteLine(lineText);
                if (note && currentItems.length > 0) {
                    note.from = lineOffsets[i];
                    currentItems[currentItems.length - 1].notes.push(note);
                } else {
                    flushGroup(i - 1);
                }
            }
        }
        flushGroup(lines.length - 1);

        return galleries;
    },

    _buildLineSet(doc, items) {
        const blockedLines = new Set();
        for (const item of items) {
            const startLine = doc.lineAt(item.from).number;
            const endPosition = Math.max(item.from, item.to - 1);
            const endLine = doc.lineAt(endPosition).number;
            for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
                blockedLines.add(lineNumber);
            }
        }
        return blockedLines;
    },

    buildGalleryLineSet(doc, mediaGalleries) {
        return this._buildLineSet(doc, mediaGalleries);
    },

    buildTableLineSet(doc, tables) {
        return this._buildLineSet(doc, tables);
    },

    buildFencedBlockLineSet(doc, fencedBlocks) {
        return this._buildLineSet(doc, fencedBlocks);
    },

    isSelectionInsideBlock(state, block) {
        return state.selection.ranges.some((range) => range.to >= block.from && range.from <= block.to);
    },

    focusFencedBlock(view, from) {
        view.dispatch({
            selection: { anchor: from, head: from },
            scrollIntoView: true
        });
        view.focus();
    },

    openFencedBlockModal(block) {
        const title = block.info ? `${Common.capitalizeFirst(block.info)} Block` : 'Code Block';
        const lineLabel = block.lineCount === 1 ? '1 line' : `${block.lineCount} lines`;

        Modal.create({
            title,
            modalClass: 'tag-modal content-modal fenced-block-modal',
            content: `
                <div class="fenced-block-modal-meta">
                    <span class="badge">${escapeHtml(block.kind)}</span>
                    <span class="meta-date">${lineLabel}</span>
                    <span class="meta-date">${block.charCount} chars</span>
                </div>
                <pre class="fenced-block-modal-content">${escapeHtml(block.body)}</pre>
            `
        });
    },

    getActiveTaskFilter() {
        return TaskParser.getActiveTaskFilter();
    },

    taskLineMatchesFilter(lineText, activeFilters) {
        return TaskParser.taskLineMatchesFilter(lineText, activeFilters);
    },

    getHiddenTaskLineIndices(lineTexts, activeTaskFilters) {
        const excludeFilters = TaskParser.getActiveExcludedTaskFilter();
        return TaskParser.getHiddenTaskLineIndices(lineTexts, activeTaskFilters, excludeFilters);
    },

    filterContentLines(content, activeTaskFilters) {
        const excludeFilters = TaskParser.getActiveExcludedTaskFilter();
        if ((!activeTaskFilters || activeTaskFilters.size === 0) && (!excludeFilters || excludeFilters.size === 0)) return content;
        const lines = content.split('\n');
        const hidden = DocumentView.getHiddenTaskLineIndices(lines, activeTaskFilters);
        return lines.filter((_, i) => !hidden.has(i)).join('\n');
    },
};
