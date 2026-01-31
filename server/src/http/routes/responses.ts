import type {AppConfig} from '../../config/config';
import {applyPromptTemplate} from '../../prompts/resolveIncludes';
import {getSoleClient, sendToSoleClient, getClient, sendToClient} from '../../ws/hub';
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
    createTemporaryChat: boolean,
    clientId?: string
): boolean {
    const type = createTemporaryChat ? 'prompt.new' : 'prompt';
    const msg = {type, id, created: createdAt, input: prompt};
    
    if (clientId) {
        return sendToClient(clientId, msg);
    } else {
        return sendToSoleClient(msg);
    }
}

function handleStreamingResponse(
    id: string,
    createdAt: number,
    prompt: string,
    responseObj: any,
    messageItemId: string,
    timeoutMs: number,
    createTemporaryChat: boolean,
    clientId?: string
): Response {
    const encoder = new TextEncoder();
    const cors = corsHeaders();

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const timeoutHandle = setTimeout(() => {
                if (!getInflight(clientId)) return;

                emitResponseCompleted(clientId, 'error', {error: 'Timed out waiting for extension SSE'});
                inflightTerminate(clientId, 'response.error', {
                    type: 'response.error',
                    error: {message: 'Timed out waiting for extension SSE'},
                });
            }, timeoutMs);

            if (clientId) {
                createInflight(clientId, {
                    id,
                    createdAt,
                    mode: 'stream',
                    controller,
                    encoder,
                    timeoutHandle,
                    response: responseObj,
                    messageItemId,
                });
            } else {
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
            }

            const ok = sendPromptToExtension(id, createdAt, prompt, createTemporaryChat, clientId);
            if (!ok) {
                emitResponseCompleted(clientId, 'error', {error: 'Failed to send prompt to WS client'});
                inflightTerminate(clientId, 'response.error', {
                    type: 'response.error',
                    error: {message: 'Failed to send prompt to WS client'},
                });
                return;
            }

            emitResponseCreated(clientId);
            emitResponseInProgress(clientId);
            emitOutputItemAdded(clientId);
            emitContentPartAdded(clientId);
        },

        cancel() {
            const currentInflight = getInflight(clientId);
            if (currentInflight && currentInflight.id === id) {
                emitResponseCompleted(clientId, 'cancelled', {reason: 'client_disconnected'});
                inflightTerminate(clientId, 'response.cancelled', {
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
    createTemporaryChat: boolean,
    clientId?: string
): Promise<Response> {
    try {
        const result = await new Promise<any>((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                const current = getInflight(clientId);
                if (current && current.id === id) {
                    emitResponseCompleted(clientId, 'error', {error: 'Timed out waiting for extension SSE'});
                    inflightTerminate(clientId, null, null);
                }
                reject(new Error('Timed out waiting for completion'));
            }, timeoutMs);

            if (clientId) {
                createInflight(clientId, {
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
            } else {
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
            }

            const ok = sendPromptToExtension(id, createdAt, prompt, createTemporaryChat, clientId);
            if (!ok) {
                emitResponseCompleted(clientId, 'error', {error: 'Failed to send prompt to WS client'});
                inflightTerminate(clientId, null, null);
                reject(new Error('Failed to send prompt to WS client'));
                return;
            }

            emitResponseCreated(clientId);
            emitResponseInProgress(clientId);
            emitOutputItemAdded(clientId);
            emitContentPartAdded(clientId);
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
            status: 200,
            headers: {...cors, 'Content-Type': 'application/json; charset=utf-8'},
        });
    }
}

/**
 * Shared implementation details for /responses endpoints.
 */
type ResponseHandlerOptions = {
    createTemporaryChat: boolean;
    clientId?: string;
};

async function handleResponsesRequest(
    req: Request,
    cfg: AppConfig,
    url: URL,
    opts: ResponseHandlerOptions
): Promise<Response> {
    const {createTemporaryChat, clientId} = opts;
    const cors = corsHeaders();

    // Check inflight for specific clientId (or default if no clientId)
    if (getInflight(clientId)) {
        const clientDisplay = clientId ? `'${clientId}'` : 'default';
        return new Response(
            JSON.stringify({error: `Another request in-flight for client ${clientDisplay}.`}),
            {status: 409, headers: {...cors, 'Content-Type': 'application/json'}}
        );
    }

    // If clientId provided, verify client is connected
    let targetClient: WebSocket | null = null;
    if (clientId) {
        targetClient = getClient(clientId);
        if (!targetClient) {
            return new Response(
                JSON.stringify({error: `Client '${clientId}' not connected.`}),
                {status: 404, headers: {...cors, 'Content-Type': 'application/json'}}
            );
        }
    } else {
        // Old behavior: check sole client
        if (!getSoleClient()) {
            return new Response(JSON.stringify({error: 'No WebSocket client connected (/ws).'}), {
                status: 503,
                headers: {...cors, 'Content-Type': 'application/json'},
            });
        }
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

    const rawPrompt = extractUserPrompt(body);
    if (!rawPrompt) {
        return new Response(
            JSON.stringify({
                error: 'Missing user prompt. Provide {input:"..."} or {input:[{role:"user",content:"..."}]}.',
            }),
            {status: 400, headers: {...cors, 'Content-Type': 'application/json'}}
        );
    }

    const prompt = await applyPromptTemplate(rawPrompt, cfg.filesRoot);

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
            createTemporaryChat,
            clientId
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
            createTemporaryChat,
            clientId
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

/**
 * Controller for POST /responses/:id (per-client, reuses existing chat)
 */
export async function handlePostResponsesById(
    req: Request,
    cfg: AppConfig,
    url: URL
): Promise<Response> {
    const pathParts = url.pathname.split('/');
    const clientId = pathParts[pathParts.length - 1];

    if (!clientId || clientId.trim() === '') {
        return new Response(
            JSON.stringify({error: 'Client ID is required in the URL path'}),
            {
                status: 400,
                headers: {'Content-Type': 'application/json'},
            }
        );
    }

    return handleResponsesRequest(req, cfg, url, {createTemporaryChat: false, clientId});
}

/**
 * Controller for POST /responses/:id/new (per-client, forces new temporary chat)
 */
export async function handlePostResponsesByIdNew(
    req: Request,
    cfg: AppConfig,
    url: URL
): Promise<Response> {
    const pathParts = url.pathname.split('/');
    pathParts.pop();
    const clientId = pathParts[pathParts.length - 1];

    if (!clientId || clientId.trim() === '') {
        return new Response(
            JSON.stringify({error: 'Client ID is required in the URL path'}),
            {
                status: 400,
                headers: {'Content-Type': 'application/json'},
            }
        );
    }

    return handleResponsesRequest(req, cfg, url, {createTemporaryChat: true, clientId});
}
