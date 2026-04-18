#!/usr/bin/env node

/**
 * Tana → NoteView migration script
 * Converts a nested Tana export into a flat NoteView vault.
 * Works with any Tana export — tag types are auto-discovered.
 *
 * Usage: node scripts/migrate-tana.js <source-dir> <output-dir>
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length < 2) {
    console.error('Usage: node migrate-tana.js <source-dir> <output-dir>');
    process.exit(1);
}

const sourceDir = path.resolve(args[0]);
const outputDir = path.resolve(args[1]);

if (!fs.existsSync(sourceDir)) {
    console.error(`Source directory not found: ${sourceDir}`);
    process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

// --- Constants (Tana export format, not user-data-specific) ---
const DATE_DIR_REGEX = /^(\d{4}-\d{2}-\d{2}) - \w+$/;
const HASHTAG_REGEX = /(?:^|\s)#([a-zA-Z][\w-]*)/g;
const TANA_LINK_REGEX_BRACKET = /\[([^\]]*)\]\(<([^>]+)>\)/g;
const TANA_LINK_REGEX_PAREN = /\[([^\]]*)\]\(([^()<>]+?\.(?:md|MD))\)/g;
const TANA_PROMO_REGEX = /^- .*install the Tana.*$/gm;
const YOUTUBE_IN_FILENAME = /https?:\/\/[^\s]+/;

// --- Stats ---
const stats = {
    notesCreated: 0,
    skipped: 0,
    types: {},
    tags: new Set(),
    collisions: 0,
    unresolvedLinks: 0
};

// --- Walk tree ---
function walkTree(dir, dateContext = null, depth = 0) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];

    const dirName = path.basename(dir);
    const dateMatch = dirName.match(DATE_DIR_REGEX);
    if (dateMatch) dateContext = dateMatch[1];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.name === '.git' || entry.name === '.noteview') continue;

        if (entry.isDirectory()) {
            files.push(...walkTree(fullPath, dateContext, depth + 1));
        } else if (entry.name.endsWith('.md')) {
            files.push({
                sourcePath: fullPath,
                relativePath: path.relative(sourceDir, fullPath),
                filename: entry.name,
                isReadme: entry.name === 'README.md',
                content: fs.readFileSync(fullPath, 'utf8'),
                dateContext,
                depth,
                dirName,
                parentDir: dir
            });
        }
    }
    return files;
}

// --- Phase 0: Auto-discover tag types from filenames ---
function discoverTagTypes(files) {
    const tagTypes = new Set();
    for (const f of files) {
        for (const match of f.filename.matchAll(/\(([^)]+)\)/g)) {
            tagTypes.add(match[1]);
        }
        // Also check directory names
        for (const match of f.dirName.matchAll(/\(([^)]+)\)/g)) {
            tagTypes.add(match[1]);
        }
    }
    return tagTypes;
}

function buildTypeSuffixesRegex(tagTypes) {
    // Build regex that matches any (TagName) suffix, e.g. (Idea), (Task), (Meeting)
    const escaped = [...tagTypes].map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = escaped.map(t => `\\s*\\(${t}\\)`).join('|');
    return new RegExp(pattern, 'g');
}

// --- Extract link targets from content ---
function extractLinks(content) {
    const targets = [];
    let match;
    const r1 = new RegExp(TANA_LINK_REGEX_BRACKET.source, 'g');
    while ((match = r1.exec(content)) !== null) {
        if (!match[2].startsWith('http')) targets.push(match[2]);
    }
    const r2 = new RegExp(TANA_LINK_REGEX_PAREN.source, 'g');
    while ((match = r2.exec(content)) !== null) {
        if (!match[2].startsWith('http')) targets.push(match[2]);
    }
    return targets;
}

// --- Build parent-child map ---
function buildChildMap(files) {
    const childMap = new Map();
    const fileByPath = new Map();
    for (const f of files) fileByPath.set(f.sourcePath, f);

    for (const f of files) {
        if (!f.isReadme) continue;
        const dir = f.parentDir;
        const children = [];

        for (const targetEncoded of extractLinks(f.content)) {
            let targetDecoded;
            try { targetDecoded = decodeURIComponent(targetEncoded); } catch { targetDecoded = targetEncoded; }
            const targetPath = path.resolve(dir, targetDecoded);
            if (fileByPath.has(targetPath)) {
                children.push(targetPath);
            } else if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
                const readmeInDir = path.join(targetPath, 'README.md');
                if (fileByPath.has(readmeInDir)) children.push(readmeInDir);
            }
        }
        if (children.length > 0) childMap.set(f.sourcePath, children);
    }
    return { childMap, fileByPath };
}

// --- Tag extraction ---
function extractFilenameTags(filename) {
    const tags = [];
    for (const s of filename.match(/\(([^)]+)\)/g) || []) {
        tags.push(s.slice(1, -1).toLowerCase().trim());
    }
    return tags;
}

function extractContentTags(content) {
    const tags = new Set();
    let match;
    const regex = new RegExp(HASHTAG_REGEX.source, 'g');
    while ((match = regex.exec(content)) !== null) {
        tags.add(match[1].toLowerCase());
    }
    return tags;
}

function removeHashtags(content) {
    return content.replace(/(\s)#([a-zA-Z][\w-]*)/g, '$1').trim();
}

// --- Filename sanitization ---
function sanitizeFilename(name, typeSuffixesRegex) {
    let c = name.replace(typeSuffixesRegex, '')
        .replace(/https?:\/\/[^\s]+/g, '')
        .replace(/https?-[\w./=_?&;-]+/g, '')
        .replace(/[.\s-]+$/, '').replace(/^[.\s-]+/, '');
    c = c.toLowerCase()
        .replace(/[äöüß]/g, m => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[m] || m))
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (c.length > 120) c = c.substring(0, 120).replace(/-+$/, '');
    return c || 'unnamed';
}

// --- Task transformation ---
function transformTasks(content) {
    return content.replace(/^(\s*)\[([ xX])\]\s+(.+)$/gm, (match, indent, state, text) => {
        let cleanText = text.replace(/\s#([a-zA-Z][\w-]*)/g, '');
        return `${indent}- [${state.toLowerCase()}] ${cleanText}`;
    });
}

function extractTaskMetadata(content) {
    const lines = content.split('\n');
    const result = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const taskMatch = line.match(/^(\s*-\s*\[[ xX]\])\s+(.+)$/);
        if (taskMatch) {
            let taskText = taskMatch[2];
            while (i + 1 < lines.length) {
                const next = lines[i + 1];
                if (next.match(/^\s*-\s*\*\*Task status\*\*:\s*(.*)/) ||
                    next.match(/^\s*-\s*\*\*Due date\*\*:\s*\*([^*]+)\*/)) {
                    const dueMatch = next.match(/^\s*-\s*\*\*Due date\*\*:\s*\*([^*]+)\*/);
                    if (dueMatch) taskText += ` [due:: ${dueMatch[1].trim()}]`;
                    i++;
                    continue;
                }
                break;
            }
            result.push(`${taskMatch[1]} ${taskText}`);
        } else {
            result.push(line);
        }
        i++;
    }
    return result.join('\n');
}

