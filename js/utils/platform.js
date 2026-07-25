/**
 * Platform - Runtime environment detection.
 *
 * Distinguishes the browser PWA context from the Capacitor Android/iOS app
 * shell. Capacitor injects `window.Capacitor` when running inside its native
 * WebView; we use that to gate features that depend on APIs not supported in
 * WebView (File System Access pickers, optionally Web Speech).
 *
 * All accessors are getters so changes to window.Capacitor at runtime are
 * reflected — no stale snapshots.
 */
window.Platform = {
    /** True when running inside the Capacitor native shell (Android or iOS). */
    get isCapacitor() {
        return typeof window.Capacitor !== 'undefined'
            && typeof window.Capacitor.isNativePlatform === 'function'
            && window.Capacitor.isNativePlatform();
    },

    /** True when running inside the Capacitor Android shell. */
    get isAndroid() {
        if (!this.isCapacitor) return false;
        try {
            return window.Capacitor.getPlatform() === 'android';
        } catch (e) {
            return false;
        }
    },

    /** True when running inside the Capacitor iOS shell. */
    get isIOS() {
        if (!this.isCapacitor) return false;
        try {
            return window.Capacitor.getPlatform() === 'ios';
        } catch (e) {
            return false;
        }
    },

    /** True when running as a regular web page (not inside Capacitor). */
    get isBrowser() {
        return !this.isCapacitor;
    },

    /**
     * True when the File System Access API folder picker is available.
     * `showDirectoryPicker` is a Chromium-browser-only API and is NOT
     * supported in Android/iOS WebView. Use this to gate any UI that lets
     * users pick an external folder.
     */
    get supportsFileSystemPicker() {
        return this.isBrowser && typeof window.showDirectoryPicker === 'function';
    }
};
