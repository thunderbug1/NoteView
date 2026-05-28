# Tag Index Robustness Guarantees

## Defense Against Stale Caches

### 1. **Index Cleared on Load Failures**
When `loadBlocks()` fails early (directory iteration errors), the index is explicitly cleared:
```javascript
TagIndex.clear();
```
This prevents stale data from previous vaults from persisting.

### 2. **Index Rebuilt on Every Load**
`TagIndex.init()` is called after every successful `loadBlocks()`, completely rebuilding the index from scratch. The index is never persisted across page loads.

### 3. **Index Updated After File Write Success**
Tag index updates occur only AFTER the file write succeeds in `saveBlock()`:
```javascript
await writable.write(content);
await writable.close();
// File write successful - now update index
TagIndex.updateBlockTags(block.id, oldTags, newTags);
```
If the write fails, the index is not modified.

### 4. **Graceful Fallback to Linear Scan**
If the tag index is not initialized or is corrupted, the filtering code automatically falls back to the linear scan approach:
```javascript
if (regularTags.length > 0 && window.TagIndex?.tagToBlocks?.size > 0) {
    // Use index
} else if (regularTags.length > 0) {
    // Fallback to linear scan
}
```

### 5. **Validation on Init**
`TagIndex.init()` calls `TagIndex.validate()` which checks:
- Every block in `Store.blocks` is in the index
- Tag counts match between blocks and index
- No orphaned entries in index
- No missing entries from index
- Throws if inconsistencies found

### 6. **Index Updated on All Block Operations**
- `saveBlock()` - updates index when tags change
- `deleteBlock()` - removes block from index
- `undoCreate()` - removes block from index
- `redoCreate()` - adds block to index
- All other paths go through `saveBlock()` which handles index updates

### 7. **Atomic Index Operations**
Index update methods are designed to be atomic:
- `updateBlockTags()` calculates the delta and applies all changes together
- No intermediate inconsistent state

## Potential Issues and Mitigations

### **Issue: Race Condition with Concurrent Saves**
**Scenario:** Two async saves to different blocks could interleave index updates.

**Mitigation:** JavaScript is single-threaded, so concurrent async operations still serialize. However, `_saveQueue` in `saveBlock()` provides additional serialization per-block.

### **Issue: Index Not Validated After Updates**
**Scenario:** Index could become corrupted due to bugs in update logic.

**Mitigation:** 
- Validation runs on every `init()` (vault load)
- In development, could add validation after critical operations
- Graceful fallback ensures app continues to work even with corrupted index

### **Issue: Vault Switch Without Load**
**Scenario:** What if vault is switched but `loadBlocks()` isn't called?

**Mitigation:** All vault switch paths (`_activateVault`, `switchVault`, etc.) call `loadBlocks()`, which rebuilds the index.

### **Issue: Browser Crash During Save**
**Scenario:** App crashes after file write but before index update.

**Mitigation:** On next load, `loadBlocks()` reads from disk and rebuilds the index from scratch. The index is never persisted, so no stale data survives a crash.

### **Issue: Undo/Redo Missing Index Updates**
**Scenario:** Undo/redo operations modify blocks without updating index.

**Mitigation:** All undo/redo operations that affect tags call `saveBlock()`, which updates the index. Direct index updates are only needed for create/delete operations.

## Testing Recommendations

1. **Test vault switching** with different vaults to verify no stale data
2. **Test concurrent saves** to verify no index corruption
3. **Test with many blocks** (10,000+) to verify performance improvements
4. **Test failure paths** (disk full, permission errors) to verify index stays consistent
5. **Test validation** by introducing intentional bugs to verify errors are caught

## Monitoring

In development, add logging:
```javascript
console.log('TagIndex stats:', TagIndex.getStats());
```

After every vault load to verify index size matches expectations.