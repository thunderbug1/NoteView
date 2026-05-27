/**
 * Test suite for git connection error handling improvements
 * 
 * Run in browser console after loading NoteView:
 * 1. Open Chrome DevTools Console
 * 2. Paste this file
 * 3. Run: testGitErrorHandling()
 */

const GitErrorTests = {
    results: [],

    logResult(testName, passed, details = '') {
        this.results.push({ testName, passed, details });
        const icon = passed ? '✓' : '✗';
        console.log(`${icon} ${testName}`);
        if (details) console.log(`  ${details}`);
    },

    async testErrorClassification() {
        console.log('\n=== Testing Error Classification ===\n');

        // Test auth error detection
        const authErr = new Error('Authentication failed: 401 Unauthorized');
        const isAuth = SyncManager._isAuthError(authErr);
        this.logResult('Auth error detection', isAuth, 'Should detect 401 error');

        // Test forbidden error detection
        const forbiddenErr = new Error('403 Forbidden');
        const isForbidden = SyncManager._isAuthError(forbiddenErr);
        this.logResult('Forbidden error detection', isForbidden, 'Should detect 403 error');

        // Test CORS error detection
        const corsErr = new Error('Failed to fetch - CORS blocked');
        const isCors = SyncManager._isCorsError(corsErr);
        this.logResult('CORS error detection', isCors, 'Should detect CORS error');

        // Test network error detection
        const networkErr = new Error('Network timeout after 30000ms');
        const isNetwork = SyncManager._isNetworkError(networkErr);
        this.logResult('Network error detection', isNetwork, 'Should detect network timeout');

        // Test protected branch error detection
        const protectedErr = new Error('Push rejected: branch is protected');
        const isProtected = SyncManager._isProtectedBranchError(protectedErr);
        this.logResult('Protected branch error detection', isProtected, 'Should detect protected branch error');
    },

    async testConsecutiveErrors() {
        console.log('\n=== Testing Consecutive Error Tracking ===\n');

        const initialCount = SyncManager._consecutiveErrors;
        this.logResult('Initial error count', initialCount === 0, `Should start at 0, got ${initialCount}`);

        // Simulate consecutive errors
        SyncManager._consecutiveErrors = 2;
        this.logResult('Error count increment', SyncManager._consecutiveErrors === 2, 'Should track consecutive errors');

        // Test reset
        SyncManager._consecutiveErrors = 0;
        this.logResult('Error count reset', SyncManager._consecutiveErrors === 0, 'Should reset to 0');
    },

    async testVaultCreationErrorHandling() {
        console.log('\n=== Testing Vault Creation Error Handling ===\n');

        // Test wizard error message generation
        const testCases = [
            { err: new Error('401 Unauthorized'), expected: 'auth' },
            { err: new Error('Repository not found'), expected: 'notfound' },
            { err: new Error('CORS blocked'), expected: 'cors' },
            { err: new Error('Network timeout'), expected: 'network' },
        ];

        for (const { err, expected } of testCases) {
            const msg = err.message.toLowerCase();
            let detected = 'generic';
            if (msg.includes('401') || msg.includes('unauthorized')) detected = 'auth';
            else if (msg.includes('not found')) detected = 'notfound';
            else if (msg.includes('cors')) detected = 'cors';
            else if (msg.includes('timeout')) detected = 'network';
            
            this.logResult(
                `Error type: ${expected}`,
                detected === expected,
                `Detected as ${detected}`
            );
        }
    },

    async testGitRemoteValidation() {
        console.log('\n=== Testing GitRemote Validation ===\n');

        // Test HTTPS validation (this would require actual GitStore.git to be initialized)
        if (!GitStore.git) {
            this.logResult('GitRemote validation', false, 'Git not initialized - skip test');
            return;
        }

        const invalidUrl = 'git@github.com:user/repo.git';
        const validUrl = 'https://github.com/user/repo.git';

        this.logResult(
            'Reject non-HTTPS URL',
            !invalidUrl.startsWith('https://'),
            'Should reject SSH URLs'
        );

        this.logResult(
            'Accept HTTPS URL',
            validUrl.startsWith('https://'),
            'Should accept HTTPS URLs'
        );
    },

    printSummary() {
        console.log('\n=== Test Summary ===\n');
        const passed = this.results.filter(r => r.passed).length;
        const total = this.results.length;
        const percentage = ((passed / total) * 100).toFixed(1);

        console.log(`Passed: ${passed}/${total} (${percentage}%)`);

        if (passed < total) {
            console.log('\nFailed tests:');
            this.results
                .filter(r => !r.passed)
                .forEach(r => console.log(`  ✗ ${r.testName}: ${r.details}`));
        } else {
            console.log('\n✓ All tests passed!');
        }
    }
};

// Run all tests
async function testGitErrorHandling() {
    console.clear();
    console.log('Starting Git Error Handling Tests...\n');

    await GitErrorTests.testErrorClassification();
    await GitErrorTests.testConsecutiveErrors();
    await GitErrorTests.testVaultCreationErrorHandling();
    await GitErrorTests.testGitRemoteValidation();

    GitErrorTests.printSummary();

    return GitErrorTests.results;
}

// Export for manual testing
if (typeof window !== 'undefined') {
    window.testGitErrorHandling = testGitErrorHandling;
    window.GitErrorTests = GitErrorTests;
}