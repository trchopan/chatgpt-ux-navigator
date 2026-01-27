import {sseFrame} from './sse';
import type {ResponseObject} from '../../types/responses';
import {parseToolCallsFromText} from '../../prompts/parser';
import {sanitizeAssistantText} from './sanitize';

type InflightMode = 'stream' | 'json';

export type InflightResponses = {
    id: string;
    createdAt: number; // unix seconds
    mode: InflightMode;

    controller: ReadableStreamDefaultController<Uint8Array> | null;
    encoder: TextEncoder | null;

    closed: boolean;
    timeoutHandle: any;

    // OpenAI-like response bookkeeping
    response: ResponseObject;

    // Output item + content part bookkeeping
    messageItemId: string; // msg_...
    outputIndex: number; // usually 0
    contentIndex: number; // usually 0

    // Sequence numbering for SSE
    sequenceNumber: number;

    // Used to compute deltas from ChatGPT growing text
    lastText: string;

    // For JSON (non-stream) mode
    jsonResolve: ((resp: ResponseObject) => void) | null;
    jsonReject: ((err: Error) => void) | null;
};

// Global state for now, but encapsulated in this module
let inflight: InflightResponses | null = null;

export function getInflight(): InflightResponses | null {
    return inflight;
}

export function createInflight(params: {
    id: string;
    createdAt: number;
    mode: InflightMode;
    controller: ReadableStreamDefaultController<Uint8Array> | null;
    encoder: TextEncoder | null;
    timeoutHandle: any;
    response: ResponseObject;
    messageItemId: string;
    jsonResolve?: ((resp: ResponseObject) => void) | null;
    jsonReject?: ((err: Error) => void) | null;
}) {
    inflight = {
        id: params.id,
        createdAt: params.createdAt,
        mode: params.mode,
        controller: params.controller,
        encoder: params.encoder,
        timeoutHandle: params.timeoutHandle,
        response: params.response,
        messageItemId: params.messageItemId,

        closed: false,
        outputIndex: 0,
        contentIndex: 0,
        sequenceNumber: 0,
        lastText: '',

        jsonResolve: params.jsonResolve ?? null,
        jsonReject: params.jsonReject ?? null,
    };
    return inflight;
}

function nextSeq(): number {
    if (!inflight) return 0;
    const n = inflight.sequenceNumber;
    inflight.sequenceNumber += 1;
    return n;
}

function canStream(): boolean {
    return !!inflight && inflight.mode === 'stream' && !!inflight.controller && !!inflight.encoder;
}

function safeEnqueue(frame: string) {
    if (!inflight || inflight.closed) return;
    if (!canStream()) return;

    try {
        inflight.controller!.enqueue(inflight.encoder!.encode(frame));
    } catch {
        // If enqueue fails, attempt a terminal close
        inflightTerminate('response.error', {
            type: 'response.error',
            error: {message: 'Failed to enqueue SSE chunk'},
            sequence_number: nextSeq(),
        });
    }
}

/**
 * Emit a named SSE event with OpenAI-style `{type, ... , sequence_number}` payload.
 * No-op in JSON mode.
 */
export function inflightEnqueue(event: string, data: any) {
    if (!inflight || inflight.closed) return;
    if (!canStream()) return;
    safeEnqueue(sseFrame(event, data));
}

/**
 * Terminal close.
 * - In stream mode: optionally sends a final event, then `[DONE]`, then closes.
 * - In json mode: resolves the waiting HTTP request with the final response.
 */
export function inflightTerminate(finalEvent: string | null = null, finalData: any = null) {
    if (!inflight || inflight.closed) return;
    inflight.closed = true;

    try {
        clearTimeout(inflight.timeoutHandle);
    } catch {}

    if (inflight.mode === 'stream') {
        // Best-effort final event (errors typically)
        if (finalEvent && finalData != null) {
            try {
                inflight.controller?.enqueue(
                    inflight.encoder!.encode(sseFrame(finalEvent, finalData))
                );
            } catch {}
        }

        // Terminal sentinel
        try {
            inflight.controller?.enqueue(inflight.encoder!.encode(sseFrame(null, '[DONE]')));
        } catch {}

        try {
            inflight.controller?.close();
        } catch {}

        inflight = null;
        return;
    }

    // JSON mode
    const resolve = inflight.jsonResolve;
    const resp = inflight.response;

    inflight.jsonResolve = null;
    inflight.jsonReject = null;

    inflight = null;

    try {
        resolve?.(resp);
    } catch {
        // ignore
    }
}

// ----------------------------
// OpenAI-like event emitters
// (These update inflight.response in both modes; they only enqueue SSE in stream mode.)
// ----------------------------

export function emitResponseCreated() {
    if (!inflight) return;

    inflightEnqueue('response.created', {
        type: 'response.created',
        response: inflight.response,
        sequence_number: nextSeq(),
    });
}

