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

// --- Multi-client inflight tracking: Map of clientId -> InflightResponses ---
const inflights = new Map<string, InflightResponses>();
const defaultClientId = '__default__';

export function getInflight(clientId?: string): InflightResponses | null {
    const id = clientId || defaultClientId;
    return inflights.get(id) || null;
}

export function createInflight(
    clientIdOrParams: string | {
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
    },
    params?: {
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
    }
) {
    let clientId: string;
    let config: {
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
    };

    if (typeof clientIdOrParams === 'string') {
        clientId = clientIdOrParams;
        config = params!;
    } else {
        clientId = defaultClientId;
        config = clientIdOrParams;
    }

    const inflight: InflightResponses = {
        id: config.id,
        createdAt: config.createdAt,
        mode: config.mode,
        controller: config.controller,
        encoder: config.encoder,
        timeoutHandle: config.timeoutHandle,
        response: config.response,
        messageItemId: config.messageItemId,

        closed: false,
        outputIndex: 0,
        contentIndex: 0,
        sequenceNumber: 0,
        lastText: '',

        jsonResolve: config.jsonResolve ?? null,
        jsonReject: config.jsonReject ?? null,
    };
    inflights.set(clientId, inflight);
    return inflight;
}

function nextSeq(clientId?: string): number {
    const id = clientId || defaultClientId;
    const inflight = inflights.get(id);
    if (!inflight) return 0;
    const n = inflight.sequenceNumber;
    inflight.sequenceNumber += 1;
    return n;
}

function canStream(clientId?: string): boolean {
    const id = clientId || defaultClientId;
    const inflight = inflights.get(id);
    return !!inflight && inflight.mode === 'stream' && !!inflight.controller && !!inflight.encoder;
}

function safeEnqueue(frame: string, clientId?: string) {
    const id = clientId || defaultClientId;
    const inflight = inflights.get(id);
    if (!inflight || inflight.closed) return;
    if (!canStream(clientId)) return;

    try {
        inflight.controller!.enqueue(inflight.encoder!.encode(frame));
    } catch {
        inflightTerminate('response.error', {
            type: 'response.error',
            error: {message: 'Failed to enqueue SSE chunk'},
            sequence_number: nextSeq(clientId),
        }, clientId);
    }
}

export function inflightEnqueue(eventOrClientId: string, dataOrEvent?: any, data?: any) {
    let clientId: string | undefined;
    let event: string;
    let eventData: any;

    if (typeof dataOrEvent === 'object' && data === undefined) {
        clientId = undefined;
        event = eventOrClientId;
        eventData = dataOrEvent;
    } else {
        clientId = eventOrClientId;
        event = dataOrEvent;
        eventData = data;
    }

    const id = clientId || defaultClientId;
    const inflight = inflights.get(id);
    if (!inflight || inflight.closed) return;
    if (!canStream(clientId)) return;
    safeEnqueue(sseFrame(event, eventData), clientId);
}

export function inflightTerminate(
    finalEventOrClientId?: string | null,
    finalDataOrEvent?: any,
    clientIdOrFinalData?: any
) {
    let clientId: string | undefined;
    let finalEvent: string | null;
    let finalData: any;

    if (typeof finalEventOrClientId === 'string' && typeof finalDataOrEvent === 'string') {
        clientId = finalEventOrClientId;
        finalEvent = finalDataOrEvent;
        finalData = clientIdOrFinalData;
    } else {
        clientId = undefined;
        finalEvent = finalEventOrClientId || null;
        finalData = finalDataOrEvent;
    }

    const id = clientId || defaultClientId;
    const inflight = inflights.get(id);
    if (!inflight || inflight.closed) return;
    inflight.closed = true;

    try {
        clearTimeout(inflight.timeoutHandle);
    } catch {}

    if (inflight.mode === 'stream') {
        if (finalEvent && finalData != null) {
            try {
                inflight.controller?.enqueue(
                    inflight.encoder!.encode(sseFrame(finalEvent, finalData))
                );
            } catch {}
        }

        try {
            inflight.controller?.enqueue(inflight.encoder!.encode(sseFrame(null, '[DONE]')));
        } catch {}

        try {
            inflight.controller?.close();
        } catch {}

        inflights.delete(id);
        return;
    }

    const resolve = inflight.jsonResolve;
    const resp = inflight.response;

    inflight.jsonResolve = null;
    inflight.jsonReject = null;

    inflights.delete(id);

    try {
        resolve?.(resp);
    } catch {
    }
}

export function emitResponseCreated(clientId?: string) {
    const id = clientId || defaultClientId;
    const inflight = inflights.get(id);
    if (!inflight) return;

    inflightEnqueue(id, 'response.created', {
        type: 'response.created',
        response: inflight.response,
        sequence_number: nextSeq(clientId),
    });
}

export function emitResponseInProgress(clientId?: string) {
    const id = clientId || defaultClientId;
    const inflight = inflights.get(id);
    if (!inflight) return;

    inflightEnqueue(id, 'response.in_progress', {
        type: 'response.in_progress',
        response: inflight.response,
        sequence_number: nextSeq(clientId),
    });
}

export function emitOutputItemAdded(clientId?: string) {
    const id = clientId || defaultClientId;
    const inflight = inflights.get(id);
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

    inflightEnqueue(id, 'response.output_item.added', {
        type: 'response.output_item.added',
        item,
        output_index: inflight.outputIndex,
        sequence_number: nextSeq(clientId),
    });
}

