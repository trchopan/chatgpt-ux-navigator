import type {ServerWebSocket} from 'bun';
import type {WsData} from '../types/ws';
import {setSoleClient} from './hub';
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

function debugSample(obj: any, label: string) {
    try {
        const metaUrl = obj?.payload?.meta?.url ? String(obj.payload.meta.url) : '';
        const event = obj?.payload?.event ?? null;

        // Try to show a small, stable "shape" summary
        const j = obj?.payload?.json;
        const keys = j && typeof j === 'object' ? Object.keys(j).slice(0, 25) : null;

        // Extract likely text-bearing paths (best-effort peek)
        const p1 = j?.message?.content?.parts;
        const p1Type = Array.isArray(p1) ? `array(len=${p1.length})` : typeof p1;

        const t2 = j?.message?.content?.text;
        const t2Type = typeof t2;

        const d1 = j?.delta;
        const d1Type = typeof d1;

        const c0 = j?.choices?.[0];
        const c0Keys = c0 && typeof c0 === 'object' ? Object.keys(c0).slice(0, 20) : null;

        const cDelta = j?.choices?.[0]?.delta;
        const cDeltaType = typeof cDelta;

        const cDeltaContent = j?.choices?.[0]?.delta?.content;
        const cDeltaContentType = typeof cDeltaContent;

        console.log(
            `[ws][dbg:${label}] type=${String(obj?.type)} event=${String(event)} url=${metaUrl}`
        );
        console.log(`[ws][dbg:${label}] json keys:`, keys);
        console.log(`[ws][dbg:${label}] message.content.parts:`, p1Type);
        console.log(`[ws][dbg:${label}] message.content.text:`, t2Type);
        console.log(`[ws][dbg:${label}] delta:`, d1Type);
        console.log(`[ws][dbg:${label}] choices[0] keys:`, c0Keys);
        console.log(`[ws][dbg:${label}] choices[0].delta type:`, cDeltaType);
        console.log(`[ws][dbg:${label}] choices[0].delta.content type:`, cDeltaContentType);

        // Print short previews (avoid huge logs)
        function preview(v: any) {
            if (typeof v === 'string') return v.slice(0, 200);
            try {
                return JSON.stringify(v).slice(0, 200);
            } catch {
                return String(v).slice(0, 200);
            }
        }

        if (typeof t2 === 'string')
            console.log(`[ws][dbg:${label}] message.content.text preview:`, preview(t2));
        if (typeof d1 === 'string') console.log(`[ws][dbg:${label}] delta preview:`, preview(d1));
        if (typeof cDeltaContent === 'string')
            console.log(
                `[ws][dbg:${label}] choices[0].delta.content preview:`,
                preview(cDeltaContent)
            );

        if (Array.isArray(p1) && p1.length) {
            console.log(`[ws][dbg:${label}] parts[0] type:`, typeof p1[0]);
            console.log(`[ws][dbg:${label}] parts[0] preview:`, preview(p1[0]));
        }
        // Print payload.raw if present (common when JSON.parse fails in pageHook)
        const raw = obj?.payload?.raw;
        if (typeof raw === 'string' && raw) {
            console.log(`[ws][dbg:${label}] payload.raw preview:`, raw.slice(0, 400));
        }

        // If compact {v,c} exists, print both
        if (j && typeof j === 'object' && 'v' in j && 'c' in j) {
            const v = (j as any).v;
            const c = (j as any).c;
            console.log(`[ws][dbg:${label}] compact v:`, v);
            if (typeof c === 'string')
                console.log(`[ws][dbg:${label}] compact c preview:`, c.slice(0, 400));
            else console.log(`[ws][dbg:${label}] compact c type:`, typeof c);
        }

        // Also dump the small json object if it is small
        try {
            const js = j && typeof j === 'object' ? JSON.stringify(j) : null;
            if (js && js.length < 1200) {
                console.log(`[ws][dbg:${label}] payload.json full:`, js);
            }
        } catch {}
    } catch (e) {
        console.log('[ws][dbg] failed:', String((e as any)?.message || e));
    }
}

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
        const metaUrl = obj?.payload?.meta?.url ? String((obj as any).payload.meta.url) : '';

        // If a /responses call is in-flight, forward extension stream events into OpenAI SSE.
        const inflight = getInflight();
        if (inflight) {
            // Debug counters for this HTTP request
            (inflight as any)._dbg = (inflight as any)._dbg || {
                sse: 0,
                done: 0,
                closed: 0,
                error: 0,
            };

            if (t === 'sse') {
                (inflight as any)._dbg.sse++;
                if ((inflight as any)._dbg.sse === 1) {
                    debugSample(obj, 'first-sse');
                }
                // Also sample occasionally
                if ((inflight as any)._dbg.sse === 5) {
                    debugSample(obj, 'sse-5');
                }

                if ((inflight as any)._dbg.sse === 10) {
                    debugSample(obj, 'sse-10');
                }

                const upd = extractTextUpdateFromChatGPTPayload(obj);

                if (upd && typeof upd.text === 'string' && upd.text.length > 0) {
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

                if (upd?.text && (inflight as any)._dbg?.sse % 5 === 0) {
                    console.log('[ws][dbg] lastTextLen now=', (inflight.lastText || '').length);
                }
            } else if (t === 'done') {
                (inflight as any)._dbg.done++;
                console.log(
                    '[ws][dbg] DONE received. counts=',
                    (inflight as any)._dbg,
                    'lastTextLen=',
                    (inflight.lastText || '').length
                );

                const full = typeof inflight.lastText === 'string' ? inflight.lastText : '';

                emitOutputTextDone(full);
                emitContentPartDone(full);
                emitOutputItemDone(full);

                emitResponseCompleted('completed');
                inflightTerminate(null, null);
                return;
            } else if (t === 'closed') {
                (inflight as any)._dbg.closed++;
                console.log(
                    '[ws][dbg] CLOSED received. counts=',
                    (inflight as any)._dbg,
                    'lastTextLen=',
                    (inflight.lastText || '').length
                );

                const full = typeof inflight.lastText === 'string' ? inflight.lastText : '';

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

        if (t) console.log('[ws]', t, metaUrl);
        else console.log('[ws] message:', obj);
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
