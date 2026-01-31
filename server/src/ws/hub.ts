// --- Multi-client registry: Map of clientId -> WebSocket ---
const clients = new Map<string, WebSocket>();

// --- Legacy: only 1 websocket client (for backward compatibility) ---
let soleClient: WebSocket | null = null;

/**
 * Store a client in the registry. If clientId already exists, close the old socket.
 */
export function setClient(clientId: string, ws: WebSocket): void {
    const existing = clients.get(clientId);
    if (existing) {
        try {
            existing.close();
        } catch {
            // ignore close errors
        }
    }
    clients.set(clientId, ws);
}

/**
 * Retrieve a client by ID. Returns null if not found.
 */
export function getClient(clientId: string): WebSocket | null {
    return clients.get(clientId) || null;
}

/**
 * Remove a client from the registry by ID.
 */
export function removeClient(clientId: string): void {
    clients.delete(clientId);
}

/**
 * Check if a client is registered.
 */
export function hasClient(clientId: string): boolean {
    return clients.has(clientId);
}

/**
 * Send a message to a specific client. Returns false if client not found.
 */
export function sendToClient(clientId: string, obj: any): boolean {
    const ws = clients.get(clientId);
    if (!ws) return false;
    try {
        ws.send(JSON.stringify(obj));
        return true;
    } catch {
        return false;
    }
}

// --- Backward compatibility: legacy single-client functions ---

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
