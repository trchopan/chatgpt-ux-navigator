import type {AppConfig} from '../../config/config';
import {getSoleClient, sendToSoleClient} from '../../ws/hub';
import {
    getInflight,
    createInflight,
    inflightTerminate,
    emitResponseCompleted,
    emitResponseCreated,
    emitResponseInProgress,
    emitOutputItemAdded,
    emitContentPartAdded,
} from '../responses/inflight';
import {sseResponseHeaders} from '../responses/sse';

function extractUserPromptFromResponsesBody(body: any): string | null {
    if (!body) return null;

    // Helper: normalize OpenAI-style content into text
    function extractText(content: any): string | null {
        if (!content) return null;

        if (typeof content === 'string') {
            const t = content.trim();
            return t || null;
        }

        if (Array.isArray(content)) {
            const parts: string[] = [];
            for (const part of content) {
                if (!part) continue;

                if (typeof part === 'string') {
                    if (part.trim()) parts.push(part.trim());
                    continue;
                }

                if (typeof part.text === 'string' && part.text.trim()) {
                    parts.push(part.text.trim());
                    continue;
                }
            }
            const joined = parts.join('\n').trim();
            return joined || null;
        }

        return null;
    }

    // Fast paths: single-string inputs (no system context possible)
    if (typeof body.input === 'string' && body.input.trim()) {
        return body.input.trim();
    }

    if (typeof body.prompt === 'string' && body.prompt.trim()) {
        return body.prompt.trim();
    }

    // OpenAI-ish shape: input: [{ role, content }]
    const input = body.input;
    if (!Array.isArray(input)) return null;

    const systemMessages: string[] = [];
    const userMessages: string[] = [];

    for (const msg of input) {
        if (!msg || !msg.role) continue;

        const role = String(msg.role).toLowerCase();
        const text = extractText(msg.content);
        if (!text) continue;

        if (role === 'user') {
            userMessages.push(text);
        } else {
            // Treat all non-user roles (e.g., 'system', 'developer') as system messages
            systemMessages.push(text);
        }
    }

    const combinedUserText = userMessages.join('\n\n').trim();
    const combinedSystemText = systemMessages.join('\n\n').trim();

    if (!combinedUserText) return null;

    if (combinedSystemText) {
        return `# INSTRUCTION\n\n` + combinedSystemText + `\n\n# REQUEST\n\n` + combinedUserText;
    }

    return combinedUserText;
}
export async function handlePostResponses(
    req: Request,
    cors: Record<string, string>,
    cfg: AppConfig
): Promise<Response> {
    const inflight = getInflight();
    if (inflight) {
        return new Response(
            JSON.stringify({error: 'Another /responses request is already in-flight.'}),
            {
                status: 409,
                headers: {...cors, 'Content-Type': 'application/json'},
            }
        );
    }

    if (!getSoleClient()) {
        return new Response(JSON.stringify({error: 'No WebSocket client connected (/ws).'}), {
            status: 503,
            headers: {...cors, 'Content-Type': 'application/json'},
        });
    }

    let body: any = null;
    try {
        body = await req.json();
    } catch {
        return new Response(JSON.stringify({error: 'Invalid JSON'}), {
            status: 400,
            headers: {...cors, 'Content-Type': 'application/json'},
        });
    }

    const prompt = extractUserPromptFromResponsesBody(body);
    if (!prompt) {
        return new Response(
            JSON.stringify({
                error: 'Missing user prompt. Provide {input:"..."} or {input:[{role:"user",content:"..."}]}.',
            }),
            {
                status: 400,
                headers: {...cors, 'Content-Type': 'application/json'},
            }
        );
    }

    // OpenAI default: stream is false unless explicitly true.
    const requestedStream = body?.stream === true;
    const shouldStream = requestedStream && !cfg.noStream;

    const id = `resp_${crypto.randomUUID()}`;
    const createdAt = Math.floor(Date.now() / 1000);
    const messageItemId = `msg_${crypto.randomUUID()}`;

    // Minimal-but-shaped like OpenAI's Responses response object
    // (You can add more fields later; this is enough for format + client compatibility.)
    const responseObj: any = {
        id,
        object: 'response',
        created_at: createdAt,
        status: 'in_progress',
        background: false,
        billing: {payer: 'developer'}, // OpenAI includes billing in some responses
        completed_at: null,
        error: null,

        frequency_penalty: 0.0,
        incomplete_details: null,
        instructions: null,
        max_output_tokens: null,
        max_tool_calls: null,

        model: typeof body?.model === 'string' ? body.model : null,

        output: [],
        parallel_tool_calls: true,

        presence_penalty: 0.0,
        previous_response_id: null,
        prompt_cache_key: null,
        prompt_cache_retention: null,

        reasoning: {effort: 'none', summary: null},
        safety_identifier: null,
        service_tier: 'default',
        store: true,

        temperature: typeof body?.temperature === 'number' ? body.temperature : 1.0,
        text: {format: {type: 'text'}, verbosity: 'medium'},

        tool_choice: body?.tool_choice ?? 'auto',
        tools: Array.isArray(body?.tools) ? body.tools : [],
        top_logprobs: 0,
        top_p: typeof body?.top_p === 'number' ? body.top_p : 1.0,
        truncation: 'disabled',

        usage: null,
        user: null,
        metadata: {},

        // Convenience snapshot you already expose
        output_text: '',

        // Keep request input for traceability (not OpenAI exact, but helpful)
        input: prompt,

        meta: {},
    };

    // Shared timeout setup
    const timeoutMs = 60_000;

    if (shouldStream) {
        const encoder = new TextEncoder();

        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                const timeoutHandle = setTimeout(() => {
                    if (!getInflight()) return;

                    emitResponseCompleted('error', {
                        error: 'Timed out waiting for extension SSE',
                    });

                    inflightTerminate('response.error', {
                        type: 'response.error',
                        error: {message: 'Timed out waiting for extension SSE'},
                    });
                }, timeoutMs);

                createInflight({
                    id,
                    createdAt,
                    mode: 'stream',
                    controller,
                    encoder,
                    timeoutHandle,
                    response: responseObj,
                    messageItemId,
                });

                const ok = sendToSoleClient({
                    type: 'prompt',
                    id,
                    created: createdAt,
                    input: prompt,
                });
                if (!ok) {
                    emitResponseCompleted('error', {
                        error: 'Failed to send prompt to WS client',
                    });

                    inflightTerminate('response.error', {
                        type: 'response.error',
                        error: {message: 'Failed to send prompt to WS client'},
                    });
                    return;
                }

                emitResponseCreated();
                emitResponseInProgress();
                emitOutputItemAdded();
                emitContentPartAdded();
            },

            cancel() {
                const currentInflight = getInflight();
                if (currentInflight && currentInflight.id === id) {
                    emitResponseCompleted('cancelled', {reason: 'client_disconnected'});
                    inflightTerminate('response.cancelled', {
                        type: 'response.cancelled',
                        response_id: id,
                        error: {message: 'Client disconnected'},
                    });
                }
            },
        });

        return new Response(stream, {
            status: 200,
            headers: sseResponseHeaders(cors),
        });
    }

    // ----------------------------
    // Non-stream (JSON) mode
    // ----------------------------
    const result = await new Promise<any>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
            // Timeout: finalize as error and resolve (OpenAI returns error object differently,
            // but we keep it consistent with our response shape)
            const current = getInflight();
            if (current && current.id === id) {
                emitResponseCompleted('error', {error: 'Timed out waiting for extension SSE'});
                inflightTerminate(null, null);
            }

            reject(new Error('Timed out waiting for completion'));
        }, timeoutMs);

        createInflight({
            id,
            createdAt,
            mode: 'json',
            controller: null,
            encoder: null,
            timeoutHandle,
            response: responseObj,
            messageItemId,
            jsonResolve: resolve,
            jsonReject: reject,
        });

        const ok = sendToSoleClient({type: 'prompt', id, created: createdAt, input: prompt});
        if (!ok) {
            // Resolve immediately as error-like response
            emitResponseCompleted('error', {error: 'Failed to send prompt to WS client'});
            inflightTerminate(null, null);
            reject(new Error('Failed to send prompt to WS client'));
            return;
        }

        // Maintain same internal state transitions for correctness,
        // even though no SSE is emitted.
        emitResponseCreated();
        emitResponseInProgress();
        emitOutputItemAdded();
        emitContentPartAdded();
    }).catch(err => {
        // If we failed before completion, produce a consistent JSON error response
        const message = String((err as any)?.message || err || 'Unknown error');
        return {
            ...responseObj,
            status: 'error',
            completed_at: Math.floor(Date.now() / 1000),
            error: {message},
        };
    });

    return new Response(JSON.stringify(result, null, 2), {
        status: 200,
        headers: {...cors, 'Content-Type': 'application/json; charset=utf-8'},
    });
}
