/**
 * FloatingMenu — Shared utility for creating positioned floating menus
 * with close-on-outside-click, Escape key, and proper cleanup.
 */
window.FloatingMenu = {
    /**
     * Create and show a floating menu.
     * @param {Object} opts
     * @param {string} opts.className — CSS class for the menu element (also used to remove previous instances)
     * @param {HTMLElement} opts.anchor — Element to position near
     * @param {string|HTMLElement} opts.content — HTML string or element for menu body
     * @param {Function} [opts.onClose] — Called when menu closes (outside click, Escape)
     * @param {Object} [opts.position] — Override positioning: { left, top }
     * @param {boolean} [opts.closeOnClick=true] — Close on click outside
     * @param {boolean} [opts.closeOnEscape=true] — Close on Escape key
     * @param {boolean} [opts.closeOnScroll=true] — Close on window scroll
     * @returns {{ menu: HTMLElement, close: Function }}
     */
    create({ className, anchor, content, onClose, position, closeOnClick = true, closeOnEscape = true, closeOnScroll = true }) {
        // Remove any existing menu of the same type
        document.querySelector(`.${className}`)?.remove();

        const menu = document.createElement('div');
        menu.className = className;

        if (typeof content === 'string') {
            menu.innerHTML = content;
        } else if (content instanceof HTMLElement) {
            menu.appendChild(content);
        }

        document.body.appendChild(menu);

        // Position near anchor
        if (position) {
            menu.style.left = position.left + 'px';
            menu.style.top = position.top + 'px';
        } else if (anchor) {
            const rect = anchor.getBoundingClientRect();
            menu.style.left = rect.left + 'px';
            menu.style.top = (rect.bottom + 4) + 'px';
        }
        menu.style.position = 'fixed';
        menu.style.zIndex = '1000';

        let closed = false;
        function close() {
            if (closed) return;
            closed = true;
            menu.remove();
            if (closeOnClick) {
                document.removeEventListener('mousedown', handleOutside);
            }
            if (closeOnEscape) document.removeEventListener('keydown', handleEscape);
            if (closeOnScroll) window.removeEventListener('scroll', handleScroll, true);
            if (onClose) onClose();
        }

        function handleOutside(e) {
            if (!menu.contains(e.target)) close();
        }

        function handleEscape(e) {
            if (e.key === 'Escape') {
                e.stopPropagation();
                close();
            }
        }

        function handleScroll(e) {
            if (!menu.contains(e.target)) close();
        }

        if (closeOnClick) {
            document.addEventListener('mousedown', handleOutside);
        }
        if (closeOnEscape) document.addEventListener('keydown', handleEscape);
        if (closeOnScroll) window.addEventListener('scroll', handleScroll, true);

        return { menu, close };
    }
};
