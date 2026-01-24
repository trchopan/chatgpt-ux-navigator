import {sseFrame} from './sse';
import type {ResponseObject} from '../../types/responses';

export type InflightResponses = {
    id: string;
    createdAt: number; // unix seconds
    controller: ReadableStreamDefaultController<Uint8Array>;
    encoder: TextEncoder;
    closed: boolean;
    timeoutHandle: any;

    // OpenAI-like response stream bookkeeping
    response: ResponseObject;

    // Output item + content part bookkeeping
    messageItemId: string; // msg_...
    outputIndex: number; // usually 0
    contentIndex: number; // usually 0

    // Sequence numbering for SSE
    sequenceNumber: number;

    // Used to compute deltas from ChatGPT growing text
    lastText: string;
};

// Global state for now, but encapsulated in this module
let inflight: InflightResponses | null = null;

export function getInflight(): InflightResponses | null {
    return inflight;
}

export function createInflight(
    params: Omit<
        InflightResponses,
        'closed' | 'sequenceNumber' | 'outputIndex' | 'contentIndex' | 'lastText'
    > & {
        timeoutHandle: any;
    }
) {
    inflight = {
        ...params,
        closed: false,
        outputIndex: 0,
        contentIndex: 0,
        sequenceNumber: 0,
        lastText: '',
    };
    return inflight;
}

function nextSeq(): number {
    if (!inflight) return 0;
    const n = inflight.sequenceNumber;
    inflight.sequenceNumber += 1;
    return n;
}

function safeEnqueue(frame: string) {
    if (!inflight || inflight.closed) return;
    try {
        inflight.controller.enqueue(inflight.encoder.encode(frame));
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
 */
export function inflightEnqueue(event: string, data: any) {
    if (!inflight || inflight.closed) return;
    safeEnqueue(sseFrame(event, data));
}

/**
 * Terminal close. Optionally sends a final SSE event (e.g. response.error),
 * then sends the OpenAI-ish terminal sentinel `[DONE]` and closes the stream.
 */
export function inflightTerminate(finalEvent: string | null = null, finalData: any = null) {
    if (!inflight || inflight.closed) return;
    inflight.closed = true;

    try {
        clearTimeout(inflight.timeoutHandle);
    } catch {}

    // Best-effort final event (errors typically)
    if (finalEvent && finalData != null) {
        try {
            safeEnqueue(sseFrame(finalEvent, finalData));
        } catch {}
    }

    // Terminal sentinel
    try {
        safeEnqueue(sseFrame(null, '[DONE]'));
    } catch {}

    try {
        inflight.controller.close();
    } catch {}

    inflight = null;
}

// ----------------------------
// OpenAI-like event emitters
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

    const item = {
        id: inflight.messageItemId,
        type: 'message',
        status: 'in_progress',
        content: [],
        role: 'assistant',
    };

    // Keep response.output authoritative
    inflight.response.output = inflight.response.output || [];
    inflight.response.output.push(item as any);

    inflightEnqueue('response.output_item.added', {
        type: 'response.output_item.added',
        item,
        output_index: inflight.outputIndex,
        sequence_number: nextSeq(),
    });
}

export function emitContentPartAdded() {
    if (!inflight) return;

    const part = {
        type: 'output_text',
        annotations: [],
        logprobs: [],
        text: '',
    };

    // Attach the part to the output message content array
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
        // OpenAI sometimes includes `obfuscation`. It is not required for clients.
        // If you want it, you could add a short random token here.
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

    const part = {
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

    const item = {
        id: inflight.messageItemId,
        type: 'message',
        status: 'completed',
        content: [
            {
                type: 'output_text',
                annotations: [],
                logprobs: [],
                text: fullText,
            },
        ],
        role: 'assistant',
    };

    // Ensure response.output reflects final content
    if (Array.isArray(inflight.response.output)) {
        inflight.response.output[inflight.outputIndex] = item as any;
    } else {
        inflight.response.output = [item as any];
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

    // completed_at in unix seconds when terminal
    if (status !== 'in_progress') {
        inflight.response.completed_at = Math.floor(Date.now() / 1000);
    }

    // Keep convenience snapshot
    if (typeof inflight.lastText === 'string') {
        inflight.response.output_text = inflight.lastText;
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
