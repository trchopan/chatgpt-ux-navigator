import type { IncomingWebSocketMessage } from '../types/ws';

export function safeParseJson(text: string): IncomingWebSocketMessage | null {
    try {
        return JSON.parse(text) as IncomingWebSocketMessage;
    } catch {
        return null;
    }
}
