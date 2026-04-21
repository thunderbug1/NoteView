# Diligent Review

Perform a thorough, detailed review of all uncommitted changes (staged and unstaged). Analyze every modified and new file line-by-line. Look for:

## Review Checklist

### Bugs & Logic Errors
- Race conditions, especially in async code, event handlers, and debounced/throttled functions
- Off-by-one errors, null/undefined access, missing null checks
- Incorrect conditionals (wrong operator, inverted logic, missing edge case)
- State that can get out of sync (stale closures, missing re-renders, orphaned listeners)
- Resource leaks (unremoved event listeners, unclosed connections, uncleared timers)
- Error paths that swallow exceptions silently or leave the app in a broken state

### Edge Cases
- Empty inputs, empty arrays, missing properties, zero-length strings
- Concurrent operations (rapid clicks, overlapping saves, double-submits)
- Unicode issues, very long strings, special characters in filenames/content
- Browser API unavailability or permission denial (File System Access, Web Speech, etc.)
- What happens when data is missing, corrupted, or in an unexpected format

### Security
- XSS via unsanitized user input rendered as HTML
- Path traversal or injection in file operations
- Sensitive data exposure (tokens, credentials logged or stored insecurely)

### UI/UX
- Broken layouts at different screen widths (especially mobile)
- Missing loading states, error states, or empty states
- Accessibility issues (missing ARIA labels, keyboard navigation, focus management)
- Inconsistent behavior compared to existing patterns in the codebase
- Visual regressions from CSS changes

### Performance
- Unnecessary DOM manipulation or re-renders
- Expensive operations in loops or hot paths
- Missing debounce/throttle where needed
- Memory growth from accumulating data structures

### Code Quality
- Dead code, unused variables, unreachable branches
- Inconsistent naming or style compared to surrounding code
- Missing error handling at system boundaries (user input, external APIs)
- Changes that violate existing architectural patterns documented in CLAUDE.md

## Process

1. Run `git diff` and `git diff --cached` to see all changes, and `git status` for new untracked files
2. For each changed file, read the full file if needed for context (not just the diff)
3. Work through the checklist above systematically
4. For each finding, report:
   - **File and line number** where the issue exists
   - **Severity**: critical (bug/data loss), major (broken feature), minor (edge case), nit (style/preference)
   - **Description** of the issue and what can go wrong
   - **Suggested fix** (code snippet or approach)
5. Summarize overall quality: is this ready to commit, or does it need fixes first?