// --- Link rewriting ---
function resolveLink(displayText, targetEncoded, blockIdMap, typeSuffixesRegex) {
    let targetDecoded;
    try { targetDecoded = decodeURIComponent(targetEncoded); } catch { targetDecoded = targetEncoded; }
    targetDecoded = targetDecoded.replace(/\.md$/, '').replace(/\/README$/, '').replace(typeSuffixesRegex, '').trim();

    const cleanTarget = sanitizeFilename(path.basename(targetDecoded), typeSuffixesRegex);
    if (blockIdMap.has(cleanTarget)) {
        const blockId = blockIdMap.get(cleanTarget);
        if (displayText && displayText !== path.basename(targetDecoded)) {
            return `[[${blockId}|${displayText}]]`;
        }
        return `[[${blockId}]]`;
    }
    stats.unresolvedLinks++;
    return `[[${cleanTarget}]]`;
}

function rewriteLinks(content, blockIdMap, typeSuffixesRegex) {
    content = content.replace(TANA_LINK_REGEX_BRACKET, (match, displayText, target) => {
        if (target.startsWith('http')) return match;
        return resolveLink(displayText, target, blockIdMap, typeSuffixesRegex);
    });
    content = content.replace(TANA_LINK_REGEX_PAREN, (match, displayText, target) => {
        if (target.startsWith('http')) return match;
        return resolveLink(displayText, target, blockIdMap, typeSuffixesRegex);
    });
    return content;
}

