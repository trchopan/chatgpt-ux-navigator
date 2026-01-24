import { join } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { SKIP_DIR_NAMES } from './constants';
import type { TreeNode } from '../types/prompts';

export async function concatFirstLevelFiles(absDir: string, rawDirPath: string): Promise<string[]> {
    const out: string[] = [];

    let names: string[];
    try {
        names = await readdir(absDir, { encoding: 'utf8' });
    } catch {
        return [`[ERROR: Unable to read directory: ${absDir}]`];
    }

    names.sort((a, b) => a.localeCompare(b));

    for (const name of names) {
        if (SKIP_DIR_NAMES.has(name)) continue;

        const full = join(absDir, name);

        let st;
        try {
            st = await stat(full);
        } catch {
            continue;
        }

        if (!st.isFile()) continue;

        const rawFilePath = join(rawDirPath, name);

        let content: string;
        try {
            content = await Bun.file(full).text();
        } catch {
            content = `[ERROR: Unable to read file: ${full}]`;
        }

        out.push(`**File:** ${rawFilePath}`);
        out.push('');
        out.push('```');
        out.push(content.replace(/\r\n/g, '\n').trimEnd());
        out.push('```');
        out.push('');
    }

    return out;
}

export async function listPathsRecursive(absDir: string, baseDir: string = absDir): Promise<TreeNode[]> {
    const out: TreeNode[] = [];

    let names: string[];
    try {
        names = await readdir(absDir, { encoding: 'utf8' });
    } catch {
        return out;
    }

    names.sort((a, b) => a.localeCompare(b));

    for (const name of names) {
        const full = join(absDir, name);

        let st;
        try {
            st = await stat(full);
        } catch {
            continue;
        }

        if (st.isDirectory()) {
            if (SKIP_DIR_NAMES.has(name)) continue;
            const children = await listPathsRecursive(full, baseDir);
            out.push({ name, type: 'directory', children });
        } else if (st.isFile()) {
            out.push({ name, type: 'file' });
        }
    }

    return out;
}

export function formatTree(nodes: TreeNode[], indent: string = ''): string[] {
    const lines: string[] = [];
    nodes.forEach((node, i) => {
        const isLast = i === nodes.length - 1;
        const prefix = indent + (isLast ? '└── ' : '├── ');
        lines.push(prefix + node.name);
        if (node.type === 'directory' && node.children) {
            const childIndent = indent + (isLast ? '    ' : '│   ');
            lines.push(...formatTree(node.children, childIndent));
        }
    });
    return lines;
}
