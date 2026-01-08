const SERVER = 'http://localhost:8765';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'cgpt-nav-fetch-list') {
        const r = await fetch(`${SERVER}/list`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
        const data = await r.json();
        sendResponse({ ok: true, prompts: data?.prompts || [] });
        return;
      }

      if (msg?.type === 'cgpt-nav-fetch-prompt') {
        const filename = msg?.filename;
        if (!filename || typeof filename !== 'string') {
          throw new Error('Missing filename');
        }
        const url = `${SERVER}/prompt/${encodeURIComponent(filename)}`;
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
        const text = await r.text();
        sendResponse({ ok: true, text });
        return;
      }

      // Unknown message
      sendResponse({ ok: false, error: 'Unknown message type' });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();

  // Required for async sendResponse
  return true;
});

