const TagIndex = {
  // Map<tag, Set<blockId>> - inverted index
  tagToBlocks: new Map(),
  
  // Map<group, Set<blockId>> - for path:* filtering
  groupToBlocks: new Map(),
  
  // Set<blockId> - blocks with no tags
  untaggedBlocks: new Set(),
  
  // Map<blockId, Set<tag>> - reverse lookup
  blocksByTag: new Map(),
  
  // Map<blockId, Map<tag, {segments, leaf, full}>> - parsed tag segments
  parsedTags: new Map(),

  // Map<todoType, Set<blockId>> - for fast Todo.* computed tag filtering
  todoToBlocks: new Map(),

  // For validation: reference to blocks array
  _blocksRef: null,
  
  /**
   * Initialize index from an array of blocks
   */
  init(blocks, options = {}) {
    this.clear();
    this._blocksRef = blocks;
    blocks.forEach(block => this.addBlock(block));
    if (!options.skipValidate || Logger.enabled) {
      this.validate();
    }
  },
  
  /**
   * Clear all indexes
   */
  clear() {
    this.tagToBlocks.clear();
    this.groupToBlocks.clear();
    this.untaggedBlocks.clear();
    this.blocksByTag.clear();
    this.parsedTags.clear();
    this.todoToBlocks.clear();
    this._blocksRef = null;
  },
  
  /**
   * Validate index consistency with blocks array
   * Throws if inconsistencies found
   */
  validate() {
    if (!this._blocksRef) {
      console.warn('TagIndex.validate: no blocks reference');
      return;
    }

    const blocks = this._blocksRef;
    const errors = [];

    // Check every block is in the index
    for (const block of blocks) {
      const blockId = block.id;
      const tags = block.tags || [];

      // Check blocksByTag
      const indexedTags = this.blocksByTag.get(blockId);
      if (!indexedTags) {
        errors.push(`Block ${blockId} missing from blocksByTag`);
        continue;
      }

      // Check tag counts match
      if (indexedTags.size !== tags.length) {
        errors.push(`Block ${blockId} tag count mismatch: ${indexedTags.size} vs ${tags.length}`);
      }

      // Check each tag is in tagToBlocks
      for (const tag of tags) {
        const blockSet = this.tagToBlocks.get(tag);
        if (!blockSet || !blockSet.has(blockId)) {
          errors.push(`Block ${blockId} missing from tagToBlocks[${tag}]`);
        }

        // Check parsedTags
        const parsed = this.parsedTags.get(blockId)?.get(tag);
        if (!parsed) {
          errors.push(`Block ${blockId} missing parsed tag for ${tag}`);
        }

        // Check group index for hierarchical tags
        const tagParsed = window.Common.parseHierarchicalTag(tag);
        if (tagParsed.segments.length > 0) {
          const group = tagParsed.segments[0];
          const groupSet = this.groupToBlocks.get(group);
          if (!groupSet || !groupSet.has(blockId)) {
            errors.push(`Block ${blockId} missing from groupToBlocks[${group}] for tag ${tag}`);
          }
        }
      }

      // Check untagged status
      const isUntagged = tags.length === 0;
      if (isUntagged && !this.untaggedBlocks.has(blockId)) {
        errors.push(`Untagged block ${blockId} missing from untaggedBlocks`);
      }
      if (!isUntagged && this.untaggedBlocks.has(blockId)) {
        errors.push(`Tagged block ${blockId} should not be in untaggedBlocks`);
      }
    }

    // Check for orphaned entries in tagToBlocks
    const allBlockIds = new Set(blocks.map(b => b.id));
    for (const [tag, blockSet] of this.tagToBlocks) {
      for (const blockId of blockSet) {
        if (!allBlockIds.has(blockId)) {
          errors.push(`Orphaned block ${blockId} in tagToBlocks[${tag}]`);
        }
      }
    }

    // Check for orphaned entries in groupToBlocks
    for (const [group, blockSet] of this.groupToBlocks) {
      for (const blockId of blockSet) {
        if (!allBlockIds.has(blockId)) {
          errors.push(`Orphaned block ${blockId} in groupToBlocks[${group}]`);
        }
      }
    }

    // Check for orphaned entries in blocksByTag
    for (const blockId of this.blocksByTag.keys()) {
      if (!allBlockIds.has(blockId)) {
        errors.push(`Orphaned block ${blockId} in blocksByTag`);
      }
    }

    // Check for orphaned entries in untaggedBlocks
    for (const blockId of this.untaggedBlocks) {
      if (!allBlockIds.has(blockId)) {
        errors.push(`Orphaned block ${blockId} in untaggedBlocks`);
      }
    }

    if (errors.length > 0) {
      console.error('TagIndex validation errors:', errors);
      throw new Error(`TagIndex validation failed: ${errors.join('; ')}`);
    }
  },
  
  /**
   * Add a block to all indexes
   */
  addBlock(block) {
    const { id, tags = [] } = block;
    
    // Track tags for this block
    this.blocksByTag.set(id, new Set(tags));
    
    // Track task status for Todo.* computed tags
    if (window.TaskParser) {
        if (block.content && block.content.match(/\[[ \/]\]/)) {
            this._addToTodoIndex('Todo.anyOpen', id);
        }
        
        const tasks = window.TaskParser.parseTasksFromBlock(block);
        if (tasks.length > 0) {
            this._addToTodoIndex('Todo.all', id);
            if (tasks.some(t => window.TaskParser.isOpenTask(t))) this._addToTodoIndex('Todo.open', id);
            if (tasks.some(t => window.TaskParser.isDoneTask(t))) this._addToTodoIndex('Todo.done', id);
            if (tasks.some(t => window.TaskParser.isBlockedTask(t))) this._addToTodoIndex('Todo.blocked', id);
            if (tasks.some(t => window.TaskParser.isInProgressTask(t))) this._addToTodoIndex('Todo.inProgress', id);
            if (tasks.some(t => window.TaskParser.isCanceledTask(t))) this._addToTodoIndex('Todo.canceled', id);
            if (tasks.some(t => window.TaskParser.isUnblockedTask(t))) this._addToTodoIndex('Todo.unblocked', id);
            if (window.TaskParser.hasUnassignedTasks(tasks)) this._addToTodoIndex('Todo.unassigned', id);
        }
    }

    if (tags.length === 0) {
      this.untaggedBlocks.add(id);
      return;
    }
    
    tags.forEach(tag => {
      // Add to inverted index
      if (!this.tagToBlocks.has(tag)) {
        this.tagToBlocks.set(tag, new Set());
      }
      this.tagToBlocks.get(tag).add(id);
      
      // Parse hierarchical tag and add to group index
      const parsed = window.Common.parseHierarchicalTag(tag);
      if (parsed.segments.length > 0) {
        const group = parsed.segments[0];
        if (!this.groupToBlocks.has(group)) {
          this.groupToBlocks.set(group, new Set());
        }
        this.groupToBlocks.get(group).add(id);
      }
      
      // Cache parsed segments
      if (!this.parsedTags.has(id)) {
        this.parsedTags.set(id, new Map());
      }
      this.parsedTags.get(id).set(tag, parsed);
    });
  },
  
  /**
   * Remove a block from all indexes
   */
  removeBlock(blockId) {
    const tags = this.blocksByTag.get(blockId);
    
    if (!tags) {
      this.untaggedBlocks.delete(blockId);
      return;
    }
    
    tags.forEach(tag => {
      // Remove from inverted index
      const blockSet = this.tagToBlocks.get(tag);
      if (blockSet) {
        blockSet.delete(blockId);
        if (blockSet.size === 0) {
          this.tagToBlocks.delete(tag);
        }
      }
      
      // Remove from group index
      const parsed = this.parsedTags.get(blockId)?.get(tag);
      if (parsed && parsed.segments.length > 0) {
        const group = parsed.segments[0];
        const groupSet = this.groupToBlocks.get(group);
        if (groupSet) {
          groupSet.delete(blockId);
          if (groupSet.size === 0) {
            this.groupToBlocks.delete(group);
          }
        }
      }
    });
    
    this.blocksByTag.delete(blockId);
    this.parsedTags.delete(blockId);
    this.untaggedBlocks.delete(blockId);

    for (const set of this.todoToBlocks.values()) {
        set.delete(blockId);
    }
  },
  
  /**
   * Update a block's tags in indexes (call after save)
   */
  updateBlockTags(blockId, oldTags, newTags) {
    const oldTagSet = new Set(oldTags);
    const newTagSet = new Set(newTags);
    
    // Remove tags that are no longer present
    oldTags.forEach(tag => {
      if (!newTagSet.has(tag)) {
        this.removeTagFromBlock(blockId, tag);
      }
    });
    
    // Add new tags
    newTags.forEach(tag => {
      if (!oldTagSet.has(tag)) {
        this.addTagToBlock(blockId, tag);
      }
    });
    
    // Update untagged status
    if (newTags.length === 0 && oldTags.length > 0) {
      this.untaggedBlocks.add(blockId);
    } else if (newTags.length > 0 && oldTags.length === 0) {
      this.untaggedBlocks.delete(blockId);
    }
  },

  /**
   * Update a block's content in indexes (call after save if content changed)
   */
  updateBlockContent(blockId, content) {
    // For now, simpler to just re-add the block's todo info
    // First remove from all todo sets
    for (const set of this.todoToBlocks.values()) {
        set.delete(blockId);
    }
    
    // Then re-evaluate
    if (window.TaskParser) {
        if (content && content.match(/\[[ \/]\]/)) {
            this._addToTodoIndex('Todo.anyOpen', blockId);
        }
        
        // Create a temporary block-like object for TaskParser
        const tasks = window.TaskParser.parseTasksFromContent(content, blockId);
        if (tasks.length > 0) {
            this._addToTodoIndex('Todo.all', blockId);
            if (tasks.some(t => window.TaskParser.isOpenTask(t))) this._addToTodoIndex('Todo.open', blockId);
            if (tasks.some(t => window.TaskParser.isDoneTask(t))) this._addToTodoIndex('Todo.done', blockId);
            if (tasks.some(t => window.TaskParser.isBlockedTask(t))) this._addToTodoIndex('Todo.blocked', blockId);
            if (tasks.some(t => window.TaskParser.isInProgressTask(t))) this._addToTodoIndex('Todo.inProgress', blockId);
            if (tasks.some(t => window.TaskParser.isCanceledTask(t))) this._addToTodoIndex('Todo.canceled', blockId);
            if (tasks.some(t => window.TaskParser.isUnblockedTask(t))) this._addToTodoIndex('Todo.unblocked', blockId);
            if (window.TaskParser.hasUnassignedTasks(tasks)) this._addToTodoIndex('Todo.unassigned', blockId);
        }
    }
  },

  /**
   * Add a single tag to a block (helper for incremental updates)
   */
  addTagToBlock(blockId, tag) {
    // Update reverse lookup
    if (!this.blocksByTag.has(blockId)) {
      this.blocksByTag.set(blockId, new Set());
    }
    this.blocksByTag.get(blockId).add(tag);
    
    // Remove from untagged set
    this.untaggedBlocks.delete(blockId);
    
    // Add to inverted index
    if (!this.tagToBlocks.has(tag)) {
      this.tagToBlocks.set(tag, new Set());
    }
    this.tagToBlocks.get(tag).add(blockId);
    
    // Add to group index
    const parsed = window.Common.parseHierarchicalTag(tag);
    if (parsed.segments.length > 0) {
      const group = parsed.segments[0];
      if (!this.groupToBlocks.has(group)) {
        this.groupToBlocks.set(group, new Set());
      }
      this.groupToBlocks.get(group).add(blockId);
    }
    
    // Cache parsed segments
    if (!this.parsedTags.has(blockId)) {
      this.parsedTags.set(blockId, new Map());
    }
    this.parsedTags.get(blockId).set(tag, parsed);
  },
  
  /**
   * Remove a single tag from a block (helper for incremental updates)
   */
  removeTagFromBlock(blockId, tag) {
    // Update reverse lookup
    const tags = this.blocksByTag.get(blockId);
    if (tags) {
      tags.delete(tag);
      if (tags.size === 0) {
        this.blocksByTag.delete(blockId);
        this.untaggedBlocks.add(blockId);
      }
    }
    
    // Remove from inverted index
    const blockSet = this.tagToBlocks.get(tag);
    if (blockSet) {
      blockSet.delete(blockId);
      if (blockSet.size === 0) {
        this.tagToBlocks.delete(tag);
      }
    }
    
    // Remove from group index
    const parsed = this.parsedTags.get(blockId)?.get(tag);
    if (parsed && parsed.segments.length > 0) {
      const group = parsed.segments[0];
      const groupSet = this.groupToBlocks.get(group);
      if (groupSet) {
        groupSet.delete(blockId);
        if (groupSet.size === 0) {
          this.groupToBlocks.delete(group);
        }
      }
    }
    
    // Remove from cache
    if (this.parsedTags.has(blockId)) {
      this.parsedTags.get(blockId).delete(tag);
    }
  },
  
  /**
   * Get all blocks with a specific tag (Set intersection for AND logic)
   */
  getBlocksWithTag(tag) {
    return this.tagToBlocks.get(tag) || new Set();
  },
  
  /**
   * Get all blocks with ALL specified tags (AND logic)
   */
  getBlocksWithTags(tags) {
    if (tags.length === 0) return null;
    if (tags.length === 1) return this.getBlocksWithTag(tags[0]);
    
    // Find the smallest set to minimize intersection work
    let result = this.getBlocksWithTag(tags[0]);
    for (let i = 1; i < tags.length; i++) {
      const tagSet = this.getBlocksWithTag(tags[i]);
      // Early exit if any tag has no matches
      if (tagSet.size === 0) return new Set();
      result = new Set([...result].filter(x => tagSet.has(x)));
    }
    return result;
  },
  
  /**
   * Get all blocks that DON'T have any of the specified tags
   */
  getBlocksWithoutTags(tags) {
    if (tags.length === 0) return null;
    
    const excludedSet = new Set();
    tags.forEach(tag => {
      const blockSet = this.tagToBlocks.get(tag);
      if (blockSet) {
        blockSet.forEach(id => excludedSet.add(id));
      }
    });
    
    return excludedSet;
  },
  
  /**
   * Get all blocks with tags in a specific group (for path:* filtering)
   */
  getBlocksWithTagGroup(group) {
    return this.groupToBlocks.get(group) || new Set();
  },
  
  /**
   * Get all blocks matching a Todo.* computed status
   */
  getBlocksWithTodo(todoType) {
    return this.todoToBlocks.get(todoType) || new Set();
  },

  /**
   * Get count of blocks for a specific Todo.* status
   */
  getTodoCount(todoType) {
    return this.todoToBlocks.get(todoType)?.size || 0;
  },

  /**
   * Internal helper to add a block to the todo index
   */
  _addToTodoIndex(type, blockId) {
    if (!this.todoToBlocks.has(type)) {
      this.todoToBlocks.set(type, new Set());
    }
    this.todoToBlocks.get(type).add(blockId);
  },
  
  /**
   * Check if a block is untagged
   */
  isBlockUntagged(blockId) {
    return this.untaggedBlocks.has(blockId);
  },
  
  /**
   * Get parsed tag segments for a block's tag
   */
  getParsedTag(blockId, tag) {
    return this.parsedTags.get(blockId)?.get(tag);
  },
  
  /**
   * Get all tags for a block
   */
  getBlockTags(blockId) {
    return this.blocksByTag.get(blockId) || new Set();
  },
  
  /**
   * Get count of blocks with a specific tag
   */
  getTagCount(tag) {
    return this.tagToBlocks.get(tag)?.size || 0;
  },
  
  /**
   * Get all unique tags in the vault
   */
  getAllTags() {
    return Array.from(this.tagToBlocks.keys());
  },
  
  /**
   * Get all unique tag groups
   */
  getAllGroups() {
    return Array.from(this.groupToBlocks.keys());
  },
  
  /**
   * Debug: Get index statistics
   */
  getStats() {
    return {
      totalTags: this.tagToBlocks.size,
      totalGroups: this.groupToBlocks.size,
      untaggedBlocks: this.untaggedBlocks.size,
      totalBlocks: this.blocksByTag.size
    };
  },

  /**
   * Manually rebuild index from current Store.blocks
   * Call this if you suspect index corruption
   */
  rebuild() {
    if (!window.Store?.blocks) {
      console.error('TagIndex.rebuild: Store not available');
      return;
    }
    console.log('TagIndex: Rebuilding from', window.Store.blocks.length, 'blocks');
    this.init(window.Store.blocks);
    console.log('TagIndex: Rebuild complete', this.getStats());
  },

  /**
   * Log index stats to console for debugging
   */
  logStats() {
    const stats = this.getStats();
    console.log('TagIndex stats:', stats);
    return stats;
  }
};

window.TagIndex = TagIndex;