import type {ServerWebSocket} from 'bun';
import type {WsData} from '../types/ws';
import {setSoleClient} from './hub';
import {safeParseJson} from './parse';
import {extractTextUpdateFromChatGPTPayload, computeDelta} from './extract';
import {sanitizeAssistantText} from '../http/responses/sanitize';
import {
    getInflight,
    inflightTerminate,
    emitResponseCompleted,
    emitOutputTextDelta,
    emitOutputTextDone,
    emitContentPartDone,
    emitOutputItemDone,
    emitGenericEvent,
} from '../http/responses/inflight';

export const websocketHandlers = {
    open(ws: ServerWebSocket<WsData>) {
        // Single-client assumption: newest connection wins.
        setSoleClient(ws as unknown as WebSocket);
        ws.send(JSON.stringify({type: 'welcome', at: Date.now()}));
    },

    message(ws: ServerWebSocket<WsData>, message: string | Uint8Array) {
        const text =
            typeof message === 'string'
                ? message
                : Buffer.from(message as Uint8Array).toString('utf8');

        const obj = safeParseJson(text);
        if (!obj) {
            console.log('[ws] non-json message:', text.slice(0, 300));
            return;
        }

        const t = String(obj.type || '');

        // If a /responses call is in-flight, forward extension stream events into OpenAI SSE.
        const inflight = getInflight();
            if (inflight) {
                if (t === 'sse') {
                    const upd = extractTextUpdateFromChatGPTPayload(obj);

                    if (upd && typeof upd.text === 'string' && upd.text.length > 0) {
                        console.log('[responses] sse update', {mode: upd.mode, text: upd.text});
                        if (upd.mode === 'full') {
                        const fullText = upd.text;
                        const delta = computeDelta(fullText, inflight.lastText);

                        if (delta) {
                            inflight.lastText = fullText;
                            inflight.response.output_text = fullText;
                            emitOutputTextDelta(delta);
                        }
                        // If delta is null, text didn't change; do nothing.
                    } else {
                        // delta-only mode: append
                        const delta = upd.text;
                        inflight.lastText = (inflight.lastText || '') + delta;
                        inflight.response.output_text = inflight.lastText;
                        emitOutputTextDelta(delta);
                    }
                } else {
                    // No text extracted; pass through as a generic OpenAI-like event (optional)
                    // This is useful for debugging unknown payload shapes.
                    emitGenericEvent(obj);
                }
            } else if (t === 'done') {
                const full = typeof inflight.lastText === 'string' ? inflight.lastText : '';
                const sanitizedFull = sanitizeAssistantText(full);
                console.log(
                    '[responses] done raw=' + JSON.stringify(full) + ' sanitized=' + JSON.stringify(sanitizedFull)
                );

                emitOutputTextDone(full);
                emitContentPartDone(full);
                emitOutputItemDone(full);

                emitResponseCompleted('completed');
                inflightTerminate(null, null);
                return;
            } else if (t === 'closed') {
                const full = typeof inflight.lastText === 'string' ? inflight.lastText : '';
                const sanitizedFull = sanitizeAssistantText(full);
                console.log(
                    '[responses] stream_closed raw=' + JSON.stringify(full) +
                        ' sanitized=' + JSON.stringify(sanitizedFull)
                );

                emitOutputTextDone(full);
                emitContentPartDone(full);
                emitOutputItemDone(full);

                emitResponseCompleted('completed', {reason: 'stream_closed'});
                inflightTerminate(null, null);
                return;
            } else if (t === 'error') {
                emitResponseCompleted('error', {reason: 'extension_error'});
                inflightTerminate('response.error', {
                    type: 'response.error',
                    error: {message: 'Extension reported error', detail: obj},
                });
                return;
            } else {
                emitGenericEvent(obj);
            }
        }
    },

    close(ws: ServerWebSocket<WsData>) {
        const inflight = getInflight();
        if (inflight) {
            emitResponseCompleted('error', {error: 'WebSocket closed'});
            inflightTerminate('response.error', {
                type: 'response.error',
                error: {message: 'WebSocket closed'},
            });
        }
    },
};
