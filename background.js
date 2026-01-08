chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'cgpt-nav-fetch-prompt') return;

    (async () => {
        try {
            const res = await fetch('http://localhost:8765/prompt', {method: 'GET'});
            if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
            const text = await res.text();
            sendResponse({ok: true, text});
        } catch (err) {
            sendResponse({ok: false, error: String(err?.message || err)});
        }
    })();

    // Keep the message channel open for async response
    return true;
});
