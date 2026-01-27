export type ExtractedTextUpdate = {mode: 'full'; text: string} | {mode: 'delta'; text: string};

const SKIPPED_TYPES = [
    'grouped_webpages',
    'web_page',
    'webpage',
    'web_page_result',
    'source',
    'citation',
    'search_result',
];

function asNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    return value.length > 0 ? value : null;
}

function mergeFragments(values: Array<string | null>): string | null {
    const fragments = values.filter(Boolean) as string[];
    return fragments.length ? fragments.join('') : null;
}

function getTypeIdentifier(value: any): string | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = typeof value.type === 'string' ? value.type : typeof value.content_type === 'string' ? value.content_type : null;
    return candidate ? candidate.toLowerCase() : null;
}

function isBlockedType(value: any): boolean {
    const type = getTypeIdentifier(value);
    if (!type) return false;
    return SKIPPED_TYPES.some(block => type.includes(block));
}

function textFromContent(parts: any): string | null {
    if (!parts) return null;

    if (isBlockedType(parts)) return null;

    if (typeof parts === 'string') {
        return parts.length ? parts : null;
    }

    if (Array.isArray(parts)) {
        const merged = mergeFragments(parts.map(textFromContent));
        return merged;
    }

    if (typeof parts !== 'object') return null;

    if (isBlockedType(parts)) return null;

    const directKeys = ['text', 'value', 'content', 'literal'];
    for (const key of directKeys) {
        const str = asNonEmptyString((parts as any)[key]);
        if (str) return str;
    }

    const directDelta = asNonEmptyString((parts as any).delta);
    if (directDelta) return directDelta;

    const fromParts = textFromContent((parts as any).parts);
    if (fromParts) return fromParts;

    const nestedKeys = ['delta', 'content', 'arguments', 'argument', 'payload', 'body', 'data'];
    for (const key of nestedKeys) {
        if (key in (parts as any)) {
            const nested = textFromContent((parts as any)[key]);
            if (nested) return nested;
        }
    }

    if (Array.isArray((parts as any).messages)) {
        for (const msg of (parts as any).messages) {
            const txt = textFromMessage(msg);
            if (txt) return txt;
        }
    }

    if (Array.isArray((parts as any).output)) {
        const txt = textFromContent((parts as any).output);
        if (txt) return txt;
    }

    return null;
}

function textFromMessage(msg: any): string | null {
    if (!msg || typeof msg !== 'object') return null;

    const role = (msg.author?.role ?? msg.role ?? '').toLowerCase();
    if (role && role !== 'assistant') return null;

    const fromContent = textFromContent(msg.content);
    if (fromContent) return fromContent;

    const fromParts = textFromContent(msg.parts);
    if (fromParts) return fromParts;

    const direct = asNonEmptyString(msg.text);
    if (direct) return direct;

    return null;
}

function extractFromTypedEvent(data: any, type: string): ExtractedTextUpdate | null {
    const normalized = type.toLowerCase();

    if (normalized === 'response.output_text.delta') {
        const delta =
            asNonEmptyString(data.delta) ??
            textFromContent(data.delta) ??
            textFromContent(data.response?.delta) ??
            textFromContent(data.response?.output_text);
        if (delta) return {mode: 'delta', text: delta};
    }

    if (normalized === 'response.output_text.done') {
        const full =
            asNonEmptyString(data.text) ??
            textFromContent(data.text) ??
            textFromContent(data.response?.output_text) ??
            textFromContent(data.response?.output?.[0]?.content) ??
            textFromContent(data.output_text) ??
            textFromContent(data.content);
        if (full) return {mode: 'full', text: full};
    }

    if (normalized === 'response.completed') {
        const full =
            textFromContent(data.response?.output_text) ??
            textFromContent(data.response?.output?.[0]?.content);
        if (full) return {mode: 'full', text: full};
    }

    const deltaLikeTypes = [
        'content_block_delta',
        'message_delta',
        'response.delta',
        'output_text.delta',
        '.delta',
        'delta',
    ];

    if (deltaLikeTypes.some(t => normalized.includes(t))) {
        const delta =
            textFromContent(data.delta) ??
            textFromContent(data.content) ??
            textFromContent(data.payload) ??
            textFromContent(data.arguments);
        if (delta) return {mode: 'delta', text: delta};
    }

    const doneLikeTypes = ['content_block_done', 'message_done', '.done'];
    if (doneLikeTypes.some(t => normalized.includes(t))) {
        const full =
            textFromContent(data.content) ??
            textFromContent(data.full_text) ??
            textFromContent(data.payload);
        if (full) return {mode: 'full', text: full};
    }

    return null;
}

function extractFromStructuredPayload(data: any): ExtractedTextUpdate | null {
    if (data == null) return null;

    if (isBlockedType(data)) return null;

    if (typeof data === 'string') {
        return data.length ? {mode: 'delta', text: data} : null;
    }

    if (Array.isArray(data)) {
        const fragments: string[] = [];
        for (const entry of data) {
            if (isBlockedType(entry)) continue;
            const nested = extractFromStructuredPayload(entry);
            if (nested) {
                fragments.push(nested.text);
                continue;
            }
            const fallback = textFromContent(entry);
            if (fallback) fragments.push(fallback);
        }
        if (fragments.length) {
            return {mode: 'delta', text: fragments.join('')};
        }
        return null;
    }

    if (typeof data !== 'object') return null;

    const type = typeof (data as any).type === 'string' ? (data as any).type : null;
    if (type) {
        const typed = extractFromTypedEvent(data, type);
        if (typed) return typed;
    }

    const messageText = textFromMessage((data as any).message);
    if (messageText) return {mode: 'full', text: messageText};

    if (Array.isArray((data as any).messages)) {
        for (const msg of (data as any).messages) {
            const txt = textFromMessage(msg);
            if (txt) return {mode: 'full', text: txt};
        }
    }

    const contentText = textFromContent((data as any).content ?? (data as any).text);
    if (contentText) return {mode: 'full', text: contentText};

    const deltaText = textFromContent((data as any).delta);
    if (deltaText) return {mode: 'delta', text: deltaText};

    const choiceDelta = textFromContent((data as any).choices?.[0]?.delta?.content);
    if (choiceDelta) return {mode: 'delta', text: choiceDelta};

    if ('v' in (data as any)) {
        const v = (data as any).v;
        if (typeof v === 'string') {
            return v.length ? {mode: 'delta', text: v} : null;
        }
        const nested = extractFromStructuredPayload(v);
        if (nested) return nested;
    }

    return null;
}

/**
 * Best-effort extraction of assistant text updates from ChatGPT internal SSE payload JSON.
 */
export function extractTextUpdateFromChatGPTPayload(obj: any): ExtractedTextUpdate | null {
    const payload = obj?.payload;
    if (!payload) return null;

    const fromJson = extractFromStructuredPayload(payload.json);
    if (fromJson) return fromJson;

    const raw = payload.raw;
    if (typeof raw === 'string' && raw.length > 0 && raw !== '[DONE]') {
        if (raw.trim().startsWith('{')) {
            try {
                const parsed = JSON.parse(raw);
                const nested = extractFromStructuredPayload(parsed);
                if (nested) return nested;
            } catch {
                // ignore parse errors, fall back to treating raw as delta text
            }
        }
        return {mode: 'delta', text: raw};
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
