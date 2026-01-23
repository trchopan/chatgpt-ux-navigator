(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};

    /**
     * Find the ChatGPT input box. Currently targets the ChatGPT “prompt-textarea” contenteditable.
     * Returns a descriptor so we can support other input types later if needed.
     * @returns {{ kind: 'contenteditable', el: HTMLElement } | null}
     */
    function findChatInput() {
        /** @type {HTMLElement|null} */
        const ce =
            /** ChatGPT primary target */
            /** @type {HTMLElement|null} */ (
                document.querySelector('[data-testid="prompt-textarea"][contenteditable="true"]')
            ) ||
            /** fallback: any contenteditable inside a form */
            /** @type {HTMLElement|null} */ (
                document.querySelector('form [contenteditable="true"]')
            ) ||
            /** fallback: any contenteditable on page (last resort) */
            /** @type {HTMLElement|null} */ (document.querySelector('[contenteditable="true"]'));

        if (ce) return {kind: 'contenteditable', el: ce};
        return null;
    }

    function normalizeText(text) {
        return String(text ?? '').replace(/\r\n/g, '\n');
    }

    /**
     * Place the caret at the end of a contenteditable element.
     * @param {HTMLElement} el
     */
    function moveCaretToEnd(el) {
        try {
            el.focus();

            const sel = window.getSelection();
            if (!sel) return;

            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        } catch (_) {
            // non-fatal
        }
    }

    /**
     * Attempt to insert via a synthetic paste event (works well with rich editors).
     * Returns whether the event was dispatched (not whether editor accepted it).
     * @param {HTMLElement} el
     * @param {string} text
     * @returns {boolean}
     */
    function dispatchPaste(el, text) {
        try {
            const dt = new DataTransfer();
            dt.setData('text/plain', text);

            const ev = new ClipboardEvent('paste', {
                clipboardData: dt,
                bubbles: true,
                cancelable: true,
            });

            el.dispatchEvent(ev);
            return true;
        } catch (_) {
            return false;
        }
    }

    /**
     * Fallback insertion for contenteditable.
     * Uses textContent and emits an input event.
     * @param {HTMLElement} el
     * @param {string} text
     */
    function fallbackInsertContenteditable(el, text) {
        el.textContent = text;

        try {
            el.dispatchEvent(
                new InputEvent('input', {
                    bubbles: true,
                    inputType: 'insertFromPaste',
                    data: text,
                })
            );
        } catch (_) {
            try {
                const ev = document.createEvent('Event');
                ev.initEvent('input', true, true);
                el.dispatchEvent(ev);
            } catch (_) {
                // ignore
            }
        }
    }

    /**
     * Set ChatGPT input text.
     * Returns false if input box cannot be found.
     * @param {string} text
     * @returns {boolean}
     */
    function setChatInputText(text) {
        const input = findChatInput();
        if (!input) return false;

        const t = normalizeText(text);

        if (input.kind === 'contenteditable') {
            const el = input.el;

            moveCaretToEnd(el);

            const dispatched = dispatchPaste(el, t);

            if (!dispatched) {
                fallbackInsertContenteditable(el, t);
            }

            return true;
        }

        return false;
    }

    /**
     * Best-effort submit of the current prompt.
     * Returns true if it *attempted* to submit (click or key event).
     * @returns {boolean}
     */
    function submitChatInput() {
        // Prefer clicking the send button if available
        const sendBtn =
            /** common on chatgpt.com */
            document.querySelector('button[data-testid="send-button"]') ||
            /** fallback: aria-labels */
            document.querySelector('button[aria-label="Send prompt"]') ||
            document.querySelector('button[aria-label="Send"]') ||
            document.querySelector('button[aria-label*="Send"]');

        if (sendBtn instanceof HTMLButtonElement) {
            // avoid clicking if disabled
            if (!sendBtn.disabled) {
                sendBtn.click();
                return true;
            }
        } else if (sendBtn instanceof HTMLElement) {
            // if it's not a button element, still try click
            sendBtn.click();
            return true;
        }

        // Fallback: dispatch Enter on the contenteditable
        const input = findChatInput();
        if (input?.kind === 'contenteditable') {
            const el = input.el;
            try {
                el.focus();
                const evDown = new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    bubbles: true,
                    cancelable: true,
                });
                el.dispatchEvent(evDown);

                const evUp = new KeyboardEvent('keyup', {
                    key: 'Enter',
                    code: 'Enter',
                    bubbles: true,
                    cancelable: true,
                });
                el.dispatchEvent(evUp);

                return true;
            } catch (_) {
                return false;
            }
        }

        return false;
    }

    window.CGPT_NAV.chatInput = {
        findChatInput,
        setChatInputText,
        submitChatInput,
    };
})();
