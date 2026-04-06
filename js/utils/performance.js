/**
 * Performance utility functions
 */

/**
 * Debounce a function call
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle a function call
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
function throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Memoize a function call
 * @param {Function} func - Function to memoize
 * @param {Function} keyGenerator - Optional function to generate cache key from arguments
 * @returns {Function} Memoized function
 */
function memoize(func, keyGenerator = null) {
    const cache = new Map();
    return function executedFunction(...args) {
        const key = keyGenerator ? keyGenerator(...args) : JSON.stringify(args);
        if (cache.has(key)) {
            return cache.get(key);
        }
        const result = func.apply(this, args);
        cache.set(key, result);
        return result;
    };
}

/**
 * Create a memoized version of a function that invalidates its cache
 * when a dependency changes
 * @param {Function} func - Function to memoize
 * @param {Function} getDeps - Function that returns current dependencies
 * @returns {Function} Memoized function with automatic invalidation
 */
function createMemoizedWithDeps(func, getDeps) {
    let lastDeps = null;
    let cachedResult = null;

    return function executedFunction(...args) {
        const currentDeps = getDeps();
        const depsChanged = !lastDeps || JSON.stringify(currentDeps) !== JSON.stringify(lastDeps);

        if (depsChanged) {
            cachedResult = func.apply(this, args);
            lastDeps = currentDeps;
        }
        return cachedResult;
    };
}
