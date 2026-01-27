
/**
 * Parses tool calls from the model's text output.
 * ChatGPT (via the prompts we inject) outputs tool calls in a markdown JSON block:
 * ```json
 * { "tool_calls": [ ... ] }
 * ```
 *
 * This function extracts that block, parses it, and returns the cleaned text
 * (with the block removed) and the tool calls array.
 */
export function parseToolCallsFromText(fullText: string): {
    text: string;
    tool_calls?: any[];
} {
    // Regex to find the JSON block containing "tool_calls".
    // We look for ```json ... ``` where the content has "tool_calls".
    // "s" flag (dotAll) is simulated with [\s\S] because JS RegExp dotAll is relatively new,
    // though safe in Bun. Let's use [\s\S]*? for non-greedy matching across lines.
    const jsonBlockRegex = /```json\s*(\{[\s\S]*?"tool_calls"[\s\S]*?\})\s*```/g;

    let match;
    let foundToolCalls: any[] = [];
    let cleanedText = fullText;

    // We iterate in case there are multiple blocks, though usually there's just one.
    // If there are multiple, we'll merge the tool calls and remove all blocks.
    while ((match = jsonBlockRegex.exec(fullText)) !== null) {
        const fullMatch = match[0];
        const jsonContent = match[1] || '';

        try {
            const parsed = JSON.parse(jsonContent);
            if (Array.isArray(parsed.tool_calls)) {
                foundToolCalls = foundToolCalls.concat(parsed.tool_calls);
                // Remove the block from the text
                cleanedText = cleanedText.replace(fullMatch, '');
            }
        } catch (e) {
            // If JSON parse fails, ignore this block (treat as regular text)
            console.warn('Failed to parse potential tool_calls JSON block:', e);
        }
    }

    cleanedText = cleanedText.trim();

    if (foundToolCalls.length > 0) {
        return {
            text: cleanedText,
            tool_calls: foundToolCalls,
        };
    }

    return {text: fullText};
}
