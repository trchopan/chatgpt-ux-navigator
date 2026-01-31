import type {ServerWebSocket} from 'bun';
import type {WsData} from '../types/ws';
import {setClient, removeClient, getClient} from './hub';
import {safeParseJson} from './parse';
import {extractTextUpdateFromChatGPTPayload, computeDelta} from './extract';
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
        const clientId = ws.data.clientId;
        if (!clientId) {
            ws.close();
            return;
        }
        setClient(clientId, ws as unknown as WebSocket);
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
        const clientId = ws.data.clientId;

        const inflight = getInflight(clientId);

        if (inflight) {
            if (t === 'sse') {
                const upd = extractTextUpdateFromChatGPTPayload(obj);

                if (upd && typeof upd.text === 'string' && upd.text.length > 0) {
                    if (upd.mode === 'full') {
                        const fullText = upd.text;
                        const delta = computeDelta(fullText, inflight.lastText);

                        if (delta) {
                            inflight.lastText = fullText;
                            inflight.response.output_text = fullText;
                            emitOutputTextDelta(clientId, delta);
                        }
                    } else {
                        const delta = upd.text;
                        inflight.lastText = (inflight.lastText || '') + delta;
                        inflight.response.output_text = inflight.lastText;
                        emitOutputTextDelta(clientId, delta);
                    }
                } else {
                    emitGenericEvent(clientId, obj);
                }
            } else if (t === 'done') {
                const full = typeof inflight.lastText === 'string' ? inflight.lastText : '';
                emitOutputTextDone(clientId, full);
                emitContentPartDone(clientId, full);
                emitOutputItemDone(clientId, full);

                emitResponseCompleted(clientId, 'completed');
                inflightTerminate(clientId, null, null);
                return;
            } else if (t === 'closed') {
                const full = typeof inflight.lastText === 'string' ? inflight.lastText : '';
                emitOutputTextDone(clientId, full);
                emitContentPartDone(clientId, full);
                emitOutputItemDone(clientId, full);

                emitResponseCompleted(clientId, 'completed', {reason: 'stream_closed'});
                inflightTerminate(clientId, null, null);
                return;
            } else if (t === 'error') {
                emitResponseCompleted(clientId, 'error', {reason: 'extension_error'});
                inflightTerminate(clientId, 'response.error', {
                    type: 'response.error',
                    error: {message: 'Extension reported error', detail: obj},
                });
                return;
            } else {
                emitGenericEvent(clientId, obj);
            }
        }
    },

    close(ws: ServerWebSocket<WsData>) {
        const clientId = ws.data.clientId;
        if (clientId) {
            removeClient(clientId);
        }
        const inflight = getInflight(clientId);
        if (inflight) {
            emitResponseCompleted(clientId, 'error', {error: 'WebSocket closed'});
            inflightTerminate(clientId, 'response.error', {
                type: 'response.error',
                error: {message: 'WebSocket closed'},
            });
        }
    },
};
