# Fix Issues

Fix the following issues described by the user. The issues are provided as free-form text in $ARGUMENTS.

## Process

1. **Parse the issues.** Read `$ARGUMENTS` and break it into a numbered list of distinct issues. If the text is ambiguous, make your best interpretation.

2. **Create a task for each issue** using TaskCreate so the user can track progress.

3. **Fix each issue one at a time.** For each:
   - Use grep/search/read to locate the relevant code. Read surrounding context to understand how it fits into the broader module — don't fix in isolation.
   - Understand the **root cause** before writing any code. If a function crashes on null, figure out *why* null reaches it, don't just add a guard.
   - Apply a **simple and robust** fix:
     - Handle edge cases properly (null/undefined, empty arrays, missing properties, concurrent operations)
     - Use straightforward logic — no clever one-liners or tricks that are hard to reason about
     - Follow the patterns already used in this codebase
     - Don't over-engineer, but don't paper over the problem with a fragile workaround
   - Follow all coding rules from CLAUDE.md:
     - Escape all user-controlled values in HTML via `escapeHtml()`
     - Sanitize `marked.parse()` output through `sanitizeHtml()`
     - Clean up document-level event listeners with `removeEventListener`
     - Mutate in-memory state only after file operations succeed
     - Don't export regex literals with the `g` flag on window globals
     - When adding `<script>`/`<link>` tags, also update `sw.js` `PRECACHE_URLS` and bump `CACHE_NAME`
   - Mark the task as completed.

4. **Self-check.** After all fixes, grep the changed files for common mistakes:
   - Unescaped user input in `innerHTML` or HTML attributes
   - `addEventListener` without a matching `removeEventListener`
   - State mutations before async operations
   - Regex literals with `g` flag exported as globals

5. **Report.** Summarize what was fixed, what each root cause was, and any issues that need manual attention.
