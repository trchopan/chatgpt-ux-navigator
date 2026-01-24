import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import type { AppConfig } from '../../config/config';
import { buildPrompt } from '../../prompts/buildPrompt';
import { parseThreadMessages, appendAssistantResponse } from '../../prompts/thread';

export async function handleListPrompts(req: Request, cfg: AppConfig): Promise<Response> {
    try {
        const files = await readdir(cfg.promptsDir);
        const prompts = files.filter(f => f.endsWith('.md'));
        return new Response(JSON.stringify({ prompts }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

export async function handleGetPrompt(req: Request, cfg: AppConfig): Promise<Response> {
    const url = new URL(req.url);
    const filename = url.pathname.replace('/prompt/', '');
    const fullPath = join(cfg.promptsDir, filename);

    try {
        const processed = await buildPrompt(fullPath, cfg.filesRoot);
        const threadMessages = parseThreadMessages(processed);

        return new Response(JSON.stringify({ threadMessages }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: String(e?.toString?.() ?? e) }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    }
}

export async function handlePostPrompt(req: Request, cfg: AppConfig): Promise<Response> {
    const url = new URL(req.url);
    const filename = url.pathname.replace('/prompt/', '');
    const fullPath = join(cfg.promptsDir, filename);

    try {
        const body: any = await req.json();

        if (!body || typeof body.response !== 'string') {
            return new Response(JSON.stringify({ error: 'Missing response' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        await appendAssistantResponse(fullPath, body.response);

        return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: String(e?.toString?.() ?? e) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
