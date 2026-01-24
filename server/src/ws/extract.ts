// Try to extract the current full assistant text from ChatGPT internal SSE payload JSON.
export function extractFullTextFromChatGPTPayload(obj: any): string | null {
    const j = obj?.payload?.json;
    if (!j || typeof j !== 'object') return null;

    // Common-ish shapes observed in ChatGPT internal streams (best-effort):
    // 1) { message: { content: { parts: ["..."] } } }
    const p1 = j?.message?.content?.parts;
    if (Array.isArray(p1) && typeof p1[0] === 'string') {
        return String(p1[0]);
    }

    // 2) { message: { content: { text: "..." } } }
    const t2 = j?.message?.content?.text;
    if (typeof t2 === 'string') return t2;

    // 3) { delta: "..." } or { text: "..." }
    const t3 = j?.delta;
    if (typeof t3 === 'string') return t3;

    const t4 = j?.text;
    if (typeof t4 === 'string') return t4;

    // 4) { content: "..." }
    const t5 = j?.content;
    if (typeof t5 === 'string') return t5;

    return null;
}

// Compute a delta given a "full text so far" snapshot. If it doesn't extend,
// return null so we don't emit misleading deltas.
export function computeDelta(fullText: string, prevText: string): string | null {
    const next = fullText || '';
    const prev = prevText || '';

    if (next === prev) return null;
    if (next.startsWith(prev)) return next.slice(prev.length);

    // If it changed non-monotonically (edits), emit the whole thing as a reset delta.
    return next;
}
