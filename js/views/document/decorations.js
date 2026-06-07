/**
 * DocumentDecorations - Line decoration system for CodeMirror live preview
 */
const DocumentDecorations = {
    applyLineDecorations(line, builder, hideSyntax, Decoration, isLastLine) {
        const text = line.text;
        const from = line.from;
        const usedRanges = [];

        // Ensure widgets are initialized
        const widgets = this.getCMWidgets();

        // 1. Task List Checkboxes (kept inline due to interdependencies with task-done styling)
        const checkboxRegex = /^(\s*[-*+]\s+)\[([ xX\/bB\-])\]/g;
        let cbMatch;
        let lineHasCheckedTask = false;
        let isTaskLine = false;
        let taskLineStart = from;

        while ((cbMatch = checkboxRegex.exec(text)) !== null) {
            const matchFrom = from + cbMatch.index + cbMatch[1].length;
            const matchTo = matchFrom + 3; // "[ ]" length
            let taskState = cbMatch[2];
            if (taskState === ' ') taskState = ' ';

            if (hideSyntax) {
                builder.push(Decoration.replace({
                    widget: new widgets.CheckboxWidget(taskState, matchFrom, matchTo)
                }).range(matchFrom, matchTo));
            } else {
                const safeState = { ' ': 'todo', 'x': 'done', 'X': 'done', '/': 'progress', 'b': 'blocked', 'B': 'blocked', '-': 'canceled' }[taskState] || 'todo';
                builder.push(Decoration.mark({ class: `cm-task-check state-${safeState}` }).range(matchFrom, matchTo));
            }
            if (taskState === 'x' || taskState === 'X' || taskState === '-') {
                lineHasCheckedTask = true;
            }
            isTaskLine = true;
            taskLineStart = from + cbMatch[0].length;
            while (taskLineStart < line.to && /\s/.test(text[taskLineStart - from])) {
                taskLineStart += 1;
            }
        }

        // 2. Add-field widgets for task lines
        if (isTaskLine) {
            if (!text.includes('[due::') && !text.includes('[start::')) {
                builder.push(Decoration.widget({
                    widget: new widgets.AddDeadlineWidget(from, line.to),
                    side: 1
                }).range(line.to));
            }
            if (!text.includes('[assignee::')) {
                builder.push(Decoration.widget({
                    widget: new widgets.AddAssigneeWidget(from, line.to),
                    side: 1
                }).range(line.to));
            }
            if (!text.includes('[priority::')) {
                builder.push(Decoration.widget({
                    widget: new widgets.AddPriorityWidget(from, line.to),
                    side: 1
                }).range(line.to));
            }
        }

        // 3. Run registered line decorators
        for (const decorator of this._lineDecorators) {
            decorator(text, from, builder, hideSyntax, Decoration, usedRanges, widgets);
        }

        // 4. Task-done styling for checked/canceled tasks
        if (lineHasCheckedTask) {
            builder.push(Decoration.mark({ class: 'md-task-done' }).range(taskLineStart, line.to));
        }
    },

    // Registry of line decorator functions. Each takes (text, from, builder, hideSyntax, Decoration, usedRanges, widgets).
    get _lineDecorators() {
        if (!this._cachedLineDecorators) {
            this._cachedLineDecorators = [
                this.decorateInlineFields.bind(this),
                this.decorateTaskAnchors.bind(this),
                this.decorateHeaders.bind(this),
                this.decorateInlineFormats.bind(this),
                this.decorateImages.bind(this),
                this.decorateVideos.bind(this),
                this.decorateEmbeds.bind(this),
                this.decorateLinks.bind(this),
                this.decorateBareUrls.bind(this),
                this.decorateWikilinks.bind(this)
            ];
        }
        return this._cachedLineDecorators;
    },

    // Decorator: inline fields (e.g. [due:: 2026-03-25], [assignee:: @user])
    decorateInlineFields(text, from, builder, hideSyntax, Decoration, usedRanges, widgets) {
        const inlineFieldRegex = /\[(due|assignee|priority|start)::\s*([^\]]+)\]/g;
        let fieldMatch;
        while ((fieldMatch = inlineFieldRegex.exec(text)) !== null) {
            const matchFrom = from + fieldMatch.index;
            const matchTo = matchFrom + fieldMatch[0].length;
            const type = fieldMatch[1];
            const value = fieldMatch[2].trim();

            if (hideSyntax) {
                builder.push(Decoration.replace({
                    widget: new widgets.BadgeWidget(type, value, matchFrom, matchTo)
                }).range(matchFrom, matchTo));
            } else {
                builder.push(Decoration.mark({ class: `md-inline-field badge-${type}` }).range(matchFrom, matchTo));
            }
            usedRanges.push({ from: matchFrom, to: matchTo });
        }
    },

    // Decorator: task anchors (e.g. ^task-id)
    decorateTaskAnchors(text, from, builder, hideSyntax, Decoration, usedRanges, widgets) {
        const anchorRegex = /(?:\s+)(\^[a-zA-Z0-9-_]+)\b/g;
        let anchorMatch;
        while ((anchorMatch = anchorRegex.exec(text)) !== null) {
            const matchFrom = from + anchorMatch.index + anchorMatch[0].indexOf(anchorMatch[1]);
            const matchTo = matchFrom + anchorMatch[1].length;
            const idValue = anchorMatch[1];

            if (hideSyntax) {
                builder.push(Decoration.replace({
                    widget: new widgets.BadgeWidget('id', idValue, matchFrom, matchTo)
                }).range(matchFrom, matchTo));
            } else {
                builder.push(Decoration.mark({ class: 'md-task-anchor badge-id' }).range(matchFrom, matchTo));
            }
            usedRanges.push({ from: matchFrom, to: matchTo });
        }
    },

    // Decorator: markdown headers (#{1,6})
    decorateHeaders(text, from, builder, hideSyntax, Decoration, usedRanges) {
        const headerMatch = text.match(/^(#{1,6})\s+(.*)$/);
        if (headerMatch) {
            const level = headerMatch[1].length;
            const matchTo = from + text.length;
            let overlaps = usedRanges.some(r => from < r.to && matchTo > r.from);

            if (!overlaps) {
                builder.push(Decoration.mark({ class: `md-header md-header-${level}` }).range(from, from + text.length));
                if (hideSyntax) {
                    const syntaxEnd = from + level + 1; // # + space
                    builder.push(Decoration.replace({}).range(from, syntaxEnd));
                }
            }
        }
    },

    // Decorator: inline formatting patterns (bold, italic, strikethrough, code)
    decorateInlineFormats(text, from, builder, hideSyntax, Decoration, usedRanges) {
        const patterns = [
            { regex: /\*\*(.+?)\*\*/g, class: 'md-strong', syntaxLen: 2 },
            { regex: /\*(.+?)\*/g, class: 'md-emphasis', syntaxLen: 1 },
            { regex: /~~(.+?)~~/g, class: 'md-strikethrough', syntaxLen: 2 },
            { regex: /`(.+?)`/g, class: 'md-code', syntaxLen: 1 }
        ];

        // Prune usedRanges to only keep active ranges (sorted by from, prune by maintaining start index)
        let checkStart = 0;
        const overlaps = (matchFrom, matchTo) => {
            while (checkStart < usedRanges.length && usedRanges[checkStart].to <= matchFrom) checkStart++;
            for (let i = checkStart; i < usedRanges.length; i++) {
                if (matchFrom < usedRanges[i].to && matchTo > usedRanges[i].from) return true;
            }
            return false;
        };

        for (const pattern of patterns) {
            pattern.regex.lastIndex = 0;
            let match;
            while ((match = pattern.regex.exec(text)) !== null) {
                const matchFrom = from + match.index;
                const matchTo = matchFrom + match[0].length;

                if (!overlaps(matchFrom, matchTo)) {
                    builder.push(Decoration.mark({ class: pattern.class }).range(matchFrom, matchTo));
                    if (hideSyntax) {
                        builder.push(Decoration.replace({}).range(matchFrom, matchFrom + pattern.syntaxLen));
                        builder.push(Decoration.replace({}).range(matchTo - pattern.syntaxLen, matchTo));
                    }
                    usedRanges.push({ from: matchFrom, to: matchTo });
                }
            }
        }
    },

    // Decorator: markdown images ![alt](url)
    decorateImages(text, from, builder, hideSyntax, Decoration, usedRanges, widgets) {
        const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
        let match;
        while ((match = imageRegex.exec(text)) !== null) {
            const matchFrom = from + match.index;
            const matchTo = matchFrom + match[0].length;

            let overlaps = usedRanges.some(r => matchFrom < r.to && matchTo > r.from);
            if (!overlaps) {
                if (hideSyntax) {
                    builder.push(Decoration.replace({
                        widget: new widgets.ImageWidget(match[1], match[2], matchFrom, matchTo)
                    }).range(matchFrom, matchTo));
                } else {
                    builder.push(Decoration.mark({ class: 'md-image-source' }).range(matchFrom, matchTo));
                }
                usedRanges.push({ from: matchFrom, to: matchTo });
            }
        }
    },

    // Decorator: <video> HTML tags
    decorateVideos(text, from, builder, hideSyntax, Decoration, usedRanges, widgets) {
        const videoRegex = /<video\s+[^>]*src=["']([^"']+)["'][^>]*>[^<]*<\/video\s*>/gi;
        let match;
        while ((match = videoRegex.exec(text)) !== null) {
            const matchFrom = from + match.index;
            const matchTo = matchFrom + match[0].length;

            let overlaps = usedRanges.some(r => matchFrom < r.to && matchTo > r.from);
            if (!overlaps) {
                if (hideSyntax) {
                    builder.push(Decoration.replace({
                        widget: new widgets.VideoWidget(match[1], matchFrom, matchTo)
                    }).range(matchFrom, matchTo));
                } else {
                    builder.push(Decoration.mark({ class: 'md-video-source' }).range(matchFrom, matchTo));
                }
                usedRanges.push({ from: matchFrom, to: matchTo });
            }
        }
    },

    // Decorator: YouTube/Vimeo/Steam embed URLs
    decorateEmbeds(text, from, builder, hideSyntax, Decoration, usedRanges, widgets) {
        const youtubeRegex = /https?:\/\/(www\.)?(youtube\.com\/(watch\?.*v=|embed\/|shorts\/)|youtu\.be\/)([\w-]+)/gi;
        const vimeoRegex = /https?:\/\/(www\.)?vimeo\.com\/(\d+)/gi;
        const steamRegex = /https?:\/\/store\.steampowered\.com\/app\/(\d+)[^\s]*/gi;

        let match;
        while ((match = youtubeRegex.exec(text)) !== null) {
            const matchFrom = from + match.index;
            const matchTo = matchFrom + match[0].length;
            let overlaps = usedRanges.some(r => matchFrom < r.to && matchTo > r.from);
            if (!overlaps) {
                const videoId = match[4];
                if (hideSyntax) {
                    builder.push(Decoration.replace({
                        widget: new widgets.EmbedWidget(match[0], 'youtube', videoId, matchFrom, matchTo)
                    }).range(matchFrom, matchTo));
                } else {
                    builder.push(Decoration.mark({ class: 'md-embed-source' }).range(matchFrom, matchTo));
                }
                usedRanges.push({ from: matchFrom, to: matchTo });
            }
        }

        while ((match = vimeoRegex.exec(text)) !== null) {
            const matchFrom = from + match.index;
            const matchTo = matchFrom + match[0].length;
            let overlaps = usedRanges.some(r => matchFrom < r.to && matchTo > r.from);
            if (!overlaps) {
                const videoId = match[2];
                if (hideSyntax) {
                    builder.push(Decoration.replace({
                        widget: new widgets.EmbedWidget(match[0], 'vimeo', videoId, matchFrom, matchTo)
                    }).range(matchFrom, matchTo));
                } else {
                    builder.push(Decoration.mark({ class: 'md-embed-source' }).range(matchFrom, matchTo));
                }
                usedRanges.push({ from: matchFrom, to: matchTo });
            }
        }

        while ((match = steamRegex.exec(text)) !== null) {
            const matchFrom = from + match.index;
            const matchTo = matchFrom + match[0].length;
            let overlaps = usedRanges.some(r => matchFrom < r.to && matchTo > r.from);
            if (!overlaps) {
                const appId = match[1];
                if (hideSyntax) {
                    builder.push(Decoration.replace({
                        widget: new widgets.EmbedWidget(match[0], 'steam', appId, matchFrom, matchTo)
                    }).range(matchFrom, matchTo));
                } else {
                    builder.push(Decoration.mark({ class: 'md-embed-source' }).range(matchFrom, matchTo));
                }
                usedRanges.push({ from: matchFrom, to: matchTo });
            }
        }
    },

    // Decorator: markdown links [text](url)
    decorateLinks(text, from, builder, hideSyntax, Decoration, usedRanges, widgets) {
        const linkRegex = /\[(.+?)\]\((.+?)\)/g;
        let match;
        while ((match = linkRegex.exec(text)) !== null) {
            const matchFrom = from + match.index;
            const matchTo = matchFrom + match[0].length;

            let overlaps = usedRanges.some(r => matchFrom < r.to && matchTo > r.from);
            if (!overlaps) {
                if (hideSyntax) {
                    builder.push(Decoration.replace({
                        widget: new widgets.LinkWidget(match[1], match[2], matchFrom, matchTo)
                    }).range(matchFrom, matchTo));
                } else {
                    builder.push(Decoration.mark({ class: 'md-link-text' }).range(matchFrom, matchTo));
                }
                usedRanges.push({ from: matchFrom, to: matchTo });
            }
        }
    },

    // Decorator: bare URLs (http/https)
    decorateBareUrls(text, from, builder, hideSyntax, Decoration, usedRanges, widgets) {
        const bareUrlRegex = /https?:\/\/\S+/g;
        let match;
        while ((match = bareUrlRegex.exec(text)) !== null) {
            const matchFrom = from + match.index;
            const matchTo = matchFrom + match[0].length;

            let overlaps = usedRanges.some(r => matchFrom < r.to && matchTo > r.from);
            if (!overlaps) {
                if (hideSyntax) {
                    // Strip trailing punctuation that's unlikely to be part of the URL
                    let url = match[0];
                    while (/[.,;:!?)\]>}]$/.test(url) && url.length > 1) {
                        url = url.slice(0, -1);
                    }
                    const urlTo = matchFrom + url.length;
                    if (urlTo < matchTo) {
                        // Part of the match is trailing punctuation — only replace the URL portion
                        builder.push(Decoration.replace({
                            widget: new widgets.LinkWidget(url, url, matchFrom, urlTo)
                        }).range(matchFrom, urlTo));
                    } else {
                        builder.push(Decoration.replace({
                            widget: new widgets.LinkWidget(url, url, matchFrom, matchTo)
                        }).range(matchFrom, matchTo));
                    }
                } else {
                    builder.push(Decoration.mark({ class: 'md-link-text' }).range(matchFrom, matchTo));
                }
                usedRanges.push({ from: matchFrom, to: matchTo });
            }
        }
    },
    // Decorator: wikilinks [[target]] and [[target|display]]
    decorateWikilinks(text, from, builder, hideSyntax, Decoration, usedRanges, widgets) {
        const wikilinkRegex = /\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]/g;
        let match;
        while ((match = wikilinkRegex.exec(text)) !== null) {
            const matchFrom = from + match.index;
            const matchTo = matchFrom + match[0].length;

            let overlaps = usedRanges.some(r => matchFrom < r.to && matchTo > r.from);
            if (!overlaps) {
                const targetId = match[1].trim();
                const displayText = match[2] ? match[2].trim() : targetId;

                if (hideSyntax) {
                    const blockExists = !!Store.findBlockByWikilink(targetId);
                    builder.push(Decoration.replace({
                        widget: new widgets.WikilinkWidget(displayText, targetId, matchFrom, matchTo, blockExists)
                    }).range(matchFrom, matchTo));
                } else {
                    builder.push(Decoration.mark({ class: 'md-wikilink-source' }).range(matchFrom, matchTo));
                }
                usedRanges.push({ from: matchFrom, to: matchTo });
            }
        }
    }
};