export function emitContentPartAdded(clientId?: string) {
    const id = clientId || defaultClientId;
    const inflight = inflights.get(id);
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

    inflightEnqueue(id, 'response.content_part.added', {
        type: 'response.content_part.added',
        content_index: inflight.contentIndex,
        item_id: inflight.messageItemId,
        output_index: inflight.outputIndex,
        part,
        sequence_number: nextSeq(clientId),
    });
}

export function emitOutputTextDelta(clientIdOrDelta: string | undefined, delta?: string) {
    let clientId: string | undefined;
    let text: string;

    if (typeof delta === 'string') {
        clientId = clientIdOrDelta;
        text = delta;
    } else {
        clientId = undefined;
        text = clientIdOrDelta || '';
    }

    const id = clientId || defaultClientId;
    const inflight = inflights.get(id);
    if (!inflight) return;

    inflightEnqueue(id, 'response.output_text.delta', {
        type: 'response.output_text.delta',
        content_index: inflight.contentIndex,
        delta: text,
        item_id: inflight.messageItemId,
        logprobs: [],
        output_index: inflight.outputIndex,
        sequence_number: nextSeq(clientId),
    });
}

export function emitOutputTextDone(clientIdOrText: string | undefined, fullText?: string) {
    let clientId: string | undefined;
    let text: string;

    if (typeof fullText === 'string') {
        clientId = clientIdOrText;
        text = fullText;
    } else {
        clientId = undefined;
        text = clientIdOrText || '';
    }

    const id = clientId || defaultClientId;
    const inflight = inflights.get(id);
    if (!inflight) return;

    inflightEnqueue(id, 'response.output_text.done', {
        type: 'response.output_text.done',
        content_index: inflight.contentIndex,
        item_id: inflight.messageItemId,
        logprobs: [],
        output_index: inflight.outputIndex,
        sequence_number: nextSeq(clientId),
        text: text,
    });
}

export function emitContentPartDone(clientIdOrText: string | undefined, fullText?: string) {
    let clientId: string | undefined;
    let text: string;

    if (typeof fullText === 'string') {
        clientId = clientIdOrText;
        text = fullText;
    } else {
        clientId = undefined;
        text = clientIdOrText || '';
    }

    const id = clientId || defaultClientId;
    const inflight = inflights.get(id);
    if (!inflight) return;

    const part: any = {
        type: 'output_text',
        annotations: [],
        logprobs: [],
        text: text,
    };

    inflightEnqueue(id, 'response.content_part.done', {
        type: 'response.content_part.done',
        content_index: inflight.contentIndex,
        item_id: inflight.messageItemId,
        output_index: inflight.outputIndex,
        part,
        sequence_number: nextSeq(clientId),
    });
}

export function emitOutputItemDone(clientIdOrText: string | undefined, fullText?: string) {
    let clientId: string | undefined;
    let text: string;

    if (typeof fullText === 'string') {
        clientId = clientIdOrText;
        text = fullText;
    } else {
        clientId = undefined;
        text = clientIdOrText || '';
    }

    const id = clientId || defaultClientId;
    const inflight = inflights.get(id);
    if (!inflight) return;

    const {text: cleanText, tool_calls} = parseToolCallsFromText(text);
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
    }

    if (Array.isArray(inflight.response.output)) {
        inflight.response.output[inflight.outputIndex] = item;
    } else {
        inflight.response.output = [item];
    }

    inflightEnqueue(id, 'response.output_item.done', {
        type: 'response.output_item.done',
        item,
        output_index: inflight.outputIndex,
        sequence_number: nextSeq(clientId),
    });
}

export function emitResponseCompleted(clientIdOrStatus?: string, statusOrExtra?: any, extra?: any) {
    let clientId: string | undefined;
    let status: ResponseObject['status'];
    let extraData: any;

    if (typeof statusOrExtra === 'string' || statusOrExtra === undefined) {
        clientId = undefined;
        status = clientIdOrStatus as any;
        extraData = statusOrExtra;
    } else {
        clientId = clientIdOrStatus;
        status = statusOrExtra;
        extraData = extra;
    }

    const id = clientId || defaultClientId;
    const inflight = inflights.get(id);
    if (!inflight) return;

    inflight.response.status = status;

    if (status !== 'in_progress') {
        inflight.response.completed_at = Math.floor(Date.now() / 1000);
    }

    if (typeof inflight.lastText === 'string') {
        const {text: cleanText} = parseToolCallsFromText(inflight.lastText);
        inflight.response.output_text = sanitizeAssistantText(cleanText);
    }

    if (extraData) {
        inflight.response.meta = {...(inflight.response.meta || {}), ...extraData};
    }

    inflightEnqueue(id, 'response.completed', {
        type: 'response.completed',
        response: inflight.response,
        sequence_number: nextSeq(clientId),
    });
}

export function emitGenericEvent(clientIdOrObj?: string, rawObj?: any) {
    let clientId: string | undefined;
    let obj: any;

    if (typeof clientIdOrObj === 'object' && rawObj === undefined) {
        clientId = undefined;
        obj = clientIdOrObj;
    } else {
        clientId = clientIdOrObj;
        obj = rawObj;
    }

    const id = clientId || defaultClientId;
    const inflight = inflights.get(id);
    if (!inflight) return;

    inflightEnqueue(id, 'response.event', {
        type: 'response.event',
        response_id: inflight.id,
        raw: obj,
        sequence_number: nextSeq(clientId),
    });
}

export function setSoleInflight(inflight: InflightResponses | null) {
    if (inflight) {
        inflights.set(defaultClientId, inflight);
    } else {
        inflights.delete(defaultClientId);
    }
}

export function getSoleInflight(): InflightResponses | null {
    return inflights.get(defaultClientId) || null;
}
