import {parse as parseYaml} from 'yaml';

const PORT = 8765;

// Path to the markdown file that contains front matter + body
// You can change this to whatever you want.
const PROMPT_MD_PATH = process.env.PROMPT_MD_PATH || './prompt.md';

type FrontMatter = {
    files?: string[];
};

function isAbsolutePath(p: string) {
    // Works for Unix/macOS; add Windows support if needed later.
    return p.startsWith('/');
}

function resolvePath(baseFile: string, filePath: string) {
    // If front matter uses relative paths, resolve relative to the prompt markdown file location.
    if (isAbsolutePath(filePath)) return filePath;

    const baseDir = baseFile.replace(/\/[^/]+$/, ''); // dirname without importing path
    const joined = baseDir ? `${baseDir}/${filePath}` : filePath;
    // Normalize simple "./" occurrences
    return joined.replace(/\/\.\//g, '/');
}

function parseFrontMatterAndBody(md: string): {fm: FrontMatter; body: string} {
    // Expect:
    // +++
    // yaml...
    // +++
    // body...
    //
    // If missing, treat entire md as body.
    const trimmed = md.replace(/^\uFEFF/, ''); // strip BOM if present

    if (!trimmed.startsWith('+++')) {
        return {fm: {}, body: trimmed.trim()};
    }

    const lines = trimmed.split('\n');

    // first line must be +++
    if (lines.length < 3 || lines[0]?.trim() !== '+++') {
        return {fm: {}, body: trimmed.trim()};
    }

    // find the closing +++
    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i]?.trim() === '+++') {
            endIdx = i;
            break;
        }
    }
    if (endIdx === -1) {
        // no closing delimiter -> treat as body
        return {fm: {}, body: trimmed.trim()};
    }

    const yamlText = lines.slice(1, endIdx).join('\n');
    const bodyText = lines.slice(endIdx + 1).join('\n');

    let fm: FrontMatter = {};
    try {
        const parsed = parseYaml(yamlText);
        if (parsed && typeof parsed === 'object') fm = parsed as FrontMatter;
    } catch {
        // invalid YAML -> ignore front matter rather than failing hard
        fm = {};
    }

    return {fm, body: bodyText.trim()};
}

async function buildPrompt(): Promise<string> {
    const md = await Bun.file(PROMPT_MD_PATH).text();
    const {fm, body} = parseFrontMatterAndBody(md);

    const parts: string[] = [];
    if (body) parts.push(body.trim());

    const files = Array.isArray(fm.files) ? fm.files : [];
    for (const rawPath of files) {
        if (!rawPath || typeof rawPath !== 'string') continue;

        const absPath = resolvePath(PROMPT_MD_PATH, rawPath);
        let content: string;

        try {
            content = await Bun.file(absPath).text();
        } catch (e) {
            console.error(e);
            // You can choose whether to fail hard; here we include an error marker.
            content = `[ERROR: Unable to read file: ${absPath}]`;
        }

        parts.push('');
        parts.push(`--- ${absPath} ---`);
        parts.push('');
        parts.push(content.replace(/\r\n/g, '\n').trimEnd());
        parts.push('');
		parts.push(`--- END OF ${absPath} ---`);
    }

    // Ensure a trailing newline (nice for textareas/copy)
    return parts.join('\n').trimEnd() + '\n';
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

        if (req.method === 'GET' && url.pathname === '/prompt') {
            try {
                const prompt = await buildPrompt();
                return new Response(prompt, {
                    status: 200,
                    headers: {
                        ...corsHeaders,
                        'Content-Type': 'text/plain; charset=utf-8',
                        'Cache-Control': 'no-store',
                    },
                });
            } catch (e) {
                return new Response(String(e?.toString?.() ?? e), {
                    status: 500,
                    headers: {
                        ...corsHeaders,
                        'Content-Type': 'text/plain; charset=utf-8',
                        'Cache-Control': 'no-store',
                    },
                });
            }
        }

        if (req.method === 'GET' && url.pathname === '/') {
            return new Response(`OK. Try GET /prompt\nUsing PROMPT_MD_PATH=${PROMPT_MD_PATH}\n`, {
                status: 200,
                headers: {...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8'},
            });
        }

        return new Response('Not Found', {
            status: 404,
            headers: {...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8'},
        });
    },
});

console.log(`Bun prompt server running: http://localhost:${PORT}`);
console.log(`Prompt endpoint:           http://localhost:${PORT}/prompt`);
console.log(`Prompt markdown source:    ${PROMPT_MD_PATH}`);
