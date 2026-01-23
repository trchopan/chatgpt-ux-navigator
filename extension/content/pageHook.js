(() => {
    const NS = 'CGPT_NAV_STREAM_TAP';
    const TARGET_SUBSTR = '/backend-api/f/conversation';

    function post(type, payload) {
        try {
            window.postMessage({__cgptNav: NS, type, payload}, '*');
        } catch (_) {}
    }

    function isTargetUrl(u) {
        try {
            return typeof u === 'string' && u.includes(TARGET_SUBSTR);
        } catch (_) {
            return false;
        }
    }

    function parseSseStream(stream, meta) {
        const reader = stream.getReader();
        const dec = new TextDecoder('utf-8');

        let buf = '';
        let closed = false;

        function flushEventsFromBuffer() {
            // SSE events separated by blank line "\n\n"
            let idx;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
                const rawEvent = buf.slice(0, idx);
                buf = buf.slice(idx + 2);

                const lines = rawEvent.split(/\n/);
                const dataLines = [];
                let eventName = null;

                for (const line of lines) {
                    if (line.startsWith('event:')) {
                        eventName = line.slice(6).trim();
                    } else if (line.startsWith('data:')) {
                        dataLines.push(line.slice(5).trimStart());
                    }
                }

                if (!dataLines.length) continue;

                const dataStr = dataLines.join('\n');

                if (dataStr === '[DONE]') {
                    post('done', {meta});
                    continue;
                }

                let obj = null;
                try {
                    obj = JSON.parse(dataStr);
                } catch (_) {}

                post('sse', {
                    meta,
                    event: eventName || null,
                    raw: obj ? null : dataStr,
                    json: obj,
                });
            }
        }

        (async () => {
            try {
                while (true) {
                    const {value, done} = await reader.read();
                    if (done) break;

                    buf += dec.decode(value, {stream: true});
                    flushEventsFromBuffer();
                }
            } catch (e) {
                post('error', {meta, error: String(e?.message || e)});
            } finally {
                if (!closed) {
                    closed = true;
                    post('closed', {meta});
                }
            }
        })();
    }

    const origFetch = window.fetch;
    if (typeof origFetch !== 'function') return;

    window.fetch = async function (...args) {
        const input = args[0];
        const url = typeof input === 'string' ? input : input && input.url ? input.url : '';

        const res = await origFetch.apply(this, args);

        try {
            if (!isTargetUrl(url)) return res;

            const ct = res.headers && res.headers.get ? res.headers.get('content-type') || '' : '';
            const isSse = ct.includes('text/event-stream');

            if (!isSse || !res.body || !res.body.tee) return res;

            const meta = {
                url,
                at: Date.now(),
                contentType: ct,
            };

            const [streamA, streamB] = res.body.tee();
            parseSseStream(streamB, meta);

            // Return a new Response using streamA so ChatGPT continues to work
            return new Response(streamA, {
                status: res.status,
                statusText: res.statusText,
                headers: res.headers,
            });
        } catch (_) {
            return res;
        }
    };

    post('ready', {at: Date.now()});
})();
