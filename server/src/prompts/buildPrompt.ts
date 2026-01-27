import {resolvePromptIncludes} from './resolveIncludes';

export async function buildPrompt(filePath: string, filesRoot: string): Promise<string> {
    let md: string;
    try {
        md = await Bun.file(filePath).text();
    } catch {
        return `[ERROR: Unable to read prompt file: ${filePath}]`;
    }

    const lines = md.split('\n');
    const processedLines = await resolvePromptIncludes(lines, filesRoot);

    return processedLines.join('\n').trimEnd() + '\n';
}
