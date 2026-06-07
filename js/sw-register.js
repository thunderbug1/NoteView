if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js?v=50');

    // Automatically reload the page when the service worker updates and takes control
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
            refreshing = true;
            window.location.reload();
        }
    });
}
