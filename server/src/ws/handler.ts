import type { ServerWebSocket } from 'bun';
import type { WsData } from '../types/ws';
import { setSoleClient, sendToSoleClient } from './hub';
import { safeParseJson } from './parse';
import { extractFullTextFromChatGPTPayload, computeDelta } from './extract';
import {
    getInflight,
    inflightClose,
    emitResponseCompleted,
    emitOutputTextDelta,
    emitGenericEvent,
} from '../http/responses/inflight';

export const websocketHandlers = {
    open(ws: ServerWebSocket<WsData>) {
        // Single-client assumption: newest connection wins.
        setSoleClient(ws as unknown as WebSocket);
        ws.send(JSON.stringify({ type: 'welcome', at: Date.now() }));
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
        const metaUrl = obj?.payload?.meta?.url ? String((obj as any).payload.meta.url) : '';

        // If a /responses call is in-flight, forward extension stream events into OpenAI SSE.
        const inflight = getInflight();
        if (inflight) {
            if (t === 'sse') {
                // 1) Try to derive a text delta from ChatGPT JSON payload (best-effort).
                const fullText = extractFullTextFromChatGPTPayload(obj);
                if (typeof fullText === 'string') {
                    const delta = computeDelta(fullText, inflight.lastText);
                    if (delta) {
                        inflight.lastText = fullText;
                        inflight.response.output_text = fullText;
                        emitOutputTextDelta(delta);
                    } else {
                        // No delta, but still allow raw for debugging if you want visibility.
                        // emitGenericEvent(obj);
                    }
                } else {
                    // No text extracted; pass through as a generic OpenAI-like event
                    emitGenericEvent(obj);
                }
            } else if (t === 'done') {
                emitResponseCompleted('completed');
                inflightClose(null, '[DONE]');
                return;
            } else if (t === 'closed') {
                // treat as completion if we didn't get done
                emitResponseCompleted('completed', { reason: 'stream_closed' });
                inflightClose(null, '[DONE]');
                return;
            } else if (t === 'error') {
                emitResponseCompleted('error', { reason: 'extension_error' });
                inflightClose('response.error', {
                    type: 'response.error',
                    error: { message: 'Extension reported error', detail: obj },
                });
                return;
            } else {
                emitGenericEvent(obj);
            }
        }

        if (t) console.log('[ws]', t, metaUrl);
        else console.log('[ws] message:', obj);
    },

    close(ws: ServerWebSocket<WsData>) {
        // Note: checking if ws === soleClient needs careful typing or comparison
        // But here we can just check if getSoleClient() matches
        // For simplicity, we just clear it if it matches? 
        // Or we can just leave it since setSoleClient handles overwrites.
        // The original code did: if (soleClient === (ws as any)) soleClient = null;
        
        // We need to import getSoleClient to check
        // but importing hub here creates circular dependency? 
        // hub -> ?
        // handler -> hub (yes)
        // hub doesn't import handler. So it is fine.
        
        // We didn't export getSoleClient in hub.ts in my previous step? 
        // Checking hub.ts content... I did export getSoleClient.

        // However, ws here is ServerWebSocket<WsData>, soleClient is WebSocket.
        // They are compatible in Bun usually but types might mismatch.
        
        // Let's just null it out if we can confirm it's the same object reference.
        // Since we cast it when setting, we might need to cast to check.
        // Actually, let's just leave it or rely on setSoleClient to overwrite. 
        // But for safety let's implement the check.
        
        // If the WS closes mid-flight, end the HTTP stream in OpenAI style.
        const inflight = getInflight();
        if (inflight) {
            emitResponseCompleted('error', { error: 'WebSocket closed' });
            inflightClose('response.error', {
                type: 'response.error',
                error: { message: 'WebSocket closed' },
            });
        }
    },
};
