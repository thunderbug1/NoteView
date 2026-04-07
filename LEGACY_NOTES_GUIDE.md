# Structuring Legacy Markdown Notes for NoteView

This guide shows how to reshape an existing markdown note collection so it fits cleanly into NoteView's current storage model.

NoteView is intentionally simple on disk:

- One note = one `.md` file
- The selected vault folder is scanned for top-level `.md` files
- Metadata is stored in a small frontmatter block
- Everything else stays plain markdown in the body

If you are bringing notes over from Obsidian, Logseq, Notion exports, old project folders, or a hand-rolled markdown archive, the main goal is to flatten each note into a single self-contained file that NoteView can read without guesswork.

## Recommended Vault Shape

Use a flat folder of markdown files for the vault you open in NoteView:

```text
notes-vault/
  2024-architecture-review.md
  2025-hiring-plan.md
  client-acme-roadmap.md
  personal-weekly-review-2026-04-07.md
  sprint-42.md
```

Why this works well:

- NoteView currently loads top-level `.md` files from the selected folder
- Filenames become note IDs inside the app
- History and task timeline features track changes per file
- Sorting is more predictable when filenames carry stable prefixes

If your legacy notes are deeply nested, either:

1. Flatten the notes you want to actively manage in NoteView into one vault folder.
2. Keep separate NoteView vaults by area, such as `work-notes/` and `personal-notes/`.

## File Naming Convention

Treat the filename as the durable note identifier.

Good patterns:

```text
2026-04-07-weekly-review.md
client-acme-roadmap.md
proj-search-redesign.md
reference-git-workflows.md
```

Recommended rules:

- Use lowercase kebab-case
- Keep names stable after migration
- Put dates first when chronology matters
- Put project or area first when grouping matters


Because NoteView uses the filename without `.md` as the note ID, `client-acme-roadmap.md` becomes `client-acme-roadmap` inside task references.

## Frontmatter Format NoteView Expects

NoteView does not expect full YAML semantics. Its parser reads frontmatter lines in this shape:

```text
key: JSON-value
```

That means strings should be quoted, arrays should use JSON brackets, and timestamps should be ISO strings.

Recommended frontmatter:

```markdown
---
tags: ["work", "client", "planning"]
creationDate: "2025-11-03T09:00:00.000Z"
lastUpdated: "2026-04-07T14:30:00.000Z"
---

# Client ACME Roadmap

Body content goes here.
```

Notes:

- `tags` should be a JSON array, not YAML list syntax
- `creationDate` and `lastUpdated` should be ISO 8601 strings if you want reliable time filtering
- Additional metadata is allowed, but NoteView currently uses tags and timestamps most directly
- If there is no frontmatter, the file still loads, but you lose structured tags and explicit dates

Avoid this YAML-style syntax if you want predictable parsing:

```markdown
---
tags:
  - work
  - client
creationDate: 2026-04-07
---
```

That format is valid YAML, but not a clean fit for NoteView's current frontmatter parser.

## Body Structure That Works Well

Inside the note body, keep normal markdown. Headings, paragraphs, bullets, code blocks, quotes, and links remain plain markdown and are safe to migrate as-is.

A practical legacy-note shape looks like this:

```markdown
---
tags: ["work", "product", "sprint-42"]
creationDate: "2026-03-28T10:00:00.000Z"
lastUpdated: "2026-04-07T16:45:00.000Z"
---

# Sprint 42 Planning

## Summary

Focus this sprint on onboarding polish, search relevance, and API reliability.

## Open Questions

- Should we cut bulk import from the sprint scope?
- Do we need a staged rollout for search changes?

## Tasks

- [ ] Finalize search acceptance criteria [due:: 2026-04-10] [priority:: High]
- [/] Review onboarding copy with @maria [assignee:: @maria]
- [b] Ship API retry changes
- [x] Confirm QA schedule [assignee:: @lee] [due:: 2026-04-05]

## Related Work

- Backend API readiness
- Retry strategy
- Rollout sequencing

## Notes

Search latency is acceptable in staging, but relevance needs better defaults.
```

This gives NoteView enough structure to support:

- Document editing
- Context tag filtering
- Contact extraction from `@mentions`
- Kanban cards from task checkboxes
- Timeline events from task state changes in git history

## Task Syntax to Standardize During Migration

If your legacy notes contain ad hoc TODO lines, normalize them into NoteView's checkbox format.

Supported task states:

```markdown
- [ ] Todo
- [/] In Progress
- [x] Done
- [b] Blocked
- [-] Canceled
```

Supported inline task fields:

```markdown
[due:: 2026-04-15]
[assignee:: @alice]
[priority:: High]
```

Migration advice:

