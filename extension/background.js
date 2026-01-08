const SERVER = 'http://localhost:8765';

const handlers = {
    'cgpt-nav-fetch-list': async () => {
        const r = await fetch(`${SERVER}/list`, {cache: 'no-store'});
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
        const data = await r.json();
        return {ok: true, prompts: data?.prompts || []};
    },

    'cgpt-nav-fetch-prompt': async msg => {
        const filename = msg?.filename;
        if (!filename || typeof filename !== 'string') throw new Error('Missing filename');
        const r = await fetch(`${SERVER}/prompt/${encodeURIComponent(filename)}`, {
            cache: 'no-store',
        });
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
        const text = await r.text();
        return {ok: true, text};
    },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
        try {
            const fn = handlers[msg?.type];
            if (!fn) return sendResponse({ok: false, error: 'Unknown message type'});
            sendResponse(await fn(msg));
        } catch (e) {
            sendResponse({ok: false, error: String(e?.message || e)});
        }
    })();
    return true;
});