export function emitResponseInProgress() {
    if (!inflight) return;

    inflightEnqueue('response.in_progress', {
        type: 'response.in_progress',
        response: inflight.response,
        sequence_number: nextSeq(),
    });
}

export function emitOutputItemAdded() {
    if (!inflight) return;

    const item: any = {
        id: inflight.messageItemId,
        type: 'message',
        status: 'in_progress',
        content: [],
        role: 'assistant',
    };

    inflight.response.output = inflight.response.output || [];
    inflight.response.output.push(item);

    inflightEnqueue('response.output_item.added', {
        type: 'response.output_item.added',
        item,
        output_index: inflight.outputIndex,
        sequence_number: nextSeq(),
    });
}

export function emitContentPartAdded() {
    if (!inflight) return;

    const part: any = {
        type: 'output_text',
        annotations: [],
        logprobs: [],
        text: '',
    };

    const out0: any = inflight.response.output?.[inflight.outputIndex];
    if (out0 && Array.isArray(out0.content)) {
        out0.content.push(part);
    }

    inflightEnqueue('response.content_part.added', {
        type: 'response.content_part.added',
        content_index: inflight.contentIndex,
        item_id: inflight.messageItemId,
        output_index: inflight.outputIndex,
        part,
        sequence_number: nextSeq(),
    });
}

export function emitOutputTextDelta(delta: string) {
    if (!inflight) return;

    inflightEnqueue('response.output_text.delta', {
        type: 'response.output_text.delta',
        content_index: inflight.contentIndex,
        delta,
        item_id: inflight.messageItemId,
        logprobs: [],
        output_index: inflight.outputIndex,
        sequence_number: nextSeq(),
    });
}

export function emitOutputTextDone(fullText: string) {
    if (!inflight) return;

    inflightEnqueue('response.output_text.done', {
        type: 'response.output_text.done',
        content_index: inflight.contentIndex,
        item_id: inflight.messageItemId,
        logprobs: [],
        output_index: inflight.outputIndex,
        sequence_number: nextSeq(),
        text: fullText,
    });
}

export function emitContentPartDone(fullText: string) {
    if (!inflight) return;

    const part: any = {
        type: 'output_text',
        annotations: [],
        logprobs: [],
        text: fullText,
    };

    inflightEnqueue('response.content_part.done', {
        type: 'response.content_part.done',
        content_index: inflight.contentIndex,
        item_id: inflight.messageItemId,
        output_index: inflight.outputIndex,
        part,
        sequence_number: nextSeq(),
    });
}

export function emitOutputItemDone(fullText: string) {
    if (!inflight) return;

    const {text: cleanText, tool_calls} = parseToolCallsFromText(fullText);
    const sanitizedText = sanitizeAssistantText(cleanText);

    const item: any = {
        id: inflight.messageItemId,
        type: 'message',
        status: 'completed',
        content: [
            {
                type: 'output_text',
                annotations: [],
                logprobs: [],
                text: sanitizedText,
            },
        ],
        role: 'assistant',
    };

    if (tool_calls && tool_calls.length > 0) {
        item.tool_calls = tool_calls;
        // OpenAI convention: if tool_calls are present and text is empty, content is null.
        // But here we might have thought process text, so we keep content if text is not empty.
        // If text is empty, we can set content to null or keep it as empty array/empty text.
        // Let's keep it as is (content with potentially empty text) unless we want strict OpenAI compat.
        // Strict OpenAI: content is string or null (or array of parts).
        // If cleanText is empty, let's keep the empty text part or just not have it?
        // For safety, let's keep the content array.
    }

    if (Array.isArray(inflight.response.output)) {
        inflight.response.output[inflight.outputIndex] = item;
    } else {
        inflight.response.output = [item];
    }

    inflightEnqueue('response.output_item.done', {
        type: 'response.output_item.done',
        item,
        output_index: inflight.outputIndex,
        sequence_number: nextSeq(),
    });
}

export function emitResponseCompleted(status: ResponseObject['status'], extra?: any) {
    if (!inflight) return;

    inflight.response.status = status;

    if (status !== 'in_progress') {
        inflight.response.completed_at = Math.floor(Date.now() / 1000);
    }

    if (typeof inflight.lastText === 'string') {
        const {text: cleanText} = parseToolCallsFromText(inflight.lastText);
        inflight.response.output_text = sanitizeAssistantText(cleanText);
    }

    if (extra) {
        inflight.response.meta = {...(inflight.response.meta || {}), ...extra};
    }

    inflightEnqueue('response.completed', {
        type: 'response.completed',
        response: inflight.response,
        sequence_number: nextSeq(),
    });
}

export function emitGenericEvent(rawObj: any) {
    if (!inflight) return;

    inflightEnqueue('response.event', {
        type: 'response.event',
        response_id: inflight.id,
        raw: rawObj,
        sequence_number: nextSeq(),
    });
}
