/**
 * Modal Utility - Simple modal creation and management
 */

/**
 * Create a modal overlay with content
 * @param {Object} options - Modal options
 * @param {string} options.title - Modal title
 * @param {string} options.content - HTML content for modal body
 * @param {string} options.headerContent - Optional custom header HTML (replaces default title)
 * @param {string} options.width - Optional width (e.g., '300px')
 * @param {string} options.overlayClass - Optional custom overlay class (default: 'tag-modal-overlay')
 * @param {string} options.modalClass - Optional custom modal class (default: 'tag-modal')
 * @param {Function} options.onClose - Optional callback when modal closes
 * @returns {Object} Modal element with close() method
 */
function createModal(options) {
    const {
        title = '',
        content = '',
        headerContent = null,
        width = '',
        overlayClass = 'tag-modal-overlay',
        modalClass = 'tag-modal',
        onClose = null
    } = options;

    const modal = document.createElement('div');
    modal.className = overlayClass;

    const widthStyle = width ? `width: ${width};` : '';

    // Use custom header if provided, otherwise use default title header
    const headerHtml = headerContent !== null
        ? headerContent
        : `
            <div class="tag-modal-header">
                <h3>${title}</h3>
                <button class="close-modal">&times;</button>
            </div>
        `;

    modal.innerHTML = `
        <div class="${modalClass}" style="${widthStyle}">
            ${headerHtml}
            <div class="tag-modal-body">
                ${content}
            </div>
        </div>
    `;

    const closeModal = () => {
        modal.remove();
        if (onClose) onClose();
    };

    // Try to find close button by common class names
    const closeBtn = modal.querySelector('.close-modal, .tl-modal-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeModal);
    }

    modal.addEventListener('click', e => {
        if (e.target === modal) closeModal();
    });

    document.body.appendChild(modal);

    // Return modal object with close method
    return {
        element: modal,
        close: closeModal,
        querySelector: (selector) => modal.querySelector(selector),
        querySelectorAll: (selector) => modal.querySelectorAll(selector)
    };
}

/**
 * Create a simple confirm dialog
 * @param {Object} options - Confirm options
 * @param {string} options.title - Dialog title
 * @param {string} options.message - Message to show
 * @param {string} options.confirmText - Text for confirm button
 * @param {string} options.cancelText - Text for cancel button
 * @returns {Promise<boolean>} Promise that resolves to true if confirmed
 */
function createConfirm(options) {
    const {
        title = 'Confirm',
        message = '',
        confirmText = 'Confirm',
        cancelText = 'Cancel'
    } = options;

    return new Promise((resolve) => {
        const modal = createModal({
            title,
            content: `
                <p style="margin-bottom: 20px;">${message}</p>
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button class="modal-cancel-btn" style="padding: 8px 16px; background: transparent; border: 1px solid var(--border); border-radius: 4px; cursor: pointer;">${cancelText}</button>
                    <button class="modal-confirm-btn" style="padding: 8px 16px; background: var(--accent, #3b82f6); color: white; border: none; border-radius: 4px; cursor: pointer;">${confirmText}</button>
                </div>
            `,
            onClose: () => resolve(false)
        });

        modal.querySelector('.modal-confirm-btn').addEventListener('click', () => {
            modal.close();
            resolve(true);
        });

        modal.querySelector('.modal-cancel-btn').addEventListener('click', () => {
            modal.close();
            resolve(false);
        });
    });
}

/**
 * Create a prompt dialog
 * @param {Object} options - Prompt options
 * @param {string} options.title - Dialog title
 * @param {string} options.message - Message to show
 * @param {string} options.placeholder - Input placeholder text
 * @param {string} options.defaultValue - Default input value
 * @returns {Promise<string|null>} Promise that resolves to input value or null if cancelled
 */
function createPrompt(options) {
    const {
        title = 'Input',
        message = '',
        placeholder = '',
        defaultValue = ''
    } = options;

    return new Promise((resolve) => {
        const modal = createModal({
            title,
            content: `
                <p style="margin-bottom: 10px;">${message}</p>
                <input type="text" class="modal-prompt-input" placeholder="${placeholder}" value="${defaultValue}" style="width: 100%; padding: 8px; box-sizing: border-box; border: 1px solid var(--border); border-radius: 4px; margin-bottom: 15px;">
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button class="modal-cancel-btn" style="padding: 8px 16px; background: transparent; border: 1px solid var(--border); border-radius: 4px; cursor: pointer;">Cancel</button>
                    <button class="modal-confirm-btn" style="padding: 8px 16px; background: var(--accent, #3b82f6); color: white; border: none; border-radius: 4px; cursor: pointer;">OK</button>
                </div>
            `,
            onClose: () => resolve(null)
        });

        const input = modal.querySelector('.modal-prompt-input');
        setTimeout(() => input.focus(), 10);

        const submit = () => {
            const value = input.value.trim();
            modal.close();
            resolve(value || null);
        };

        modal.querySelector('.modal-confirm-btn').addEventListener('click', submit);
        modal.querySelector('.modal-cancel-btn').addEventListener('click', () => {
            modal.close();
            resolve(null);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') {
                modal.close();
                resolve(null);
            }
        });
    });
}

// Export for use in other modules
window.Modal = {
    create: createModal,
    confirm: createConfirm,
    prompt: createPrompt
};
