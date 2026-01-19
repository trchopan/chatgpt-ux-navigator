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
        // Prefer plain text; some editors dislike innerHTML changes.
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
            // If InputEvent fails in edge cases, still keep content set.
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

            // Ensure focus + caret so paste goes to correct place
            moveCaretToEnd(el);

            // Try paste route (best compatibility)
            const dispatched = dispatchPaste(el, t);

            // Some editors ignore synthetic paste; ensure content is set anyway.
            // We do not attempt to detect success reliably (varies per editor).
            if (!dispatched) {
                fallbackInsertContenteditable(el, t);
            }

            return true;
        }

        return false;
    }

    window.CGPT_NAV.chatInput = {
        findChatInput,
        setChatInputText,
    };
})();
