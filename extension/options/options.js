const DEFAULT_SERVER = 'http://localhost:8765';
const STORAGE_KEY_SERVER_URL = 'cgpt_nav_server_url';

function normalizeServerUrl(url) {
    const s = String(url || '').trim();
    if (!s) return DEFAULT_SERVER;
    return s.replace(/\/+$/, '');
}

function setStatus(text, ok = true) {
    const el = document.getElementById('status');
    if (!el) return;
    el.textContent = text;
    el.dataset.ok = ok ? '1' : '0';
    if (text) setTimeout(() => (el.textContent = ''), 1500);
}

async function load() {
    const input = document.getElementById('serverUrl');
    const data = await chrome.storage.sync.get({[STORAGE_KEY_SERVER_URL]: DEFAULT_SERVER});
    input.value = normalizeServerUrl(data[STORAGE_KEY_SERVER_URL]);
}

async function save() {
    const input = document.getElementById('serverUrl');
    const value = normalizeServerUrl(input.value);

    // Basic validation: must be http(s) URL
    let u;
    try {
        u = new URL(value);
    } catch {
        setStatus('Invalid URL', false);
        return;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        setStatus('URL must start with http:// or https://', false);
        return;
    }

    await chrome.storage.sync.set({[STORAGE_KEY_SERVER_URL]: value});
    setStatus('Saved');
}

async function reset() {
    await chrome.storage.sync.set({[STORAGE_KEY_SERVER_URL]: DEFAULT_SERVER});
    await load();
    setStatus('Reset');
}

document.addEventListener('DOMContentLoaded', () => {
    load();

    document.getElementById('save')?.addEventListener('click', save);
    document.getElementById('reset')?.addEventListener('click', reset);

    // Save on Enter
    document.getElementById('serverUrl')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') save();
    });
});
