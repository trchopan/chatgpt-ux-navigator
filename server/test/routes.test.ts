import {describe, it, expect, beforeEach, afterEach} from 'bun:test';
import {mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {handleListPrompts, handleGetPrompt, handlePostPrompt} from '../src/http/routes/prompts';
import type {AppConfig} from '../src/config/config';

const TEST_ROOT = join(import.meta.dir, 'temp_test_routes');
const PROMPTS_ROOT = join(TEST_ROOT, 'prompts');
const FILES_ROOT = join(TEST_ROOT, 'files');

const config: AppConfig = {
    promptsDir: PROMPTS_ROOT,
    filesRoot: FILES_ROOT,
    port: 0, // Unused for these tests
    noStream: false,
};

describe('Prompt Routes', () => {
    beforeEach(async () => {
        await rm(TEST_ROOT, {recursive: true, force: true});
        await mkdir(PROMPTS_ROOT, {recursive: true});
        await mkdir(FILES_ROOT, {recursive: true});
    });

    afterEach(async () => {
        await rm(TEST_ROOT, {recursive: true, force: true});
    });

    describe('GET /list', () => {
        it('should return a list of markdown files', async () => {
            await writeFile(join(PROMPTS_ROOT, 'p1.md'), '');
            await writeFile(join(PROMPTS_ROOT, 'p2.txt'), ''); // Should be ignored
            await writeFile(join(PROMPTS_ROOT, 'p3.md'), '');

            const req = new Request('http://localhost/list');
            const url = new URL(req.url);
            const res = await handleListPrompts(req, config, url);

            expect(res.status).toBe(200);
            const body = (await res.json()) as {prompts: string[]};
            expect(body.prompts).toContain('p1.md');
            expect(body.prompts).toContain('p3.md');
            expect(body.prompts).not.toContain('p2.txt');
        });
    });

    describe('GET /prompt/:filename', () => {
        it('should parse and return thread messages', async () => {
            await writeFile(join(PROMPTS_ROOT, 'test.md'), '# {{USER}}\nHello');

            const req = new Request('http://localhost/prompt/test.md');
            const url = new URL(req.url);
            const res = await handleGetPrompt(req, config, url);

            expect(res.status).toBe(200);
            const body = (await res.json()) as {threadMessages: any[]};
            expect(body.threadMessages).toHaveLength(1);
            expect(body.threadMessages[0].content).toBe('Hello');
        });

        it('should return empty messages on missing file (error caught by buildPrompt)', async () => {
            const req = new Request('http://localhost/prompt/missing.md');
            const url = new URL(req.url);
            const res = await handleGetPrompt(req, config, url);

            expect(res.status).toBe(200);
            const body = (await res.json()) as {threadMessages: any[]};
            // buildPrompt returns error string, which lacks # {{ROLE}}, so 0 messages.
            expect(body.threadMessages).toHaveLength(0);
        });
    });

    describe('POST /prompt/:filename', () => {
        it('should append response to the file', async () => {
            const filePath = join(PROMPTS_ROOT, 'chat.md');
            await writeFile(filePath, '# {{USER}}\nQuestion');

            const req = new Request('http://localhost/prompt/chat.md', {
                method: 'POST',
                body: JSON.stringify({response: 'Answer'}),
            });
            const url = new URL(req.url);

            const res = await handlePostPrompt(req, config, url);
            expect(res.status).toBe(200);

            const content = await readFile(filePath, 'utf8');
            expect(content).toContain('# {{ASSISTANT}}\n\nAnswer');
        });

        it('should return 400 if response is missing', async () => {
            const req = new Request('http://localhost/prompt/chat.md', {
                method: 'POST',
                body: JSON.stringify({}),
            });
            const url = new URL(req.url);

            const res = await handlePostPrompt(req, config, url);
            expect(res.status).toBe(400);
        });
    });
});
