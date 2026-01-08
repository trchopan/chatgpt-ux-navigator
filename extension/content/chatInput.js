// extension/content/chatInput.js
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
            /** @type {HTMLElement|null} */ (
                document.querySelector('[data-testid="prompt-textarea"][contenteditable="true"]')
            ) ||
            /** @type {HTMLElement|null} */ (
                document.querySelector('form [contenteditable="true"]')
            );

        if (ce) return {kind: 'contenteditable', el: ce};
        return null;
    }

    /**
     * Attempt to insert via a synthetic paste event (works well with rich editors).
     * @param {HTMLElement} el
     * @param {string} text
     * @returns {boolean}
     */
    function insertViaPaste(el, text) {
        try {
            const dt = new DataTransfer();
            dt.setData('text/plain', text);

            const ev = new ClipboardEvent('paste', {
                clipboardData: dt,
                bubbles: true,
                cancelable: true,
            });

            return el.dispatchEvent(ev);
        } catch (_) {
            return false;
        }
    }

    /**
     * Fallback insertion for contenteditable: create <p> lines and emit an input event.
     * @param {HTMLElement} el
     * @param {string} text
     */
    function fallbackInsertAsParagraphs(el, text) {
        el.innerHTML = '';
        const lines = (text || '').split('\n');

        for (const line of lines) {
            const p = document.createElement('p');
            // Preserve empty lines
            p.textContent = line === '' ? '\u00A0' : line;
            el.appendChild(p);
        }

        el.dispatchEvent(
            new InputEvent('input', {
                bubbles: true,
                inputType: 'insertFromPaste',
                data: text,
            })
        );
    }

    /**
     * Place the caret at the end of the contenteditable element.
     * @param {HTMLElement} el
     */
    function moveCaretToEnd(el) {
        el.focus();

        const sel = window.getSelection();
        if (!sel) return;

        try {
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        } catch (_) {
            // Non-fatal; some editors may throw in edge cases.
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

        const t = (text ?? '').replace(/\r\n/g, '\n');

        if (input.kind === 'contenteditable') {
            const el = input.el;

            moveCaretToEnd(el);

            const pasted = insertViaPaste(el, t);
            if (!pasted) {
                fallbackInsertAsParagraphs(el, t);
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
