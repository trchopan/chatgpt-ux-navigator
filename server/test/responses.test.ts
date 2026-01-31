import {describe, it, expect, beforeEach, afterEach, mock} from 'bun:test';
import {handlePostResponses, handlePostResponsesNew, handlePostResponsesById, handlePostResponsesByIdNew} from '../src/http/routes/responses';
import type {AppConfig} from '../src/config/config';
import {setSoleClient, setClient, removeClient} from '../src/ws/hub';
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

    it('sanitizes finished_successfully markers in final response text', async () => {
        const mockSend = mock((msg: string) => {
            const current = getInflight();
            if (current) {
                current.lastText = 'v1The final answer finished_successfully';
                emitResponseCompleted('completed');
                inflightTerminate();
            }
        });

        setSoleClient({send: mockSend} as any);

        const req = new Request('http://localhost/responses', {
            method: 'POST',
            body: JSON.stringify({input: 'Cleanup markers'}),
        });

        const res = await handlePostResponses(req, config, new URL(req.url));
        const body = await res.json() as any;

        expect(body.status).toBe('completed');
        expect(body.output_text).toBe('The final answer');
    });
});

// --- Multi-client tests ---
describe('POST /responses/:clientId (multi-client)', () => {
    afterEach(() => {
        // Cleanup all clients and inflight
        removeClient('client-a');
        removeClient('client-b');
        removeClient('client-x');
        inflightTerminate('client-a', null, null);
        inflightTerminate('client-b', null, null);
        inflightTerminate('client-x', null, null);
    });

    it('should handle parallel requests to different clients (no 409)', async () => {
        // Mock two clients that immediately complete on send
        const mockSendA = mock(() => {
            const current = getInflight('client-a');
            if (current) {
                current.response.status = 'completed';
                current.response.completed_at = Math.floor(Date.now() / 1000);
                inflightTerminate('client-a', 'response.completed', {});
            }
        });
        const mockSendB = mock(() => {
            const current = getInflight('client-b');
            if (current) {
                current.response.status = 'completed';
                current.response.completed_at = Math.floor(Date.now() / 1000);
                inflightTerminate('client-b', 'response.completed', {});
            }
        });
        
        setClient('client-a', {send: mockSendA} as any);
        setClient('client-b', {send: mockSendB} as any);

        // POST to both clients in parallel
        const reqA = new Request('http://localhost/responses/client-a', {
            method: 'POST',
            body: JSON.stringify({input: 'Request to A'}),
        });
        const reqB = new Request('http://localhost/responses/client-b', {
            method: 'POST',
            body: JSON.stringify({input: 'Request to B'}),
        });

        const [resA, resB] = await Promise.all([
            handlePostResponsesById(reqA, config, new URL(reqA.url)),
            handlePostResponsesById(reqB, config, new URL(reqB.url))
        ]);

        // Both should succeed
        expect(resA.status).toBe(200);
        expect(resB.status).toBe(200);
        const bodyA = await resA.json() as any;
        const bodyB = await resB.json() as any;
        expect(bodyA.status).toBe('completed');
        expect(bodyB.status).toBe('completed');
    });

    it('should return 404 when target client not connected', async () => {
        // Don't register any client with ID 'nonexistent'

        const req = new Request('http://localhost/responses/nonexistent', {
            method: 'POST',
            body: JSON.stringify({input: 'Hello'}),
        });

        const res = await handlePostResponsesById(req, config, new URL(req.url));

        expect(res.status).toBe(404);
        const body = await res.json() as any;
        expect(body.error).toContain('not connected');
    });

    it('should return 409 for concurrent requests to same client', async () => {
        // Mock one client that doesn't immediately complete
        const mockWs = {send: mock(() => {})} as any;
        setClient('client-x', mockWs);

        // Start first request (it will hang waiting for completion)
        const req1 = new Request('http://localhost/responses/client-x', {
            method: 'POST',
            body: JSON.stringify({input: 'Req 1'}),
        });
        const p1 = handlePostResponsesById(req1, config, new URL(req1.url));

        // Allow microtask queue to process so inflight is set
        await new Promise(r => setTimeout(r, 10));

        // Start second request to same client
        const req2 = new Request('http://localhost/responses/client-x', {
            method: 'POST',
            body: JSON.stringify({input: 'Req 2'}),
        });
        const res2 = await handlePostResponsesById(req2, config, new URL(req2.url));

        expect(res2.status).toBe(409);
        const body2 = await res2.json() as any;
        expect(body2.error).toContain('in-flight');
        expect(body2.error).toContain('client-x');

        // Cleanup: terminate inflight to let p1 resolve
        const currentInflight = getInflight('client-x');
        if (currentInflight) {
            currentInflight.response.status = 'completed';
            currentInflight.response.completed_at = Math.floor(Date.now() / 1000);
        }
        inflightTerminate('client-x', 'response.completed', {});
        try {
            await p1;
        } catch {}
    });
});

describe('POST /responses (backward compat)', () => {
    afterEach(() => {
        setSoleClient(null);
        inflightTerminate(null, null);
    });

    it('should return 503 when no sole client and using old route', async () => {
        setSoleClient(null);

        const req = new Request('http://localhost/responses', {
            method: 'POST',
            body: JSON.stringify({input: 'Hello'}),
        });

        const res = await handlePostResponses(req, config, new URL(req.url));
        expect(res.status).toBe(503);
    });

    it('should work with setSoleClient for backward compat', async () => {
        const mockSend = mock((msg: string) => {
            const current = getInflight();
            if (current) {
                emitResponseCompleted('completed');
                inflightTerminate();
            }
        });
        setSoleClient({send: mockSend} as any);

        const req = new Request('http://localhost/responses', {
            method: 'POST',
            body: JSON.stringify({input: 'Hello backward compat'}),
        });

        const res = await handlePostResponses(req, config, new URL(req.url));

        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.status).toBe('completed');
        expect(mockSend).toHaveBeenCalled();
    });
});
