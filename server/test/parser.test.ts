import {describe, it, expect} from 'bun:test';
import {parseToolCallsFromText} from '../src/prompts/parser';

describe('Tool Call Parser', () => {
    it('should extract tool calls and clean text', () => {
        const input = `
Some reasoning here.

\`\`\`json
{
  "tool_calls": [
    {
      "name": "get_weather",
      "arguments": {"location": "London"}
    }
  ]
}
\`\`\`

More text.
`;

        const {text, tool_calls} = parseToolCallsFromText(input);

        expect(text).toContain('Some reasoning here.');
        expect(text).toContain('More text.');
        expect(text).not.toContain('```json');
        expect(text).not.toContain('"tool_calls"');

        expect(tool_calls).toBeDefined();
        expect(tool_calls).toHaveLength(1);
        expect(tool_calls![0].name).toBe('get_weather');
    });

    it('should handle multiple tool blocks', () => {
        const input = `
Block 1:
\`\`\`json
{ "tool_calls": [{ "name": "a" }] }
\`\`\`

Block 2:
\`\`\`json
{ "tool_calls": [{ "name": "b" }] }
\`\`\`
`;
        const {text, tool_calls} = parseToolCallsFromText(input);

        expect(text).toContain('Block 1:');
        expect(text).toContain('Block 2:');
        expect(tool_calls).toHaveLength(2);
        expect(tool_calls![0].name).toBe('a');
        expect(tool_calls![1].name).toBe('b');
    });

    it('should return raw text if no tool calls found', () => {
        const input = 'Just some text.';
        const {text, tool_calls} = parseToolCallsFromText(input);

        expect(text).toBe(input);
        expect(tool_calls).toBeUndefined();
    });

    it('should handle malformed JSON gracefully', () => {
        const input = `
\`\`\`json
{ "tool_calls": [ ... broken ... }
\`\`\`
`;
        // Should ignore broken JSON and return text as is
        const {text, tool_calls} = parseToolCallsFromText(input);
        expect(text.trim()).toBe(input.trim());
        expect(tool_calls).toBeUndefined();
    });
});
