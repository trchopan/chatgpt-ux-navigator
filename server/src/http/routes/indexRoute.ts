import type {AppConfig} from '../../config/config';

/**
 * Handles the root index route.
 * Returns server status and available routes.
 */
export function handleIndex(req: Request, cfg: AppConfig, url: URL): Response {
    return new Response(
        `OK.\n` +
            `Prompts Directory: ${cfg.promptsDir}\n` +
            `Files Root:        ${cfg.filesRoot}\n\n` +
            `Routes:\n` +
            `GET  /list              - List all .md prompts\n` +
            `GET  /prompt/<filename> - Get processed content of a prompt\n` +
            `POST /prompt/<filename> - Append assistant response\n` +
            `POST /responses         - Stream assistant output without forcing a new ChatGPT chat\n` +
            `POST /responses/new     - Same as /responses but spawns a temporary chat first\n` +
            `GET  /ws                - WebSocket ingest for streaming events + prompt delivery\n`,
        {
            status: 200,
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
            },
        }
    );
}
