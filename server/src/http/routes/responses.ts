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
    cors: Record<string, string>
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

    const id = `resp_${crypto.randomUUID()}`;
    const createdAt = Math.floor(Date.now() / 1000);
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const timeoutHandle = setTimeout(() => {
                // Timeout: emit error completion + terminate
                if (!getInflight()) return;

                emitResponseCompleted('error', {
                    error: 'Timed out waiting for extension SSE',
                });

                inflightTerminate('response.error', {
                    type: 'response.error',
                    error: {message: 'Timed out waiting for extension SSE'},
                    // NOTE: sequence_number is attached in inflightTerminate caller only if you pass it;
                    // we keep it simple here and rely on the completed event.
                });
            }, 60_000);

            const messageItemId = `msg_${crypto.randomUUID()}`;

            // OpenAI Responses-like response object (minimal-but-shaped like OpenAI)
            const responseObj: any = {
                id,
                object: 'response',
                created_at: createdAt,
                status: 'in_progress',
                background: false,
                completed_at: null,
                error: null,

                // Echo requested model if provided (best-effort)
                model: typeof body?.model === 'string' ? body.model : null,

                // OpenAI includes many tuning fields; we can default them.
                frequency_penalty: 0.0,
                presence_penalty: 0.0,
                temperature: typeof body?.temperature === 'number' ? body.temperature : 1.0,
                top_p: typeof body?.top_p === 'number' ? body.top_p : 1.0,
                truncation: 'disabled',

                // Tools fields (not used here)
                tools: Array.isArray(body?.tools) ? body.tools : [],
                tool_choice: body?.tool_choice ?? 'auto',
                parallel_tool_calls: true,

                // Output collection, starts empty
                output: [],

                // Convenience snapshot
                output_text: '',

                // Provide request input for traceability (your existing behavior)
                input: prompt,

                // OpenAI returns usage at the end; we cannot compute token counts reliably here.
                usage: null,

                metadata: {},
                meta: {},
            };

            createInflight({
                id,
                createdAt,
                controller,
                encoder,
                response: responseObj,
                messageItemId,
                timeoutHandle,
            });

            // Send prompt to extension
            const ok = sendToSoleClient({type: 'prompt', id, created: createdAt, input: prompt});
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

            // Emit OpenAI-style initial event cadence
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
