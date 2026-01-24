import type { AppConfig } from '../../config/config';

export function handleIndex(req: Request, cfg: AppConfig): Response {
    return new Response(
        `OK.\n` +
        `Prompts Directory: ${cfg.promptsDir}\n` +
        `Files Root:        ${cfg.filesRoot}\n\n` +
        `Routes:\n` +
        `GET  /list              - List all .md prompts\n` +
        `GET  /prompt/<filename> - Get processed content of a prompt\n` +
        `POST /prompt/<filename> - Append assistant response\n` +
        `POST /responses         - Push a user prompt to extension via WebSocket (NOW streams SSE back)\n` +
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
