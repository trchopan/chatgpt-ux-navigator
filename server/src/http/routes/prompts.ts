import {join} from 'node:path';
import {readdir} from 'node:fs/promises';
import type {AppConfig} from '../../config/config';
import {buildPrompt} from '../../prompts/buildPrompt';
import {parseThreadMessages, appendAssistantResponse} from '../../prompts/thread';

/**
 * Lists all available prompt files (.md) in the configured directory.
 */
export async function handleListPrompts(req: Request, cfg: AppConfig, url: URL): Promise<Response> {
    try {
        const files = await readdir(cfg.promptsDir);
        const prompts = files.filter(f => f.endsWith('.md'));
        return new Response(JSON.stringify({prompts}), {
            status: 200,
            headers: {'Content-Type': 'application/json'},
        });
    } catch (e) {
        return new Response(JSON.stringify({error: String(e)}), {
            status: 500,
            headers: {'Content-Type': 'application/json'},
        });
    }
}

/**
 * Gets the processed content of a specific prompt file.
 * Handles @file includes and thread parsing.
 */
export async function handleGetPrompt(req: Request, cfg: AppConfig, url: URL): Promise<Response> {
    // pathname: /prompt/<filename>
    const filename = url.pathname.replace('/prompt/', '');
    const fullPath = join(cfg.promptsDir, filename);

    try {
        const processed = await buildPrompt(fullPath, cfg.filesRoot);
        const threadMessages = parseThreadMessages(processed);

        return new Response(JSON.stringify({threadMessages}), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    } catch (e) {
        return new Response(JSON.stringify({error: String(e?.toString?.() ?? e)}), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    }
}

/**
 * Appends an assistant response to a prompt file.
 */
export async function handlePostPrompt(req: Request, cfg: AppConfig, url: URL): Promise<Response> {
    const filename = url.pathname.replace('/prompt/', '');
    const fullPath = join(cfg.promptsDir, filename);

    try {
        const body: any = await req.json();

        if (!body || typeof body.response !== 'string') {
            return new Response(JSON.stringify({error: 'Missing response'}), {
                status: 400,
                headers: {'Content-Type': 'application/json'},
            });
        }

        await appendAssistantResponse(fullPath, body.response);

        return new Response(JSON.stringify({ok: true}), {
            status: 200,
            headers: {'Content-Type': 'application/json'},
        });
    } catch (e) {
        return new Response(JSON.stringify({error: String(e?.toString?.() ?? e)}), {
            status: 500,
            headers: {'Content-Type': 'application/json'},
        });
    }
}
