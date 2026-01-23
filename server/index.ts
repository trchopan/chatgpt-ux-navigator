// server/index.ts
import {join, resolve, isAbsolute} from 'node:path';
import {readdir, stat} from 'node:fs/promises';

const PORT = 8765;

// Usage:
//   bun run index.ts <prompts-dir> <files-root>
//
// <prompts-dir> : where .md prompt files live
// <files-root>  : root directory used to resolve @file inclusions
//
// Defaults:
//   prompts-dir -> cwd
//   files-root  -> cwd
const PROMPTS_DIR = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
const FILES_ROOT = process.argv[3] ? resolve(process.argv[3]) : process.cwd();

const SKIP_DIR_NAMES = new Set(['.git', 'node_modules', '.idea', '.vscode', 'dist', 'build']);

/**
 * Parse a prompt file into structured thread messages.
 * Expected format:
 *
 * # {{USER}}
 *
 * ...
 *
 * # {{ASSISTANT}}
 *
 * ...
 */
function parseThreadMessages(text: string): ThreadMessage[] {
    const lines = text.replace(/\r\n/g, '\n').split('\n');

    const messages: ThreadMessage[] = [];
    let currentRole: ThreadMessage['role'] | null = null;
    let buffer: string[] = [];

    function flush() {
        if (currentRole && buffer.length > 0) {
            const content = buffer.join('\n').trim();
            const hash = Bun.hash(content).toString();
            if (content) {
                messages.push({role: currentRole, content, hash});
            }
        }
        buffer = [];
    }

    for (const line of lines) {
        const headerMatch = line.match(/^#\s*\{\{(USER|ASSISTANT)\}\}\s*$/i);

        if (headerMatch) {
            flush();
            currentRole = headerMatch[1]!.toLowerCase() as ThreadMessage['role'];
            continue;
        }

        buffer.push(line);
    }

    flush();
    return messages;
}

async function appendAssistantResponse(filePath: string, response: string): Promise<void> {
    let existing = '';

    try {
        existing = await Bun.file(filePath).text();
    } catch {
        existing = '';
    }

    const block = `\n\n# {{ASSISTANT}}\n\n` + response.replace(/\r\n/g, '\n').trimEnd() + '\n';
    const next = existing.replace(/\s*$/, '') + block;

    await Bun.write(filePath, next);
}

async function concatFirstLevelFiles(absDir: string, rawDirPath: string): Promise<string[]> {
    const out: string[] = [];

    let names: string[];
    try {
        names = await readdir(absDir, {encoding: 'utf8'});
    } catch {
        return [`[ERROR: Unable to read directory: ${absDir}]`];
    }

    names.sort((a, b) => a.localeCompare(b));

    for (const name of names) {
        if (SKIP_DIR_NAMES.has(name)) continue;

        const full = join(absDir, name);

        let st;
        try {
            st = await stat(full);
        } catch {
            continue;
        }

        if (!st.isFile()) continue;

        const rawFilePath = join(rawDirPath, name);

        let content: string;
        try {
            content = await Bun.file(full).text();
        } catch {
            content = `[ERROR: Unable to read file: ${full}]`;
        }

        out.push(`**File:** ${rawFilePath}`);
        out.push('');
        out.push('```');
        out.push(content.replace(/\r\n/g, '\n').trimEnd());
        out.push('```');
        out.push('');
    }

    return out;
}

async function listPathsRecursive(absDir: string, baseDir: string = absDir): Promise<TreeNode[]> {
    const out: TreeNode[] = [];

    let names: string[];
    try {
        names = await readdir(absDir, {encoding: 'utf8'});
    } catch {
        return out;
    }

    names.sort((a, b) => a.localeCompare(b));

    for (const name of names) {
        const full = join(absDir, name);

        let st;
        try {
            st = await stat(full);
        } catch {
            continue;
        }

        if (st.isDirectory()) {
            if (SKIP_DIR_NAMES.has(name)) continue;
            const children = await listPathsRecursive(full, baseDir);
            out.push({name, type: 'directory', children});
        } else if (st.isFile()) {
            out.push({name, type: 'file'});
        }
    }

    return out;
}

function formatTree(nodes: TreeNode[], indent: string = ''): string[] {
    const lines: string[] = [];
    nodes.forEach((node, i) => {
        const isLast = i === nodes.length - 1;
        const prefix = indent + (isLast ? '└── ' : '├── ');
        lines.push(prefix + node.name);
        if (node.type === 'directory' && node.children) {
            const childIndent = indent + (isLast ? '    ' : '│   ');
            lines.push(...formatTree(node.children, childIndent));
        }
    });
    return lines;
}

function isPathInsideRoot(absPath: string, absRoot: string): boolean {
    const root = absRoot.endsWith('/') || absRoot.endsWith('\\') ? absRoot : absRoot + '/';
    const path = absPath.replace(/\\/g, '/');
    const normRoot = root.replace(/\\/g, '/');
    return path === normRoot.slice(0, -1) || path.startsWith(normRoot);
}

type ThreadMessage = {
    role: 'user' | 'assistant';
    content: string;
    hash: string;
};

type TreeNode = {
    name: string;
    type: 'file' | 'directory';
    children?: TreeNode[];
};

async function buildPrompt(filePath: string): Promise<string> {
    let md: string;
    try {
        md = await Bun.file(filePath).text();
    } catch {
        return `[ERROR: Unable to read prompt file: ${filePath}]`;
    }

    const lines = md.split('\n');
    const processedLines: string[] = [];

    for (const line of lines) {
        const match = line.match(/^\s*(@@?)(\S+)\s*$/);

        if (!match) {
            processedLines.push(line);
            continue;
        }

        const sigil = match[1]!;
        const rawPath = match[2]!;
        const absPath = isAbsolute(rawPath) ? rawPath : resolve(FILES_ROOT, rawPath);

        // Security: prevent escaping FILES_ROOT
        if (!isAbsolute(rawPath) && !isPathInsideRoot(absPath, FILES_ROOT)) {
            processedLines.push(`[ERROR: Path escapes FILES_ROOT: ${absPath}]`);
            continue;
        }

        let st;
        try {
            st = await stat(absPath);
        } catch {
            processedLines.push(`[ERROR: Path does not exist: ${absPath}]`);
            continue;
        }

        if (st.isDirectory()) {
            if (sigil === '@@') {
                const chunks = await concatFirstLevelFiles(absPath, rawPath);
                processedLines.push(...chunks);
                continue;
            }

            const tree = await listPathsRecursive(absPath);
            const formattedTree = formatTree(tree);

            processedLines.push(`\`\`\`\n${rawPath}`);
            for (const l of formattedTree) processedLines.push(l);
            processedLines.push('```');
            continue;
        }

        let content: string;
        try {
            content = await Bun.file(absPath).text();
        } catch {
            content = `[ERROR: Unable to read file: ${absPath}]`;
        }

        processedLines.push(`**File:** ${rawPath}`);
        processedLines.push('');
        processedLines.push('```');
        processedLines.push(content.replace(/\r\n/g, '\n').trimEnd());
        processedLines.push('```');
        processedLines.push('');
    }

    return processedLines.join('\n').trimEnd() + '\n';
}

// ----------------------------
// WebSocket: receive streamed events from extension + send prompts to extension
// ----------------------------
type WsData = {id: string};

type ChatGPTStreamMeta = {
    url: string;
    at: number;
    contentType: string;
};

type ChatGPTMetadata = {
    conduit_prewarmed: boolean;
    plan_type: string;
    user_agent: string;
    service: string | null;
    tool_name: string | null;
    tool_invoked: boolean;
    fast_convo: boolean;
    warmup_state: string;
    is_first_turn: boolean;
    cluster_region: string;
    model_slug: string;
    region: string | null;
    is_multimodal: boolean;
    did_auto_switch_to_reasoning: boolean;
    auto_switcher_race_winner: string | null;
    is_autoswitcher_enabled: boolean;
    is_search: boolean | null;
    did_prompt_contain_image: boolean;
    search_tool_call_count: number | null;
    search_tool_query_types: string[] | null;
    message_id: string;
    request_id: string;
    turn_exchange_id: string;
    turn_trace_id: string;
    resume_with_websockets: boolean;
    streaming_async_status: boolean;
    temporal_conversation_turn: boolean;
};

type ChatGPTServerSteMetadata = {
    type: 'server_ste_metadata';
    metadata: ChatGPTMetadata;
    conversation_id: string;
};

type ChatGPTMessageStreamComplete = {
    type: 'message_stream_complete';
    conversation_id: string;
};

type ChatGPTConversationDetailMetadata = {
    type: 'conversation_detail_metadata';
    banner_info: any | null;
    blocked_features: string[];
    model_limits: any[];
    limits_progress: any | null;
    default_model_slug: string;
    conversation_id: string;
};

type ChatGPTEventJson =
    | ChatGPTServerSteMetadata
    | ChatGPTMessageStreamComplete
    | ChatGPTConversationDetailMetadata;

type WsPayloadSse = {
    meta: ChatGPTStreamMeta;
    event: string | null;
    raw: string | null;
    json: ChatGPTEventJson;
};

type WsPayloadDoneOrClosed = {
    meta: ChatGPTStreamMeta;
    event?: null;
    raw?: null;
    json?: null;
};

type WsPayload = WsPayloadSse | WsPayloadDoneOrClosed;

type IncomingWebSocketMessage = {
    type: 'sse' | 'done' | 'closed' | 'error' | string;
    payload: WsPayload;
};

function safeParseJson(text: string): IncomingWebSocketMessage | null {
    try {
        return JSON.parse(text) as IncomingWebSocketMessage;
    } catch {
        return null;
    }
}

// --- Assumption: only 1 websocket client ---
let soleClient: WebSocket | null = null;

// --- In-flight /responses SSE proxy state (single in-flight at a time) ---
type InflightResponses = {
    id: string;
    created: number;
    controller: ReadableStreamDefaultController<Uint8Array>;
    encoder: TextEncoder;
    closed: boolean;
    timeoutHandle: any;

    // OpenAI-like response stream bookkeeping
    response: any; // minimal OpenAI Responses "response" object
    outputTextItemId: string;
    outputIndex: number;
    contentIndex: number;

    // Used to compute deltas from ChatGPT growing text
    lastText: string;
};

let inflight: InflightResponses | null = null;

function sseFrame(event: string | null, data: any): string {
    const evLine = event ? `event: ${event}\n` : '';
    let payload = '';
    if (data === '[DONE]') {
        payload = 'data: [DONE]\n\n';
        return evLine + payload;
    }

    let dataStr = '';
    try {
        dataStr = typeof data === 'string' ? data : JSON.stringify(data);
    } catch {
        dataStr = JSON.stringify({type: 'error', error: 'Could not stringify SSE payload'});
    }

    // SSE requires each line be prefixed with "data:"
    const dataLines = dataStr
        .split('\n')
        .map(l => `data: ${l}`)
        .join('\n');

    return `${evLine}${dataLines}\n\n`;
}

function inflightEnqueue(event: string | null, data: any) {
    if (!inflight || inflight.closed) return;
    try {
        inflight.controller.enqueue(inflight.encoder.encode(sseFrame(event, data)));
    } catch {
        inflightClose('response.error', {
            type: 'response.error',
            error: {message: 'Failed to enqueue SSE chunk'},
        });
    }
}

function inflightClose(finalEvent: string | null, finalData: any) {
    if (!inflight || inflight.closed) return;
    inflight.closed = true;

    try {
        clearTimeout(inflight.timeoutHandle);
    } catch {}

    // Send final event (best-effort)
    try {
        inflight.controller.enqueue(inflight.encoder.encode(sseFrame(finalEvent, finalData)));
    } catch {}

    // OpenAI-style terminal sentinel
    try {
        inflight.controller.enqueue(inflight.encoder.encode(sseFrame(null, '[DONE]')));
    } catch {}

    try {
        inflight.controller.close();
    } catch {}

    inflight = null;
}

function sendToSoleClient(obj: any): boolean {
    if (!soleClient) return false;
    try {
        soleClient.send(JSON.stringify(obj));
        return true;
    } catch {
        return false;
    }
}

// Try to extract the current full assistant text from ChatGPT internal SSE payload JSON.
// We then delta it by comparing with inflight.lastText.
function extractFullTextFromChatGPTPayload(obj: any): string | null {
    const j = obj?.payload?.json;
    if (!j || typeof j !== 'object') return null;

    // Common-ish shapes observed in ChatGPT internal streams (best-effort):
    // 1) { message: { content: { parts: ["..."] } } }
    const p1 = j?.message?.content?.parts;
    if (Array.isArray(p1) && typeof p1[0] === 'string') {
        return String(p1[0]);
    }

    // 2) { message: { content: { text: "..." } } }
    const t2 = j?.message?.content?.text;
    if (typeof t2 === 'string') return t2;

    // 3) { delta: "..." } or { text: "..." }
    const t3 = j?.delta;
    if (typeof t3 === 'string') return t3;

    const t4 = j?.text;
    if (typeof t4 === 'string') return t4;

    // 4) { content: "..." }
    const t5 = j?.content;
    if (typeof t5 === 'string') return t5;

    return null;
}

// Compute a delta given a "full text so far" snapshot. If it doesn't extend,
// return null so we don't emit misleading deltas.
function computeDelta(fullText: string): string | null {
    if (!inflight) return null;
    const prev = inflight.lastText || '';
    const next = fullText || '';

    if (next === prev) return null;
    if (next.startsWith(prev)) return next.slice(prev.length);

    // If it changed non-monotonically (edits), emit the whole thing as a reset delta.
    // This is not perfect, but keeps the stream moving.
    return next;
}

// Emit OpenAI Responses style events
function emitResponseCreated() {
    if (!inflight) return;

    inflightEnqueue('response.created', {
        type: 'response.created',
        response: inflight.response,
    });
}

function emitOutputTextDelta(delta: string) {
    if (!inflight) return;

    inflightEnqueue('response.output_text.delta', {
        type: 'response.output_text.delta',
        delta,
        item_id: inflight.outputTextItemId,
        output_index: inflight.outputIndex,
        content_index: inflight.contentIndex,
    });
}

function emitGenericEvent(rawObj: any) {
    if (!inflight) return;

    inflightEnqueue('response.event', {
        type: 'response.event',
        response_id: inflight.id,
        raw: rawObj,
    });
}

function emitResponseCompleted(status: 'completed' | 'cancelled' | 'error', extra?: any) {
    if (!inflight) return;

    inflight.response.status = status;
    if (typeof inflight.lastText === 'string') {
        // keep a minimal "output_text" snapshot for convenience
        inflight.response.output_text = inflight.lastText;
    }
    if (extra) inflight.response.meta = {...(inflight.response.meta || {}), ...extra};

    inflightEnqueue('response.completed', {
        type: 'response.completed',
        response: inflight.response,
    });
}

// OpenAI-ish “Responses API” minimal request parsing
function extractUserPromptFromResponsesBody(body: any): string | null {
    if (!body) return null;

    // Most convenient: { input: "..." }
    if (typeof body.input === 'string' && body.input.trim()) {
        return body.input.trim();
    }

    // Also accept: { prompt: "..." }
    if (typeof body.prompt === 'string' && body.prompt.trim()) {
        return body.prompt.trim();
    }

    // OpenAI-ish shape: input: [{ role, content }]
    // content might be string, or array of parts (e.g. [{type:"input_text", text:"..."}])
    const input = body.input;
    if (Array.isArray(input)) {
        // Find first user message
        const userMsg = input.find(
            (m: any) => m && (m.role === 'user' || m.role === 'USER' || m.role === 'User')
        );
        if (!userMsg) return null;

        const c = userMsg.content;

        if (typeof c === 'string' && c.trim()) return c.trim();

        if (Array.isArray(c)) {
            // join text-like parts
            const parts: string[] = [];
            for (const part of c) {
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
    }

    return null;
}

Bun.serve<WsData>({
    port: PORT,

    async fetch(req, server) {
        const url = new URL(req.url);

        const corsHeaders: Record<string, string> = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        // WebSocket upgrade endpoint
        if (req.method === 'GET' && url.pathname === '/ws') {
            const ok = server.upgrade(req, {
                data: {id: crypto.randomUUID()},
            });
            return ok
                ? new Response(null, {status: 101})
                : new Response('Upgrade failed', {status: 400});
        }

        if (req.method === 'OPTIONS') {
            return new Response(null, {status: 204, headers: corsHeaders});
        }

        // OpenAI-ish endpoint: POST /responses
        // Streams back OpenAI Responses-style SSE events based on extension stream tap.
        // Assumes exactly 1 websocket client and 1 in-flight request.
        if (req.method === 'POST' && url.pathname === '/responses') {
            if (inflight) {
                return new Response(
                    JSON.stringify({error: 'Another /responses request is already in-flight.'}),
                    {
                        status: 409,
                        headers: {...corsHeaders, 'Content-Type': 'application/json'},
                    }
                );
            }

            if (!soleClient) {
                return new Response(
                    JSON.stringify({error: 'No WebSocket client connected (/ws).'}),
                    {
                        status: 503,
                        headers: {...corsHeaders, 'Content-Type': 'application/json'},
                    }
                );
            }

            let body: any = null;
            try {
                body = await req.json();
            } catch {
                return new Response(JSON.stringify({error: 'Invalid JSON'}), {
                    status: 400,
                    headers: {...corsHeaders, 'Content-Type': 'application/json'},
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
                        headers: {...corsHeaders, 'Content-Type': 'application/json'},
                    }
                );
            }

            const id = `resp_${crypto.randomUUID()}`;
            const created = Math.floor(Date.now() / 1000);

            const encoder = new TextEncoder();

            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    const timeoutHandle = setTimeout(() => {
                        // timeout as OpenAI-like error + completed + DONE
                        if (!inflight) return;
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
                        object: 'response',
                        created,
                        status: 'in_progress',
                        // Best-effort, since we don't know the model slug reliably here
                        model: null,
                        // Provide request input for traceability
                        input: prompt,
                        // Provide a minimal output scaffold
                        output: [
                            {
                                id: outputTextItemId,
                                object: 'output_text',
                                content: [],
                            },
                        ],
                        output_text: '',
                    };

                    inflight = {
                        id,
                        created,
                        controller,
                        encoder,
                        closed: false,
                        timeoutHandle,
                        response: responseObj,
                        outputTextItemId,
                        outputIndex: 0,
                        contentIndex: 0,
                        lastText: '',
                    };

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
                    if (inflight && inflight.id === id) {
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
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'text/event-stream; charset=utf-8',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    Connection: 'keep-alive',
                },
            });
        }

        if (req.method === 'GET' && url.pathname === '/list') {
            try {
                const files = await readdir(PROMPTS_DIR);
                const prompts = files.filter(f => f.endsWith('.md'));
                return new Response(JSON.stringify({prompts}), {
                    status: 200,
                    headers: {...corsHeaders, 'Content-Type': 'application/json'},
                });
            } catch (e) {
                return new Response(JSON.stringify({error: String(e)}), {
                    status: 500,
                    headers: {...corsHeaders, 'Content-Type': 'application/json'},
                });
            }
        }

        if (req.method === 'GET' && url.pathname.startsWith('/prompt/')) {
            const filename = url.pathname.replace('/prompt/', '');
            const fullPath = join(PROMPTS_DIR, filename);

            try {
                const processed = await buildPrompt(fullPath);
                const threadMessages = parseThreadMessages(processed);

                return new Response(JSON.stringify({threadMessages}), {
                    status: 200,
                    headers: {
                        ...corsHeaders,
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-store',
                    },
                });
            } catch (e) {
                return new Response(JSON.stringify({error: String(e?.toString?.() ?? e)}), {
                    status: 500,
                    headers: {
                        ...corsHeaders,
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-store',
                    },
                });
            }
        }

        if (req.method === 'POST' && url.pathname.startsWith('/prompt/')) {
            const filename = url.pathname.replace('/prompt/', '');
            const fullPath = join(PROMPTS_DIR, filename);

            try {
                const body: any = await req.json();

                if (!body || typeof body.response !== 'string') {
                    return new Response(JSON.stringify({error: 'Missing response'}), {
                        status: 400,
                        headers: {...corsHeaders, 'Content-Type': 'application/json'},
                    });
                }

                await appendAssistantResponse(fullPath, body.response);

                return new Response(JSON.stringify({ok: true}), {
                    status: 200,
                    headers: {...corsHeaders, 'Content-Type': 'application/json'},
                });
            } catch (e) {
                return new Response(JSON.stringify({error: String(e?.toString?.() ?? e)}), {
                    status: 500,
                    headers: {...corsHeaders, 'Content-Type': 'application/json'},
                });
            }
        }

        if (req.method === 'GET' && url.pathname === '/') {
            return new Response(
                `OK.\n` +
                    `Prompts Directory: ${PROMPTS_DIR}\n` +
                    `Files Root:        ${FILES_ROOT}\n\n` +
                    `Routes:\n` +
                    `GET  /list              - List all .md prompts\n` +
                    `GET  /prompt/<filename> - Get processed content of a prompt\n` +
                    `POST /prompt/<filename> - Append assistant response\n` +
                    `POST /responses         - Push a user prompt to extension via WebSocket (NOW streams SSE back)\n` +
                    `GET  /ws                - WebSocket ingest for streaming events + prompt delivery\n`,
                {
                    status: 200,
                    headers: {...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8'},
                }
            );
        }

        return new Response('Not Found', {
            status: 404,
            headers: {...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8'},
        });
    },

    websocket: {
        open(ws) {
            // Single-client assumption: newest connection wins.
            soleClient = ws as any;
            ws.send(JSON.stringify({type: 'welcome', at: Date.now()}));
        },

        message(ws, message) {
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
            if (inflight) {
                if (t === 'sse') {
                    // 1) Try to derive a text delta from ChatGPT JSON payload (best-effort).
                    const fullText = extractFullTextFromChatGPTPayload(obj);
                    if (typeof fullText === 'string') {
                        const delta = computeDelta(fullText);
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
                    emitResponseCompleted('completed', {reason: 'stream_closed'});
                    inflightClose(null, '[DONE]');
                    return;
                } else if (t === 'error') {
                    emitResponseCompleted('error', {reason: 'extension_error'});
                    inflightClose('response.error', {
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

        close(ws) {
            if (soleClient === (ws as any)) soleClient = null;

            // If the WS closes mid-flight, end the HTTP stream in OpenAI style.
            if (inflight) {
                emitResponseCompleted('error', {error: 'WebSocket closed'});
                inflightClose('response.error', {
                    type: 'response.error',
                    error: {message: 'WebSocket closed'},
                });
            }
        },
    },
});

console.log(`Bun prompt server running: http://localhost:${PORT}`);
console.log(`Serving prompts from:      ${PROMPTS_DIR}`);
console.log(`Resolving @files from:     ${FILES_ROOT}`);
console.log(`List endpoint:             http://localhost:${PORT}/list`);
console.log(`Responses endpoint:         http://localhost:${PORT}/responses`);
console.log(`WebSocket endpoint:        ws://localhost:${PORT}/ws`);
