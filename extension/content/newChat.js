(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    /**
     * Wait for a function to return a truthy value (polling).
     * @template T
     * @param {() => T} fn
     * @param {{timeoutMs?: number, intervalMs?: number}} opts
     * @returns {Promise<T|null>}
     */
    async function waitFor(fn, opts = {}) {
        const timeoutMs = opts.timeoutMs ?? 8000;
        const intervalMs = opts.intervalMs ?? 120;

        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                const v = fn();
                if (v) return v;
            } catch (_) {
                // ignore transient DOM errors
            }
            await sleep(intervalMs);
        }
        return null;
    }

    /**
     * Find and click the "New chat" control (best-effort).
     * @returns {boolean}
     */
    function clickNewChatButton() {
        // Common selectors across chatgpt.com variants
        const candidates = [
            '[data-testid="create-new-chat-button"',
            'button[aria-label="New chat"]',
            'a[aria-label="New chat"]',
            'button[aria-label*="New chat"]',
            'a[aria-label*="New chat"]',
        ];

        for (const sel of candidates) {
            const el = document.querySelector(sel);
            if (el instanceof HTMLElement) {
                el.click();
                return true;
            }
        }

        // Fallback: scan clickable elements for visible text
        const clickables = Array.from(document.querySelectorAll('button, a, [role="button"]'));
        for (const el of clickables) {
            if (!(el instanceof HTMLElement)) continue;
            const t = (el.innerText || el.textContent || '').trim().toLowerCase();
            if (t === 'new chat' || t === 'new') {
                el.click();
                return true;
            }
        }

        return false;
    }

    /**
     * Determines the specific state for temporary chat based on known aria-labels
     * or falls back to generic toggle state detection.
     * @param {HTMLElement} el
     * @returns {boolean|null}
     */
    function getTemporaryChatToggleState(el) {
        if (!(el instanceof HTMLElement)) return null;

        if (el.ariaLabel === 'Turn off temporary chat') {
            return true; // Temporary chat is ON
        }
        if (el.ariaLabel === 'Turn on temporary chat') {
            return false; // Temporary chat is OFF
        }
        // Fallback to generic toggle state detection for other elements/labels
        return getToggleState(el);
    }

    /**
     * Return tri-state for a toggle-like element:
     * - true: definitely ON
     * - false: definitely OFF
     * - null: unknown
     * @param {Element} el
     * @returns {boolean|null}
     */
    function getToggleState(el) {
        if (!(el instanceof Element)) return null;

        // If it's a real checkbox input
        if (el instanceof HTMLInputElement && el.type === 'checkbox') {
            return !!el.checked;
        }

        // aria-checked is authoritative for switches/checkbox-like roles
        const ariaChecked = el.getAttribute('aria-checked');
        if (ariaChecked === 'true') return true;
        if (ariaChecked === 'false') return false;

        // aria-pressed is authoritative for toggle buttons
        const ariaPressed = el.getAttribute('aria-pressed');
        if (ariaPressed === 'true') return true;
        if (ariaPressed === 'false') return false;

        // Common attribute used by headless UI / radix
        const dataState = el.getAttribute('data-state');
        if (dataState === 'checked' || dataState === 'on' || dataState === 'open') return true;
        if (dataState === 'unchecked' || dataState === 'off' || dataState === 'closed')
            return false;

        // If it contains an input checkbox inside, use that
        const innerCb = el.querySelector?.('input[type="checkbox"]');
        if (innerCb instanceof HTMLInputElement) return !!innerCb.checked;

        // Unknown: do NOT guess via class names (too risky; causes flips)
        return null;
    }

    /**
     * Best-effort: find a Temporary Chat toggle/switch/button and enable it.
     * Returns true if it believes the UI is now in temporary mode.
     * @returns {Promise<boolean>}
     */
    async function ensureTemporaryChatEnabled() {
        // Wait for the prompt input to exist as a sign the page is ready
        const prompt = await waitFor(
            () =>
                document.querySelector('[data-testid="prompt-textarea"][contenteditable="true"]') ||
                document.querySelector('form [contenteditable="true"]'),
            {timeoutMs: 12000}
        );

        if (!prompt) return false;

        // Give UI a beat to mount header/toolbars around composer
        await sleep(250);

        const selectors = [
            // Specific aria-labels for on/off state (most reliable)
            'button[aria-label="Turn off temporary chat"]', // Indicates temporary chat is currently ON
            'button[aria-label="Turn on temporary chat"]', // Indicates temporary chat is currently OFF

            // switches
            '[role="switch"][aria-label*="Temporary"]',
            '[role="switch"][aria-label*="temporary"]',
            // toggle buttons
            'button[aria-label*="Temporary"]',
            'button[aria-label*="temporary"]',
            'button[data-testid*="temporary"]',
            'button[data-testid*="Temporary"]',
            // sometimes the clickable is the label wrapper
            '[role="button"][aria-label*="Temporary"]',
            '[role="button"][aria-label*="temporary"]',
        ];

        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (!(el instanceof HTMLElement)) continue;

            // Use the specialized function to get the state
            const state = getTemporaryChatToggleState(el);

            // Only click if we can prove it's OFF.
            // If unknown, do nothing to avoid toggling OFF accidentally.
            if (state === false) {
                el.click();
                await sleep(200);

                // Re-check if possible using the specialized function
                const after = getTemporaryChatToggleState(el);
                if (after === true) return true;

                // If still unknown, we at least attempted once.
                return true;
            }

            // If it's already ON, return success.
            if (state === true) return true;

            // state === null => unknown: do not click; continue searching
        }

        // Fallback: search buttons/role=button by visible text
        const clickables = Array.from(document.querySelectorAll('button, [role="button"]'));
        for (const el of clickables) {
            if (!(el instanceof HTMLElement)) continue;

            const txt = (el.innerText || el.textContent || '').trim();
            const low = txt.toLowerCase();

            if (low === 'temporary' || low.includes('temporary chat') || low === 'temporary chat') {
                const state = getToggleState(el);

                // Same rule: only click if definitely OFF
                if (state === false) {
                    el.click();
                    await sleep(200);
                    return true;
                }

                if (state === true) return true;

                // unknown -> do nothing (avoid accidental OFF)
            }
        }

        // If we can't find a reliable control or state, do not click anything.
        return false;
    }

    /**
     * Public API: start a new chat and attempt to enable temporary chat.
     * @returns {Promise<{ok:boolean, temp:boolean, error?:string}>}
     */
    async function startNewTemporaryChat() {
        const clicked = clickNewChatButton();
        if (!clicked) {
            return {ok: false, temp: false, error: 'Could not find the “New chat” button.'};
        }

        // Wait a moment for navigation/transition
        await sleep(1500);

        const tempOk = await ensureTemporaryChatEnabled();
        return {ok: true, temp: tempOk};
    }

    window.CGPT_NAV.newChat = {
        startNewTemporaryChat,
    };
})();
