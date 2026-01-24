import { type AppConfig } from '../config/config';
import { corsHeaders, handleOptions } from './cors';
import { handleIndex } from './routes/indexRoute';
import { handleListPrompts, handleGetPrompt, handlePostPrompt } from './routes/prompts';
import { handlePostResponses } from './routes/responses';
import { websocketHandlers } from '../ws/handler';
import type { WsData } from '../types/ws';

export function startServer(cfg: AppConfig): void {
    Bun.serve<WsData>({
        port: cfg.port,

        async fetch(req, server) {
            const url = new URL(req.url);
            const cors = corsHeaders();

            // WebSocket upgrade endpoint
            if (req.method === 'GET' && url.pathname === '/ws') {
                const ok = server.upgrade(req, {
                    data: { id: crypto.randomUUID() },
                });
                return ok
                    ? new Response(null, { status: 101 })
                    : new Response('Upgrade failed', { status: 400 });
            }

            if (req.method === 'OPTIONS') {
                return handleOptions();
            }

            // OpenAI-ish endpoint: POST /responses
            if (req.method === 'POST' && url.pathname === '/responses') {
                return handlePostResponses(req, cors);
            }

            if (req.method === 'GET' && url.pathname === '/list') {
                return handleListPrompts(req, cfg);
            }

            if (req.method === 'GET' && url.pathname.startsWith('/prompt/')) {
                return handleGetPrompt(req, cfg);
            }

            if (req.method === 'POST' && url.pathname.startsWith('/prompt/')) {
                return handlePostPrompt(req, cfg);
            }

            if (req.method === 'GET' && url.pathname === '/') {
                return handleIndex(req, cfg);
            }

            return new Response('Not Found', {
                status: 404,
                headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' },
            });
        },

        websocket: websocketHandlers,
    });

    console.log(`Bun prompt server running: http://localhost:${cfg.port}`);
    console.log(`Serving prompts from:      ${cfg.promptsDir}`);
    console.log(`Resolving @files from:     ${cfg.filesRoot}`);
    console.log(`List endpoint:             http://localhost:${cfg.port}/list`);
    console.log(`Responses endpoint:         http://localhost:${cfg.port}/responses`);
    console.log(`WebSocket endpoint:        ws://localhost:${cfg.port}/ws`);
}
