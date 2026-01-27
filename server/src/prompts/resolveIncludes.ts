import {isAbsolute, resolve} from 'node:path';
import {stat} from 'node:fs/promises';
import {isPathInsideRoot} from '../fs/security';
import {
    concatFirstLevelFiles,
    formatTree,
    formatFileContent,
    listPathsRecursive,
} from '../fs/tree';

const INCLUDE_RE = /^\s*(@@?)(\S+)\s*$/;

async function processDirectory(absPath: string, rawPath: string, sigil: string): Promise<string[]> {
    if (sigil === '@@') {
        return concatFirstLevelFiles(absPath, rawPath);
    }

    const tree = await listPathsRecursive(absPath);
    const formattedTree = formatTree(tree);
    return [`\`\`\`\n${rawPath}`, ...formattedTree, '```'];
}

async function processFile(absPath: string, rawPath: string): Promise<string[]> {
    let content: string;
    try {
        content = await Bun.file(absPath).text();
    } catch {
        content = `[ERROR: Unable to read file: ${absPath}]`;
    }
    return formatFileContent(rawPath, content);
}

async function resolveIncludes(lines: string[], filesRoot: string): Promise<string[]> {
    const processedLines: string[] = [];

    for (const line of lines) {
        const match = line.match(INCLUDE_RE);
        if (!match) {
            processedLines.push(line);
            continue;
        }

        const sigil = match[1]!;
        const rawPath = match[2]!;
        const absPath = isAbsolute(rawPath) ? rawPath : resolve(filesRoot, rawPath);

        if (!isAbsolute(rawPath) && !isPathInsideRoot(absPath, filesRoot)) {
            processedLines.push(`[ERROR: Path escapes FILES_ROOT: ${absPath}]`);
            continue;
        }

        let st;
        try {
            st = await stat(absPath);
        } catch {
            processedLines.push(`[ERROR: Path does not exist: ${absPath}]`);
            continue;
        }

        if (st.isDirectory()) {
            const chunks = await processDirectory(absPath, rawPath, sigil);
            processedLines.push(...chunks);
        } else {
            const chunks = await processFile(absPath, rawPath);
            processedLines.push(...chunks);
        }
    }

    return processedLines;
}

export async function resolvePromptIncludes(lines: string[], filesRoot: string): Promise<string[]> {
    return resolveIncludes(lines, filesRoot);
}

export async function applyPromptTemplate(text: string, filesRoot: string): Promise<string> {
    const lines = text.split(/\r?\n/);
    const processedLines = await resolveIncludes(lines, filesRoot);
    return processedLines.join('\n');
}
