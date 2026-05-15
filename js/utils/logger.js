const Logger = {
    enabled: localStorage.getItem('noteview-debug') === 'true',
    enable() { this.enabled = true; localStorage.setItem('noteview-debug', 'true'); },
    disable() { this.enabled = false; localStorage.setItem('noteview-debug', 'false'); },
    log(...args) { if (this.enabled) console.log(...args); },
};
