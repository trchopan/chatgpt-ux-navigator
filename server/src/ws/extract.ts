export type ExtractedTextUpdate = {mode: 'full'; text: string} | {mode: 'delta'; text: string};

function partsToText(parts: any): string | null {
    if (!Array.isArray(parts) || parts.length === 0) return null;

    const out: string[] = [];
    for (const p of parts) {
        if (typeof p === 'string') {
            if (p) out.push(p);
            continue;
        }
        if (p && typeof p === 'object') {
            if (typeof (p as any).text === 'string' && (p as any).text) out.push((p as any).text);
            else if (typeof (p as any).content === 'string' && (p as any).content)
                out.push((p as any).content);
        }
    }

    const joined = out.join('');
    return joined ? joined : null;
}

/**
 * Best-effort extraction of assistant text updates from ChatGPT internal SSE payload JSON.
 *
 * IMPORTANT: ChatGPT payloads vary. In your logs, they are often wrapped in:
 *   { v: { message: { author: {role}, content: {parts: [...] } } }, c: <number> }
 */
export function extractTextUpdateFromChatGPTPayload(obj: any): ExtractedTextUpdate | null {
    const j = obj?.payload?.json;
    if (!j || typeof j !== 'object') return null;

    // ------------------------------------------------------------
    // 0) ChatGPT compact envelope: { v: <...>, c?: ... }
    // In your logs, v can be:
    //   - object: { message: {...} }   (often metadata frames, including user prompt echo)
    //   - string: " I am"             (assistant text delta fragments)
    // ------------------------------------------------------------
    if ('v' in (j as any)) {
        const v = (j as any).v;

        // Case A: v is a string => treat as a text delta fragment
        if (typeof v === 'string' && v.length > 0) {
            return {mode: 'delta', text: v};
        }

        // Case B: v is an object => may contain message frames (sometimes full snapshots)
        if (v && typeof v === 'object') {
            const msg = (v as any)?.message;
            const role = msg?.author?.role;

            // Only extract assistant output (ignore user frames)
            if (role === 'assistant') {
                const parts = msg?.content?.parts;
                const t = partsToText(parts);
                if (typeof t === 'string') {
                    return {mode: 'full', text: t};
                }

                const t2 = msg?.content?.text;
                if (typeof t2 === 'string' && t2) return {mode: 'full', text: t2};
            }
        }
    }

    // ----------------------------
    // FULL SNAPSHOT patterns (older / other shapes)
    // ----------------------------

    // 1) { message: { content: { parts: [...] } } }
    {
        const parts = (j as any)?.message?.content?.parts;
        const t = partsToText(parts);
        if (typeof t === 'string') return {mode: 'full', text: t};
    }

    // 2) { message: { content: { text: "..." } } }
    {
        const t = (j as any)?.message?.content?.text;
        if (typeof t === 'string' && t) return {mode: 'full', text: t};
    }

    // ----------------------------
    // DELTA-only patterns
    // ----------------------------

    // 3) { delta: "..." }
    {
        const d = (j as any)?.delta;
        if (typeof d === 'string' && d) return {mode: 'delta', text: d};
    }

    // 4) OpenAI-ish delta: { choices: [{ delta: { content: "..." } }] }
    {
        const d = (j as any)?.choices?.[0]?.delta?.content;
        if (typeof d === 'string' && d) return {mode: 'delta', text: d};
    }

    return null;
}

/**
 * Compute a delta given a "full text so far" snapshot. If it doesn't extend,
 * return null so we don't emit misleading deltas.
 */
export function computeDelta(fullText: string, prevText: string): string | null {
    const next = fullText || '';
    const prev = prevText || '';

    if (next === prev) return null;
    if (next.startsWith(prev)) return next.slice(prev.length);

    // If it changed non-monotonically (edits), emit the whole thing as a reset delta.
    return next;
}