// --- Merge a tree into a single body ---
function mergeTree(readmePath, childMap, fileByPath, typeSuffixesRegex, depth = 0) {
    const readme = fileByPath.get(readmePath);
    if (!readme) return '';

    const heading = '#'.repeat(depth + 1);
    const titleLine = readme.content.split('\n')[0].replace(/[#]/g, '').replace(/\s#([a-zA-Z][\w-]*)/g, '').trim();
    const childPaths = childMap.get(readmePath) || [];

    let bodyLines = readme.content.split('\n').slice(1);

    // Build set of link targets that point to children
    const childLinkTargets = new Set();
    for (const cp of childPaths) {
        const child = fileByPath.get(cp);
        if (!child) continue;
        if (child.isReadme) {
            childLinkTargets.add(path.relative(path.dirname(readmePath), path.dirname(cp)));
        } else {
            childLinkTargets.add(path.relative(path.dirname(readmePath), cp));
        }
    }

    // Remove lines that contain links to children (they'll be replaced by inlined content)
    bodyLines = bodyLines.filter(line => {
        const links = extractLinks(line);
        for (const link of links) {
            let decoded;
            try { decoded = decodeURIComponent(link); } catch { decoded = link; }
            const normalized = decoded.replace(/\.md$/, '').replace(/\/README$/, '');
            for (const target of childLinkTargets) {
                const targetNorm = target.replace(/\.md$/, '').replace(/\/README$/, '');
                if (decoded === target || normalized === targetNorm ||
                    decoded.endsWith('/' + target) || decoded === target + '.md') {
                    return false;
                }
            }
        }
        return true;
    });

    // Remove empty Transcript lines
    bodyLines = bodyLines.filter(line => !/^\s*-\s*\*\*Transcript\*\*:\s*$/.test(line));

    let body = bodyLines.join('\n').trim();

    for (const cp of childPaths) {
        const child = fileByPath.get(cp);
        if (!child) continue;

        if (child.isReadme && childMap.has(cp)) {
            body += '\n\n' + mergeTree(cp, childMap, fileByPath, typeSuffixesRegex, depth + 1);
        } else if (child.isReadme) {
            const childContent = child.content.split('\n').slice(1).join('\n').trim();
            const childTitle = child.content.split('\n')[0].trim();
            if (childContent) {
                body += `\n\n${'#'.repeat(Math.min(depth + 2, 6))} ${childTitle}\n\n${childContent}`;
            }
        } else {
            const childTitle = child.filename.replace(/\.md$/, '').replace(typeSuffixesRegex, '').trim();
            // Leaf files always have the title as first line — skip it
            let childContent = child.content.split('\n').slice(1).join('\n').trim();
            if (childContent) {
                body += `\n\n${'#'.repeat(Math.min(depth + 2, 6))} ${childTitle}\n\n${childContent}`;
            } else {
                body += `\n\n${'#'.repeat(Math.min(depth + 2, 6))} ${childTitle}`;
            }
        }
    }

    return `${heading} ${titleLine}${body ? '\n\n' + body : ''}`;
}

// --- Check for substantive content ---
function hasSubstantiveContent(content) {
    const noPromo = content.replace(TANA_PROMO_REGEX, '').trim();
    const lines = noPromo.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) return false;
    if (lines.length === 1 && DATE_DIR_REGEX.test(lines[0].trim())) return false;
    return true;
}

// Check if a string contains any tag type from the discovered set
function hasAnyTagType(name, tagTypes) {
    for (const tag of tagTypes) {
        if (name.includes(`(${tag})`)) return true;
    }
    return false;
}

// ============================================================
// MAIN
// ============================================================
console.log(`Scanning ${sourceDir}...`);
const allFiles = walkTree(sourceDir);
console.log(`Found ${allFiles.length} markdown files`);

// Auto-discover tag types from all filenames and directory names
const tagTypes = discoverTagTypes(allFiles);
const typeSuffixesRegex = buildTypeSuffixesRegex(tagTypes);
console.log(`Discovered tag types: ${[...tagTypes].sort().join(', ')}`);

const { childMap, fileByPath } = buildChildMap(allFiles);
console.log(`Built parent-child map with ${childMap.size} parent nodes`);

const outputNotes = [];
const processed = new Set();

// --- Phase 1: Process date-level READMEs and their children ---
for (const [readmePath, children] of childMap) {
    const readme = fileByPath.get(readmePath);
    if (!readme || !readme.dirName.match(DATE_DIR_REGEX)) continue;

    processed.add(readmePath);

    const contentFiles = [];
    const dirTrees = [];

    for (const cp of children) {
        const child = fileByPath.get(cp);
        if (!child) continue;
        if (child.isReadme) dirTrees.push(cp);
        else contentFiles.push(cp);
    }

    // Process directory trees: typed dirs become standalone, untyped merge into sibling
    for (const dirReadmePath of dirTrees) {
        const dirReadme = fileByPath.get(dirReadmePath);
        const dirName = path.basename(path.dirname(dirReadmePath));

        if (hasAnyTagType(dirName, tagTypes)) {
            // Standalone typed tree (e.g., meeting directory) → own note
            const mergedBody = mergeTree(dirReadmePath, childMap, fileByPath, typeSuffixesRegex, 0);
            if (!mergedBody.trim()) continue;

            const nameTags = extractFilenameTags(dirName);
            const contentTags = extractContentTags(mergedBody);
            const allTags = [...new Set([...nameTags, ...contentTags])];
            const cleanName = sanitizeFilename(dirName.replace(typeSuffixesRegex, '').trim(), typeSuffixesRegex);

            outputNotes.push({
                name: cleanName, tags: allTags,
                creationDate: readme.dateContext, body: mergedBody,
                sourceType: 'tree'
            });

            processed.add(dirReadmePath);
            const markTree = (p) => { processed.add(p); for (const c of (childMap.get(p) || [])) markTree(c); };
            markTree(dirReadmePath);
        } else {
            // Untyped concept tree → merge into first sibling content file
            let mergeTarget = contentFiles.length > 0 ? contentFiles[0] : null;

            const mergedBody = mergeTree(dirReadmePath, childMap, fileByPath, typeSuffixesRegex, 1);

            if (mergeTarget) {
                const targetFile = fileByPath.get(mergeTarget);
                const cleanName = sanitizeFilename(targetFile.filename.replace(/\.md$/, '').replace(typeSuffixesRegex, '').trim(), typeSuffixesRegex);
                const nameTags = extractFilenameTags(targetFile.filename);
                const contentTags = extractContentTags(targetFile.content);
                const treeContentTags = extractContentTags(mergedBody);
                const allTags = [...new Set([...nameTags, ...contentTags, ...treeContentTags])];

                const existing = outputNotes.find(n => n.name === cleanName);
                if (existing) {
                    existing.body += '\n\n' + mergedBody;
                    for (const t of treeContentTags) { if (!existing.tags.includes(t)) existing.tags.push(t); }
                } else {
                    outputNotes.push({
                        name: cleanName, tags: allTags,
                        creationDate: targetFile.dateContext,
                        body: `${targetFile.content.trim()}\n\n${mergedBody}`,
                        sourceType: 'merged-content'
                    });
                    processed.add(mergeTarget);
                }
            } else {
                const contentTags = extractContentTags(mergedBody);
                outputNotes.push({
                    name: sanitizeFilename(dirName, typeSuffixesRegex), tags: [...contentTags],
                    creationDate: readme.dateContext, body: mergedBody,
                    sourceType: 'tree'
                });
            }

            processed.add(dirReadmePath);
            const markTree = (p) => { processed.add(p); for (const c of (childMap.get(p) || [])) markTree(c); };
            markTree(dirReadmePath);
        }
    }
}

// --- Phase 2: Remaining standalone files ---
for (const file of allFiles) {
    if (processed.has(file.sourcePath)) continue;

    if (file.isReadme && file.depth <= 2) { stats.skipped++; continue; }

    // Date READMEs with substantive content (AI chats, etc.)
    if (file.isReadme && file.dirName.match(DATE_DIR_REGEX)) {
        const withoutLinks = file.content.replace(TANA_LINK_REGEX_BRACKET, '').replace(TANA_LINK_REGEX_PAREN, '').trim();
        const nonDateNonPromo = withoutLinks.split('\n')
            .filter(l => l.trim().length > 0)
            .filter(l => !DATE_DIR_REGEX.test(l.trim()))
            .filter(l => !TANA_PROMO_REGEX.test(l));

        if (nonDateNonPromo.length === 0) { stats.skipped++; continue; }

        const bodyContent = withoutLinks.replace(TANA_PROMO_REGEX, '')
            .split('\n').filter(l => !DATE_DIR_REGEX.test(l.trim())).join('\n').trim();

        if (bodyContent) {
            outputNotes.push({
                name: sanitizeFilename(file.dirName, typeSuffixesRegex),
                tags: [...extractContentTags(bodyContent)],
                creationDate: file.dateContext,
                body: `# ${file.dirName}\n\n${bodyContent}`,
                sourceType: 'date-readme'
            });
        }
        processed.add(file.sourcePath);
        continue;
    }

    // Standalone daily files (at Week level, named YYYY-MM-DD - Dayname.md)
    const filenameNoExt = file.filename.replace(/\.md$/, '');
    if (!file.isReadme && filenameNoExt.match(DATE_DIR_REGEX)) {
        if (!hasSubstantiveContent(file.content)) { stats.skipped++; processed.add(file.sourcePath); continue; }
        const body = file.content.replace(TANA_PROMO_REGEX, '').trim();
        const lines = body.split('\n').filter(l => !DATE_DIR_REGEX.test(l.trim()));
        const dateMatch = filenameNoExt.match(DATE_DIR_REGEX);
        const creationDate = file.dateContext || (dateMatch ? dateMatch[1] : null);
        outputNotes.push({
            name: sanitizeFilename(filenameNoExt, typeSuffixesRegex),
            tags: [...extractContentTags(body)],
            creationDate,
            body: lines.join('\n').trim(),
            sourceType: 'daily'
        });
        processed.add(file.sourcePath);
        continue;
    }

    // Regular content files
    if (!file.isReadme) {
        const nameTags = extractFilenameTags(file.filename);
        const contentTags = extractContentTags(file.content);
        let cleanName = file.filename.replace(/\.md$/, '').replace(typeSuffixesRegex, '').trim();
        cleanName = sanitizeFilename(cleanName, typeSuffixesRegex);
        let creationDate = file.dateContext;
        if (!creationDate) {
            const dirDateMatch = file.dirName.match(DATE_DIR_REGEX);
            if (dirDateMatch) creationDate = dirDateMatch[1];
        }

        let body = file.content;

        outputNotes.push({
            name: cleanName,
            tags: [...new Set([...nameTags, ...contentTags])],
            creationDate,
            body,
            sourceType: 'content'
        });
        processed.add(file.sourcePath);
    }
}

// --- Deduplicate filenames ---
const nameCounts = new Map();
for (const note of outputNotes) {
    const count = nameCounts.get(note.name) || 0;
    nameCounts.set(note.name, count + 1);
    if (count > 0) {
        note.name = `${note.name}-${count + 1}`;
        stats.collisions++;
    }
}

// --- Build block ID map ---
const blockIdMap = new Map();
for (const note of outputNotes) {
    blockIdMap.set(note.name, note.name);
    blockIdMap.set(note.name.replace(/-/g, ' '), note.name);
}

// --- Transform and write ---
for (const note of outputNotes) {
    stats.notesCreated++;

    let body = note.body;
    body = body.replace(TANA_PROMO_REGEX, '');
    body = transformTasks(body);
    body = extractTaskMetadata(body);
    body = removeHashtags(body);
    body = rewriteLinks(body, blockIdMap, typeSuffixesRegex);
    body = body.replace(/\[\[([^\]]*)\]\]#/g, '[[$1]]');
    // Clean up nested Tana links with wikilinks: [text [[Name]]](<path>) → [[Name|text]]
    body = body.replace(/\[([^\]]*?)\[\[([^\]]+?)\]\]\]\(<[^>]+>\)/g, (m, prefix, name) => {
        const clean = prefix.trim().replace(/^- /, '').trim();
        return clean ? `[[${name}|${clean}]]` : `[[${name}]]`;
    });
    // Clean any remaining angle-bracket links
    body = body.replace(/\[([^\]]*)\]\(<[^>]+>\)/g, (m, text) => text);
    body = body.replace(/\n{3,}/g, '\n\n').trim();

    const fm = {};
    const uniqueTags = [...new Set(note.tags.map(t => t.toLowerCase()))];
    if (uniqueTags.length > 0) fm.tags = JSON.stringify(uniqueTags);
    if (note.creationDate) fm.creationDate = JSON.stringify(`${note.creationDate}T00:00:00.000Z`);

    let output;
    if (Object.keys(fm).length > 0) {
        const frontmatter = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n');
        output = `---\n${frontmatter}\n---\n\n${body}\n`;
    } else {
        output = `${body}\n`;
    }

    const type = note.tags[0] || 'unknown';
    stats.types[type] = (stats.types[type] || 0) + 1;
    for (const t of note.tags) stats.tags.add(t);

    fs.writeFileSync(path.join(outputDir, `${note.name}.md`), output, 'utf8');
}

// --- Report ---
console.log('\n=== Migration Report ===');
console.log(`Files scanned:    ${allFiles.length}`);
console.log(`Notes created:    ${stats.notesCreated}`);
console.log(`Skipped:          ${stats.skipped}`);
console.log(`Collisions:       ${stats.collisions}`);
console.log(`Unresolved links: ${stats.unresolvedLinks}`);
console.log('\nBy type:');
for (const [type, count] of Object.entries(stats.types).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
}
console.log(`\nAll tags: ${[...stats.tags].sort().join(', ')}`);
console.log(`\nOutput: ${outputDir}`);
