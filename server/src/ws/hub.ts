// --- Assumption: only 1 websocket client ---
let soleClient: WebSocket | null = null;

export function setSoleClient(ws: WebSocket | null): void {
    soleClient = ws;
}

export function getSoleClient(): WebSocket | null {
    return soleClient;
}

export function sendToSoleClient(obj: any): boolean {
    if (!soleClient) return false;
    try {
        soleClient.send(JSON.stringify(obj));
        return true;
    } catch {
        return false;
    }
}
