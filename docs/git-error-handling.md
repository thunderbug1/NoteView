# Git Connection Error Handling Improvements

This document describes the improvements made to properly handle errors when new vault git connections fail, ensuring users can resolve issues effectively.

## Summary of Improvements

### 1. Vault Creation Wizard Enhancements (`js/modals/vaultModal.js`)

#### Error Classification and Humanized Messages
- **Auth errors (401)**: Clear message about PAT requirements with link to GitHub documentation
- **Forbidden errors (403)**: Explains permission issues and branch protection
- **Not found errors (404)**: Guidance on checking URL and token permissions
- **CORS errors**: Detailed CORS proxy explanation with link to isomorphic-git docs
- **Network errors**: Identifies transient issues and suggests checking internet connection
- **Git init errors**: Explains storage limits or browser restrictions

#### Retry Button for Transient Errors
- Network timeout errors now show a "Retry" button
- User can retry without navigating back to step 2
- Reduces friction for temporary connection issues

#### Improved Cleanup Handling
- Better detection of cleanup failures
- Attempts to clean up vault list entries if directory cleanup fails
- Shows detailed error message with instructions if manual cleanup is needed
- Prevents zombie directories from appearing in vault list

#### Action Hints
- Links to documentation for common issues (PAT creation, CORS proxy)
- Specific guidance for each error type
- Helps users self-service common problems

### 2. Ongoing Sync Improvements (`js/syncManager.js`)

#### Consecutive Error Tracking
- Tracks consecutive sync failures (`_consecutiveErrors` counter)
- Escalates error messages after 3 consecutive failures
- Adds exponential backoff delay for retries (up to 10 seconds)

#### Error-Specific Actions
- **CORS errors**: "View Settings" button opens Settings view directly
- **Auth errors**: "View Settings" button opens Settings view directly
- **Network errors**: Retry with delay, indicates retry is happening
- **Protected branch errors**: "Force Push" button (with confirmation)

#### Background Sync Failures
- Shows notification after 2 consecutive background sync failures
- Provides "View Status" button to check sync status
- Prevents silent failures

#### Error Type Detection
- `_isAuthError()`: Detects authentication/authorization failures (401, 403)
- `_isNetworkError()`: Detects network/timeout errors
- `_isProtectedBranchError()`: Detects protected branch rejections
- `_isCorsError()`: Enhanced to detect more CORS-related errors

### 3. Git Remote Connection Validation (`js/gitRemote.js`)

#### Atomic State Updates
- Validates parameters before making changes
- Tests connection before persisting config (when auth provided)
- Improved rollback mechanism if operations fail
- Prevents partial state corruption

#### Pre-connection Validation
- Checks URL is HTTPS format
- Validates required parameters (name, url)
- Provides clear error messages for invalid inputs

#### Rollback on Failure
- Backs up previous config before changes
- Restores previous config if any operation fails
- Logs rollback failures for debugging

## Error Scenarios and User Resolution

| Scenario | Before | After | Can User Resolve? |
|----------|--------|-------|-------------------|
| Wrong credentials (401) | Generic error, go back to step 2 | Clear message with PAT link, "Edit Settings" | ✓ Yes |
| Wrong URL (404) | Generic error, go back to step 2 | Clear guidance, "Edit Settings" | ✓ Yes |
| CORS proxy down | Generic "Settings → Sync" text | "View Settings" button, direct link | ✓ Yes |
| Network timeout | Generic error, no retry | "Retry" button, transient error indicator | ✓ Yes |
| Cleanup failure | Silent console.warn | Detailed message with instructions | ✓ Yes |
| Protected branch | Generic "Sync failed" | "Force Push" option with confirmation | ✓ Yes |
| Background sync failure | Silent console.warn | Toast notification after 2 failures | ✓ Yes |
| Consecutive failures | Generic message repeated | Escalated message with count, delayed retry | ✓ Yes |

## Testing

Run the test suite to verify error handling improvements:

```javascript
// In browser console after loading NoteView
testGitErrorHandling()
```

Test file: `test-git-error-handling.js`

Tests cover:
- Error classification (auth, CORS, network, protected branch)
- Consecutive error tracking
- Vault creation error message generation
- GitRemote validation

## Implementation Details

### Vault Creation Wizard Flow

1. User enters vault name and git credentials
2. Clicks "Verify & Create Vault"
3. **New**: Wizard validates inputs and classifies error type
4. **New**: Shows humanized message with action hints
5. **New**: For transient errors, shows "Retry" button
6. **New**: On failure, attempts cleanup and shows detailed status
7. User can either "Edit Settings" or "Retry" (if transient)

### Sync Error Handling Flow

1. Sync fails
2. **New**: Increment consecutive error counter
3. **New**: Classify error type
4. **New**: Show appropriate action button:
   - CORS/Auth errors → "View Settings"
   - Network errors → "Retry (Wait)" with backoff
   - Protected branch → "Force Push"
   - Others → "Retry"
5. On successful sync, reset counter

### Background Sync Flow

1. Tab hidden with pending commits
2. Attempt background push
3. **New**: If fails, increment counter
4. **New**: After 2 failures, show toast notification
5. **New**: Provide "View Status" action

## Troubleshooting Guide

### Common Issues and Solutions

**Authentication Failed (401)**
- Ensure you're using a Personal Access Token (PAT), not your password
- PAT must have "repo" scope
- Check PAT hasn't expired

**Access Denied (403)**
- Verify PAT has "repo" scope
- Check branch protection rules
- Ensure user has push access to repository

**Repository Not Found (404)**
- Double-check repository URL
- Ensure repository exists
- Verify PAT has read access to repository

**CORS Blocked**
- Configure CORS proxy in Settings → Sync
- Test proxy URL: https://cors.isomorphic-git.org
- Check proxy is accessible

**Network Timeout**
- Check internet connection
- Try "Retry" button for transient errors
- If persistent, check firewall settings

**Protected Branch**
- Use "Force Push" option (with confirmation)
- Or create a pull request instead
- Check branch protection rules

### Zombie Vault Cleanup

If vault creation fails and shows cleanup warning:

1. Open "Manage Vaults"
2. Find the vault name mentioned in error
3. Click menu button (three dots)
4. Select "Remove from list"
5. Vault directory is removed if it's an OPFS vault

## Future Improvements

Potential enhancements:
1. Add connection test utility in Settings
2. Implement smart retry with exponential backoff for all error types
3. Add troubleshooting wizard that guides users through common issues
4. Store error history for debugging
5. Add option to skip git during vault creation and configure later
6. Implement health checks for CORS proxies

## Related Files

- `js/modals/vaultModal.js` - Vault creation wizard with error handling
- `js/syncManager.js` - Ongoing sync with error tracking
- `js/gitRemote.js` - Remote operations with validation
- `test-git-error-handling.js` - Test suite for error handling