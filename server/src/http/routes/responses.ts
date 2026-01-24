import {getSoleClient, sendToSoleClient} from '../../ws/hub';
import {
    getInflight,
    createInflight,
    inflightClose,
    emitResponseCompleted,
    emitResponseCreated,
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
    console.log('>>>', body);

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
    console.log(prompt);

    const id = `resp_${crypto.randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const timeoutHandle = setTimeout(() => {
                // timeout as OpenAI-like error + completed + DONE
                if (!getInflight()) return;
                emitResponseCompleted('error', {
                    error: 'Timed out waiting for extension SSE',
                });
                inflightClose('response.error', {
                    type: 'response.error',
                    error: {message: 'Timed out waiting for extension SSE'},
                });
            }, 60_000);

            const outputTextItemId = `item_${crypto.randomUUID()}`;

            // Minimal OpenAI Responses "response" object
            const responseObj = {
                id,
                object: 'response' as const,
                created,
                status: 'in_progress' as const,
                // Best-effort, since we don't know the model slug reliably here
                model: null,
                // Provide request input for traceability
                input: prompt,
                // Provide a minimal output scaffold
                output: [
                    {
                        id: outputTextItemId,
                        object: 'output_text' as const,
                        content: [],
                    },
                ],
                output_text: '',
            };

            createInflight({
                id,
                created,
                controller,
                encoder,
                response: responseObj,
                outputTextItemId,
                timeoutHandle,
            });

            // Send prompt to extension
            const ok = sendToSoleClient({type: 'prompt', id, created, input: prompt});
            if (!ok) {
                emitResponseCompleted('error', {
                    error: 'Failed to send prompt to WS client',
                });
                inflightClose('response.error', {
                    type: 'response.error',
                    error: {message: 'Failed to send prompt to WS client'},
                });
                return;
            }

            // OpenAI-style created event
            emitResponseCreated();
        },

        cancel() {
            const currentInflight = getInflight();
            if (currentInflight && currentInflight.id === id) {
                emitResponseCompleted('cancelled', {reason: 'client_disconnected'});
                inflightClose('response.cancelled', {
                    type: 'response.cancelled',
                    response_id: id,
                });
            }
        },
    });

    return new Response(stream, {
        status: 200,
        headers: sseResponseHeaders(cors),
    });
}
