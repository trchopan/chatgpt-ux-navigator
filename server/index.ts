import {join, resolve, isAbsolute, relative} from 'node:path';
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

const SKIP_DIR_NAMES = new Set([
    //
    '.git',
    'node_modules',
    '.idea',
    '.vscode',
    'dist',
    'build',
]);

function isPathInsideRoot(absPath: string, absRoot: string): boolean {
    // Ensure trailing separator for correct prefix matching (e.g. /root2 not matching /root)
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
        // If file does not exist or is unreadable, treat as empty
        existing = '';
    }

    const block = `\n\n# {{ASSISTANT}}\n\n` + response.replace(/\r\n/g, '\n').trimEnd() + '\n';

    const next = existing.replace(/\s*$/, '') + block;

    await Bun.write(filePath, next);
}

async function listPathsRecursive(absDir: string, baseDir: string = absDir): Promise<string[]> {
    const out: string[] = [];

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
            await listPathsRecursive(full, baseDir).then(r => out.push(...r));
        } else if (st.isFile()) {
            out.push(relative(baseDir, full));
        }
    }

    return out;
}

async function buildPrompt(filePath: string): Promise<string> {
    let md: string;
    try {
        md = await Bun.file(filePath).text();
    } catch (e) {
        return `[ERROR: Unable to read prompt file: ${filePath}]`;
    }

    const lines = md.split('\n');
    const processedLines: string[] = [];

    for (const line of lines) {
        const match = line.match(/^\s*@(\S+)\s*$/);

        if (!match) {
            processedLines.push(line);
            continue;
        }

        const rawPath = match[1]!;
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
            // @dirpath → LIST PATHS ONLY
            const paths = await listPathsRecursive(absPath);

            processedLines.push('');
            processedLines.push(`--- DIR ${absPath} (${paths.length} files) ---`);
            processedLines.push('');

            for (const p of paths) {
                processedLines.push(p);
            }

            processedLines.push('');
            processedLines.push(`--- END DIR ${absPath} ---`);
            continue;
        }

        // @filepath → EXISTING BEHAVIOR
        let content: string;
        try {
            content = await Bun.file(absPath).text();
        } catch {
            content = `[ERROR: Unable to read file: ${absPath}]`;
        }

        processedLines.push('');
        processedLines.push(`--- ${absPath} ---`);
        processedLines.push('');
        processedLines.push(content.replace(/\r\n/g, '\n').trimEnd());
        processedLines.push('');
        processedLines.push(`--- END OF ${absPath} ---`);
    }

    return processedLines.join('\n').trimEnd() + '\n';
}

Bun.serve({
    port: PORT,
    async fetch(req) {
        const url = new URL(req.url);

        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (req.method === 'OPTIONS') {
            return new Response(null, {status: 204, headers: corsHeaders});
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
                    `GET /list              - List all .md prompts\n` +
                    `GET /prompt/<filename> - Get processed content of a prompt\n`,
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
});

console.log(`Bun prompt server running: http://localhost:${PORT}`);
console.log(`Serving prompts from:      ${PROMPTS_DIR}`);
console.log(`Resolving @files from:     ${FILES_ROOT}`);
console.log(`List endpoint:             http://localhost:${PORT}/list`);