- Convert `TODO:` lines into checkbox tasks
- Keep one actionable item per task line
- Put due dates and assignments inline on the same line
- Use `@username` consistently for mentions and assignees

For now, leave task dependencies out of the task line itself. If one item depends on another area of work, represent that in the note hierarchy instead:

- Use section structure such as `Project -> Feature -> Task list`
- Split major dependency areas into separate notes with shared project tags
- Keep prerequisite work in its own section such as `Related Work`, `Prerequisites`, or `Blocked By`
- Use note titles, headings, and grouping to show sequence instead of inline dependency metadata

## How to Map Common Legacy Patterns

### Journal or Daily Notes

Use date-first filenames:

```text
2026-04-07-daily.md
2026-04-08-daily.md
```

Suggested tags:

```markdown
tags: ["daily", "journal"]
```

### Project Notes

Use a stable project prefix:

```text
proj-search-overview.md
proj-search-meeting-notes.md
proj-search-open-questions.md
```

Suggested tags:

```markdown
tags: ["work", "project-search"]
```

Recommendation:

- Always give project notes a project tag so you can filter to a project-wide slice such as all notes or all todos for that project
- If a project grows broad enough to span multiple themes, add narrower tags such as `feature-ranking`, `feature-onboarding`, or `area-api`
- Prefer multiple focused notes with shared project tags over one oversized project file

### Reference Notes

Keep them task-light and tag-heavy:

```text
reference-postgres-indexing.md
reference-release-checklist.md
```

Suggested tags:

```markdown
tags: ["reference", "engineering"]
```

### Meeting Notes

Use a date plus subject or account name:

```text
2026-04-07-client-acme-sync.md
2026-04-07-design-review-search.md
```

Suggested body shape:

```markdown
# Client ACME Sync

## Attendees

- @alex
- @jamie

## Decisions

- Move pilot start to May.

## Follow-ups

- [ ] Send revised rollout plan [assignee:: @alex]
```

## Minimal Migration Checklist

For each legacy note you want in NoteView:

1. Move it into the vault's top level as a single `.md` file.
2. Give it a stable, readable filename.
3. Add frontmatter with JSON-style `tags` and ISO timestamps.
4. Keep the main content as standard markdown.
5. Normalize tasks into NoteView checkbox syntax.
6. Convert people references to consistent `@mentions`.
7. Use stable tags instead of folder depth for categorization.

## Suggested Tag Strategy

Use tags as filter handles for interesting areas, not decoration. A small controlled set works better than importing every historical keyword.

The practical rule is:

- Every note should have the tags you would realistically want to filter by later
- Project names should usually be tags, not just words in the title
- If you want to ask NoteView for something like todos for project X, that project needs a consistent tag across the relevant notes
- If one aspect of a project becomes large, give it its own tag and spread the material across multiple notes instead of creating a mega markdown file

Good tag categories:

- Area: `work`, `personal`, `admin`
- Type: `meeting`, `reference`, `daily`, `planning`
- Project: `project-search`, `client-acme`, `sprint-42`
- Feature or aspect: `feature-ranking`, `feature-import`, `area-api`, `area-ux`
- Status context: `active`, `waiting`, `archive`

Example tag sets:

- Broad project note: `tags: ["work", "project-search", "planning"]`
- Search ranking note: `tags: ["work", "project-search", "feature-ranking"]`
- Search API issue note: `tags: ["work", "project-search", "area-api"]`

That structure lets you filter at multiple levels:

- Everything related to `project-search`
- Only notes and tasks related to `feature-ranking`
- Cross-cutting areas like `area-api` across several projects

Try to avoid:

- Near-duplicates like `meeting`, `meetings`, `mtg`
- Folder names copied directly into tags without meaning
- Project names living only in filenames or headings instead of tags
- Large tag lists that repeat obvious words already in the title

## Example: Before and After

Before:

```markdown
# Search Meeting

Date: 4/7/26
Project: Search
Owner: Maria

TODO fix ranking
TODO talk to API team
```

After:

```markdown
---
tags: ["work", "meeting", "project-search"]
creationDate: "2026-04-07T13:00:00.000Z"
lastUpdated: "2026-04-07T13:00:00.000Z"
---

# Search Meeting

Owner: @maria

- [ ] Fix ranking defaults [priority:: High]
- [ ] Talk to API team [assignee:: @maria]
```

## Practical Limits to Keep in Mind

- NoteView currently scans markdown files in the selected folder, not a nested tree
- File identity is tied to the filename
- Tags belong in frontmatter, not inferred from folders
- Task metadata should stay inline on the task line
- Full YAML frontmatter conventions are not the safest choice here; JSON-style values are

If you structure legacy notes this way, they remain ordinary markdown files, but they also map cleanly onto NoteView's document, kanban, filter, and history features.