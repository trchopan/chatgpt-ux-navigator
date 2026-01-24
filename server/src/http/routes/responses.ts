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
import {corsHeaders} from '../cors';

/**
 * Extracts the user prompt from the request body.
 * Supports simple strings, OpenAI-like message arrays, and prompt/input fields.
 */
function extractUserPrompt(body: any): string | null {
    if (!body) return null;

    // Helper: normalize OpenAI-style content into text
    function extractText(content: any): string | null {
        if (!content) return null;

        if (typeof content === 'string') {
            return content.trim() || null;
        }

        if (Array.isArray(content)) {
            const parts: string[] = [];
            for (const part of content) {
                if (!part) continue;
                if (typeof part === 'string') {
                    if (part.trim()) parts.push(part.trim());
                } else if (typeof part.text === 'string' && part.text.trim()) {
                    parts.push(part.text.trim());
                }
            }
            return parts.join('\n').trim() || null;
        }

        return null;
    }

    // Fast paths
    if (typeof body.input === 'string' && body.input.trim()) return body.input.trim();
    if (typeof body.prompt === 'string' && body.prompt.trim()) return body.prompt.trim();

    // OpenAI-ish shape
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
            systemMessages.push(text);
        }
    }

    const combinedUserText = userMessages.join('\n\n').trim();
    const combinedSystemText = systemMessages.join('\n\n').trim();

    if (!combinedUserText) return null;

    if (combinedSystemText) {
        return `# INSTRUCTION\n\n${combinedSystemText}\n\n# REQUEST\n\n${combinedUserText}`;
    }

    return combinedUserText;
}

/**
 * Creates the initial response object structure.
 */
function createResponseObject(id: string, createdAt: number, body: any, prompt: string) {
    return {
        id,
        object: 'response',
        created_at: createdAt,
        status: 'in_progress',
        background: false,
        billing: {payer: 'developer'},
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
        output_text: '',
        input: prompt,
        meta: {},
    };
}

/**
 * Handles streaming responses (SSE).
 */
function handleStreamingResponse(
    id: string,
    createdAt: number,
    prompt: string,
    responseObj: any,
    messageItemId: string,
    timeoutMs: number
): Response {
    const encoder = new TextEncoder();
    const cors = corsHeaders();

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const timeoutHandle = setTimeout(() => {
                if (!getInflight()) return;

                emitResponseCompleted('error', {error: 'Timed out waiting for extension SSE'});
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

            const ok = sendToSoleClient({type: 'prompt', id, created: createdAt, input: prompt});
            if (!ok) {
                emitResponseCompleted('error', {error: 'Failed to send prompt to WS client'});
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

/**
 * Handles JSON responses (Promise-based).
 */
async function handleJsonResponse(
    id: string,
    createdAt: number,
    prompt: string,
    responseObj: any,
    messageItemId: string,
    timeoutMs: number,
    cors: Record<string, string>
): Promise<Response> {
    try {
        const result = await new Promise<any>((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
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
                emitResponseCompleted('error', {error: 'Failed to send prompt to WS client'});
                inflightTerminate(null, null);
                reject(new Error('Failed to send prompt to WS client'));
                return;
            }

            emitResponseCreated();
            emitResponseInProgress();
            emitOutputItemAdded();
            emitContentPartAdded();
        });

        return new Response(JSON.stringify(result, null, 2), {
            status: 200,
            headers: {...cors, 'Content-Type': 'application/json; charset=utf-8'},
        });
    } catch (err) {
        const message = String((err as any)?.message || err || 'Unknown error');
        const errorResponse = {
            ...responseObj,
            status: 'error',
            completed_at: Math.floor(Date.now() / 1000),
            error: {message},
        };
        return new Response(JSON.stringify(errorResponse, null, 2), {
            status: 200, // Or 500? The original code returns 200 with error field
            headers: {...cors, 'Content-Type': 'application/json; charset=utf-8'},
        });
    }
}

/**
 * Controller for POST /responses
 */
export async function handlePostResponses(
    req: Request,
    cfg: AppConfig,
    url: URL
): Promise<Response> {
    const cors = corsHeaders();

    if (getInflight()) {
        return new Response(
            JSON.stringify({error: 'Another /responses request is already in-flight.'}),
            {status: 409, headers: {...cors, 'Content-Type': 'application/json'}}
        );
    }

    if (!getSoleClient()) {
        return new Response(JSON.stringify({error: 'No WebSocket client connected (/ws).'}), {
            status: 503,
            headers: {...cors, 'Content-Type': 'application/json'},
        });
    }

    let body: any;
    try {
        body = await req.json();
    } catch {
        return new Response(JSON.stringify({error: 'Invalid JSON'}), {
            status: 400,
            headers: {...cors, 'Content-Type': 'application/json'},
        });
    }

    const prompt = extractUserPrompt(body);
    if (!prompt) {
        return new Response(
            JSON.stringify({
                error: 'Missing user prompt. Provide {input:"..."} or {input:[{role:"user",content:"..."}]}.',
            }),
            {status: 400, headers: {...cors, 'Content-Type': 'application/json'}}
        );
    }

    const requestedStream = body?.stream === true;
    const shouldStream = requestedStream && !cfg.noStream;

    const id = `resp_${crypto.randomUUID()}`;
    const createdAt = Math.floor(Date.now() / 1000);
    const messageItemId = `msg_${crypto.randomUUID()}`;
    const timeoutMs = 60_000;

    const responseObj = createResponseObject(id, createdAt, body, prompt);

    if (shouldStream) {
        return handleStreamingResponse(
            id,
            createdAt,
            prompt,
            responseObj,
            messageItemId,
            timeoutMs
        );
    } else {
        return handleJsonResponse(
            id,
            createdAt,
            prompt,
            responseObj,
            messageItemId,
            timeoutMs,
            cors
        );
    }
}
