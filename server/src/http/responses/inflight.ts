import { sseFrame } from './sse';
import type { ResponseObject } from '../../types/responses';

export type InflightResponses = {
    id: string;
    created: number;
    controller: ReadableStreamDefaultController<Uint8Array>;
    encoder: TextEncoder;
    closed: boolean;
    timeoutHandle: any;

    // OpenAI-like response stream bookkeeping
    response: ResponseObject;
    outputTextItemId: string;
    outputIndex: number;
    contentIndex: number;

    // Used to compute deltas from ChatGPT growing text
    lastText: string;
};

// Global state for now, but encapsulated in this module
let inflight: InflightResponses | null = null;

export function getInflight(): InflightResponses | null {
    return inflight;
}

export function createInflight(
    params: Omit<InflightResponses, 'closed' | 'timeoutHandle' | 'outputIndex' | 'contentIndex' | 'lastText'> & {
        timeoutHandle: any;
    }
) {
    inflight = {
        ...params,
        closed: false,
        outputIndex: 0,
        contentIndex: 0,
        lastText: '',
    };
    return inflight;
}

export function inflightEnqueue(event: string | null, data: any) {
    if (!inflight || inflight.closed) return;
    try {
        inflight.controller.enqueue(inflight.encoder.encode(sseFrame(event, data)));
    } catch {
        inflightClose('response.error', {
            type: 'response.error',
            error: { message: 'Failed to enqueue SSE chunk' },
        });
    }
}

export function inflightClose(finalEvent: string | null, finalData: any) {
    if (!inflight || inflight.closed) return;
    inflight.closed = true;

    try {
        clearTimeout(inflight.timeoutHandle);
    } catch { }

    // Send final event (best-effort)
    try {
        inflight.controller.enqueue(inflight.encoder.encode(sseFrame(finalEvent, finalData)));
    } catch { }

    // OpenAI-style terminal sentinel
    try {
        inflight.controller.enqueue(inflight.encoder.encode(sseFrame(null, '[DONE]')));
    } catch { }

    try {
        inflight.controller.close();
    } catch { }

    inflight = null;
}

export function emitResponseCreated() {
    if (!inflight) return;

    inflightEnqueue('response.created', {
        type: 'response.created',
        response: inflight.response,
    });
}

export function emitOutputTextDelta(delta: string) {
    if (!inflight) return;

    inflightEnqueue('response.output_text.delta', {
        type: 'response.output_text.delta',
        delta,
        item_id: inflight.outputTextItemId,
        output_index: inflight.outputIndex,
        content_index: inflight.contentIndex,
    });
}

export function emitGenericEvent(rawObj: any) {
    if (!inflight) return;

    inflightEnqueue('response.event', {
        type: 'response.event',
        response_id: inflight.id,
        raw: rawObj,
    });
}

export function emitResponseCompleted(status: ResponseObject['status'], extra?: any) {
    if (!inflight) return;

    inflight.response.status = status;
    if (typeof inflight.lastText === 'string') {
        // keep a minimal "output_text" snapshot for convenience
        inflight.response.output_text = inflight.lastText;
    }
    if (extra) inflight.response.meta = { ...(inflight.response.meta || {}), ...extra };

    inflightEnqueue('response.completed', {
        type: 'response.completed',
        response: inflight.response,
    });
}
