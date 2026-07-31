// Service worker is intentionally NOT registered inside Capacitor:
// the APK already bundles every asset on-device, so the SW's offline cache
// is redundant and a stale SW inside a WebView is painful to debug.
if (!window.Platform?.isCapacitor && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js?v=0.6.1');

    // Automatically reload the page when the service worker updates and takes control
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
            refreshing = true;
            window.location.reload();
        }
    });
}
