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

    function extractText(content: any): string | null {
        if (!content) return null;

        if (typeof content === 'string') {
            const trimmed = content.trim();
            return trimmed ? trimmed : null;
        }

        if (typeof content === 'object' && typeof content.text === 'string') {
            const trimmed = content.text.trim();
            return trimmed ? trimmed : null;
        }

        if (Array.isArray(content)) {
            const parts: string[] = [];
            for (const part of content) {
                const text = extractText(part);
                if (text) parts.push(text);
            }
            if (parts.length) {
                const joined = parts.join('\n').trim();
                return joined ? joined : null;
            }
        }

        return null;
    }

    const fromMessages = (messages: any): string | null => {
        if (!Array.isArray(messages)) return null;
        const userMessages: string[] = [];

        for (const msg of messages) {
            if (!msg) continue;
            const role = typeof msg.role === 'string' ? msg.role.toLowerCase() : 'user';
            if (role !== 'user') continue;

            const text = extractText(msg.content ?? msg.message ?? msg.text);
            if (text) {
                userMessages.push(text);
            }
        }

        if (userMessages.length === 0) return null;
        return userMessages.join('\n\n').trim() || null;
    };

    if (typeof body.input === 'string' && body.input.trim()) {
        return body.input.trim();
    }

    if (typeof body.prompt === 'string' && body.prompt.trim()) {
        return body.prompt.trim();
    }

    const listPrompt = fromMessages(body.input);
    if (listPrompt) return listPrompt;

    const messagePrompt = fromMessages(body.messages);
    if (messagePrompt) return messagePrompt;

    return null;
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
function sendPromptToExtension(
    id: string,
    createdAt: number,
    prompt: string,
    createTemporaryChat: boolean
): boolean {
    const type = createTemporaryChat ? 'prompt.new' : 'prompt';
    return sendToSoleClient({type, id, created: createdAt, input: prompt});
}

function handleStreamingResponse(
    id: string,
    createdAt: number,
    prompt: string,
    responseObj: any,
    messageItemId: string,
    timeoutMs: number,
    createTemporaryChat: boolean
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

            const ok = sendPromptToExtension(id, createdAt, prompt, createTemporaryChat);
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
    cors: Record<string, string>,
    createTemporaryChat: boolean
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

            const ok = sendPromptToExtension(id, createdAt, prompt, createTemporaryChat);
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
 * Shared implementation details for /responses endpoints.
 */
type ResponseHandlerOptions = {
    createTemporaryChat: boolean;
};

async function handleResponsesRequest(
    req: Request,
    cfg: AppConfig,
    url: URL,
    opts: ResponseHandlerOptions
): Promise<Response> {
    const {createTemporaryChat} = opts;
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
            timeoutMs,
            createTemporaryChat
        );
    } else {
        return handleJsonResponse(
            id,
            createdAt,
            prompt,
            responseObj,
            messageItemId,
            timeoutMs,
            cors,
            createTemporaryChat
        );
    }
}

/**
 * Controller for POST /responses (reuses existing chat)
 */
export function handlePostResponses(
    req: Request,
    cfg: AppConfig,
    url: URL
): Promise<Response> {
    return handleResponsesRequest(req, cfg, url, {createTemporaryChat: false});
}

/**
 * Controller for POST /responses/new (forces new temporary chat)
 */
export function handlePostResponsesNew(
    req: Request,
    cfg: AppConfig,
    url: URL
): Promise<Response> {
    return handleResponsesRequest(req, cfg, url, {createTemporaryChat: true});
}
