/**
 * Cache Manager - Standardized caching utilities
 * Provides consistent caching patterns across the application
 */

/**
 * Create a managed cache with key generation and validation
 * @param {Function} keyGenerator - Function that generates cache key from current state
 * @returns {Object} Cache object with get, set, invalidate, and isValid methods
 */
function createCache(keyGenerator) {
    let _cache = null;
    let _cacheKey = null;

    return {
        /**
         * Get the current cache value if valid
         * @returns {*} Cached value or null if cache is invalid/empty
         */
        get() {
            const currentKey = keyGenerator();
            if (_cache !== null && _cacheKey === currentKey) {
                return _cache;
            }
            return null;
        },

        /**
         * Set a cached value with the current key
         * @param {*} value - Value to cache
         */
        set(value) {
            _cache = value;
            _cacheKey = keyGenerator();
        },

        /**
         * Check if the current cache is still valid
         * @returns {boolean} True if cache exists and key matches
         */
        isValid() {
            return _cache !== null && _cacheKey === keyGenerator();
        },

        /**
         * Invalidate the cache
         */
        invalidate() {
            _cache = null;
            _cacheKey = null;
        },

        /**
         * Get the current cache key without accessing the cache
         * @returns {*} Current cache key
         */
        getCurrentKey() {
            return keyGenerator();
        }
    };
}

/**
 * Create a simple key-value cache without automatic validation
 * @returns {Object} Cache object with get, set, has, and clear methods
 */
function createSimpleCache() {
    const cache = new Map();

    return {
        /**
         * Get a value from the cache
         * @param {*} key - Cache key
         * @returns {*} Cached value or undefined if not found
         */
        get(key) {
            return cache.get(key);
        },

        /**
         * Set a value in the cache
         * @param {*} key - Cache key
         * @param {*} value - Value to cache
         */
        set(key, value) {
            cache.set(key, value);
        },

        /**
         * Check if a key exists in the cache
         * @param {*} key - Cache key
         * @returns {boolean} True if key exists in cache
         */
        has(key) {
            return cache.has(key);
        },

        /**
         * Clear the entire cache
         */
        clear() {
            cache.clear();
        },

        /**
         * Remove a specific key from the cache
         * @param {*} key - Cache key to remove
         */
        delete(key) {
            cache.delete(key);
        }
    };
}

// Export for use in other modules
window.CacheManager = {
    createCache,
    createSimpleCache
};
