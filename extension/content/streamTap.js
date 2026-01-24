(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};
    const NS = 'CGPT_NAV_STREAM_TAP';

    const {store} = window.CGPT_NAV;

    // ---------- WebSocket forwarder (content-script world) ----------
    const WS_URL = 'ws://localhost:8765/ws';
    let ws = null;
    let wsOpen = false;
    let reconnectTimer = null;
    let backoffMs = 300;

    let enabled = false;
    let pageHookInjected = false;

    // Prompt queue to serialize "new chat -> inject -> submit"
    /** @type {Array<{id?:string, created?:number, input:string}>} */
    const promptQueue = [];
    let promptProcessing = false;

    function safeJsonStringify(obj) {
        try {
            return JSON.stringify(obj);
        } catch (_) {
            return JSON.stringify({type: 'error', error: 'Could not stringify payload'});
        }
    }

    function scheduleReconnect() {
        if (!enabled) return;
        if (reconnectTimer) return;

        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            backoffMs = Math.min(backoffMs * 2, 8000);
            connectWs();
        }, backoffMs);
    }

    function connectWs() {
        if (!enabled) return;

        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        try {
            ws = new WebSocket(WS_URL);
        } catch (_) {
            scheduleReconnect();
            return;
        }

        ws.onopen = () => {
            wsOpen = true;
            backoffMs = 300;
            ws.send(
                safeJsonStringify({
                    type: 'hello',
                    source: 'cgpt-nav',
                    at: Date.now(),
                })
            );
        };

        // ----------------------------
        // helpers for queued prompt processing
        // ----------------------------
        function sleep(ms) {
            return new Promise(r => setTimeout(r, ms));
        }

        /**
         * Wait until fn() returns truthy, or timeout.
         * @template T
         * @param {() => T} fn
         * @param {{timeoutMs?: number, intervalMs?: number}} [opts]
         * @returns {Promise<T|null>}
         */
        async function waitFor(fn, opts = {}) {
            const timeoutMs = opts.timeoutMs ?? 12_000;
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

        async function ensureComposerReady() {
            // Prefer your chatInput finder if present; otherwise DOM fallback
            const ok = await waitFor(() => {
                const ci = window.CGPT_NAV.chatInput;
                if (ci?.findChatInput) return ci.findChatInput();
                return (
                    document.querySelector(
                        '[data-testid="prompt-textarea"][contenteditable="true"]'
                    ) || document.querySelector('form [contenteditable="true"]')
                );
            });
            return !!ok;
        }

        /**
         * Process queued prompts sequentially:
         * - create new temporary chat
         * - wait for composer
         * - inject and submit
         */
        async function processPromptQueue() {
            if (promptProcessing) return;
            promptProcessing = true;

            try {
                while (promptQueue.length > 0) {
                    const item = promptQueue.shift();
                    const prompt = String(item?.input ?? '');
                    if (!prompt.trim()) continue;

                    // 1) Start new temporary chat (best-effort)
                    try {
                        const nc = window.CGPT_NAV.newChat;
                        if (nc?.startNewTemporaryChat) {
                            await nc.startNewTemporaryChat();
                        }
                    } catch (_) {
                        // Non-fatal: if this fails, still try to inject into whatever chat is present
                    }

                    // 2) Wait for navigation/UI mount so composer exists
                    await ensureComposerReady();

                    // 3) Inject prompt + submit
                    try {
                        const ci = window.CGPT_NAV.chatInput;
                        const okSet = ci?.setChatInputText ? ci.setChatInputText(prompt) : false;

                        if (!okSet) {
                            // Retry briefly; ChatGPT sometimes remounts editor after navigation
                            const setOkAfter = await waitFor(
                                () => {
                                    const ci2 = window.CGPT_NAV.chatInput;
                                    return ci2?.setChatInputText
                                        ? ci2.setChatInputText(prompt)
                                        : false;
                                },
                                {timeoutMs: 5000, intervalMs: 150}
                            );

                            if (!setOkAfter) continue;
                        }

                        // small delay so editor state settles before clicking send
                        await sleep(120);

                        try {
                            ci?.submitChatInput?.();
                        } catch (_) {}
                    } catch (_) {
                        // ignore and continue to next queued prompt
                    }

                    // 4) Small spacing to avoid racing subsequent new chat clicks
                    await sleep(250);
                }
            } finally {
                promptProcessing = false;
            }
        }

        function enqueuePromptMessage(msg) {
            const prompt = typeof msg?.input === 'string' ? msg.input : '';
            if (!prompt.trim()) return;

            promptQueue.push({
                id: msg?.id,
                created: msg?.created,
                input: prompt,
            });

            // Kick processor (fire-and-forget)
            processPromptQueue();
        }

        // Receive server -> extension messages (e.g. prompts)
        ws.onmessage = ev => {
            let msg = null;
            try {
                msg = JSON.parse(String(ev?.data ?? ''));
            } catch (_) {
                return;
            }

            if (!msg || typeof msg !== 'object') return;

            // Expected:
            // { type: "prompt", id: "...", created: <unix>, input: "..." }
            if (msg.type === 'prompt') {
                // Always create a new temporary chat before injecting
                enqueuePromptMessage(msg);
                return;
            }
        };

        ws.onclose = () => {
            wsOpen = false;
            scheduleReconnect();
        };

        ws.onerror = () => {
            wsOpen = false;
            try {
                ws.close();
            } catch (_) {}
            scheduleReconnect();
        };
    }

    function wsSend(obj) {
        if (!enabled) return;

        const payload = safeJsonStringify(obj);
        if (!ws || !wsOpen) connectWs();

        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(payload);
            } catch (_) {
                // ignore; reconnect loop will handle
            }
        }
    }

    // ---------- Page-world injection (CSP-safe) ----------
    function injectPageHook() {
        if (!enabled) return;
        if (pageHookInjected) return;

        const existing = document.querySelector('script[data-cgpt-nav-page-hook="1"]');
        if (existing) {
            pageHookInjected = true;
            return;
        }

        const s = document.createElement('script');
        s.setAttribute('data-cgpt-nav-page-hook', '1');
        s.src = chrome.runtime.getURL('content/pageHook.js');

        (document.documentElement || document.head || document.body).appendChild(s);

        s.addEventListener('load', () => {
            pageHookInjected = true;
        });
        s.addEventListener('error', () => {
            console.warn('Failed to load pageHook.js (CSP or missing web_accessible_resources).');
        });
    }

    function clearReconnectTimer() {
        if (!reconnectTimer) return;
        try {
            clearTimeout(reconnectTimer);
        } catch (_) {}
        reconnectTimer = null;
    }

    function closeWs() {
        wsOpen = false;
        if (ws) {
            try {
                ws.onopen = null;
                ws.onclose = null;
                ws.onerror = null;
                ws.onmessage = null;
                ws.close();
            } catch (_) {}
        }
        ws = null;
        clearReconnectTimer();
        backoffMs = 300;
    }

    // Receive page-world events and forward to Bun WS
    function onWindowMessage(ev) {
        if (!enabled) return;

        const d = ev && ev.data;
        if (!d || d.__cgptNav !== NS) return;

        wsSend({
            type: d.type,
            payload: d.payload,
            pageUrl: location.href,
            at: Date.now(),
        });
    }

    function enable() {
        if (enabled) return;
        enabled = true;

        // Hook window message listener (for pageHook events)
        window.addEventListener('message', onWindowMessage);

        // Start WS + inject page hook
        connectWs();
        injectPageHook();
    }

    function disable() {
        if (!enabled) return;
        enabled = false;

        // Stop forwarding and close WS
        window.removeEventListener('message', onWindowMessage);
        closeWs();

        // NOTE: we do not remove the injected script; it is harmless if no listener/WS is active.
        // Keeping it avoids churn if the user toggles WS on/off repeatedly.
    }

    function isEnabled() {
        return enabled;
    }

    window.CGPT_NAV.streamTap = {
        wsUrl: WS_URL,
        enable,
        disable,
        isEnabled,
        reconnect: connectWs,
    };
})();
