const FINISHED_MARKER = 'finished_successfully';
const VERSION_PREFIX = /^v\d+\s*/i;

function extractMarkerRange(text: string): string {
    const indices: number[] = [];
    let idx = text.indexOf(FINISHED_MARKER);
    while (idx >= 0) {
        indices.push(idx);
        idx = text.indexOf(FINISHED_MARKER, idx + 1);
    }

    if (indices.length === 0) {
        return text;
    }

    if (indices.length === 1) {
        return text.slice(0, indices[0]).trim();
    }

    const first = indices[0];
    const last = indices[indices.length - 1];
    return text.slice(first + FINISHED_MARKER.length, last).trim();
}

export function sanitizeAssistantText(fullText: string): string {
    if (typeof fullText !== 'string') return '';

    let cleaned = fullText.trim();
    if (!cleaned) return '';

    const hasMarker = cleaned.includes(FINISHED_MARKER);
    if (hasMarker) {
        cleaned = extractMarkerRange(cleaned);
    }

    if (hasMarker) {
        cleaned = cleaned.replace(VERSION_PREFIX, '').trim();
    }

    return cleaned;
}
