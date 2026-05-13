# Media Embeds & Custom Syntax Reference

NoteView extends standard markdown with several custom syntax conventions. These are rendered as rich widgets in the live preview.

---

## Media Embeds

NoteView auto-detects media URLs and renders them as interactive embeds. Multiple consecutive media lines are grouped into a gallery grid.

### Supported URL types

| Type | Example | Preview |
|------|---------|---------|
| YouTube | `https://youtube.com/watch?v=abc` | Thumbnail with play button |
| YouTube short | `https://youtu.be/abc` | Same as above |
| YouTube shorts | `https://youtube.com/shorts/abc` | Same as above |
| Vimeo | `https://vimeo.com/12345` | Play button card |
| Steam | `https://store.steampowered.com/app/730/CS2/` | Game header image |
| Video file | `https://example.com/clip.mp4` | Inline video player |
| `<video>` tag | `<video src="url" controls></video>` | Inline video player |
| Image | `![alt](image.png)` | Inline image |
| Website link | `Description: https://example.com/` | Link icon + domain badge |

Website links are only detected when there is descriptive text alongside the URL (e.g. `Name: https://url`). Bare URLs remain as clickable links.

### Media galleries

Consecutive lines containing media URLs are automatically grouped into a horizontal grid of thumbnail cards:

```markdown
Tutorial for drawing: https://youtube.com/watch?v=abc
Vectorfields: https://youtube.com/watch?v=def
```

A blank line or non-indented text line breaks the group. Each card shows a thumbnail and the text description as a caption. Clicking a card opens it for editing.

### Notes under media items

Indented lines under a media URL are attached as notes to that item:

```markdown
Vectorfields to control movement: https://youtube.com/watch?v=na7LuZsW2UM
  tracing the particle paths leads to cool images
  @6:20 IDEA: communicate emotions through particle movement
```

Three types of notes are supported:

| Type | Syntax | Rendering |
|------|--------|-----------|
| Plain note | `  any indented text` | Text below the card |
| Timestamp | `  @MM:SS description` | Thumbnail + clickable time badge (opens video at that point) |
| Image | `  ![alt](image_url)` | Full-width image below the card |

### Timestamp bookmarks (`@MM:SS`)

On an indented line under a video, use `@` followed by a timecode:

```markdown
Cool tutorial: https://youtube.com/watch?v=abc
  @2:35 introduction to the technique
  @6:20 the advanced part
  @1:23:45 deep into the long video
```

- `@MM:SS` — minutes and seconds (e.g. `@6:20` = 6 min 20 sec = opens at `?t=380`)
- `@HH:MM:SS` — hours, minutes, seconds (e.g. `@1:23:45` = 1 hr 23 min 45 sec)
- Timestamps are only clickable for video types (YouTube, Vimeo, direct video files)
- For images/Steam/links, `@MM:SS` lines render as plain text notes

### Image thumbnails for links

Add `![alt](url)` on indented lines under a website link to attach visual previews:

```markdown
Interactive generative art: http://weavesilk.com/
  ![screenshot](screenshots/silk.png)
  ![another angle](screenshots/silk2.png)
  allows drawing with symmetry/mirror mode
```

---

## Task Syntax

### Checkbox states

Standard `[ ]` and `[x]` are extended with three additional states:

```markdown
- [ ] Todo
- [/] In Progress
- [x] Done
- [b] Blocked
- [-] Canceled
```

States are case-insensitive: `[X]`, `[B]` are valid.

### Inline fields `[key:: value]`

Metadata attached to tasks or any line:

```markdown
- [ ] Ship feature [due:: 2026-04-15] [priority:: high] [assignee:: @alice]
```

| Key | Values | Usage |
|-----|--------|-------|
| `due` | Date (`YYYY-MM-DD`) | Due date badge, kanban sorting |
| `start` | Date (`YYYY-MM-DD`) | Start date |
| `priority` | `urgent`, `high`, `medium`, `low` | Priority badge, sorting |
| `assignee` | `@name` | Assignee badge, contact filter |
| `completed` | ISO timestamp | Auto-set when task is checked off |

### Task anchors `^id`

```markdown
- [ ] Task one ^task-abc
- [ ] Task two ^task-def
```

The `^id` syntax assigns an identifier to a task. Anchors start with `^` followed by alphanumeric characters, hyphens, or underscores.

---

## Wikilinks `[[target]]`

```markdown
See also [[Meeting Notes]] or [[meeting-notes|the meeting]]
```

- `[[target]]` — links to a note by filename or first heading (case-insensitive)
- `[[target|display text]]` — custom display text
- Click navigates to the note; Shift+click opens in a modal
- Broken links (target not found) are highlighted differently
- Autocomplete triggers when typing `[[`

---

## Hierarchical tags

```yaml
---
tags: [Project.Alpha, Project.Beta, Status.Active]
---
```

Dot-separated tags create hierarchy in the sidebar:
- `Project.Alpha` and `Project.Beta` are grouped under `Project`
- The sidebar shows `path:Project` as a group filter selecting all sub-tags

---

## Paste detection

Pasting a URL with a recognized media extension or domain triggers a modal asking how to insert it:

| Detected type | Inserted as |
|---------------|-------------|
| Image URL (`.jpg`, `.png`, `.gif`, `.webp`, `.svg`, `.bmp`, `.ico`, `.avif`) | `![image](url)` |
| Video URL (`.mp4`, `.webm`, `.ogg`, `.mov`) | `<video src="url" controls></video>` |
| YouTube URL | Bare URL (auto-rendered as embed) |
| Vimeo URL | Bare URL (auto-rendered as embed) |
| Steam URL | Bare URL (auto-rendered as embed) |
