export function sseFrame(event: string | null, data: any): string {
    const evLine = event ? `event: ${event}\n` : '';
    let payload = '';
    if (data === '[DONE]') {
        payload = 'data: [DONE]\n\n';
        return evLine + payload;
    }

    let dataStr = '';
    try {
        dataStr = typeof data === 'string' ? data : JSON.stringify(data);
    } catch {
        dataStr = JSON.stringify({ type: 'error', error: 'Could not stringify SSE payload' });
    }

    // SSE requires each line be prefixed with "data:"
    const dataLines = dataStr
        .split('\n')
        .map(l => `data: ${l}`)
        .join('\n');

    return `${evLine}${dataLines}\n\n`;
}

export function sseResponseHeaders(cors: Record<string, string>): HeadersInit {
    return {
        ...cors,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Connection: 'keep-alive',
    };
}
