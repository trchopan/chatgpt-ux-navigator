import {type AppConfig} from '../config/config';
import {corsHeaders, handleOptions} from './cors';
import {Router} from './router';
import {handleIndex} from './routes/indexRoute';
import {handleListPrompts, handleGetPrompt, handlePostPrompt} from './routes/prompts';
import {handlePostResponses, handlePostResponsesNew} from './routes/responses';
import {websocketHandlers} from '../ws/handler';
import type {WsData} from '../types/ws';
import type {Server} from 'bun';

export function startServer(cfg: AppConfig): void {
    const router = new Router();

    // Register routes
    router.get('/', handleIndex);
    router.get('/list', handleListPrompts);
    router.get(/\/prompt\/.+/, handleGetPrompt);
    router.post(/\/prompt\/.+/, handlePostPrompt);
    router.post('/responses/new', handlePostResponsesNew);
    router.post('/responses', handlePostResponses);

    // Global OPTIONS handler (or per-route if preferred, but global is easier for CORS)
    // We can add a catch-all options handler or specific ones.
    // Since the router checks method, we can add a generic options handler?
    // The Router class as written iterates. So if we want a global OPTIONS, we might need a wildcard path.
    // But regex /.*/ works.
    router.options(/.*/, handleOptions);

    Bun.serve<WsData>({
        port: cfg.port,

        async fetch(req: Request, server: Server) {
            const url = new URL(req.url);

            // WebSocket upgrade
            if (req.method === 'GET' && url.pathname === '/ws') {
                const clientId = url.searchParams.get('clientId');
                if (!clientId) {
                    return new Response('Missing clientId query parameter', {status: 400});
                }
                const ok = server.upgrade(req, {
                    data: {id: crypto.randomUUID(), clientId},
                });
                return ok
                    ? new Response(null, {status: 101})
                    : new Response('Upgrade failed', {status: 400});
            }

            // Route handling
            const response = await router.handle(req, cfg);
            if (response) {
                return response;
            }

            // Not Found
            return new Response('Not Found', {
                status: 404,
                headers: {...corsHeaders(), 'Content-Type': 'text/plain; charset=utf-8'},
            });
        },

        websocket: websocketHandlers,
    });

    console.log(`Bun prompt server running: http://localhost:${cfg.port}`);
    console.log(`Serving prompts from:      ${cfg.promptsDir}`);
    console.log(`Resolving @files from:     ${cfg.filesRoot}`);
    console.log(`List endpoint:             http://localhost:${cfg.port}/list`);
    console.log(`Responses endpoint:        http://localhost:${cfg.port}/responses`);
    console.log(`New chat endpoint:         http://localhost:${cfg.port}/responses/new`);
    console.log(`WebSocket endpoint:        ws://localhost:${cfg.port}/ws`);
}
