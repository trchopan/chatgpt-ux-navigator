import {describe, it, expect} from 'bun:test';
import {extractTextUpdateFromChatGPTPayload} from '../src/ws/extract';

describe('extractTextUpdateFromChatGPTPayload', () => {
    it('handles response.output_text.delta events', () => {
        const result = extractTextUpdateFromChatGPTPayload({
            payload: {
                json: {
                    type: 'response.output_text.delta',
                    delta: 'Hello ',
                },
            },
        });

        expect(result).not.toBeNull();
        expect(result?.mode).toBe('delta');
        expect(result?.text).toBe('Hello ');
    });

    it('handles ChatGPT v message snapshots', () => {
        const result = extractTextUpdateFromChatGPTPayload({
            payload: {
                json: {
                    v: {
                        message: {
                            author: {role: 'assistant'},
                            content: {
                                parts: [
                                    {
                                        content_type: 'text',
                                        text: 'Full snapshot',
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        });

        expect(result).not.toBeNull();
        expect(result?.mode).toBe('full');
        expect(result?.text).toBe('Full snapshot');
    });

    it('concatenates content_block_delta arrays', () => {
        const result = extractTextUpdateFromChatGPTPayload({
            payload: {
                json: {
                    v: [
                        {
                            type: 'content_block_delta',
                            delta: {text: 'Hello'},
                        },
                        {
                            type: 'content_block_delta',
                            delta: {text: ' world'},
                        },
                    ],
                },
            },
        });

        expect(result).not.toBeNull();
        expect(result?.mode).toBe('delta');
        expect(result?.text).toBe('Hello world');
    });

    it('falls back to raw payload text', () => {
        const result = extractTextUpdateFromChatGPTPayload({
            payload: {
                json: null,
                raw: ' trailing space',
            },
        });

        expect(result).not.toBeNull();
        expect(result?.mode).toBe('delta');
        expect(result?.text).toBe(' trailing space');
    });
});
