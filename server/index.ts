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
    type: 'sse' | 'done' | 'closed' | string;
    payload: WsPayload;
};

function safeParseJson(text: string): IncomingWebSocketMessage | null {
    try {
        return JSON.parse(text) as IncomingWebSocketMessage;
    } catch {
        return null;
    }
}

// Track connected extension clients
const clients = new Set<WebSocket>();

function broadcastToClients(obj: any) {
    const payload = JSON.stringify(obj);
    for (const ws of clients) {
        try {
            ws.send(payload);
        } catch {
            // ignore
        }
    }
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
        if (req.method === 'POST' && url.pathname === '/responses') {
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

            // Broadcast to all connected extension clients
            broadcastToClients({
                type: 'prompt',
                id,
                created,
                input: prompt,
            });

            // Minimal OpenAI-ish response object
            return new Response(
                JSON.stringify({
                    id,
                    object: 'response',
                    created,
                    status: 'queued',
                }),
                {
                    status: 200,
                    headers: {...corsHeaders, 'Content-Type': 'application/json'},
                }
            );
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
                    `POST /responses         - Push a user prompt to extension via WebSocket\n` +
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
            clients.add(ws as any);
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
            const metaUrl = obj?.payload?.meta?.url ? String(obj.payload.meta.url) : '';
            if (t) {
                console.log('[ws]', t, metaUrl);
            } else {
                console.log('[ws] message:', obj);
            }
        },

        close(ws) {
            clients.delete(ws as any);
        },
    },
});

console.log(`Bun prompt server running: http://localhost:${PORT}`);
console.log(`Serving prompts from:      ${PROMPTS_DIR}`);
console.log(`Resolving @files from:     ${FILES_ROOT}`);
console.log(`List endpoint:             http://localhost:${PORT}/list`);
console.log(`Responses endpoint:         http://localhost:${PORT}/responses`);
console.log(`WebSocket endpoint:        ws://localhost:${PORT}/ws`);
