// extension/content/streamTap.js
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
                const prompt = typeof msg.input === 'string' ? msg.input : '';
                if (!prompt.trim()) return;

                try {
                    const ci = window.CGPT_NAV.chatInput;
                    if (!ci?.setChatInputText) return;

                    const ok = ci.setChatInputText(prompt);
                    if (!ok) return;

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
