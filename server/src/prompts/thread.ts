import type {ThreadMessage} from '../types/prompts';

/**
 * Parse a prompt file into structured thread messages.
 * Expected format:
 *
 * # {{USER}}
 *
 * ...
 *
 * # {{ASSISTANT}}
 *
 * ...
 */
export function parseThreadMessages(text: string): ThreadMessage[] {
    const lines = text.replace(/\r\n/g, '\n').split('\n');

    const messages: ThreadMessage[] = [];
    let currentRole: ThreadMessage['role'] | null = null;
    let buffer: string[] = [];

    function flush() {
        if (currentRole && buffer.length > 0) {
            const content = buffer.join('\n').trim();
            const hash = Bun.hash(content).toString();
            if (content) {
                messages.push({role: currentRole, content, hash});
            }
        }
        buffer = [];
    }

    for (const line of lines) {
        const headerMatch = line.match(/^#\s*\{\{(USER|ASSISTANT)\}\}\s*$/i);

        if (headerMatch) {
            flush();
            currentRole = headerMatch[1]!.toLowerCase() as ThreadMessage['role'];
            continue;
        }

        buffer.push(line);
    }

    flush();
    return messages;
}

export async function appendAssistantResponse(filePath: string, response: string): Promise<void> {
    let existing = '';

    try {
        existing = await Bun.file(filePath).text();
    } catch {
        existing = '';
    }

    const block = `\n\n# {{ASSISTANT}}\n\n` + response.replace(/\r\n/g, '\n').trimEnd() + '\n';
    const next = existing.replace(/\s*$/, '') + block;

    await Bun.write(filePath, next);
}
