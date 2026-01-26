import {describe, it, expect, beforeEach, afterEach, mock} from 'bun:test';
import {handlePostResponses, handlePostResponsesNew} from '../src/http/routes/responses';
import type {AppConfig} from '../src/config/config';
import {setSoleClient} from '../src/ws/hub';
import {
    getInflight,
    inflightTerminate,
    emitResponseCompleted,
    emitOutputItemDone,
} from '../src/http/responses/inflight';

const config: AppConfig = {
    port: 0,
    promptsDir: '/tmp',
    filesRoot: '/tmp',
    noStream: false,
};

describe('POST /responses', () => {
    beforeEach(() => {
        setSoleClient(null);
        inflightTerminate(null, null);
    });

    afterEach(() => {
        setSoleClient(null);
        inflightTerminate(null, null);
    });

    it('should return 503 if no WS client connected', async () => {
        const req = new Request('http://localhost/responses', {
            method: 'POST',
            body: JSON.stringify({input: 'Hello'}),
        });


        const res = await handlePostResponses(req, config, new URL(req.url));
        expect(res.status).toBe(503);
    });

    it('should return 400 for invalid JSON', async () => {
        setSoleClient({send: () => {}} as any);
        const req = new Request('http://localhost/responses', {
            method: 'POST',
            body: 'invalid json',
        });
        const res = await handlePostResponses(req, config, new URL(req.url));
        expect(res.status).toBe(400);
    });

    it('should return 400 for missing input', async () => {
        setSoleClient({send: () => {}} as any);
        const req = new Request('http://localhost/responses', {
            method: 'POST',
            body: JSON.stringify({}),
        });
        const res = await handlePostResponses(req, config, new URL(req.url));
        expect(res.status).toBe(400);
    });

    it('should handle JSON mode (waiting for completion)', async () => {
        let sentMessage: string | null = null;

        // Mock client that simulates a response after receiving prompt
        const mockSend = mock((msg: string) => {
            sentMessage = msg;
            // Verify inflight exists
            const current = getInflight();
            if (current) {
                // Mark as completed
                emitResponseCompleted('completed');
                // Resolve the request
                inflightTerminate();
            }
        });

        setSoleClient({send: mockSend} as any);

        const req = new Request('http://localhost/responses', {
            method: 'POST',
            body: JSON.stringify({input: 'Hello JSON'}),
        });

        const res = await handlePostResponses(req, config, new URL(req.url));

        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect(body.status).toBe('completed');

        expect(mockSend).toHaveBeenCalled();
        const parsed = JSON.parse(String(sentMessage));
        expect(parsed.type).toBe('prompt');
        expect(parsed.input).toContain('Hello JSON');
    });

    it('should handle Stream mode (SSE)', async () => {
        let sentMessage: string | null = null;

        const mockSend = mock((msg: string) => {
            sentMessage = msg;
        });
        setSoleClient({send: mockSend} as any);

        const req = new Request('http://localhost/responses', {
            method: 'POST',
            body: JSON.stringify({input: 'Hello Stream', stream: true}),
        });

        const res = await handlePostResponses(req, config, new URL(req.url));

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('text/event-stream');

        // Ensure prompt was sent to WS
        expect(mockSend).toHaveBeenCalled();
        // @ts-ignore
        expect(sentMessage).toContain('Hello Stream');

        // Validate stream content
        const reader = res.body?.getReader();
        expect(reader).toBeDefined();

        if (reader) {
            // We can manually push events to inflight to see if they appear in stream
            emitResponseCompleted('completed');
            inflightTerminate();

            let text = '';
            while (true) {
                const {done, value} = await reader.read();
                if (done) break;
                text += new TextDecoder().decode(value);
            }

            expect(text).toContain('response.created');
            expect(text).toContain('response.completed');
            expect(text).toContain('[DONE]');
        }
    });

    it('should request a temporary chat for POST /responses/new', async () => {
        let parsed: any = null;
        const mockSend = mock((msg: string) => {
            parsed = JSON.parse(msg);
            emitResponseCompleted('completed');
            inflightTerminate();
        });
        setSoleClient({send: mockSend} as any);

        const req = new Request('http://localhost/responses/new', {
            method: 'POST',
            body: JSON.stringify({input: 'Hello fresh chat'}),
        });

        const res = await handlePostResponsesNew(req, config, new URL(req.url));
        expect(res.status).toBe(200);
        expect(parsed?.type).toBe('prompt.new');
        expect(parsed?.input).toContain('Hello fresh chat');
    });

    it('should accept array of messages as input', async () => {
        let capturedInput = '';
        const mockSend = mock((msg: string) => {
            const parsed = JSON.parse(msg);
            capturedInput = parsed.input;
            inflightTerminate();
        });
        setSoleClient({send: mockSend} as any);

        const req = new Request('http://localhost/responses', {
            method: 'POST',
            body: JSON.stringify({
                input: [
                    {role: 'system', content: 'Sys'},
                    {role: 'user', content: 'Usr'},
                    {role: 'system', content: 'Ignored'},
                ],
            }),
        });

        await handlePostResponses(req, config, new URL(req.url));

        expect(capturedInput).toBe('Usr');
        expect(capturedInput.includes('Sys')).toBe(false);
    });


    it('should ignore tool definitions in the payload', async () => {
        let capturedInput = '';
        const mockSend = mock((msg: string) => {
            const parsed = JSON.parse(msg);
            capturedInput = parsed.input;
            inflightTerminate();
        });
        setSoleClient({send: mockSend} as any);

        const req = new Request('http://localhost/responses', {
            method: 'POST',
            body: JSON.stringify({
                input: 'User Request',
                tools: [
                    {
                        type: 'function',
                        function: {
                            name: 'test_tool',
                            description: 'A test tool',
                            parameters: {type: 'object', properties: {foo: {type: 'string'}}},
                        },
                    },
                ],
            }),
        });

        await handlePostResponses(req, config, new URL(req.url));

        expect(capturedInput).toBe('User Request');
        expect(capturedInput.includes('test_tool')).toBe(false);
    });

    it('should return 409 if another request is in-flight', async () => {
        // 1. Setup a client that receives but doesn't immediately finish
        setSoleClient({send: () => {}} as any);

        // 2. Start the first request (it will hang waiting for WS response)
        const req1 = new Request('http://localhost/responses', {
            method: 'POST',
            body: JSON.stringify({input: 'Req 1'}),
        });

        // Start it but don't await the result yet (it waits for timeout or completion)
        const p1 = handlePostResponses(req1, config, new URL(req1.url));

        // Allow microtask queue to process so inflight is set
        await new Promise(r => setTimeout(r, 10));

        // 3. Start second request
        const req2 = new Request('http://localhost/responses', {
            method: 'POST',
            body: JSON.stringify({input: 'Req 2'}),
        });

        const res2 = await handlePostResponses(req2, config, new URL(req2.url));
        expect(res2.status).toBe(409);

        // Cleanup: terminate inflight to let p1 resolve (as error or completed)
        inflightTerminate(null, null);
        try {
            await p1;
        } catch (e) {
            // Expected error or resolved error object
        }
    });

    it('should extract tool calls from text response', async () => {
        let sentMessage: string | null = null;
        const mockSend = mock((msg: string) => {
            sentMessage = msg;
            // Simulate extension sending back text with tool call
            const current = getInflight();
            if (current) {
                // Manually trigger the events the WS handler would trigger
                // But since we can't easily access the internal 'lastText' of inflight from here without using WS handler logic,
                // we'll just rely on emitOutputItemDone if possible, but that's internal.
                // Instead, let's just inspect the result after we force completion via internal helpers.
                
                // We mock the "accumulation" of text
                const text = `Thinking...
\`\`\`json
{ "tool_calls": [{ "name": "foo", "arguments": {} }] }
\`\`\`
`;
                current.lastText = text;
                
                // Simulate the "done" event flow
                emitOutputItemDone(text);
                emitResponseCompleted('completed');
                inflightTerminate();
            }
        });

        setSoleClient({send: mockSend} as any);

        const req = new Request('http://localhost/responses', {
            method: 'POST',
            body: JSON.stringify({input: 'Call foo'}),
        });

        const res = await handlePostResponses(req, config, new URL(req.url));
        const body = await res.json() as any;

        expect(body.status).toBe('completed');
        // Check if text was cleaned
        expect(body.output_text.trim()).toBe('Thinking...');
        
        // Check output item structure
        const item = body.output[0];
        expect(item.content[0].text.trim()).toBe('Thinking...');
        expect(item.tool_calls).toBeDefined();
        expect(item.tool_calls[0].name).toBe('foo');
    });
});
