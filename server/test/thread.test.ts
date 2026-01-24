import {describe, it, expect, beforeEach, afterEach} from 'bun:test';
import {mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {parseThreadMessages, appendAssistantResponse} from '../src/prompts/thread';

const TEST_ROOT = join(import.meta.dir, 'temp_test_thread');
const FILE_PATH = join(TEST_ROOT, 'thread.md');

describe('Thread Utils', () => {
    describe('parseThreadMessages', () => {
        it('should parse a single user message', () => {
            const input = `# {{USER}}\nHello world`;
            const messages = parseThreadMessages(input);
            expect(messages).toHaveLength(1);
            expect(messages[0]!.role).toBe('user');
            expect(messages[0]!.content).toBe('Hello world');
        });

        it('should parse multiple messages', () => {
            const input = `
# {{USER}}
User message 1

# {{ASSISTANT}}
Assistant response 1

# {{USER}}
User message 2
            `;
            const messages = parseThreadMessages(input);
            expect(messages).toHaveLength(3);
            expect(messages[0]!.role).toBe('user');
            expect(messages[0]!.content).toBe('User message 1');
            expect(messages[1]!.role).toBe('assistant');
            expect(messages[1]!.content).toBe('Assistant response 1');
            expect(messages[2]!.role).toBe('user');
            expect(messages[2]!.content).toBe('User message 2');
        });

        it('should ignore content before the first header', () => {
            // "if (currentRole && buffer.length > 0) ..."
            // So content before first role is dropped.
            const input = `Ignored preamble\n# {{USER}}\nActual content`;
            const messages = parseThreadMessages(input);
            expect(messages).toHaveLength(1);
            expect(messages[0]!.content).toBe('Actual content');
        });

        it('should handle empty content', () => {
            const input = ``;
            const messages = parseThreadMessages(input);
            expect(messages).toHaveLength(0);
        });
    });

    describe('appendAssistantResponse', () => {
        beforeEach(async () => {
            // Clean up before starting to ensure clean state
            await rm(TEST_ROOT, {recursive: true, force: true});
            await mkdir(TEST_ROOT, {recursive: true});
        });

        afterEach(async () => {
            await rm(TEST_ROOT, {recursive: true, force: true});
        });

        it('should append assistant response to file', async () => {
            await writeFile(FILE_PATH, '# {{USER}}\nHello');

            await appendAssistantResponse(FILE_PATH, 'Hi there');

            const content = await readFile(FILE_PATH, 'utf8');
            expect(content).toContain('# {{USER}}\nHello');
            expect(content).toContain('# {{ASSISTANT}}\n\nHi there');
        });

        it("should create file if it doesn't exist", async () => {
            // appendAssistantResponse handles read failure by starting empty
            await appendAssistantResponse(FILE_PATH, 'New file content');

            const content = await readFile(FILE_PATH, 'utf8');
            expect(content).toContain('# {{ASSISTANT}}\n\nNew file content');
        });
    });
});
