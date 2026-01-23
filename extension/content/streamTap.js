(() => {
    window.CGPT_NAV = window.CGPT_NAV || {};
    const NS = 'CGPT_NAV_STREAM_TAP';

    // ---------- WebSocket forwarder (content-script world) ----------
    const WS_URL = 'ws://localhost:8765/ws';
    let ws = null;
    let wsOpen = false;
    let reconnectTimer = null;
    let backoffMs = 300;

    function safeJsonStringify(obj) {
        try {
            return JSON.stringify(obj);
        } catch (_) {
            return JSON.stringify({type: 'error', error: 'Could not stringify payload'});
        }
    }

    function connectWs() {
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

        // NEW: receive server -> extension messages (e.g. prompts)
        ws.onmessage = ev => {
            let msg = null;
            try {
                msg = JSON.parse(String(ev?.data ?? ''));
            } catch (_) {
                return;
            }

            if (!msg || typeof msg !== 'object') return;

            // Expected from POST /responses broadcast:
            // { type: "prompt", id: "...", created: <unix>, input: "..." }
            if (msg.type === 'prompt') {
                const prompt = typeof msg.input === 'string' ? msg.input : '';
                if (!prompt.trim()) return;

                try {
                    const ci = window.CGPT_NAV.chatInput;
                    if (!ci?.setChatInputText) return;

                    // Insert prompt
                    const ok = ci.setChatInputText(prompt);
                    if (!ok) return;

                    // Submit shortly after insertion to allow editor to settle
                    setTimeout(() => {
                        try {
                            window.CGPT_NAV.chatInput?.submitChatInput?.();
                        } catch (_) {}
                    }, 120);
                } catch (_) {
                    // ignore
                }
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

    function scheduleReconnect() {
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            backoffMs = Math.min(backoffMs * 2, 8000);
            connectWs();
        }, backoffMs);
    }

    function wsSend(obj) {
        const payload = safeJsonStringify(obj);
        if (!ws || !wsOpen) connectWs();

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(payload);
        }
    }

    // ---------- Page-world injection (CSP-safe) ----------
    function injectPageHook() {
        const existing = document.querySelector('script[data-cgpt-nav-page-hook="1"]');
        if (existing) return;

        const s = document.createElement('script');
        s.setAttribute('data-cgpt-nav-page-hook', '1');

        s.src = chrome.runtime.getURL('content/pageHook.js');

        (document.documentElement || document.head || document.body).appendChild(s);
        s.addEventListener('load', () => {});
        s.addEventListener('error', () => {
            console.warn('Failed to load pageHook.js (CSP or missing web_accessible_resources).');
        });
    }

    // Receive page-world events and forward to Bun WS
    window.addEventListener('message', ev => {
        const d = ev && ev.data;
        if (!d || d.__cgptNav !== NS) return;

        wsSend({
            type: d.type,
            payload: d.payload,
            pageUrl: location.href,
            at: Date.now(),
        });
    });

    connectWs();
    injectPageHook();

    window.CGPT_NAV.streamTap = {
        wsUrl: WS_URL,
        reconnect: connectWs,
    };
})();
